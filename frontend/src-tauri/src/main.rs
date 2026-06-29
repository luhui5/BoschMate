mod ai_client;
mod ai_loop;
mod audit;
mod code_editor;
mod code_graph;
mod crypto;
mod db;
mod error_handler;
mod fs_ops;
mod git_ops;
mod models;
mod sandbox;
mod vector_store;

use ai_client::{stream_chat as ai_stream_chat, list_ollama_models as ai_list_ollama_models};
use db::Database;
use models::*;
use rusqlite::params;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct AppState {
    db: Database,
    projects_dir: Mutex<PathBuf>,
    vector_store: Mutex<vector_store::VectorStore>,
    data_dir: PathBuf,
}

// ── Project commands ──

#[tauri::command]
fn list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, local_path, language, framework, git_remote, git_branch, ci_status, created_at, opened_at, last_summary FROM projects ORDER BY opened_at DESC NULLS LAST")
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                local_path: row.get(2)?,
                language: row.get(3)?,
                framework: row.get(4)?,
                git_remote: row.get(5)?,
                git_branch: row.get(6)?,
                ci_status: row.get(7)?,
                created_at: row.get(8)?,
                opened_at: row.get(9)?,
                last_summary: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

#[tauri::command]
fn create_project(state: State<AppState>, input: CreateProjectInput) -> Result<Project, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, local_path, language, framework, created_at, opened_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.name, input.local_path, input.language, input.framework, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Project {
        id,
        name: input.name,
        local_path: input.local_path,
        language: input.language,
        framework: input.framework,
        git_remote: None,
        git_branch: None,
        ci_status: "none".into(),
        created_at: now.clone(),
        opened_at: Some(now),
        last_summary: None,
    })
}

#[tauri::command]
fn remove_project(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_project(state: State<AppState>, id: String) -> Result<Project, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.db.conn.lock().unwrap();

    // Read git info from filesystem
    let path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let (git_remote, git_branch) = match git_ops::get_status(PathBuf::from(&path).as_path()) {
        Ok(status) => {
            // Try to read git remote
            let remote = std::process::Command::new("git")
                .args(["remote", "get-url", "origin"])
                .current_dir(&path)
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string());
            (remote, Some(status.branch))
        }
        Err(_) => (None, None),
    };

    conn.execute(
        "UPDATE projects SET opened_at = ?1, git_remote = ?2, git_branch = ?3 WHERE id = ?4",
        params![now, git_remote, git_branch, id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, local_path, language, framework, git_remote, git_branch, ci_status, created_at, opened_at, last_summary FROM projects WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    stmt.query_row(params![id], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            local_path: row.get(2)?,
            language: row.get(3)?,
            framework: row.get(4)?,
            git_remote: row.get(5)?,
            git_branch: row.get(6)?,
            ci_status: row.get(7)?,
            created_at: row.get(8)?,
            opened_at: row.get(9)?,
            last_summary: row.get(10)?,
        })
    })
    .map_err(|e| e.to_string())
}

// ── Session commands ──

