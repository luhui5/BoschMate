//! Skill runtime — Deno/shell sandbox stub (P7-2).

use crate::skills::{parse_manifest, SkillManifest};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
pub struct SkillRunResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_skill(
    skill_dir: &Path,
    args: &[String],
    project_root: Option<&Path>,
) -> Result<SkillRunResult, String> {
    let manifest = parse_manifest(skill_dir)?;
    let entry = skill_dir.join(&manifest.entry);
    if !entry.exists() {
        return Err(format!("Skill entry not found: {}", manifest.entry));
    }

    check_permissions(&manifest, project_root)?;

    let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut cmd = if ext == "sh" {
        crate::process_util::command("sh")
    } else {
        crate::process_util::command("node")
    };

    cmd.arg(&entry).args(args);

    if let Some(root) = project_root {
        cmd.current_dir(root);
    }

    let timeout = std::time::Duration::from_secs(30);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run skill entry: {}", e))?;

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(SkillRunResult {
                    success: status.success(),
                    stdout: String::new(),
                    stderr: String::new(),
                });
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    return Err(format!(
                        "Skill timed out after {}s: {}",
                        timeout.as_secs(),
                        manifest.name
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Failed waiting for skill: {}", e)),
        }
    }
}

fn check_permissions(manifest: &SkillManifest, project_root: Option<&Path>) -> Result<(), String> {
    for perm in &manifest.permissions {
        match perm.as_str() {
            "filesystem:read" | "filesystem:write" | "filesystem:read_write" => {
                if project_root.is_none() {
                    return Err("Skill requires filesystem access but no project is open".into());
                }
            }
            "shell" => {
                // Shell execution allowed with timeout
            }
            "network" => {
                // Network access allowed
            }
            _ => {}
        }
    }
    Ok(())
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
