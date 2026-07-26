#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_client;
mod ai_loop;
mod audit;
mod chat_cancel;
mod changes_db;
mod code_editor;
mod code_graph;
mod credentials;
mod crypto;
mod db;
mod error_handler;
mod file_watcher;
mod fs_ops;
mod git_ops;
mod linter_analyzer;
mod loop_guard;
mod knowledge;
mod knowledge_chunker;
mod knowledge_indexer;
mod knowledge_parser;
mod knowledge_retriever;
mod knowledge_tools;
mod memory_compressor;
mod models;
mod os_open;
mod os_sandbox;
mod outlook;
mod path_guard;
mod pending_push;
mod pr_draft;
mod process_util;
mod paused_loop;
mod recovery;
mod retriever;
mod sandbox;
mod skills;
mod skills_runtime;
mod ssh;
mod test_runner;
mod tools;
mod tracing_log;
mod tree_sitter_graph;
mod vector_store;
mod web_fetch;
mod web_search;
mod selection_lookup;

use ai_client::stream_chat as ai_stream_chat;
use db::Database;
use knowledge::KnowledgeStoreManager;
use knowledge_tools::KnowledgeToolCtx;
use models::*;
use rusqlite::params;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::ShortcutState;

pub struct AppState {
    db: Database,
    #[allow(dead_code)]
    projects_dir: Mutex<PathBuf>,
    vector_store: Mutex<vector_store::VectorStore>,
    knowledge_stores: KnowledgeStoreManager,
    data_dir: PathBuf,
    chat_cancel: chat_cancel::ChatCancelRegistry,
    loop_guard: loop_guard::LoopGuardRegistry,
    paused_loops: paused_loop::PausedLoopRegistry,
    file_watcher: file_watcher::FileWatcherRegistry,
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
    if id == "__assistant__" {
        return Err("无法移除 Assistant 内置项目".into());
    }
    let conn = state.db.conn.lock().unwrap();
    let local_path: String = conn
        .query_row(
            "SELECT local_path FROM projects WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let normalized = local_path.replace('\\', "/").to_lowercase();
    if normalized.ends_with("/.boschassistant/workspace") {
        return Err("无法移除默认 Home 工作区".into());
    }
    Database::delete_project_cascade(&conn, &id).map_err(|e| e.to_string())
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
            let remote = crate::process_util::command("git")
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
fn ensure_assistant_workspace() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法定位用户主目录")?;
    let path = home.join(".boschassistant").join("workspace");
    std::fs::create_dir_all(&path).map_err(|e| format!("创建工作区失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

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
    Database::delete_session_cascade(&conn, &id).map_err(|e| e.to_string())
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
        .prepare("SELECT id, session_id, role, content, mode, tool_calls, diffs, file_refs, token_usage, questions, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC")
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
                questions: row.get::<_, Option<String>>(9).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(10)?,
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
        questions: None,
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
        questions: None,
        created_at: now,
    })
}

// ── File system commands ──

#[tauri::command]
async fn list_directory(
    state: State<'_, AppState>,
    project_id: String,
    path: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let project_path: String = {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT local_path FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    let root = PathBuf::from(&project_path);
    let depth = 1usize;
    let target = match &path {
        Some(p) => root.join(p.trim_start_matches('/').trim_start_matches('\\')),
        None => root,
    };

    let entries = tauri::async_runtime::spawn_blocking(move || {
        fs_ops::list_directory(&target, depth, false)
    })
    .await
    .map_err(|e| format!("list_directory task failed: {}", e))?;
    Ok(entries)
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
) -> Result<String, String> {
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
    
    let network_whitelist: Vec<String> = {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE scope = 'global' AND key = 'privacy_network_whitelist'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
    };
    
    let config = sandbox::SandboxConfig {
        project_root: PathBuf::from(&project),
        allowed_dirs: vec![PathBuf::from(&project)],
        allow_network: allow_network.unwrap_or(false),
        network_whitelist,
        timeout_ms: 120_000,
        max_output_bytes: 102_400,
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
async fn git_status(state: State<'_, AppState>, project_id: String) -> Result<GitStatus, String> {
    let project = get_project_path(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        git_ops::get_status(PathBuf::from(&project).as_path())
    })
    .await
    .map_err(|e| format!("git_status task failed: {}", e))?
}

#[tauri::command]
async fn git_log(
    state: State<'_, AppState>,
    project_id: String,
    count: Option<usize>,
) -> Result<Vec<GitCommit>, String> {
    let project = get_project_path(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        git_ops::get_log(PathBuf::from(&project).as_path(), count)
    })
    .await
    .map_err(|e| format!("git_log task failed: {}", e))?
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
async fn git_branches(state: State<'_, AppState>, project_id: String) -> Result<Vec<String>, String> {
    let project = get_project_path(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        git_ops::list_branches(PathBuf::from(&project).as_path())
    })
    .await
    .map_err(|e| format!("git_branches task failed: {}", e))?
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
fn git_clone_repo(parent_dir: String, url: String, name: Option<String>) -> Result<String, String> {
    let dir_name = name.unwrap_or_else(|| {
        url.rsplit('/')
            .next()
            .unwrap_or("repo")
            .trim_end_matches(".git")
            .to_string()
    });
    let target = PathBuf::from(&parent_dir).join(&dir_name);
    if target.exists() {
        return Err(format!("Directory already exists: {}", target.display()));
    }
    let output = crate::process_util::command("git")
        .args(["clone", &url, target.to_str().unwrap_or("")])
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn git_checkout_branch(state: State<AppState>, project_id: String, branch: String) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::checkout_branch(PathBuf::from(&project).as_path(), &branch)
}

#[tauri::command]
fn git_create_branch(state: State<AppState>, project_id: String, branch: String) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::create_and_checkout_branch(PathBuf::from(&project).as_path(), &branch)
}

#[tauri::command]
fn git_stage_files(state: State<AppState>, project_id: String, paths: Vec<String>) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::stage_files(PathBuf::from(&project).as_path(), &paths)
}

#[tauri::command]
fn git_unstage_files(state: State<AppState>, project_id: String, paths: Vec<String>) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::unstage_files(PathBuf::from(&project).as_path(), &paths)
}

#[tauri::command]
fn git_stash_push(
    state: State<AppState>,
    project_id: String,
    include_untracked: Option<bool>,
    message: Option<String>,
) -> Result<String, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::stash_push(
        PathBuf::from(&project).as_path(),
        include_untracked.unwrap_or(true),
        message.as_deref(),
    )
}

#[tauri::command]
fn git_stash_pop(state: State<AppState>, project_id: String) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::stash_pop(PathBuf::from(&project).as_path())
}

#[tauri::command]
fn git_stash_list(state: State<AppState>, project_id: String) -> Result<Vec<git_ops::StashEntry>, String> {
    let project = get_project_path(&state, &project_id)?;
    git_ops::stash_list(PathBuf::from(&project).as_path())
}

#[tauri::command]
fn reveal_in_explorer(state: State<AppState>, project_id: String, path: String) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    let full = PathBuf::from(&project).join(&path);
    let full = full.canonicalize().unwrap_or(full);
    #[cfg(target_os = "windows")]
    {
        crate::process_util::command("explorer")
            .arg(format!("/select,{}", full.display()))
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&full)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = full.parent().unwrap_or(full.as_path());
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