#[tauri::command]
fn list_sessions(state: State<AppState>, project_id: String) -> Result<Vec<Session>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, mode, status, parent_id, token_count, created_at, updated_at FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map(params![project_id], |row| {
            Ok(Session {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                mode: row.get(3)?,
                status: row.get(4)?,
                parent_id: row.get(5)?,
                token_count: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
fn create_session(state: State<AppState>, input: CreateSessionInput) -> Result<Session, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO sessions (id, project_id, title, mode, status, token_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', 0, ?5, ?6)",
        params![id, input.project_id, input.title, input.mode, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Session {
        id,
        project_id: input.project_id,
        title: input.title,
        mode: input.mode,
        status: "active".into(),
        parent_id: None,
        token_count: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
fn delete_session(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_session_title(state: State<AppState>, id: String, title: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, chrono::Utc::now().to_rfc3339(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Message commands ──

#[tauri::command]
fn list_messages(state: State<AppState>, session_id: String) -> Result<Vec<ChatMessage>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, session_id, role, content, mode, tool_calls, diffs, file_refs, token_usage, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map(params![session_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                mode: row.get(4)?,
                tool_calls: row.get::<_, Option<String>>(5).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()),
                diffs: row.get::<_, Option<String>>(6).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()),
                file_refs: row.get::<_, Option<String>>(7).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()),
                token_usage: row.get::<_, Option<String>>(8).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(messages)
}

#[tauri::command]
fn send_message(state: State<AppState>, input: SendMessageInput) -> Result<ChatMessage, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn.lock().unwrap();

    // Store user message
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, mode, created_at) VALUES (?1, ?2, 'user', ?3, ?4, ?5)",
        params![id, input.session_id, input.content, input.mode, now],
    )
    .map_err(|e| e.to_string())?;

    // Update session timestamp
    conn.execute(
        "UPDATE sessions SET updated_at = ?1, token_count = token_count + ?2 WHERE id = ?3",
        params![now, input.content.len() as i64 / 4, input.session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(ChatMessage {
        id,
        session_id: input.session_id,
        role: "user".into(),
        content: input.content,
        mode: input.mode,
        tool_calls: None,
        diffs: None,
        file_refs: None,
        token_usage: None,
        created_at: now,
    })
}

#[tauri::command]
fn save_assistant_message(
    state: State<AppState>,
    session_id: String,
    content: String,
    mode: Option<String>,
) -> Result<ChatMessage, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, mode, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5)",
        params![id, session_id, content, mode, now],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE sessions SET updated_at = ?1, token_count = token_count + ?2 WHERE id = ?3",
        params![now, content.len() as i64 / 4, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(ChatMessage {
        id,
        session_id,
        role: "assistant".into(),
        content,
        mode,
        tool_calls: None,
        diffs: None,
        file_refs: None,
        token_usage: None,
        created_at: now,
    })
}

// ── File system commands ──

#[tauri::command]
fn list_directory(state: State<AppState>, project_id: String, path: Option<String>) -> Result<Vec<FileEntry>, String> {
    let conn = state.db.conn.lock().unwrap();
    let project_path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", params![project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let root = PathBuf::from(&project_path);
    let depth = if path.is_none() { 2 } else { 1 };
    let target = match &path {
        Some(p) => root.join(p.trim_start_matches('/').trim_start_matches('\\')),
        None => root.clone(),
    };
    Ok(fs_ops::list_directory(&target, depth, false))
}

#[tauri::command]
fn read_file(state: State<AppState>, project_id: String, input: ReadFileInput) -> Result<String, String> {
    let conn = state.db.conn.lock().unwrap();
    let project_path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", params![project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    fs_ops::read_file(
        PathBuf::from(&project_path).as_path(),
        &input.path,
        input.offset,
        input.limit,
    )
}

#[tauri::command]
fn write_file(state: State<AppState>, project_id: String, path: String, content: String) -> Result<String, String> {
    let conn = state.db.conn.lock().unwrap();
    let project_path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", params![project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    fs_ops::write_file(PathBuf::from(&project_path).as_path(), &path, &content)
}

#[tauri::command]
fn glob_search(state: State<AppState>, project_id: String, input: GlobInput) -> Result<Vec<FileEntry>, String> {
    let conn = state.db.conn.lock().unwrap();
    let project_path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", params![project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    fs_ops::glob_search(
        PathBuf::from(&project_path).as_path(),
        &input.pattern,
        input.path.as_deref(),
    )
}

#[tauri::command]
fn grep_search(state: State<AppState>, project_id: String, input: GrepInput) -> Result<Vec<GrepMatch>, String> {
    let conn = state.db.conn.lock().unwrap();
    let project_path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", params![project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    fs_ops::grep_search(
        PathBuf::from(&project_path).as_path(),
        &input.pattern,
        input.path.as_deref(),
        input.glob.as_deref(),
        input.head_limit,
    )
}

// ── Code Editor commands ──

#[tauri::command]
fn edit_file(
    state: State<AppState>,
    project_id: String,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
    dry_run: Option<bool>,
) -> Result<code_editor::EditResult, String> {
    let project = get_project_path(&state, &project_id)?;
    code_editor::edit_file(
        PathBuf::from(&project).as_path(),
        &path,
        &old_string,
        &new_string,
        replace_all.unwrap_or(false),
        dry_run.unwrap_or(false),
    )
}

#[tauri::command]
fn search_replace(
    state: State<AppState>,
    project_id: String,
    path: String,
    pattern: String,
    replacement: String,
    glob: Option<String>,
    dry_run: Option<bool>,
) -> Result<Vec<code_editor::EditResult>, String> {
    let project = get_project_path(&state, &project_id)?;
    code_editor::search_replace(
        PathBuf::from(&project).as_path(),
        &path,
        &pattern,
        &replacement,
        glob.as_deref(),
        dry_run.unwrap_or(false),
    )
}

#[tauri::command]
fn rollback_edit(
    state: State<AppState>,
    project_id: String,
    backup_hash: String,
    path: String,
) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    code_editor::rollback_edit(PathBuf::from(&project).as_path(), &backup_hash, &path)
}

// ── Sandbox command ──

#[tauri::command]
fn sandbox_exec(
    state: State<AppState>,
    project_id: String,
    command: String,
    cwd: Option<String>,
    env: Option<Vec<(String, String)>>,
    allow_network: Option<bool>,
    dry_run: Option<bool>,
    session_id: Option<String>,
) -> Result<sandbox::SandboxResult, String> {
    let project = get_project_path(&state, &project_id)?;
    let config = sandbox::SandboxConfig {
        project_root: PathBuf::from(&project),
        allowed_dirs: vec![PathBuf::from(&project)],
        allow_network: allow_network.unwrap_or(false),
        timeout_ms: 120_000,
        max_output_bytes: 102_400,
        ..Default::default()
    };

    let work_dir = cwd.unwrap_or_else(|| project.clone());
    let result = sandbox::execute_sandboxed(&command, &work_dir, env, &config, dry_run.unwrap_or(false), None)?;

    // Write audit log
    if let Some(ref sid) = session_id {
        audit::log_command(
            &state.db.conn,
            sid,
            None,
            &command,
            &work_dir,
            result.exit_code,
            &result.stdout,
            &result.stderr,
            result.duration_ms,
            true,
        );
    }

    Ok(result)
}

// ── Audit log query ──

#[tauri::command]
fn get_audit_log(
    state: State<AppState>,
    session_id: String,
    limit: Option<usize>,
) -> Result<Vec<audit::AuditEntry>, String> {
    audit::get_audit_log(&state.db.conn, &session_id, limit.unwrap_or(50))
}

// ── Git commands ──

#[tauri::command]
fn git_status(state: State<AppState>, project_id: String) -> Result<GitStatus, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::get_status(PathBuf::from(&project).as_path())
}

#[tauri::command]
fn git_diff(
    state: State<AppState>,
    project_id: String,
    staged: Option<bool>,
    path: Option<String>,
) -> Result<GitDiff, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::get_diff(PathBuf::from(&project).as_path(), staged.unwrap_or(false), path.as_deref(), Some(3))
}

