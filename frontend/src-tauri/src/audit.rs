use rusqlite::{params, Connection};
use std::sync::Mutex;

/// Log a command execution to the audit_log table
pub fn log_command(
    db: &Mutex<Connection>,
    session_id: &str,
    message_id: Option<&str>,
    command: &str,
    cwd: &str,
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    duration_ms: u64,
    sandboxed: bool,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let stdout_trunc = if stdout.len() > 10000 {
        format!("{}...[truncated]", &stdout[..10000])
    } else {
        stdout.to_string()
    };
    let stderr_trunc = if stderr.len() > 10000 {
        format!("{}...[truncated]", &stderr[..10000])
    } else {
        stderr.to_string()
    };

    if let Ok(conn) = db.lock() {
        conn.execute(
            "INSERT INTO audit_log (id, session_id, message_id, command, cwd, exit_code, stdout, stderr, duration_ms, sandboxed, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                session_id,
                message_id,
                command,
                cwd,
                exit_code,
                stdout_trunc,
                stderr_trunc,
                duration_ms as i64,
                sandboxed as i32,
                now,
            ],
        ).ok();
    }
}

/// Get recent audit log entries for a session
pub fn get_audit_log(
    db: &Mutex<Connection>,
    session_id: &str,
    limit: usize,
) -> Result<Vec<AuditEntry>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, message_id, command, cwd, exit_code, stdout, stderr, duration_ms, sandboxed, created_at FROM audit_log WHERE session_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let entries = stmt
        .query_map(params![session_id, limit as i64], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                session_id: row.get(1)?,
                message_id: row.get(2)?,
                command: row.get(3)?,
                cwd: row.get(4)?,
                exit_code: row.get(5)?,
                stdout: row.get(6)?,
                stderr: row.get(7)?,
                duration_ms: row.get(8)?,
                sandboxed: row.get::<_, i32>(9)? != 0,
                created_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub duration_ms: Option<i64>,
    pub sandboxed: bool,
    pub created_at: String,
}
