//! Memory retrieval: semantic vector search with keyword FTS fallback.

use crate::models::Memory;
use crate::vector_store::VectorStore;
use rusqlite::{params, Connection};

/// Retrieve top-K memories for a project (sync path after embedding is ready).
pub fn search_with_embedding(
    conn: &Connection,
    store: &VectorStore,
    project_id: &str,
    query_embedding: &[f32],
    top_k: usize,
) -> Result<Vec<Memory>, String> {
    let k = top_k.max(1);
    let results = store.search(query_embedding, k, 0.6, 0.25, 0.15);
    let mut memories = Vec::new();
    for result in results {
        if let Some(m) = fetch_memory(conn, &result.id, Some(project_id))? {
            memories.push(m);
        }
    }
    if !memories.is_empty() {
        bump_access(conn, &memories)?;
    }
    Ok(memories)
}

/// Full retrieval: tries vector search when embedding available, else keyword fallback.
pub fn retrieve_sync(
    conn: &Connection,
    store: &VectorStore,
    project_id: &str,
    query: &str,
    top_k: usize,
    query_embedding: Option<&[f32]>,
) -> Result<Vec<Memory>, String> {
    let k = top_k.max(1);
    if !store.is_corrupted() {
        if let Some(embedding) = query_embedding {
            let memories = search_with_embedding(conn, store, project_id, embedding, k)?;
            if !memories.is_empty() {
                return Ok(memories);
            }
        }
    }
    keyword_search(conn, project_id, query, k)
}

pub fn keyword_search(
    conn: &Connection,
    project_id: &str,
    query: &str,
    top_k: usize,
) -> Result<Vec<Memory>, String> {
    let pattern = format!("%{}%", query.replace('%', "").replace('_', ""));

    // Prefer FTS virtual table when populated
    let fts_sql = "SELECT m.id FROM memories_fts f
        JOIN memories m ON m.rowid = f.rowid
        WHERE memories_fts MATCH ?1 AND m.project_id = ?2
        LIMIT ?3";
    if let Ok(mut stmt) = conn.prepare(fts_sql) {
        let ids: Vec<String> = stmt
            .query_map(params![query, project_id, top_k as i64], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        if !ids.is_empty() {
            let mut out = Vec::new();
            for id in ids {
                if let Some(m) = fetch_memory(conn, &id, Some(project_id))? {
                    out.push(m);
                }
            }
            if !out.is_empty() {
                bump_access(conn, &out)?;
                return Ok(out);
            }
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at
             FROM memories
             WHERE project_id = ?1 AND (content LIKE ?2 OR IFNULL(summary,'') LIKE ?2)
             ORDER BY importance DESC, updated_at DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id, pattern, top_k as i64], map_memory_row)
        .map_err(|e| e.to_string())?;

    let mut memories = Vec::new();
    for row in rows.flatten() {
        memories.push(row);
    }
    bump_access(conn, &memories)?;
    Ok(memories)
}

pub fn format_memory_context(memories: &[Memory]) -> String {
    if memories.is_empty() {
        return String::new();
    }
    let mut lines = vec!["## Relevant long-term memories".to_string()];
    for m in memories {
        let label = m.summary.as_deref().unwrap_or(&m.content);
        lines.push(format!("- [{}] {}", m.r#type, label.chars().take(400).collect::<String>()));
    }
    lines.join("\n")
}

fn fetch_memory(
    conn: &Connection,
    id: &str,
    project_id: Option<&str>,
) -> Result<Option<Memory>, String> {
    let sql = if project_id.is_some() {
        "SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at
         FROM memories WHERE id = ?1 AND project_id = ?2"
    } else {
        "SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at
         FROM memories WHERE id = ?1"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let result = if let Some(pid) = project_id {
        stmt.query_row(params![id, pid], map_memory_row)
    } else {
        stmt.query_row(params![id], map_memory_row)
    };

    match result {
        Ok(m) => Ok(Some(m)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn map_memory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        project_id: row.get(1)?,
        r#type: row.get(2)?,
        content: row.get(3)?,
        summary: row.get(4)?,
        importance: row.get(5)?,
        source_session_id: row.get(6)?,
        access_count: row.get(7)?,
        last_accessed_at: row.get(8)?,
        encrypted: row.get::<_, i32>(9)? != 0,
        created_at: row.get(10)?,
    })
}

fn bump_access(conn: &Connection, memories: &[Memory]) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    for m in memories {
        conn.execute(
            "UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?1 WHERE id = ?2",
            params![now, m.id],
        )
        .ok();
    }
    Ok(())
}

pub fn sync_fts(conn: &Connection, memory_id: &str, content: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO memories_fts(rowid, content) SELECT rowid, ?2 FROM memories WHERE id = ?1",
        params![memory_id, content],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn keyword_search_finds_content() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(&dir.path().to_path_buf()).unwrap();
        let conn = db.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO memories (id, project_id, type, content, importance, encrypted, created_at, updated_at)
             VALUES ('m1', 'p1', 'fact', 'Rust ownership rules', 0.8, 0, ?1, ?1)",
            params![now],
        )
        .unwrap();
        let found = keyword_search(&conn, "p1", "ownership", 5).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "m1");
    }
}