#[tauri::command]
fn git_log(state: State<AppState>, project_id: String, count: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::get_log(PathBuf::from(&project).as_path(), count)
}

#[tauri::command]
fn git_commit(
    state: State<AppState>,
    project_id: String,
    message: String,
    files: Option<Vec<String>>,
) -> Result<String, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::commit(PathBuf::from(&project).as_path(), &message, files)
}

#[tauri::command]
fn git_branches(state: State<AppState>, project_id: String) -> Result<Vec<String>, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::list_branches(PathBuf::from(&project).as_path())
}

// ── Memory commands ──

#[tauri::command]
fn list_memories(state: State<AppState>, project_id: String) -> Result<Vec<Memory>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at FROM memories WHERE project_id = ?1 ORDER BY importance DESC, last_accessed_at DESC")
        .map_err(|e| e.to_string())?;

    let memories = stmt
        .query_map(params![project_id], |row| {
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
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(memories)
}

#[tauri::command]
fn save_memory(
    state: State<AppState>,
    project_id: String,
    r#type: String,
    content: String,
    importance: Option<f64>,
    source_session_id: Option<String>,
) -> Result<Memory, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO memories (id, project_id, type, content, importance, source_session_id, encrypted, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        params![id, project_id, r#type, content, importance.unwrap_or(0.5), source_session_id, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Memory {
        id,
        project_id,
        r#type,
        content,
        summary: None,
        importance: importance.unwrap_or(0.5),
        source_session_id,
        access_count: 0,
        last_accessed_at: None,
        encrypted: false,
        created_at: now,
    })
}

