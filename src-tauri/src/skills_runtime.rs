//! Skill runtime — Deno/shell sandbox stub (P7-2).

use crate::skills::{parse_manifest, SkillManifest};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
pub struct SkillRunResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_skill(skill_dir: &Path, args: &[String]) -> Result<SkillRunResult, String> {
    let manifest = parse_manifest(skill_dir)?;
    let entry = skill_dir.join(&manifest.entry);
    if !entry.exists() {
        return Err(format!("Skill entry not found: {}", manifest.entry));
    }

    // MVP: execute via shell when entry is .sh/.js; Deno sandbox in future iteration
    let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
    let output = if ext == "sh" {
        crate::process_util::command("sh")
            .arg(&entry)
            .args(args)
            .output()
            .map_err(|e| e.to_string())?
    } else {
        crate::process_util::command("node")
            .arg(&entry)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to run skill entry: {}", e))?
    };

    Ok(SkillRunResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

pub fn install_local_skill(skills_dir: &Path, source_dir: &Path) -> Result<SkillManifest, String> {
    let manifest = parse_manifest(source_dir)?;
    let dest = skills_dir.join(&manifest.name);
    if dest.exists() {
        return Err(format!("Skill already installed: {}", manifest.name));
    }
    copy_dir_recursive(source_dir, &dest)?;
    Ok(manifest)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), dest_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn skills_dir(app_dir: &PathBuf) -> PathBuf {
    app_dir.join("skills")
}
