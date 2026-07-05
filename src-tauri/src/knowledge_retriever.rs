//! Knowledge base vector + FTS retrieval.

use crate::models::KnowledgeChunkHit;
use crate::vector_store::VectorStore;
use rusqlite::{params, Connection};
use std::sync::Arc;

pub fn format_knowledge_context(hits: &[KnowledgeChunkHit]) -> String {
    if hits.is_empty() {
        return String::new();
    }
    let mut lines = vec!["## Relevant knowledge base excerpts".to_string()];
    for hit in hits {
        let excerpt: String = hit.content.chars().take(600).collect();
        lines.push(format!(
            "- [{} / {} #chunk-{}] {}",
            hit.kbase_name, hit.document_name, hit.chunk_index, excerpt
        ));
    }
    lines.join("\n")
}

pub fn search_with_embedding(
    conn: &Connection,
    store: &VectorStore,
    kbase_ids: &[String],
    query_embedding: &[f32],
    top_k: usize,
) -> Result<Vec<KnowledgeChunkHit>, String> {
    let k = top_k.max(1);
    let results = store.search(query_embedding, k * kbase_ids.len().max(1), 0.7, 0.15, 0.15);
    let mut hits = Vec::new();
    for result in results {
        if let Some(hit) = fetch_chunk_hit(conn, &result.id, kbase_ids, result.score as f64)? {
            hits.push(hit);
        }
    }
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(k);
    Ok(hits)
}

pub fn keyword_search(
    conn: &Connection,
    kbase_ids: &[String],
    query: &str,
    top_k: usize,
) -> Result<Vec<KnowledgeChunkHit>, String> {
    if kbase_ids.is_empty() {
        return Ok(Vec::new());
    }
    let k = top_k.max(1);
    let placeholders = kbase_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");

    let fts_sql = format!(
        "SELECT c.id FROM knowledge_chunks_fts f
         JOIN knowledge_chunks c ON c.rowid = f.rowid
         WHERE knowledge_chunks_fts MATCH ?1 AND c.kbase_id IN ({})
         LIMIT ?",
        placeholders
    );

    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(query.to_string())];
    for id in kbase_ids {
        params_vec.push(Box::new(id.clone()));
    }
    params_vec.push(Box::new(k as i64));

    let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    if let Ok(mut stmt) = conn.prepare(&fts_sql) {
        let ids: Vec<String> = stmt
            .query_map(param_refs.as_slice(), |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        if !ids.is_empty() {
            let mut hits = Vec::new();
            for id in ids {
                if let Some(hit) = fetch_chunk_hit(conn, &id, kbase_ids, 0.5)? {
                    hits.push(hit);
                }
            }
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
    }

    let like_sql = format!(
        "SELECT c.id, c.document_id, c.kbase_id, c.chunk_index, c.content,
                kb.name, d.name
         FROM knowledge_chunks c
         JOIN knowledge_bases kb ON kb.id = c.kbase_id
         JOIN knowledge_documents d ON d.id = c.document_id
         WHERE c.kbase_id IN ({}) AND c.content LIKE ?
         ORDER BY c.chunk_index ASC
         LIMIT ?",
        placeholders
    );
    let pattern = format!("%{}%", query.replace('%', "").replace('_', ""));
    let mut like_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    for id in kbase_ids {
        like_params.push(Box::new(id.clone()));
    }
    like_params.push(Box::new(pattern));
    like_params.push(Box::new(k as i64));
    let like_refs: Vec<&dyn rusqlite::ToSql> = like_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&like_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(like_refs.as_slice(), |row| {
            Ok(KnowledgeChunkHit {
                id: row.get(0)?,
                document_id: row.get(1)?,
                kbase_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content: row.get(4)?,
                kbase_name: row.get(5)?,
                document_name: row.get(6)?,
                score: 0.4,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

pub fn retrieve_sync(
    conn: &Connection,
    stores: &[(String, Arc<VectorStore>)],
    kbase_ids: &[String],
    query: &str,
    top_k: usize,
    query_embedding: Option<&[f32]>,
) -> Result<Vec<KnowledgeChunkHit>, String> {
    if kbase_ids.is_empty() {
        return Ok(Vec::new());
    }
    let k = top_k.max(1);

    if let Some(embedding) = query_embedding {
        let mut all_hits = Vec::new();
        for (kbase_id, store) in stores {
            if !kbase_ids.contains(kbase_id) || store.is_corrupted() {
                continue;
            }
            let mut hits = search_with_embedding(conn, store, &[kbase_id.clone()], embedding, k)?;
            all_hits.append(&mut hits);
        }
        if !all_hits.is_empty() {
            all_hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
            all_hits.truncate(k);
            return Ok(all_hits);
        }
    }

    keyword_search(conn, kbase_ids, query, k)
}

fn fetch_chunk_hit(
    conn: &Connection,
    chunk_id: &str,
    kbase_ids: &[String],
    score: f64,
) -> Result<Option<KnowledgeChunkHit>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.document_id, c.kbase_id, c.chunk_index, c.content, kb.name, d.name
             FROM knowledge_chunks c
             JOIN knowledge_bases kb ON kb.id = c.kbase_id
             JOIN knowledge_documents d ON d.id = c.document_id
             WHERE c.id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let hit = stmt
        .query_row(params![chunk_id], |row| {
            Ok(KnowledgeChunkHit {
                id: row.get(0)?,
                document_id: row.get(1)?,
                kbase_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content: row.get(4)?,
                kbase_name: row.get(5)?,
                document_name: row.get(6)?,
                score,
            })
        })
        .ok();

    Ok(hit.filter(|h| kbase_ids.contains(&h.kbase_id)))
}

pub fn sync_chunk_fts(conn: &Connection, chunk_id: &str, content: &str) -> Result<(), String> {
    let rowid: i64 = conn
        .query_row(
            "SELECT rowid FROM knowledge_chunks WHERE id = ?1",
            params![chunk_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (?1, ?2)",
        params![rowid, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn seed_chunk(conn: &Connection, kbase_id: &str, content: &str) {
        let now = "2026-01-01T00:00:00Z";
        conn.execute_batch(&format!(
            "INSERT INTO knowledge_bases (id, name, description, created_at, updated_at)
             VALUES ('{kbase_id}', 'Test KB', NULL, '{now}', '{now}');
             INSERT INTO knowledge_documents (id, kbase_id, name, kind, size_bytes, status, chunk_count, storage_path, error, created_at, updated_at)
             VALUES ('doc1', '{kbase_id}', 'doc.txt', 'text', 10, 'ready', 1, '/tmp', NULL, '{now}', '{now}');"
        ))
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_chunks (id, document_id, kbase_id, chunk_index, content, embedding, created_at)
             VALUES ('chunk1', 'doc1', ?1, 0, ?2, NULL, ?3)",
            params![kbase_id, content, now],
        )
        .unwrap();
    }

    #[test]
    fn keyword_search_like_fallback_binds_params() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE knowledge_bases (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE knowledge_documents (id TEXT PRIMARY KEY, kbase_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, size_bytes INTEGER NOT NULL, status TEXT NOT NULL, chunk_count INTEGER NOT NULL, storage_path TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, kbase_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, embedding BLOB, created_at TEXT NOT NULL);
             CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(content);",
        )
        .unwrap();
        seed_chunk(&conn, "kb1", "hello knowledge content");
        let hits = keyword_search(&conn, &["kb1".into()], "content", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].content.contains("knowledge"));
    }
}
