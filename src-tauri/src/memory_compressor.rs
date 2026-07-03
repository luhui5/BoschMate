//! Semantic memory compression — merge similar entries into summarized facts.

use rusqlite::{params, Connection};

/// Build a semantic summary from multiple memory contents (extractive MVP).
pub fn summarize_contents(contents: &[String]) -> String {
    if contents.is_empty() {
        return String::new();
    }
    if contents.len() == 1 {
        return contents[0].chars().take(500).collect();
    }

    let mut bullets: Vec<String> = contents
        .iter()
        .map(|c| {
            c.lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or(c.as_str())
                .trim()
                .chars()
                .take(120)
                .collect::<String>()
        })
        .collect();
    bullets.sort();
    bullets.dedup();
    format!(
        "Compressed from {} memories:\n{}",
        contents.len(),
        bullets
            .into_iter()
            .take(8)
            .map(|b| format!("• {}", b))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

/// Apply compression groups: insert summary memory, link sources, bump version.
pub fn apply_compression(
    conn: &Connection,
    project_id: &str,
    groups: &[Vec<String>],
) -> Result<usize, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut applied = 0usize;

    for group in groups {
        if group.len() < 2 {
            continue;
        }

        let contents: Vec<String> = group
            .iter()
            .filter_map(|id| {
                conn.query_row(
                    "SELECT content FROM memories WHERE id = ?1 AND project_id = ?2",
                    params![id, project_id],
                    |row| row.get(0),
                )
                .ok()
            })
            .collect();

        if contents.len() < 2 {
            continue;
        }

        let summary = summarize_contents(&contents);
        let summary_id = uuid::Uuid::new_v4().to_string();
        let ids_json = serde_json::to_string(group).unwrap_or_default();

        conn.execute(
            "INSERT INTO memories (id, project_id, type, content, summary, importance, version, compressed_from, encrypted, created_at, updated_at)
             VALUES (?1, ?2, 'fact', ?3, ?4, 0.75, 2, ?5, 0, ?6, ?7)",
            params![summary_id, project_id, summary, summary, ids_json, now, now],
        )
        .map_err(|e| e.to_string())?;

        for (i, src) in group.iter().enumerate() {
            if i + 1 < group.len() {
                let link_id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT OR IGNORE INTO memory_links (id, source_id, target_id, link_type, created_at)
                     VALUES (?1, ?2, ?3, 'compressed_from', ?4)",
                    params![link_id, summary_id, src, now],
                )
                .ok();
            }
            conn.execute(
                "UPDATE memories SET version = version + 1, updated_at = ?1 WHERE id = ?2",
                params![now, src],
            )
            .ok();
        }

        applied += 1;
    }

    Ok(applied)
}
