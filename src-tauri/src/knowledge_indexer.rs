//! Async knowledge document indexing pipeline (FTS + embedding).

use crate::knowledge_chunker::chunk_text;
use crate::knowledge_parser::parse_document_bytes;
use crate::knowledge_retriever::sync_chunk_fts;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct IndexProgress {
    pub document_id: String,
    pub kbase_id: String,
    pub status: String,
    pub chunk_count: i64,
    pub error: Option<String>,
}

pub async fn index_document(
    app: AppHandle,
    conn: Arc<Mutex<Connection>>,
    document_id: String,
    kbase_id: String,
    name: String,
    kind: String,
    file_bytes: Vec<u8>,
) {
    let emit = |progress: IndexProgress| {
        let _ = app.emit(
            "knowledge-index-progress",
            serde_json::json!({
                "document_id": progress.document_id,
                "kbase_id": progress.kbase_id,
                "status": progress.status,
                "chunk_count": progress.chunk_count,
                "error": progress.error,
            }),
        );
    };

    let set_status = |status: &str, chunk_count: i64, error: Option<&str>| {
        let conn = conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE knowledge_documents SET status = ?1, chunk_count = ?2, error = ?3, updated_at = ?4 WHERE id = ?5",
            params![status, chunk_count, error, now, document_id],
        );
        emit(IndexProgress {
            document_id: document_id.clone(),
            kbase_id: kbase_id.clone(),
            status: status.to_string(),
            chunk_count,
            error: error.map(|s| s.to_string()),
        });
    };

    set_status("indexing", 0, None);

    let parsed = match parse_document_bytes(&name, &kind, &file_bytes) {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => {
            set_status("failed", 0, Some("文档中没有可提取的文本"));
            return;
        }
        Err(e) => {
            set_status("failed", 0, Some(&e));
            return;
        }
    };

    let chunks = chunk_text(&parsed);
    if chunks.is_empty() {
        set_status("failed", 0, Some("分块后没有可用内容"));
        return;
    }

    let mut indexed = 0i64;
    for (idx, chunk_content) in chunks.iter().enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        {
            let conn = conn.lock().unwrap();
            if let Err(e) = conn.execute(
                "INSERT INTO knowledge_chunks (id, document_id, kbase_id, chunk_index, content, embedding, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                params![chunk_id, document_id, kbase_id, idx as i64, chunk_content, now],
            ) {
                set_status("failed", indexed, Some(&e.to_string()));
                return;
            }
            let _ = sync_chunk_fts(&conn, &chunk_id, chunk_content);
        }
        indexed += 1;
    }

    {
        let conn = conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE knowledge_documents SET status = 'ready', chunk_count = ?1, error = NULL, updated_at = ?2 WHERE id = ?3",
            params![indexed, now, document_id],
        );
        let _ = conn.execute(
            "UPDATE knowledge_bases SET updated_at = ?1 WHERE id = ?2",
            params![now, kbase_id],
        );
    }

    emit(IndexProgress {
        document_id,
        kbase_id,
        status: "ready".to_string(),
        chunk_count: indexed,
        error: None,
    });
}
