//! Desktop selection lookup — settings persisted in SQLite.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

pub const SETTINGS_KEY: &str = "selection_lookup";
pub const KBASE_KEY: &str = "assistant_selected_kbase";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionLookupSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_trigger_mode")]
    pub trigger_mode: String,
    #[serde(default = "default_shortcut")]
    pub shortcut: String,
    #[serde(default = "default_auto_mode")]
    pub auto_mode: String,
    #[serde(default = "default_auto_delay")]
    pub auto_delay_ms: u64,
    #[serde(default = "default_min_chars")]
    pub min_selection_chars: usize,
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
}

fn default_trigger_mode() -> String {
    "shortcut".into()
}
fn default_shortcut() -> String {
    "CommandOrControl+Shift+K".into()
}

/// Normalize user-facing shortcut strings to tauri-plugin-global-shortcut format.
pub fn normalize_shortcut(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| {
            let p = part.trim();
            match p.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => "CommandOrControl".to_string(),
                "cmd" | "command" | "commandorcontrol" => "CommandOrControl".to_string(),
                "alt" | "option" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "meta" | "super" | "win" => "Super".to_string(),
                key if key.len() == 1 => key.to_ascii_uppercase(),
                key if key.starts_with('f') && key[1..].chars().all(|c| c.is_ascii_digit()) => {
                    key.to_ascii_uppercase()
                }
                key => {
                    let mut chars = key.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => first
                            .to_uppercase()
                            .chain(chars.flat_map(|c| c.to_lowercase()))
                            .collect(),
                    }
                }
            }
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}
fn default_auto_mode() -> String {
    "mouse_up".into()
}
fn default_auto_delay() -> u64 {
    400
}
fn default_min_chars() -> usize {
    2
}
fn default_top_k() -> usize {
    8
}
fn default_close_to_tray() -> bool {
    true
}

impl Default for SelectionLookupSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            trigger_mode: default_trigger_mode(),
            shortcut: default_shortcut(),
            auto_mode: default_auto_mode(),
            auto_delay_ms: default_auto_delay(),
            min_selection_chars: default_min_chars(),
            top_k: default_top_k(),
            close_to_tray: default_close_to_tray(),
        }
    }
}

pub fn load_settings(conn: &Connection) -> SelectionLookupSettings {
    let raw: Result<String, _> = conn.query_row(
        "SELECT value FROM settings WHERE scope = 'global' AND key = ?1",
        params![SETTINGS_KEY],
        |row| row.get(0),
    );
    match raw {
        Ok(json) => {
            let mut settings: SelectionLookupSettings =
                serde_json::from_str(&json).unwrap_or_default();
            settings.shortcut = normalize_shortcut(&settings.shortcut);
            settings
        }
        Err(_) => SelectionLookupSettings::default(),
    }
}

pub fn save_settings(conn: &Connection, settings: &SelectionLookupSettings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    let updated = conn
        .execute(
            "UPDATE settings SET value = ?1 WHERE scope = 'global' AND project_id IS NULL AND key = ?2",
            params![json, SETTINGS_KEY],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO settings (scope, project_id, key, value) VALUES ('global', NULL, ?1, ?2)",
            params![SETTINGS_KEY, json],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn load_kbase_id(conn: &Connection) -> Option<String> {
    let raw: Result<String, _> = conn.query_row(
        "SELECT value FROM settings WHERE scope = 'global' AND key = ?1",
        params![KBASE_KEY],
        |row| row.get(0),
    );
    match raw {
        Ok(json) => {
            let parsed: serde_json::Value = serde_json::from_str(&json).ok()?;
            if parsed.is_null() {
                None
            } else {
                parsed.as_str().map(|s| s.to_string())
            }
        }
        Err(_) => None,
    }
}

pub fn kbase_exists(conn: &Connection, kbase_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM knowledge_bases WHERE id = ?1",
        params![kbase_id],
        |_| Ok(()),
    )
    .is_ok()
}

pub fn load_kbase_name(conn: &Connection, kbase_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT name FROM knowledge_bases WHERE id = ?1",
        params![kbase_id],
        |row| row.get(0),
    )
    .ok()
}

pub fn should_close_to_tray(conn: &Connection) -> bool {
    load_settings(conn).close_to_tray
}

pub fn trigger_uses_shortcut(settings: &SelectionLookupSettings) -> bool {
    settings.enabled
        && (settings.trigger_mode == "shortcut" || settings.trigger_mode == "both")
}

pub fn trigger_uses_auto(settings: &SelectionLookupSettings) -> bool {
    settings.enabled && (settings.trigger_mode == "auto" || settings.trigger_mode == "both")
}