// ── Memory commands ──

#[tauri::command]
fn list_memories(state: State<AppState>, project_id: String) -> Result<Vec<Memory>, String> {
    let encrypt_enabled = get_setting(state.clone(), "privacy_encrypt_memory".into())
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(false);

    let memories = {
        let conn = state.db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at FROM memories WHERE project_id = ?1 ORDER BY importance DESC, last_accessed_at DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
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
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            if let Ok(m) = row {
                result.push(m);
            }
        }
        result
    };

    if encrypt_enabled {
        if let Some(key_hex) = credentials::get_secret("memory_encryption_key").ok().flatten() {
            if let Ok(key_bytes) = hex::decode(&key_hex) {
                if key_bytes.len() == 32 {
                    let key: [u8; 32] = key_bytes.try_into().unwrap();
                    let mut result = memories;
                    for m in result.iter_mut() {
                        if m.encrypted {
                            if let Ok(decrypted) = crypto::decrypt(&m.content, &key) {
                                m.content = decrypted;
                            }
                        }
                    }
                    return Ok(result);
                }
            }
        }
    }

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

    let encrypt_enabled = get_setting(state.clone(), "privacy_encrypt_memory".into())
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(false);

    let (content_to_store, is_encrypted) = if encrypt_enabled {
        match get_or_create_encryption_key() {
            Ok(key) => match crypto::encrypt(&content, &key) {
                Ok(encrypted) => (encrypted, true),
                Err(_) => (content.clone(), false),
            },
            Err(_) => (content.clone(), false),
        }
    } else {
        (content.clone(), false)
    };

    let conn = state.db.conn.lock().unwrap();
    let content_for_fts = content.clone();
    conn.execute(
        "INSERT INTO memories (id, project_id, type, content, importance, source_session_id, encrypted, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, project_id, r#type, content_to_store, importance.unwrap_or(0.5), source_session_id, is_encrypted as i32, now, now],
    )
    .map_err(|e| e.to_string())?;

    retriever::sync_fts(&conn, &id, &content_for_fts).ok();

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
        encrypted: is_encrypted,
        created_at: now,
    })
}

fn get_or_create_encryption_key() -> Result<[u8; 32], String> {
    if let Some(key_hex) = credentials::get_secret("memory_encryption_key")? {
        let key_bytes = hex::decode(&key_hex).map_err(|e| e.to_string())?;
        if key_bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&key_bytes);
            return Ok(key);
        }
    }
    let salt = crypto::generate_salt();
    let passphrase = uuid::Uuid::new_v4().to_string();
    let key = crypto::derive_key(&passphrase, &salt);
    credentials::save_secret("memory_encryption_key", &hex::encode(key))?;
    Ok(key)
}

