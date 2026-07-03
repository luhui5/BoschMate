use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeRecord {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub file_path: String,
    pub diff_text: String,
    pub status: String,
    pub snapshot_id: Option<String>,
    pub edit_meta: Option<String>,
    pub created_at: String,
    pub applied_at: Option<String>,
}

pub fn insert_change(conn: &Connection, change: &ChangeRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO changes (id, session_id, message_id, file_path, diff_text, status, snapshot_id, edit_meta, created_at, applied_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            change.id,
            change.session_id,
            change.message_id,
            change.file_path,
            change.diff_text,
            change.status,
            change.snapshot_id,
            change.edit_meta,
            change.created_at,
            change.applied_at,
        ],
    )?;
    Ok(())
}

pub fn list_changes(conn: &Connection, session_id: &str) -> Result<Vec<ChangeRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, message_id, file_path, diff_text, status, snapshot_id, edit_meta, created_at, applied_at
         FROM changes WHERE session_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(ChangeRecord {
            id: row.get(0)?,
            session_id: row.get(1)?,
            message_id: row.get(2)?,
            file_path: row.get(3)?,
            diff_text: row.get(4)?,
            status: row.get(5)?,
            snapshot_id: row.get(6)?,
            edit_meta: row.get(7)?,
            created_at: row.get(8)?,
            applied_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn update_change_status(
    conn: &Connection,
    id: &str,
    status: &str,
    applied_at: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE changes SET status = ?1, applied_at = ?2 WHERE id = ?3",
        params![status, applied_at, id],
    )?;
    Ok(())
}

pub fn update_change_applied(
    conn: &Connection,
    id: &str,
    status: &str,
    applied_at: Option<&str>,
    snapshot_id: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE changes SET status = ?1, applied_at = ?2, snapshot_id = ?3 WHERE id = ?4",
        params![status, applied_at, snapshot_id, id],
    )?;
    Ok(())
}

pub fn get_change(conn: &Connection, id: &str) -> Result<Option<ChangeRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, message_id, file_path, diff_text, status, snapshot_id, edit_meta, created_at, applied_at
         FROM changes WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(ChangeRecord {
            id: row.get(0)?,
            session_id: row.get(1)?,
            message_id: row.get(2)?,
            file_path: row.get(3)?,
            diff_text: row.get(4)?,
            status: row.get(5)?,
            snapshot_id: row.get(6)?,
            edit_meta: row.get(7)?,
            created_at: row.get(8)?,
            applied_at: row.get(9)?,
        }))
    } else {
        Ok(None)
    }
}
