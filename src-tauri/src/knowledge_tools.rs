//! Knowledge base tool execution for AI loop.

use crate::knowledge::{list_knowledge_bases_db};
use crate::knowledge_retriever::keyword_search;
use crate::models::KnowledgeChunkHit;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

pub struct KnowledgeToolCtx {
    pub db: Arc<Mutex<Connection>>,
    pub enabled_kbase_ids: Vec<String>,
}

const READ_CHAR_LIMIT: usize = 12_000;

fn resolve_kbase_ids(
    conn: &Connection,
    enabled: &[String],
    kbase_id: Option<&str>,
) -> Result<Vec<String>, String> {
    if let Some(id) = kbase_id {
        if enabled.is_empty() || enabled.contains(&id.to_string()) {
            return Ok(vec![id.to_string()]);
        }
        return Ok(Vec::new());
    }
    if enabled.is_empty() {
        let all = list_knowledge_bases_db(conn)?;
        return Ok(all.into_iter().map(|b| b.id).collect());
    }
    Ok(enabled.to_vec())
}

pub fn tool_list_knowledge_bases(ctx: &KnowledgeToolCtx) -> Result<String, String> {
    let conn = ctx.db.lock().unwrap();
    let all = list_knowledge_bases_db(&conn)?;
    let filtered: Vec<_> = if ctx.enabled_kbase_ids.is_empty() {
        all
    } else {
        all.into_iter()
            .filter(|b| ctx.enabled_kbase_ids.contains(&b.id))
            .collect()
    };
    if filtered.is_empty() {
        return Ok("No knowledge bases available.".into());
    }
    let mut lines = vec!["Knowledge bases:".to_string()];
    for b in filtered {
        lines.push(format!(
            "- id={} name=\"{}\" documents={} chunks={}",
            b.id, b.name, b.document_count, b.chunk_count
        ));
    }
    Ok(lines.join("\n"))
}

pub fn tool_search_knowledge(
    ctx: &KnowledgeToolCtx,
    query: &str,
    kbase_id: Option<&str>,
    limit: usize,
) -> Result<String, String> {
    let conn = ctx.db.lock().unwrap();
    let kbase_ids = resolve_kbase_ids(&conn, &ctx.enabled_kbase_ids, kbase_id)?;
    if kbase_ids.is_empty() {
        return Ok("No enabled knowledge bases to search.".into());
    }
    let hits = keyword_search(&conn, &kbase_ids, query, limit.max(1).min(20))?;
    format_search_results(&hits)
}

fn format_search_results(hits: &[KnowledgeChunkHit]) -> Result<String, String> {
    if hits.is_empty() {
        return Ok("No matching knowledge chunks found.".into());
    }
    let mut lines = vec![format!("Found {} chunk(s):", hits.len())];
    for hit in hits {
        let excerpt: String = hit.content.chars().take(400).collect();
        lines.push(format!(
            "- kbase=\"{}\" document=\"{}\" document_id={} chunk_index={}\n  {}",
            hit.kbase_name, hit.document_name, hit.document_id, hit.chunk_index, excerpt
        ));
    }
    Ok(lines.join("\n"))
}

pub fn tool_read_knowledge_document(
    ctx: &KnowledgeToolCtx,
    document_id: &str,
    chunk_index: Option<i64>,
    limit: Option<i64>,
) -> Result<String, String> {
    let conn = ctx.db.lock().unwrap();

    let (kbase_id, doc_name, status): (String, String, String) = conn
        .query_row(
            "SELECT kbase_id, name, status FROM knowledge_documents WHERE id = ?1",
            params![document_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("Document not found: {}", e))?;

    if !ctx.enabled_kbase_ids.is_empty() && !ctx.enabled_kbase_ids.contains(&kbase_id) {
        return Err("Document is not in an enabled knowledge base.".into());
    }
    if status != "ready" {
        return Err(format!("Document is not ready (status: {})", status));
    }

    if let Some(start) = chunk_index {
        let lim = limit.unwrap_or(1).max(1).min(10) as i64;
        let mut stmt = conn
            .prepare(
                "SELECT chunk_index, content FROM knowledge_chunks
                 WHERE document_id = ?1 AND chunk_index >= ?2
                 ORDER BY chunk_index ASC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![document_id, start, lim], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = format!("# {} (chunks from index {})\n\n", doc_name, start);
        let mut total = 0usize;
        for row in rows.flatten() {
            if total + row.1.len() > READ_CHAR_LIMIT {
                out.push_str("\n...(truncated)");
                break;
            }
            out.push_str(&format!("## Chunk {}\n{}\n\n", row.0, row.1));
            total += row.1.len();
        }
        return Ok(out);
    }

    let mut stmt = conn
        .prepare(
            "SELECT chunk_index, content FROM knowledge_chunks
             WHERE document_id = ?1 ORDER BY chunk_index ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![document_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = format!("# {}\n\n", doc_name);
    let mut total = 0usize;
    for row in rows.flatten() {
        if total + row.1.len() > READ_CHAR_LIMIT {
            out.push_str("\n...(truncated — use chunk_index/limit to read more)");
            break;
        }
        out.push_str(&format!("## Chunk {}\n{}\n\n", row.0, row.1));
        total += row.1.len();
    }
    Ok(out)
}
