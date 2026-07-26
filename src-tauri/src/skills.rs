//! Skill manifest parsing and registry (P7-1).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillManifest {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub entry: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub tools: Vec<SkillToolDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillToolDef {
    pub name: String,
    pub description: String,
}

const MANIFEST_FILE: &str = "yourmate.skill.json";

pub fn parse_manifest(path: &Path) -> Result<SkillManifest, String> {
    let file = path.join(MANIFEST_FILE);
    if !file.exists() {
        return Err(format!("Missing {}", MANIFEST_FILE));
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("Invalid manifest: {}", e))
}

pub fn discover_local_skills(skills_dir: &Path) -> Vec<SkillManifest> {
    let mut out = Vec::new();
    if !skills_dir.exists() {
        return out;
    }
    if let Ok(entries) = std::fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Ok(m) = parse_manifest(&p) {
                    out.push(m);
                }
            }
        }
    }
    out
}