#[tauri::command]
async fn search_memories(
    state: State<'_, AppState>,
    query: String,
    top_k: Option<usize>,
    ollama_url: Option<String>,
) -> Result<Vec<Memory>, String> {
    let url = ollama_url.unwrap_or_else(|| "http://localhost:11434".into());

    // Generate embedding for query
    let query_embedding = vector_store::generate_embedding(&query, &url, "nomic-embed-text").await
        .map_err(|e| format!("Embedding failed (is Ollama running with nomic-embed-text?): {}", e))?;

    // Search vector store
    let vs = state.vector_store.lock().unwrap();
    let results = vs.search(&query_embedding, top_k.unwrap_or(10), 0.6, 0.25, 0.15);

    // Fetch memory details from DB
    let conn = state.db.conn.lock().unwrap();
    let mut memories = Vec::new();
    for result in results {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at FROM memories WHERE id = ?1"
        ) {
            if let Ok(memory) = stmt.query_row(params![result.id], |row| {
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
            }) {
                memories.push(memory);
            }
        }
    }

    Ok(memories)
}

#[tauri::command]
async fn embed_memory(
    state: State<'_, AppState>,
    memory_id: String,
    content: String,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let url = ollama_url.unwrap_or_else(|| "http://localhost:11434".into());
    let embedding = vector_store::generate_embedding(&content, &url, "nomic-embed-text").await?;

    // Store in vector store and update DB
    {
        let vs = state.vector_store.lock().unwrap();
        vs.upsert(&memory_id, &embedding, 0.5)?;
        vs.save_to_disk().ok();
    }

    // Update DB with embedding
    let conn = state.db.conn.lock().unwrap();
    let blob: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "UPDATE memories SET embedding = ?1 WHERE id = ?2",
        params![blob, memory_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn compress_memories(
    state: State<AppState>,
    similarity_threshold: Option<f32>,
    min_group_size: Option<usize>,
) -> Result<usize, String> {
    let vs = state.vector_store.lock().unwrap();
    let groups = vector_store::compress_memories(
        &vs,
        similarity_threshold.unwrap_or(0.85),
        min_group_size.unwrap_or(2),
    );

    let group_count = groups.len();
    let conn = state.db.conn.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

    for group in &groups {
        if group.len() < 2 { continue; }
        // Create summary memory from group
        let summary_id = uuid::Uuid::new_v4().to_string();
        let ids_json = serde_json::to_string(group).unwrap_or_default();

        // Get contents to summarize
        let contents: Vec<String> = group.iter().filter_map(|id| {
            conn.query_row(
                "SELECT content FROM memories WHERE id = ?1",
                params![id],
                |row| row.get(0),
            ).ok()
        }).collect();

        let summary = if contents.len() > 2 {
            format!("Compressed memory from {} entries: {}", contents.len(),
                contents.iter().take(3).map(|c| c.chars().take(100).collect::<String>()).collect::<Vec<_>>().join(" | "))
        } else {
            contents.join(" | ")
        };

        // Get the project_id from first memory in group
        if let Some(first_id) = group.first() {
            if let Ok(project_id) = conn.query_row(
                "SELECT project_id FROM memories WHERE id = ?1",
                params![first_id],
                |row| row.get::<_, String>(0),
            ) {
                conn.execute(
                    "INSERT INTO memories (id, project_id, type, content, summary, importance, version, compressed_from, encrypted, created_at, updated_at) VALUES (?1, ?2, 'fact', ?3, ?4, 0.7, 2, ?5, 0, ?6, ?7)",
                    params![summary_id, project_id, summary, summary, ids_json, now, now],
                ).ok();
            }
        }

        // Update source memories
        for id in group {
            conn.execute(
                "UPDATE memories SET version = version + 1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            ).ok();
        }
    }

    Ok(group_count)
}

#[tauri::command]
fn delete_memory(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Notes commands ──

#[tauri::command]
fn list_notes(state: State<AppState>, project_id: String) -> Result<Vec<Note>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, content, created_at, updated_at FROM notes WHERE project_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map(params![project_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(notes)
}

#[tauri::command]
fn save_note(state: State<AppState>, project_id: String, title: String, content: String) -> Result<Note, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO notes (id, project_id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, project_id, title, content, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Note {
        id,
        project_id,
        title,
        content,
        created_at: now.clone(),
        updated_at: now,
    })
}

// ── Crypto commands ──

#[tauri::command]
fn encrypt_memory_content(
    content: String,
    passphrase: String,
    salt_hex: Option<String>,
) -> Result<serde_json::Value, String> {
    let salt = if let Some(hex) = salt_hex {
        hex::decode(&hex).map_err(|e| format!("Invalid salt hex: {}", e))?
            .try_into()
            .map_err(|_| "Salt must be 16 bytes".to_string())?
    } else {
        crate::crypto::generate_salt()
    };

    let key = crate::crypto::derive_key(&passphrase, &salt);
    let encrypted = crate::crypto::encrypt(&content, &key)?;

    Ok(serde_json::json!({
        "encrypted": encrypted,
        "salt": hex::encode(salt),
    }))
}

#[tauri::command]
fn decrypt_memory_content(
    encrypted: String,
    passphrase: String,
    salt_hex: String,
) -> Result<String, String> {
    let salt: [u8; 16] = hex::decode(&salt_hex)
        .map_err(|e| format!("Invalid salt hex: {}", e))?
        .try_into()
        .map_err(|_| "Salt must be 16 bytes".to_string())?;

    let key = crate::crypto::derive_key(&passphrase, &salt);
    crate::crypto::decrypt(&encrypted, &key)
}

// ── System health check ──

#[tauri::command]
async fn health_check(
    state: State<'_, AppState>,
    ollama_url: Option<String>,
) -> Result<error_handler::SystemHealth, String> {
    let db_path = state.data_dir.join("boschcode.db");
    Ok(error_handler::check_system_health(
        &db_path,
        ollama_url.as_deref(),
    ).await)
}

// ── Skills / Settings / Update commands ──

#[tauri::command]
fn list_skills(state: State<AppState>) -> Result<Vec<Skill>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT name FROM skills WHERE enabled = 1")
        .map_err(|e| e.to_string())?;

    let names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let skills = names
        .into_iter()
        .map(|name| {
            let (desc, cmd) = match name.as_str() {
                "run-tests" => ("Auto-detect and run project tests", Some("/test")),
                "format-code" => ("Run formatter (prettier/rustfmt)", Some("/format")),
                "lint-check" => ("Run linter and generate fix suggestions", Some("/lint")),
                "generate-changelog" => ("Generate changelog from Git history", Some("/changelog")),
                "dependency-check" => ("Check outdated deps and CVEs", Some("/deps")),
                "project-init" => ("Initialize a project from a template", Some("/init")),
                _ => ("Unknown skill", None),
            };
            Skill {
                name,
                description: desc.to_string(),
                command: cmd.map(|s| s.to_string()),
            }
        })
        .collect();

    Ok(skills)
}

#[tauri::command]
fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state.db.conn.lock().unwrap();
    let result = conn.query_row(
        "SELECT value FROM settings WHERE scope = 'global' AND key = ?1",
        params![key],
        |row| row.get(0),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO settings (scope, key, value) VALUES ('global', ?1, ?2) ON CONFLICT(scope, key) DO UPDATE SET value = ?2",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Code Graph commands (8 tools) ──

#[tauri::command]
fn list_symbols(
    state: State<AppState>,
    project_id: String,
    file_path: String,
    kind_filter: Option<String>,
) -> Result<Vec<code_graph::Symbol>, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::list_symbols(PathBuf::from(&project).as_path(), &file_path, kind_filter.as_deref())
}

#[tauri::command]
fn read_symbol(
    state: State<AppState>,
    project_id: String,
    symbol_name: String,
    file_path: String,
) -> Result<code_graph::Symbol, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::read_symbol(PathBuf::from(&project).as_path(), &symbol_name, &file_path)
}

#[tauri::command]
fn find_references(
    state: State<AppState>,
    project_id: String,
    symbol_name: String,
    file_path: String,
    max_results: Option<usize>,
) -> Result<Vec<code_graph::GrepResult>, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::find_references(PathBuf::from(&project).as_path(), &symbol_name, &file_path, max_results)
}

#[tauri::command]
fn trace_callers(
    state: State<AppState>,
    project_id: String,
    symbol_name: String,
    file_path: String,
    max_depth: Option<usize>,
) -> Result<Vec<code_graph::Symbol>, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::trace_callers(PathBuf::from(&project).as_path(), &symbol_name, &file_path, max_depth)
}