#[tauri::command]
async fn search_memories(
    state: State<'_, AppState>,
    project_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<Memory>, String> {
    let top_k = limit.unwrap_or(10);

    let conn = state.db.conn.lock().unwrap();
    let vs = state.vector_store.lock().unwrap();
    retriever::retrieve_sync(
        &conn,
        &vs,
        &project_id,
        &query,
        top_k,
        None,
    )
}

#[tauri::command]
async fn retrieve_memories(
    state: State<'_, AppState>,
    project_id: String,
    query: String,
    top_k: Option<usize>,
) -> Result<serde_json::Value, String> {
    let memories = search_memories(
        state.clone(),
        project_id,
        query,
        top_k,
    )
    .await?;
    Ok(serde_json::json!({
        "memories": memories,
        "context": retriever::format_memory_context(&memories),
    }))
}

#[tauri::command]
fn update_memory(
    state: State<AppState>,
    id: String,
    content: Option<String>,
    summary: Option<String>,
    importance: Option<f64>,
    memory_type: Option<String>,
) -> Result<Memory, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.db.conn.lock().unwrap();

    if let Some(c) = &content {
        conn.execute(
            "UPDATE memories SET content = ?1, updated_at = ?2 WHERE id = ?3",
            params![c, now, id],
        )
        .map_err(|e| e.to_string())?;
        retriever::sync_fts(&conn, &id, c).ok();
    }
    if let Some(s) = &summary {
        conn.execute(
            "UPDATE memories SET summary = ?1, updated_at = ?2 WHERE id = ?3",
            params![s, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(imp) = importance {
        conn.execute(
            "UPDATE memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
            params![imp, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(t) = &memory_type {
        conn.execute(
            "UPDATE memories SET type = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, now, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let memory = conn
        .query_row(
            "SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at FROM memories WHERE id = ?1",
            params![id],
            |row| {
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
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(memory)
}

#[tauri::command]
fn export_memories(state: State<AppState>, project_id: String) -> Result<String, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, type, content, summary, importance, version, compressed_from, encrypted, created_at, updated_at
             FROM memories WHERE project_id = ?1 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<serde_json::Value> = stmt
        .query_map(params![project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "summary": row.get::<_, Option<String>>(4)?,
                "importance": row.get::<_, f64>(5)?,
                "version": row.get::<_, i32>(6)?,
                "compressed_from": row.get::<_, Option<String>>(7)?,
                "encrypted": row.get::<_, i32>(8)? != 0,
                "created_at": row.get::<_, String>(9)?,
                "updated_at": row.get::<_, String>(10)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())
}

#[tauri::command]
fn rebuild_vector_index(state: State<AppState>, project_id: Option<String>) -> Result<serde_json::Value, String> {
    let conn = state.db.conn.lock().unwrap();
    let vs = state.vector_store.lock().unwrap();
    let count = vs.rebuild_from_db(&conn)?;
    Database::rebuild_vector_index_meta(&conn, project_id.as_deref(), count as i64)?;
    vs.save_to_disk().ok();
    Ok(serde_json::json!({ "entry_count": count, "status": "ok" }))
}

#[tauri::command]
fn get_vector_index_meta(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, project_id, dimension, entry_count, backend, last_rebuild_at, status FROM vector_index_meta ORDER BY last_rebuild_at DESC")
        .map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "projectId": row.get::<_, Option<String>>(1)?,
                "dimension": row.get::<_, i64>(2)?,
                "entryCount": row.get::<_, i64>(3)?,
                "backend": row.get::<_, String>(4)?,
                "lastRebuildAt": row.get::<_, Option<String>>(5)?,
                "status": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
fn check_database(state: State<AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.conn.lock().unwrap();
    let integrity = Database::check_db_integrity(&conn)?;
    let vs = state.vector_store.lock().unwrap();
    Ok(serde_json::json!({
        "integrity_ok": integrity,
        "vector_corrupted": vs.is_corrupted(),
        "vector_entries": vs.len(),
    }))
}

#[tauri::command]
fn repair_database(state: State<AppState>) -> Result<serde_json::Value, String> {
    tracing_log::info("db", "Starting database repair wizard");
    let conn = state.db.conn.lock().unwrap();
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", [])
        .map_err(|e| e.to_string())?;
    let integrity = Database::check_db_integrity(&conn)?;
    drop(conn);

    let conn = state.db.conn.lock().unwrap();
    let vs = state.vector_store.lock().unwrap();
    let rebuilt = if !integrity || vs.is_corrupted() {
        vs.rebuild_from_db(&conn).unwrap_or(0)
    } else {
        vs.len()
    };
    Database::rebuild_vector_index_meta(&conn, None, rebuilt as i64)?;
    vs.save_to_disk().ok();

    Ok(serde_json::json!({
        "integrity_ok": integrity,
        "vector_entries": rebuilt,
        "repaired": true,
    }))
}

#[tauri::command]
fn check_disk_space(state: State<AppState>) -> Result<serde_json::Value, String> {
    Ok(error_handler::check_disk_space(&state.data_dir))
}

#[tauri::command]
async fn embed_memory(
    _state: State<'_, AppState>,
    _memory_id: String,
    _content: String,
) -> Result<(), String> {
    // Embedding is no longer supported (Ollama removed)
    Ok(())
}

#[tauri::command]
fn compress_memories(
    state: State<AppState>,
    project_id: Option<String>,
    similarity_threshold: Option<f32>,
    min_group_size: Option<usize>,
) -> Result<usize, String> {
    let vs = state.vector_store.lock().unwrap();
    let groups = vector_store::compress_memories(
        &vs,
        similarity_threshold.unwrap_or(0.85),
        min_group_size.unwrap_or(2),
    );
    drop(vs);

    let conn = state.db.conn.lock().unwrap();
    let mut applied = 0usize;

    if let Some(pid) = project_id {
        let project_groups: Vec<Vec<String>> = groups
            .into_iter()
            .filter(|g| {
                g.first()
                    .and_then(|id| {
                        conn.query_row(
                            "SELECT project_id FROM memories WHERE id = ?1",
                            params![id],
                            |row| row.get::<_, String>(0),
                        )
                        .ok()
                    })
                    .map(|p| p == pid)
                    .unwrap_or(false)
            })
            .collect();
        applied = memory_compressor::apply_compression(&conn, &pid, &project_groups)?;
    } else {
        let mut by_project: std::collections::HashMap<String, Vec<Vec<String>>> =
            std::collections::HashMap::new();
        for group in groups {
            if let Some(first_id) = group.first() {
                if let Ok(pid) = conn.query_row(
                    "SELECT project_id FROM memories WHERE id = ?1",
                    params![first_id],
                    |row| row.get::<_, String>(0),
                ) {
                    by_project.entry(pid).or_default().push(group);
                }
            }
        }
        for (pid, project_groups) in by_project {
            applied += memory_compressor::apply_compression(&conn, &pid, &project_groups)?;
        }
    }

    Ok(applied)
}

#[tauri::command]
fn delete_memory(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Memory links commands ──

#[tauri::command]
fn list_memory_links(state: State<AppState>, memory_id: String) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, source_id, target_id, link_type, created_at FROM memory_links WHERE source_id = ?1 OR target_id = ?1")
        .map_err(|e| e.to_string())?;
    let links = stmt
        .query_map(params![memory_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "source_id": row.get::<_, String>(1)?,
                "target_id": row.get::<_, String>(2)?,
                "link_type": row.get::<_, String>(3)?,
                "created_at": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(links)
}

#[tauri::command]
fn create_memory_link(state: State<AppState>, source_id: String, target_id: String, link_type: String) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO memory_links (id, source_id, target_id, link_type, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, source_id, target_id, link_type, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_memory_link(state: State<AppState>, link_id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM memory_links WHERE id = ?1", params![link_id])
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
) -> Result<error_handler::SystemHealth, String> {
    let db_path = state.data_dir.join("yourmate.db");
    Ok(error_handler::check_system_health(
        &db_path,
        Some(&state.data_dir),
    ).await)
}

// ── Skills / Settings / Update commands ──

#[tauri::command]
fn list_skills(state: State<AppState>) -> Result<Vec<Skill>, String> {
    let skills_dir = skills_runtime::skills_dir(&state.data_dir);
    let discovered = skills::discover_local_skills(&skills_dir);

    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT name, version, enabled FROM skills")
        .map_err(|e| e.to_string())?;

    let db_skills: Vec<(String, String, bool)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)? != 0,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut skills: Vec<Skill> = discovered
        .into_iter()
        .map(|m| {
            let name = m.name.clone();
            let db_entry = db_skills.iter().find(|(n, _, _)| n == &name);
            Skill {
                name: name.clone(),
                description: m.description.unwrap_or_else(|| name.clone()),
                command: Some(format!("/skill {}", name)),
                version: db_entry.map(|(_, v, _)| v.clone()),
                enabled: db_entry.map(|(_, _, e)| e).copied(),
            }
        })
        .collect();

    for (name, version, enabled) in &db_skills {
        if skills.iter().any(|s| &s.name == name) {
            continue;
        }
        let (desc, cmd) = match name.as_str() {
            "run-tests" => ("Auto-detect and run project tests", Some("/test")),
            "format-code" => ("Run formatter (prettier/rustfmt)", Some("/format")),
            "lint-check" => ("Run linter and generate fix suggestions", Some("/lint")),
            "generate-changelog" => ("Generate changelog from Git history", Some("/changelog")),
            "dependency-check" => ("Check outdated deps and CVEs", Some("/deps")),
            "project-init" => ("Initialize a project from a template", Some("/init")),
            _ => ("Built-in skill", None),
        };
        skills.push(Skill {
            name: name.clone(),
            description: desc.to_string(),
            command: cmd.map(|s| s.to_string()),
            version: Some(version.clone()),
            enabled: Some(*enabled),
        });
    }

    Ok(skills)
}

#[tauri::command]
fn install_skill(state: State<AppState>, source_path: String) -> Result<Skill, String> {
    let skills_dir = skills_runtime::skills_dir(&state.data_dir);
    std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    let manifest = skills_runtime::install_local_skill(&skills_dir, PathBuf::from(source_path).as_path())?;
    let name = manifest.name.clone();
    let version = manifest.version.clone();
    let desc = manifest.description.clone().unwrap_or(name.clone());
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = state.db.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO skills (id, name, version, source, entry_point, permissions, enabled, installed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
            rusqlite::params![id, name, version, "local", manifest.entry, serde_json::to_string(&manifest.permissions).unwrap_or_default(), now],
        ).map_err(|e| e.to_string())?;
    }
    Ok(Skill {
        name: name.clone(),
        description: desc,
        command: Some(format!("/skill {}", name)),
        version: Some(version),
        enabled: Some(true),
    })
}

#[tauri::command]
fn uninstall_skill(state: State<AppState>, skill_name: String) -> Result<(), String> {
    let skills_dir = skills_runtime::skills_dir(&state.data_dir);
    let skill_path = skills_dir.join(&skill_name);
    if skill_path.exists() {
        std::fs::remove_dir_all(&skill_path).map_err(|e| format!("Failed to remove skill dir: {}", e))?;
    }
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM skills WHERE name = ?1", rusqlite::params![skill_name])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn enable_skill(state: State<AppState>, skill_name: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("UPDATE skills SET enabled = 1 WHERE name = ?1", rusqlite::params![skill_name])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn disable_skill(state: State<AppState>, skill_name: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("UPDATE skills SET enabled = 0 WHERE name = ?1", rusqlite::params![skill_name])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn generate_pr_draft(state: State<AppState>, project_id: String, base_branch: Option<String>) -> Result<PrDraftOutput, String> {
    let conn = state.db.conn.lock().unwrap();
    let local_path: String = conn
        .query_row("SELECT local_path FROM projects WHERE id = ?1", rusqlite::params![project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);
    let draft = crate::pr_draft::generate_pr_draft(std::path::Path::new(&local_path), base_branch.as_deref())?;
    Ok(PrDraftOutput {
        title: draft.title,
        description: draft.description,
        branch: draft.branch,
        base_branch: draft.base_branch,
        file_count: draft.file_count,
        commit_count: draft.commit_count,
    })
}

#[tauri::command]
fn confirm_git_push(callback_id: String) -> Result<String, String> {
    let req = pending_push::take_push_request(&callback_id)
        .ok_or("No pending push request found")?;
    git_ops::push(&req.project_root, Some(&req.remote), false)?;
    Ok(format!("Pushed {} to {}", req.branch, req.remote))
}

#[tauri::command]
fn cancel_git_push(callback_id: String) -> Result<String, String> {
    if pending_push::cancel_push(&callback_id) {
        Ok("Push cancelled".to_string())
    } else {
        Err("No pending push request found".to_string())
    }
}

#[tauri::command]
fn run_skill(
    state: State<AppState>,
    skill_name: String,
    args: Option<Vec<String>>,
    project_id: Option<String>,
) -> Result<skills_runtime::SkillRunResult, String> {
    let skills_dir = skills_runtime::skills_dir(&state.data_dir);
    let skill_dir = skills_dir.join(&skill_name);
    
    let project_root = project_id.and_then(|pid| {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT local_path FROM projects WHERE id = ?1",
            params![pid],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(std::path::PathBuf::from)
    });
    
    skills_runtime::run_skill(&skill_dir, &args.unwrap_or_default(), project_root.as_deref())
}

#[tauri::command]
fn list_ssh_connections(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.db.conn.lock().unwrap();
    let json = conn
        .query_row(
            "SELECT value FROM settings WHERE scope = 'global' AND key = 'ssh_connections'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".into());
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_ssh_connection(state: State<AppState>, host: String, user: String, port: Option<u16>) -> Result<(), String> {
    let mut list = list_ssh_connections(state.clone())?;
    list.push(serde_json::json!({
        "host": host,
        "user": user,
        "port": port.unwrap_or(22),
        "last_connected_at": chrono::Utc::now().to_rfc3339(),
    }));
    set_setting(state, "ssh_connections".into(), serde_json::to_string(&list).unwrap())
}

#[tauri::command]
fn export_backup(state: State<AppState>, output_path: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();

    let mut projects: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, name, local_path, settings FROM projects") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "local_path": row.get::<_, String>(2)?,
                "settings": row.get::<_, String>(3)?,
            }))
        }) {
            projects = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let mut sessions: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, project_id, title, mode, status, parent_id, token_count, created_at, updated_at FROM sessions") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "title": row.get::<_, Option<String>>(2)?,
                "mode": row.get::<_, String>(3)?,
                "status": row.get::<_, String>(4)?,
                "parent_id": row.get::<_, Option<String>>(5)?,
                "token_count": row.get::<_, i64>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        }) {
            sessions = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, session_id, role, content, tool_calls, artifacts, token_usage, created_at FROM messages") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "session_id": row.get::<_, String>(1)?,
                "role": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "tool_calls": row.get::<_, Option<String>>(4)?,
                "artifacts": row.get::<_, Option<String>>(5)?,
                "token_usage": row.get::<_, Option<String>>(6)?,
                "created_at": row.get::<_, String>(7)?,
            }))
        }) {
            messages = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let mut memories: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at FROM memories") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "summary": row.get::<_, Option<String>>(4)?,
                "importance": row.get::<_, f64>(5)?,
                "source_session_id": row.get::<_, Option<String>>(6)?,
                "access_count": row.get::<_, i64>(7)?,
                "last_accessed_at": row.get::<_, Option<String>>(8)?,
                "encrypted": row.get::<_, i32>(9)? != 0,
                "created_at": row.get::<_, String>(10)?,
            }))
        }) {
            memories = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let mut settings: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT scope, project_id, key, value FROM settings") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "scope": row.get::<_, String>(0)?,
                "project_id": row.get::<_, Option<String>>(1)?,
                "key": row.get::<_, String>(2)?,
                "value": row.get::<_, String>(3)?,
            }))
        }) {
            settings = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let mut knowledge_bases: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, name, description, created_at FROM knowledge_bases") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "created_at": row.get::<_, String>(3)?,
            }))
        }) {
            knowledge_bases = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let ssh_json = conn
        .query_row(
            "SELECT value FROM settings WHERE scope = 'global' AND key = 'ssh_connections'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".into());

    let backup = serde_json::json!({
        "version": 2,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "projects": projects,
        "sessions": sessions,
        "messages": messages,
        "memories": memories,
        "settings": settings,
        "knowledge_bases": knowledge_bases,
        "ssh_connections": serde_json::from_str::<serde_json::Value>(&ssh_json).unwrap_or_default(),
    });
    std::fs::write(&output_path, serde_json::to_string_pretty(&backup).unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_backup(state: State<AppState>, input_path: String) -> Result<serde_json::Value, String> {
    let json = std::fs::read_to_string(&input_path).map_err(|e| e.to_string())?;
    let backup: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    
    let version = backup.get("version").and_then(|v| v.as_u64()).unwrap_or(1);
    if version > 2 {
        return Err(format!("Unsupported backup version: {}", version));
    }
    
    let conn = state.db.conn.lock().unwrap();
    let mut imported = serde_json::json!({});
    
    if let Some(projects) = backup.get("projects").and_then(|v| v.as_array()) {
        let mut count = 0;
        for p in projects {
            let id = p["id"].as_str().unwrap_or("");
            let name = p["name"].as_str().unwrap_or("");
            let local_path = p["local_path"].as_str().unwrap_or("");
            let settings = p["settings"].as_str().unwrap_or("{}");
            let now = chrono::Utc::now().to_rfc3339();
            
            conn.execute(
                "INSERT OR IGNORE INTO projects (id, name, local_path, settings, created_at, opened_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, name, local_path, settings, now],
            ).ok();
            count += 1;
        }
        imported["projects"] = serde_json::json!(count);
    }
    
    if let Some(sessions) = backup.get("sessions").and_then(|v| v.as_array()) {
        let mut count = 0;
        for s in sessions {
            let id = s["id"].as_str().unwrap_or("");
            let project_id = s["project_id"].as_str().unwrap_or("");
            let title = s["title"].as_str();
            let mode = s["mode"].as_str().unwrap_or("ask");
            let status = s["status"].as_str().unwrap_or("active");
            let parent_id = s["parent_id"].as_str();
            let token_count = s["token_count"].as_i64().unwrap_or(0);
            let created_at = s["created_at"].as_str().unwrap_or("");
            let updated_at = s["updated_at"].as_str().unwrap_or("");
            
            conn.execute(
                "INSERT OR IGNORE INTO sessions (id, project_id, title, mode, status, parent_id, token_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, project_id, title, mode, status, parent_id, token_count, created_at, updated_at],
            ).ok();
            count += 1;
        }
        imported["sessions"] = serde_json::json!(count);
    }
    
    if let Some(messages) = backup.get("messages").and_then(|v| v.as_array()) {
        let mut count = 0;
        for m in messages {
            let id = m["id"].as_str().unwrap_or("");
            let session_id = m["session_id"].as_str().unwrap_or("");
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            let tool_calls = m["tool_calls"].as_str();
            let artifacts = m["artifacts"].as_str();
            let token_usage = m["token_usage"].as_str();
            let created_at = m["created_at"].as_str().unwrap_or("");
            
            conn.execute(
                "INSERT OR IGNORE INTO messages (id, session_id, role, content, tool_calls, artifacts, token_usage, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, session_id, role, content, tool_calls, artifacts, token_usage, created_at],
            ).ok();
            count += 1;
        }
        imported["messages"] = serde_json::json!(count);
    }
    
    if let Some(memories) = backup.get("memories").and_then(|v| v.as_array()) {
        let mut count = 0;
        for m in memories {
            let id = m["id"].as_str().unwrap_or("");
            let project_id = m["project_id"].as_str().unwrap_or("");
            let mem_type = m["type"].as_str().unwrap_or("fact");
            let content = m["content"].as_str().unwrap_or("");
            let summary = m["summary"].as_str();
            let importance = m["importance"].as_f64().unwrap_or(0.5);
            let source_session_id = m["source_session_id"].as_str();
            let access_count = m["access_count"].as_i64().unwrap_or(0);
            let last_accessed_at = m["last_accessed_at"].as_str();
            let encrypted = if m["encrypted"].as_bool().unwrap_or(false) { 1 } else { 0 };
            let created_at = m["created_at"].as_str().unwrap_or("");
            
            conn.execute(
                "INSERT OR IGNORE INTO memories (id, project_id, type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![id, project_id, mem_type, content, summary, importance, source_session_id, access_count, last_accessed_at, encrypted, created_at],
            ).ok();
            count += 1;
        }
        imported["memories"] = serde_json::json!(count);
    }
    
    if let Some(settings) = backup.get("settings").and_then(|v| v.as_array()) {
        let mut count = 0;
        for s in settings {
            let scope = s["scope"].as_str().unwrap_or("global");
            let project_id = s["project_id"].as_str();
            let key = s["key"].as_str().unwrap_or("");
            let value = s["value"].as_str().unwrap_or("");
            
            conn.execute(
                "INSERT OR REPLACE INTO settings (scope, project_id, key, value) VALUES (?1, ?2, ?3, ?4)",
                params![scope, project_id, key, value],
            ).ok();
            count += 1;
        }
        imported["settings"] = serde_json::json!(count);
    }
    
    if let Some(kbases) = backup.get("knowledge_bases").and_then(|v| v.as_array()) {
        let mut count = 0;
        for k in kbases {
            let id = k["id"].as_str().unwrap_or("");
            let name = k["name"].as_str().unwrap_or("");
            let description = k["description"].as_str();
            let created_at = k["created_at"].as_str().unwrap_or("");
            let now = chrono::Utc::now().to_rfc3339();
            
            conn.execute(
                "INSERT OR IGNORE INTO knowledge_bases (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, name, description, created_at, now],
            ).ok();
            count += 1;
        }
        imported["knowledge_bases"] = serde_json::json!(count);
    }
    
    Ok(imported)
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
    let updated = conn
        .execute(
            "UPDATE settings SET value = ?1 WHERE scope = 'global' AND project_id IS NULL AND key = ?2",
            params![value, key],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO settings (scope, project_id, key, value) VALUES ('global', NULL, ?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }
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
    #[serde(default)]
    skip_tls_verify: bool,
    max_iterations: Option<usize>,
    #[allow(dead_code)]
    assistant_mode: Option<bool>,
    /// When true, edit_file runs dry_run (edit mode — wait for user confirm).
    edit_dry_run: Option<bool>,
    /// User confirmed bulk writes in auto mode (>50 files).
    bulk_write_confirmed: Option<bool>,
    /// Agent mode label for persistence (ask/plan/edit/auto).
    agent_mode: Option<String>,
    /// Knowledge base ids enabled in the UI (empty = search all bases).
    enabled_kbase_ids: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize)]
struct QuestionAnswerInput {
    question_id: String,
    selected_option_ids: Vec<String>,
    other_text: Option<String>,
}

fn persist_loop_diffs(
    conn: &rusqlite::Connection,
    response: &ai_client::ChatResponse,
    session_id: &str,
    msg_id: &str,
    edit_dry_run: bool,
    now: &str,
) -> Result<Option<String>, String> {
    let mut change_ids: Vec<String> = Vec::new();
    let diffs_json = if let Some(ref edits) = response.pending_edits {
        let meta_list = response.pending_edit_meta.as_deref().unwrap_or(&[]);
        let mut diffs_arr = Vec::new();
        for (i, edit) in edits.iter().enumerate() {
            let change_id = uuid::Uuid::new_v4().to_string();
            change_ids.push(change_id.clone());
            let status = if edit_dry_run { "pending" } else { "applied" };
            let edit_meta = meta_list.get(i).map(|m| m.to_string());
            let record = changes_db::ChangeRecord {
                id: change_id.clone(),
                session_id: session_id.to_string(),
                message_id: Some(msg_id.to_string()),
                file_path: edit.path.clone(),
                diff_text: edit.diff.clone(),
                status: status.into(),
                snapshot_id: edit.backup_hash.clone(),
                edit_meta,
                created_at: now.to_string(),
                applied_at: if status == "applied" { Some(now.to_string()) } else { None },
            };
            changes_db::insert_change(conn, &record).map_err(|e| e.to_string())?;
            diffs_arr.push(serde_json::json!({
                "id": change_id,
                "filePath": edit.path,
                "diffText": edit.diff,
                "status": status,
                "snapshotId": edit.backup_hash,
                "additions": edit.diff.lines().filter(|l| l.starts_with('+')).count(),
                "deletions": edit.diff.lines().filter(|l| l.starts_with('-')).count(),
                "editMeta": meta_list.get(i).cloned(),
            }));
        }
        Some(serde_json::to_string(&diffs_arr).unwrap_or_default())
    } else {
        None
    };
    Ok(diffs_json)
}

fn questions_json(response: &ai_client::ChatResponse) -> Option<String> {
    response
        .pending_questions
        .as_ref()
        .map(|q| serde_json::to_string(q).unwrap_or_default())
}

fn build_chat_message(
    msg_id: String,
    session_id: String,
    response: &ai_client::ChatResponse,
    agent_mode: &str,
    tool_calls_json: Option<String>,
    diffs_json: Option<String>,
    questions_json: Option<String>,
    now: String,
) -> ChatMessage {
    let usage_json = serde_json::json!({
        "prompt_tokens": response.usage.prompt_tokens,
        "completion_tokens": response.usage.completion_tokens,
    });
    ChatMessage {
        id: msg_id,
        session_id,
        role: "assistant".into(),
        content: response.content.clone(),
        mode: Some(agent_mode.into()),
        tool_calls: tool_calls_json.and_then(|d| serde_json::from_str(&d).ok()),
        diffs: diffs_json.and_then(|d| serde_json::from_str(&d).ok()),
        file_refs: None,
        token_usage: Some(usage_json),
        questions: questions_json.and_then(|d| serde_json::from_str(&d).ok()),
        created_at: now,
    }
}

async fn handle_loop_outcome(
    app: &AppHandle,
    state: &AppState,
    outcome: ai_loop::LoopOutcome,
    session_id: &str,
    msg_id: &str,
    agent_mode: &str,
    edit_dry_run: bool,
    now: &str,
    register_paused: bool,
) -> Result<ChatMessage, String> {
    match outcome {
        ai_loop::LoopOutcome::Paused { response, paused } => {
            if register_paused {
                state.paused_loops.register(session_id, paused);
            }
            let conn = state.db.conn.lock().unwrap();
            let tool_calls_json = response
                .activity_log
                .as_ref()
                .map(|log| serde_json::to_string(log).unwrap_or_default());
            let q_json = questions_json(&response);
            conn.execute(
                "INSERT INTO messages (id, session_id, role, content, mode, tool_calls, diffs, token_usage, questions, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    msg_id,
                    session_id,
                    response.content,
                    agent_mode,
                    tool_calls_json,
                    None::<String>,
                    serde_json::json!({
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                    })
                    .to_string(),
                    q_json,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            let total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
            conn.execute(
                "UPDATE sessions SET token_count = token_count + ?1, updated_at = ?2 WHERE id = ?3",
                params![total_tokens as i64, now, session_id],
            )
            .map_err(|e| e.to_string())?;
            Ok(build_chat_message(
                msg_id.to_string(),
                session_id.to_string(),
                &response,
                agent_mode,
                tool_calls_json,
                None,
                q_json,
                now.to_string(),
            ))
        }
        ai_loop::LoopOutcome::Completed(response) => {
            let conn = state.db.conn.lock().unwrap();
            let diffs_json = persist_loop_diffs(&conn, &response, session_id, msg_id, edit_dry_run, now)?;
            let tool_calls_json = response
                .activity_log
                .as_ref()
                .map(|log| serde_json::to_string(log).unwrap_or_default())
                .or_else(|| {
                    response
                        .tool_calls
                        .as_ref()
                        .map(|tc| serde_json::to_string(tc).unwrap_or_default())
                });
            let q_json = questions_json(&response);
            conn.execute(
                "INSERT INTO messages (id, session_id, role, content, mode, tool_calls, diffs, token_usage, questions, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    msg_id,
                    session_id,
                    response.content,
                    agent_mode,
                    tool_calls_json,
                    diffs_json,
                    serde_json::json!({
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                    })
                    .to_string(),
                    q_json,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            let total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
            conn.execute(
                "UPDATE sessions SET token_count = token_count + ?1, updated_at = ?2 WHERE id = ?3",
                params![total_tokens as i64, now, session_id],
            )
            .map_err(|e| e.to_string())?;
            let _ = app.emit("loop-completed", serde_json::json!({
                "session_id": session_id,
                "message_id": msg_id,
            }));
            Ok(build_chat_message(
                msg_id.to_string(),
                session_id.to_string(),
                &response,
                agent_mode,
                tool_calls_json,
                diffs_json,
                q_json,
                now.to_string(),
            ))
        }
    }
}

async fn handle_loop_outcome_update(
    app: &AppHandle,
    state: &AppState,
    outcome: ai_loop::LoopOutcome,
    session_id: &str,
    msg_id: &str,
    agent_mode: &str,
    edit_dry_run: bool,
    now: &str,
) -> Result<ChatMessage, String> {
    match outcome {
        ai_loop::LoopOutcome::Paused { response, paused } => {
            state.paused_loops.register(session_id, paused);
            let conn = state.db.conn.lock().unwrap();
            let tool_calls_json = response
                .activity_log
                .as_ref()
                .map(|log| serde_json::to_string(log).unwrap_or_default());
            let q_json = questions_json(&response);
            conn.execute(
                "UPDATE messages SET content = ?1, tool_calls = ?2, diffs = ?3, token_usage = ?4, questions = ?5 WHERE id = ?6",
                params![
                    response.content,
                    tool_calls_json,
                    None::<String>,
                    serde_json::json!({
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                    })
                    .to_string(),
                    q_json,
                    msg_id,
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(build_chat_message(
                msg_id.to_string(),
                session_id.to_string(),
                &response,
                agent_mode,
                tool_calls_json,
                None,
                q_json,
                now.to_string(),
            ))
        }
        ai_loop::LoopOutcome::Completed(response) => {
            let conn = state.db.conn.lock().unwrap();
            let diffs_json = persist_loop_diffs(&conn, &response, session_id, msg_id, edit_dry_run, now)?;
            let tool_calls_json = response
                .activity_log
                .as_ref()
                .map(|log| serde_json::to_string(log).unwrap_or_default());
            let q_json = if response.pending_questions.is_some() {
                questions_json(&response)
            } else {
                let existing: Option<String> = conn
                    .query_row(
                        "SELECT questions FROM messages WHERE id = ?1",
                        params![msg_id],
                        |r| r.get(0),
                    )
                    .ok()
                    .flatten();
                existing.map(|s| {
                    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&s) {
                        v["status"] = serde_json::json!("answered");
                        v.to_string()
                    } else {
                        s
                    }
                })
            };
            conn.execute(
                "UPDATE messages SET content = ?1, tool_calls = ?2, diffs = ?3, token_usage = ?4, questions = ?5 WHERE id = ?6",
                params![
                    response.content,
                    tool_calls_json,
                    diffs_json,
                    serde_json::json!({
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                    })
                    .to_string(),
                    q_json,
                    msg_id,
                ],
            )
            .map_err(|e| e.to_string())?;
            let _ = app.emit("loop-completed", serde_json::json!({
                "session_id": session_id,
                "message_id": msg_id,
            }));
            Ok(build_chat_message(
                msg_id.to_string(),
                session_id.to_string(),
                &response,
                agent_mode,
                tool_calls_json,
                diffs_json,
                q_json,
                now.to_string(),
            ))
        }
    }
}

#[tauri::command]
fn cancel_chat(app: AppHandle, state: State<AppState>, session_id: String) -> Result<(), String> {
    state.chat_cancel.cancel(&session_id, &app);
    state.paused_loops.clear(&session_id);
    Ok(())
}

#[tauri::command]
async fn ai_loop_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AiLoopInput,
    session_id: String,
    project_id: String,
    message_id: Option<String>,
) -> Result<ChatMessage, String> {
    state.loop_guard.begin(&session_id)?;

    let msg_id = message_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let result = ai_loop_chat_inner(
        app,
        &state,
        input,
        session_id.clone(),
        project_id,
        msg_id,
    )
    .await;

    state.loop_guard.end(&session_id);
    result
}

async fn ai_loop_chat_inner(
    app: AppHandle,
    state: &State<'_, AppState>,
    input: AiLoopInput,
    session_id: String,
    project_id: String,
    msg_id: String,
) -> Result<ChatMessage, String> {
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

    let agent_mode = input.agent_mode.as_deref().unwrap_or("edit");
    let auto_mode = agent_mode == "auto";
    let enabled_kbase_ids = input.enabled_kbase_ids.unwrap_or_default();

    let tools = if enabled_kbase_ids.is_empty() {
        let t = match agent_mode {
            "plan" => ai_loop::get_plan_tools(),
            "ask" => ai_loop::get_ask_tools(),
            _ => ai_loop::get_tools(),
        };
        ai_loop::without_knowledge_tools(t)
    } else {
        ai_loop::get_knowledge_only_tools()
    };

    let system_prompt = input.system_prompt.clone();

    let write_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let knowledge_ctx = if enabled_kbase_ids.is_empty() {
        None
    } else {
        Some(std::sync::Arc::new(KnowledgeToolCtx {
            db: state.db.conn.clone(),
            enabled_kbase_ids: enabled_kbase_ids.clone(),
        }))
    };

    let cancel = state.chat_cancel.register(&session_id);
    
    let network_whitelist: Vec<String> = {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE scope = 'global' AND key = 'privacy_network_whitelist'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
    };
    
    let outcome = ai_loop::run_loop(
        app.clone(),
        project_root.clone(),
        session_id.clone(),
        msg_id.clone(),
        input.provider,
        input.model,
        input.api_key,
        input.base_url,
        input.skip_tls_verify,
        input.messages,
        system_prompt,
        tools,
        input.max_iterations,
        ai_loop::LoopConfig {
            dry_run_edits: input.edit_dry_run.unwrap_or(false),
            auto_mode,
            bulk_write_confirmed: input.bulk_write_confirmed.unwrap_or(false),
            write_count,
            agent_mode: agent_mode.to_string(),
            ask_user_satisfied: false,
            enabled_kbase_ids,
            network_whitelist,
        },
        cancel,
        knowledge_ctx,
    )
    .await;
    state.chat_cancel.clear(&session_id);
    let outcome = outcome?;
    let agent_mode = input.agent_mode.as_deref().unwrap_or("edit");
    handle_loop_outcome(
        &app,
        &state,
        outcome,
        &session_id,
        &msg_id,
        agent_mode,
        input.edit_dry_run.unwrap_or(false),
        &now,
        true,
    )
    .await
}

#[tauri::command]
async fn continue_ai_loop(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message_id: String,
    answers: Vec<QuestionAnswerInput>,
) -> Result<ChatMessage, String> {
    let paused = state
        .paused_loops
        .take(&session_id)
        .ok_or("会话已过期或未处于等待回答状态，请重新发送消息。")?;
    if paused.message_id != message_id {
        state.paused_loops.register(&session_id, paused);
        return Err("消息 ID 不匹配".into());
    }

    let answers: Vec<ai_loop::QuestionAnswer> = answers
        .into_iter()
        .map(|a| ai_loop::QuestionAnswer {
            question_id: a.question_id,
            selected_option_ids: a.selected_option_ids,
            other_text: a.other_text,
        })
        .collect();

    let _cancel = state.chat_cancel.register(&session_id);
    let outcome = ai_loop::run_loop_resume(paused, answers).await;
    state.chat_cancel.clear(&session_id);
    let outcome = outcome?;
    let now = chrono::Utc::now().to_rfc3339();

    let agent_mode: Option<String> = {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT mode FROM messages WHERE id = ?1",
            params![message_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    let mode = agent_mode.as_deref().unwrap_or("edit");
    let edit_dry_run = mode == "edit";

    handle_loop_outcome_update(
        &app,
        &state,
        outcome,
        &session_id,
        &message_id,
        mode,
        edit_dry_run,
        &now,
    )
    .await
}

// ── Changes (diff apply / rollback) ──

#[tauri::command]
fn list_changes(state: State<AppState>, session_id: String) -> Result<Vec<changes_db::ChangeRecord>, String> {
    let conn = state.db.conn.lock().unwrap();
    changes_db::list_changes(&conn, &session_id).map_err(|e| e.to_string())
}

#[derive(Debug, serde::Deserialize)]
struct ApplyChangeInput {
    change_id: String,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
    /// "edit" for patch edits (default), "write" for full-file writes.
    kind: Option<String>,
}

#[tauri::command]
fn apply_change(
    state: State<AppState>,
    project_id: String,
    input: ApplyChangeInput,
) -> Result<code_editor::EditResult, String> {
    let project = get_project_path(&state, &project_id)?;
    let root = PathBuf::from(&project);
    let result = if input.kind.as_deref() == Some("write") {
        code_editor::apply_write(root.as_path(), &input.path, &input.new_string)?
    } else {
        code_editor::edit_file(
            root.as_path(),
            &input.path,
            &input.old_string,
            &input.new_string,
            input.replace_all.unwrap_or(false),
            false,
        )?
    };
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.db.conn.lock().unwrap();
    changes_db::update_change_applied(
        &conn,
        &input.change_id,
        "applied",
        Some(&now),
        result.backup_hash.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(result)
}

#[derive(Debug, serde::Serialize)]
struct RevertChangeResult {
    verified_hash: String,
}

#[tauri::command]
fn revert_change(
    state: State<AppState>,
    project_id: String,
    change_id: String,
) -> Result<RevertChangeResult, String> {
    let project = get_project_path(&state, &project_id)?;
    let root = PathBuf::from(&project);
    let conn = state.db.conn.lock().unwrap();
    let change = changes_db::get_change(&conn, &change_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Change not found: {}", change_id))?;
    if change.status != "applied" {
        return Err(format!("Cannot revert change with status: {}", change.status));
    }
    let backup_hash = change
        .snapshot_id
        .ok_or_else(|| "No backup hash stored for this change".to_string())?;
    let restored_hash =
        code_editor::rollback_edit(root.as_path(), &backup_hash, &change.file_path)?;
    if restored_hash != backup_hash {
        return Err(format!(
            "Hash verification failed: expected {}, got {}",
            backup_hash, restored_hash
        ));
    }
    changes_db::update_change_status(&conn, &change_id, "reverted", None)
        .map_err(|e| e.to_string())?;
    Ok(RevertChangeResult {
        verified_hash: restored_hash,
    })
}

#[tauri::command]
fn reject_change(state: State<AppState>, change_id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    changes_db::update_change_status(&conn, &change_id, "rejected", None).map_err(|e| e.to_string())
}

// ── Credentials (OS Keychain) ──

#[tauri::command]
fn save_credential(key: String, value: String) -> Result<(), String> {
    credentials::save_secret(&key, &value)
}

#[tauri::command]
fn get_credential(key: String) -> Result<Option<String>, String> {
    credentials::get_secret(&key)
}

#[tauri::command]
fn delete_credential(key: String) -> Result<(), String> {
    credentials::delete_secret(&key)
}

// ── Test & Lint ──

#[tauri::command]
fn run_tests(
    state: State<AppState>,
    project_id: String,
    filter: Option<String>,
) -> Result<test_runner::TestRunResult, String> {
    let project = get_project_path(&state, &project_id)?;
    test_runner::run_tests(PathBuf::from(&project).as_path(), filter.as_deref())
}

#[tauri::command]
fn run_linter(
    state: State<AppState>,
    project_id: String,
    target: Option<String>,
) -> Result<linter_analyzer::LintResult, String> {
    let project = get_project_path(&state, &project_id)?;
    linter_analyzer::run_linter(PathBuf::from(&project).as_path(), target.as_deref())
}

// ── Crash recovery ──

#[tauri::command]
fn save_recovery_snapshot(
    state: State<AppState>,
    snapshot: recovery::RecoverySnapshot,
) -> Result<(), String> {
    recovery::save_snapshot(&state.data_dir, &snapshot)
}

#[tauri::command]
fn load_recovery_snapshots(state: State<AppState>) -> Result<Vec<recovery::RecoverySnapshot>, String> {
    recovery::load_snapshots(&state.data_dir)
}

#[tauri::command]
fn clear_recovery_snapshot(state: State<AppState>, session_id: String) -> Result<(), String> {
    recovery::clear_snapshot(&state.data_dir, &session_id)
}

#[tauri::command]
fn clear_all_recovery_snapshots(state: State<AppState>) -> Result<(), String> {
    recovery::clear_all(&state.data_dir)
}

// ── File watcher ──

#[tauri::command]
fn watch_project_dir(
    app: AppHandle,
    state: State<AppState>,
    project_id: String,
) -> Result<(), String> {
    let project = get_project_path(&state, &project_id)?;
    state
        .file_watcher
        .watch_project(app, project_id, PathBuf::from(&project).as_path())
}

// ── Simple AI Chat (no tool loop, uses ai_client internally) ──

#[tauri::command]
async fn stream_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ai_client::ChatRequest,
    session_id: String,
    message_id: Option<String>,
) -> Result<ChatMessage, String> {
    // Save user message first
    let msg_id = message_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = state.db.conn.lock().unwrap();
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("会话未同步到数据库，请点击左侧「新对话」后重试".into());
        }
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Call AI with streaming
    let cancel = state.chat_cancel.register(&session_id);
    let response = ai_stream_chat(app, request, session_id.clone(), msg_id.clone(), cancel).await;
    state.chat_cancel.clear(&session_id);
    let response = response?;

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
        questions: None,
        created_at: now,
    })
}

#[tauri::command]
async fn list_models(provider: String, _base_url: Option<String>) -> Result<Vec<String>, String> {
    match provider.as_str() {
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
fn get_update_info(_state: State<AppState>) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let repo = std::env::var("YOURMATE_UPDATE_REPO")
        .unwrap_or_else(|_| "bosch/yourmate".into());
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = reqwest::blocking::Client::new();
    if let Ok(resp) = client.get(&url).header("User-Agent", "YourMate").send() {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<serde_json::Value>() {
                let latest = body["tag_name"].as_str().map(|s| s.trim_start_matches('v').to_string());
                return Ok(UpdateInfo {
                    current_version: current,
                    latest_version: latest,
                    download_url: body["html_url"].as_str().map(String::from),
                    size_bytes: None,
                    changelog: body["body"].as_str().map(String::from),
                });
            }
        }
    }
    Ok(UpdateInfo {
        current_version: current,
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
        .join("YourMate");

    tracing_log::init(&app_dir);
    tracing_log::info("app", "YourMate starting");

    let db = Database::new(&app_dir).expect("Failed to initialize database");
    db.seed_builtin_skills().ok();

    let vs = vector_store::VectorStore::new(app_dir.join("vectors.json"), 768);

    let state = AppState {
        db,
        projects_dir: Mutex::new(app_dir.clone()),
        vector_store: Mutex::new(vs),
        knowledge_stores: KnowledgeStoreManager::new(app_dir.clone()),
        data_dir: app_dir.clone(),
        chat_cancel: chat_cancel::ChatCancelRegistry::new(),
        loop_guard: loop_guard::LoopGuardRegistry::new(),
        paused_loops: paused_loop::PausedLoopRegistry::new(),
        file_watcher: file_watcher::FileWatcherRegistry::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            selection_lookup::trigger_from_shortcut(app).await;
                        });
                    }
                })
                .build(),
        )
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            let db_state = app.state::<AppState>();
            selection_lookup::init(&handle, db_state.inner())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if let Some(state) = window.app_handle().try_state::<AppState>() {
                        let conn = state.db.conn.lock().unwrap();
                        if selection_lookup::should_close_to_tray(&conn) {
                            api.prevent_close();
                            let _ = window.hide();
                            return;
                        }
                    }
                }
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    let _ = recovery::clear_all(&state.data_dir);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Projects
            list_projects,
            create_project,
            remove_project,
            open_project,
            // Sessions
            ensure_assistant_workspace,
            list_sessions,
            create_session,
            delete_session,
            update_session_title,
            cancel_chat,
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
            list_changes,
            apply_change,
            reject_change,
            revert_change,
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
            git_clone_repo,
            git_checkout_branch,
            git_create_branch,
            git_stage_files,
            git_unstage_files,
            git_stash_push,
            git_stash_pop,
            git_stash_list,
            reveal_in_explorer,
            // Memory (CRUD + Vector Search)
            list_memories,
            save_memory,
            delete_memory,
            search_memories,
            retrieve_memories,
            update_memory,
            export_memories,
            rebuild_vector_index,
            get_vector_index_meta,
            check_database,
            repair_database,
            check_disk_space,
            embed_memory,
            compress_memories,
            list_memory_links,
            create_memory_link,
            delete_memory_link,
            // Knowledge base
            knowledge::list_knowledge_bases,
            knowledge::create_knowledge_base,
            knowledge::update_knowledge_base,
            knowledge::delete_knowledge_base,
            knowledge::list_knowledge_documents,
            knowledge::ingest_knowledge_document,
            knowledge::ingest_knowledge_document_from_paths,
            knowledge::delete_knowledge_document,
            knowledge::retrieve_knowledge_context,
            // Notes
            list_notes,
            save_note,
            // AI
            ai_loop_chat,
            continue_ai_loop,
            stream_chat,
            list_models,
            // Crypto & Health
            encrypt_memory_content,
            decrypt_memory_content,
            health_check,
            // Skills & Settings
            list_skills,
            install_skill,
            uninstall_skill,
            enable_skill,
            disable_skill,
            run_skill,
            generate_pr_draft,
            confirm_git_push,
            cancel_git_push,
            list_ssh_connections,
            save_ssh_connection,
            export_backup,
            import_backup,
            get_setting,
            set_setting,
            save_credential,
            get_credential,
            delete_credential,
            run_tests,
            run_linter,
            save_recovery_snapshot,
            load_recovery_snapshots,
            clear_recovery_snapshot,
            clear_all_recovery_snapshots,
            watch_project_dir,
            get_update_info,
            // Selection lookup
            selection_lookup::service::selection_lookup_apply_settings,
            selection_lookup::service::hide_selection_popup,
            selection_lookup::service::continue_selection_in_assistant,
            selection_lookup::service::get_selection_lookup_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let _ = recovery::clear_all(&state.data_dir);
                }
            }
        });
}
