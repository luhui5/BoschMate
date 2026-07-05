/// Path safety checks shared by fs_ops and code_editor.

use std::path::{Path, PathBuf};

pub fn reject_protected_path(rel_path: &str) -> Result<(), String> {
    let norm = rel_path.replace('\\', "/").trim_start_matches('/').to_string();
    let segments: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    if segments.iter().any(|&s| s == ".git") {
        return Err(format!(
            "Access denied: cannot modify files under .git ({})",
            rel_path
        ));
    }
    Ok(())
}

/// Normalize a path for under-root comparison (canonicalize when possible).
fn normalize_for_root_check(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|e| format!("Path not accessible: {}", e));
    }
    if let Some(parent) = path.parent() {
        if parent.exists() {
            let mut normalized = parent
                .canonicalize()
                .map_err(|e| format!("Path not accessible: {}", e))?;
            if let Some(name) = path.file_name() {
                normalized.push(name);
            }
            return Ok(normalized);
        }
    }
    Ok(path.to_path_buf())
}

/// Resolve `rel_path` under `root`, rejecting traversal escapes. Does not require the target to exist.
pub fn resolve_under_root(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel_path);
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Root not found: {}", e))?;

    if rel.is_absolute() {
        let candidate = PathBuf::from(rel_path);
        let normalized = normalize_for_root_check(&candidate)?;
        if !normalized.starts_with(&canonical_root) {
            return Err(format!(
                "Access denied: path '{}' is outside the project directory",
                rel_path
            ));
        }
        return Ok(candidate);
    }

    let mut resolved = canonical_root.clone();
    for component in rel.components() {
        match component {
            std::path::Component::Normal(part) => resolved.push(part),
            std::path::Component::ParentDir => {
                if resolved == canonical_root {
                    return Err(format!(
                        "Access denied: path '{}' is outside the project directory",
                        rel_path
                    ));
                }
                resolved.pop();
            }
            std::path::Component::CurDir => {}
            _ => {
                return Err(format!("Invalid path component in '{}'", rel_path));
            }
        }
    }

    if !resolved.starts_with(&canonical_root) {
        return Err(format!(
            "Access denied: path '{}' is outside the project directory",
            rel_path
        ));
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn blocks_git_paths() {
        assert!(reject_protected_path(".git/config").is_err());
        assert!(reject_protected_path("src/.git/HEAD").is_err());
        assert!(reject_protected_path("src/main.rs").is_ok());
    }

    #[test]
    fn relative_path_under_root_ok() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let target = resolve_under_root(root, "hello.py").unwrap();
        assert_eq!(target.file_name().unwrap(), "hello.py");
    }

    #[test]
    fn relative_path_escape_denied() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(resolve_under_root(root, "../outside.txt").is_err());
    }

    #[test]
    fn absolute_path_to_existing_file_under_root_ok() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let file_path = root.join("hello.py");
        fs::write(&file_path, "ok").unwrap();
        let abs = file_path.canonicalize().unwrap();
        let resolved = resolve_under_root(root, abs.to_str().unwrap()).unwrap();
        assert!(resolved.exists());
    }

    #[test]
    fn absolute_path_to_new_file_under_root_ok() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let abs = root.join("new_file.py");
        let resolved = resolve_under_root(root, abs.to_str().unwrap()).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "new_file.py");
        assert!(!resolved.exists());
    }

    #[test]
    fn absolute_path_outside_root_denied() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let outside = std::env::temp_dir().join("boschcode-outside-test.txt");
        let abs = outside.canonicalize().unwrap_or(outside);
        assert!(resolve_under_root(root, abs.to_str().unwrap()).is_err());
    }
}