#[tauri::command]
fn trace_callees(
    state: State<AppState>,
    project_id: String,
    symbol_name: String,
    file_path: String,
    max_depth: Option<usize>,
) -> Result<Vec<code_graph::Symbol>, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::trace_callees(PathBuf::from(&project).as_path(), &symbol_name, &file_path, max_depth)
}

#[tauri::command]
fn trace_chain(
    state: State<AppState>,
    project_id: String,
    from_symbol: String,
    to_symbol: String,
    max_depth: Option<usize>,
) -> Result<code_graph::CallChain, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::trace_chain(PathBuf::from(&project).as_path(), &from_symbol, &to_symbol, max_depth)
}

#[tauri::command]
fn file_deps(
    state: State<AppState>,
    project_id: String,
    file_path: String,
    direction: Option<String>,
) -> Result<Vec<code_graph::FileDep>, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::file_deps(PathBuf::from(&project).as_path(), &file_path, &direction.unwrap_or_else(|| "both".into()))
}

#[tauri::command]
fn blast_radius(
    state: State<AppState>,
    project_id: String,
    file_path: String,
    symbol_name: Option<String>,
) -> Result<code_graph::BlastRadius, String> {
    let project = get_project_path(&state, &project_id)?;
    code_graph::blast_radius(PathBuf::from(&project).as_path(), &file_path, symbol_name.as_deref())
}

