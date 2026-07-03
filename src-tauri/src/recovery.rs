use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverySnapshot {
    pub session_id: String,
    pub project_id: Option<String>,
    pub draft_content: String,
    pub messages_json: String,
    pub saved_at: String,
}

pub fn recovery_dir(data_dir: &PathBuf) -> PathBuf {
    data_dir.join("recovery")
}

pub fn save_snapshot(data_dir: &PathBuf, snapshot: &RecoverySnapshot) -> Result<(), String> {
    let dir = recovery_dir(data_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", snapshot.session_id));
    let json = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn load_snapshots(data_dir: &PathBuf) -> Result<Vec<RecoverySnapshot>, String> {
    let dir = recovery_dir(data_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let content = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        if let Ok(snap) = serde_json::from_str::<RecoverySnapshot>(&content) {
            out.push(snap);
        }
    }
    Ok(out)
}

pub fn clear_snapshot(data_dir: &PathBuf, session_id: &str) -> Result<(), String> {
    let path = recovery_dir(data_dir).join(format!("{}.json", session_id));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn clear_all(data_dir: &PathBuf) -> Result<(), String> {
    let dir = recovery_dir(data_dir);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
