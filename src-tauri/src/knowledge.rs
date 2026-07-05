//! Knowledge base persistence, vector store management, and IPC helpers.

use crate::knowledge_indexer::index_document;
use crate::knowledge_retriever::format_knowledge_context;
use crate::models::*;
use base64::Engine;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

pub struct KnowledgeStoreManager {
    data_dir: PathBuf,
}

impl KnowledgeStoreManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    pub fn knowledge_root(&self) -> PathBuf {
        self.data_dir.join("knowledge")
    }
}

fn map_knowledge_base(
    id: String,
    name: String,
    description: Option<String>,
    document_count: i64,
    chunk_count: i64,
    created_at: String,
    updated_at: String,
) -> KnowledgeBase {
    KnowledgeBase {
        id,
        name,
        description,
        document_count,
        chunk_count,
        created_at,
        updated_at,
    }
}

pub fn list_knowledge_bases_db(conn: &Connection) -> Result<Vec<KnowledgeBase>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT kb.id, kb.name, kb.description, kb.created_at, kb.updated_at,
                    COUNT(DISTINCT d.id) AS doc_count,
                    COALESCE(SUM(d.chunk_count), 0) AS chunk_count
             FROM knowledge_bases kb
             LEFT JOIN knowledge_documents d ON d.kbase_id = kb.id
             GROUP BY kb.id
             ORDER BY kb.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(map_knowledge_base(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(5)?,
                row.get(6)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

pub fn list_knowledge_documents_db(conn: &Connection, kbase_id: &str) -> Result<Vec<KnowledgeDocument>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kbase_id, name, kind, size_bytes, status, chunk_count, error, created_at, updated_at
             FROM knowledge_documents
             WHERE kbase_id = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![kbase_id], |row| {
            Ok(KnowledgeDocument {
                id: row.get(0)?,
                kbase_id: row.get(1)?,
                name: row.get(2)?,
                kind: row.get(3)?,
                size_bytes: row.get(4)?,
                status: row.get(5)?,
                chunk_count: row.get(6)?,
                error: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

fn delete_document_chunks(conn: &Connection, document_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM knowledge_chunks WHERE document_id = ?1",
        params![document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_dir_all(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

#[tauri::command]
pub fn list_knowledge_bases(state: State<crate::AppState>) -> Result<Vec<KnowledgeBase>, String> {
    let conn = state.db.conn.lock().unwrap();
    list_knowledge_bases_db(&conn)
}

#[tauri::command]
pub fn create_knowledge_base(
    state: State<crate::AppState>,
    input: CreateKnowledgeBaseInput,
) -> Result<KnowledgeBase, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO knowledge_bases (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.name, input.description, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(map_knowledge_base(
        id,
        input.name,
        input.description,
        0,
        0,
        now.clone(),
        now,
    ))
}

#[tauri::command]
pub fn update_knowledge_base(
    state: State<crate::AppState>,
    input: UpdateKnowledgeBaseInput,
) -> Result<KnowledgeBase, String> {
    let conn = state.db.conn.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(name) = &input.name {
        conn.execute(
            "UPDATE knowledge_bases SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, input.id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(desc) = &input.description {
        conn.execute(
            "UPDATE knowledge_bases SET description = ?1, updated_at = ?2 WHERE id = ?3",
            params![desc, now, input.id],
        )
        .map_err(|e| e.to_string())?;
    }

    let base = conn
        .query_row(
            "SELECT id, name, description, created_at, updated_at FROM knowledge_bases WHERE id = ?1",
            params![input.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let doc_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM knowledge_documents WHERE kbase_id = ?1",
            params![input.id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let chunk_count: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(chunk_count), 0) FROM knowledge_documents WHERE kbase_id = ?1",
            params![input.id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(map_knowledge_base(
        base.0, base.1, base.2, doc_count, chunk_count, base.3, base.4,
    ))
}

#[tauri::command]
pub fn delete_knowledge_base(state: State<crate::AppState>, id: String) -> Result<(), String> {
    {
        let conn = state.db.conn.lock().unwrap();
        conn.execute("DELETE FROM knowledge_bases WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    remove_dir_all(&state.knowledge_stores.knowledge_root().join(&id));
    Ok(())
}

#[tauri::command]
pub fn list_knowledge_documents(
    state: State<crate::AppState>,
    kbase_id: String,
) -> Result<Vec<KnowledgeDocument>, String> {
    let conn = state.db.conn.lock().unwrap();
    list_knowledge_documents_db(&conn, &kbase_id)
}

fn kind_from_filename(name: &str) -> String {
    let ext = name.split('.').next_back().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "pdf" => "pdf",
        "docx" => "word",
        "doc" => "word",
        "xlsx" | "xls" | "csv" => "excel",
        "txt" | "md" => "text",
        _ => "other",
    }
    .to_string()
}

async fn ingest_document_bytes(
    app: AppHandle,
    conn_arc: std::sync::Arc<std::sync::Mutex<Connection>>,
    knowledge_root: PathBuf,
    input: IngestKnowledgeDocumentInput,
    bytes: Vec<u8>,
) -> Result<KnowledgeDocument, String> {
    let doc_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let ext = input.name.split('.').next_back().unwrap_or("bin");
    let storage_dir = knowledge_root.join(&input.kbase_id).join(&doc_id);
    std::fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;
    let storage_path = storage_dir.join(format!("original.{}", ext));
    std::fs::write(&storage_path, &bytes).map_err(|e| e.to_string())?;
    let storage_path_str = storage_path.to_string_lossy().to_string();

    {
        let conn = conn_arc.lock().unwrap();
        conn.execute(
            "INSERT INTO knowledge_documents (id, kbase_id, name, kind, size_bytes, status, chunk_count, storage_path, error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, NULL, ?7, ?8)",
            params![
                doc_id,
                input.kbase_id,
                input.name,
                input.kind,
                bytes.len() as i64,
                storage_path_str,
                now,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE knowledge_bases SET updated_at = ?1 WHERE id = ?2",
            params![now, input.kbase_id],
        )
        .ok();
    }

    let doc = KnowledgeDocument {
        id: doc_id.clone(),
        kbase_id: input.kbase_id.clone(),
        name: input.name.clone(),
        kind: input.kind.clone(),
        size_bytes: bytes.len() as i64,
        status: "pending".to_string(),
        chunk_count: 0,
        error: None,
        created_at: now.clone(),
        updated_at: now,
    };

    let name = input.name.clone();
    let kind = input.kind.clone();
    let kbase_id = input.kbase_id.clone();
    tauri::async_runtime::spawn(async move {
        index_document(app, conn_arc, doc_id, kbase_id, name, kind, bytes).await;
    });

    Ok(doc)
}

#[tauri::command]
pub async fn ingest_knowledge_document(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    input: IngestKnowledgeDocumentInput,
) -> Result<KnowledgeDocument, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.data_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    ingest_document_bytes(
        app,
        state.db.conn.clone(),
        state.knowledge_stores.knowledge_root(),
        input,
        bytes,
    )
    .await
}

#[tauri::command]
pub fn delete_knowledge_document(
    state: State<crate::AppState>,
    document_id: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    let storage_path: String = conn
        .query_row(
            "SELECT storage_path FROM knowledge_documents WHERE id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    delete_document_chunks(&conn, &document_id)?;
    conn.execute(
        "DELETE FROM knowledge_documents WHERE id = ?1",
        params![document_id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(parent) = Path::new(&storage_path).parent() {
        remove_dir_all(parent);
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
pub struct IngestKnowledgeFromPathsInput {
    pub kbase_id: String,
    pub paths: Vec<String>,
}

#[tauri::command]
pub async fn ingest_knowledge_document_from_paths(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    input: IngestKnowledgeFromPathsInput,
) -> Result<Vec<KnowledgeDocument>, String> {
    let mut docs = Vec::new();
    for path in &input.paths {
        let path_buf = PathBuf::from(path);
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let bytes = std::fs::read(&path_buf).map_err(|e| format!("Failed to read {}: {}", path, e))?;
        let kind = kind_from_filename(&name);
        let doc = ingest_document_bytes(
            app.clone(),
            state.db.conn.clone(),
            state.knowledge_stores.knowledge_root(),
            IngestKnowledgeDocumentInput {
                kbase_id: input.kbase_id.clone(),
                name,
                kind,
                data_base64: String::new(),
            },
            bytes,
        )
        .await?;
        docs.push(doc);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn retrieve_knowledge_context(
    state: State<'_, crate::AppState>,
    input: RetrieveKnowledgeContextInput,
) -> Result<serde_json::Value, String> {
    let top_k = input.top_k.unwrap_or(8);
    let conn = state.db.conn.lock().unwrap();
    let hits = crate::knowledge_retriever::keyword_search(
        &conn,
        &input.kbase_ids,
        &input.query,
        top_k,
    )?;

    Ok(serde_json::json!({
        "chunks": hits,
        "context": format_knowledge_context(&hits),
    }))
}