// ── AI Loop command (full pipeline with tool execution) ──

#[derive(Debug, serde::Deserialize)]
struct AiLoopInput {
    provider: String,
    model: String,
    messages: Vec<ai_client::AiMessage>,
    system_prompt: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    max_iterations: Option<usize>,
}

#[tauri::command]
async fn ai_loop_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AiLoopInput,
    session_id: String,
    project_id: String,
) -> Result<ChatMessage, String> {
    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Get project root
    let project_path = get_project_path(&state, &project_id)?;
    let project_root = PathBuf::from(&project_path);

    // Update session
    {
        let conn = state.db.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Run AI Loop
    let response = ai_loop::run_loop(
        app,
        project_root,
        session_id.clone(),
        msg_id.clone(),
        input.provider,
        input.model,
        input.api_key,
        input.base_url,
        input.messages,
        input.system_prompt,
        input.max_iterations.unwrap_or(10),
    )
    .await?;

    // Save assistant response
    let conn = state.db.conn.lock().unwrap();
    let tool_calls_json = response
        .tool_calls
        .as_ref()
        .map(|tc| serde_json::to_string(tc).unwrap_or_default());
    let usage_json = serde_json::json!({
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    });

    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, mode, tool_calls, token_usage, created_at) VALUES (?1, ?2, 'assistant', ?3, 'ask', ?4, ?5, ?6)",
        params![msg_id, session_id, response.content, tool_calls_json, usage_json.to_string(), now],
    )
    .map_err(|e| e.to_string())?;

    let total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
    conn.execute(
        "UPDATE sessions SET token_count = token_count + ?1, updated_at = ?2 WHERE id = ?3",
        params![total_tokens as i64, now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(ChatMessage {
        id: msg_id,
        session_id,
        role: "assistant".into(),
        content: response.content,
        mode: Some("ask".into()),
        tool_calls: response.tool_calls.map(|tc| serde_json::to_value(tc).unwrap_or_default()),
        diffs: None,
        file_refs: None,
        token_usage: Some(usage_json),
        created_at: now,
    })
}

// ── Simple AI Chat (no tool loop, uses ai_client internally) ──

#[tauri::command]
async fn stream_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ai_client::ChatRequest,
    session_id: String,
) -> Result<ChatMessage, String> {
    // Save user message first
    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = state.db.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Call AI with streaming
    let response = ai_stream_chat(app, request, session_id.clone(), msg_id.clone()).await?;

    // Save assistant response
    let conn = state.db.conn.lock().unwrap();
    let tool_calls_json = response.tool_calls.as_ref().map(|tc| serde_json::to_string(tc).unwrap_or_default());
    let usage_json = serde_json::json!({
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    });

    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, mode, tool_calls, token_usage, created_at) VALUES (?1, ?2, 'assistant', ?3, 'ask', ?4, ?5, ?6)",
        params![msg_id, session_id, response.content, tool_calls_json, usage_json.to_string(), now],
    )
    .map_err(|e| e.to_string())?;

    // Update session token count
    let total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
    conn.execute(
        "UPDATE sessions SET token_count = token_count + ?1, updated_at = ?2 WHERE id = ?3",
        params![total_tokens as i64, now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(ChatMessage {
        id: msg_id,
        session_id,
        role: "assistant".into(),
        content: response.content,
        mode: Some("ask".into()),
        tool_calls: response.tool_calls.map(|tc| serde_json::to_value(tc).unwrap_or_default()),
        diffs: None,
        file_refs: None,
        token_usage: Some(usage_json),
        created_at: now,
    })
}

#[tauri::command]
async fn list_models(provider: String, base_url: Option<String>) -> Result<Vec<String>, String> {
    match provider.as_str() {
        "ollama" => {
            let url = base_url.unwrap_or_else(|| "http://localhost:11434".into());
            ai_list_ollama_models(&url).await
        }
        "openai" => Ok(vec!["gpt-4o".into(), "gpt-4o-mini".into(), "gpt-4-turbo".into()]),
        "anthropic" => Ok(vec![
            "claude-fable-5".into(),
            "claude-sonnet-4-6".into(),
            "claude-opus-4-8".into(),
            "claude-haiku-4-5".into(),
        ]),
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
fn get_update_info(state: State<AppState>) -> Result<UpdateInfo, String> {
    Ok(UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        latest_version: None,
        download_url: None,
        size_bytes: None,
        changelog: None,
    })
}

// ── Helpers ──

fn get_project_path(state: &AppState, project_id: &str) -> Result<String, String> {
    let conn = state.db.conn.lock().unwrap();
    conn.query_row(
        "SELECT local_path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

// ── Entry point ──

fn main() {
    let app_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("BoschCode");

    let db = Database::new(&app_dir).expect("Failed to initialize database");
    db.seed_builtin_skills().ok();

    let vs = vector_store::VectorStore::new(app_dir.join("vectors.json"), 768);

    let state = AppState {
        db,
        projects_dir: Mutex::new(app_dir.clone()),
        vector_store: Mutex::new(vs),
        data_dir: app_dir.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // Projects
            list_projects,
            create_project,
            remove_project,
            open_project,
            // Sessions
            list_sessions,
            create_session,
            delete_session,
            update_session_title,
            // Messages
            list_messages,
            send_message,
            save_assistant_message,
            // File system
            list_directory,
            read_file,
            write_file,
            glob_search,
            grep_search,
            // Code editor
            edit_file,
            search_replace,
            rollback_edit,
            // Code graph
            list_symbols,
            read_symbol,
            find_references,
            trace_callers,
            trace_callees,
            trace_chain,
            file_deps,
            blast_radius,
            // Sandbox
            sandbox_exec,
            get_audit_log,
            // Git
            git_status,
            git_diff,
            git_log,
            git_commit,
            git_branches,
            // Memory (CRUD + Vector Search)
            list_memories,
            save_memory,
            delete_memory,
            search_memories,
            embed_memory,
            compress_memories,
            // Notes
            list_notes,
            save_note,
            // AI
            ai_loop_chat,
            stream_chat,
            list_models,
            // Crypto & Health
            encrypt_memory_content,
            decrypt_memory_content,
            health_check,
            // Skills & Settings
            list_skills,
            get_setting,
            set_setting,
            get_update_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
