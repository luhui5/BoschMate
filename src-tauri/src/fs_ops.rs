use crate::models::{FileEntry, GrepMatch};
use globset::{GlobBuilder, GlobMatcher};
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".next",
    "dist",
    "build",
    ".turbo",
    ".pnpm-store",
];

pub fn should_skip_dir_name(name: &str) -> bool {
    SKIP_DIR_NAMES.contains(&name)
}

pub fn should_skip_path(path: &Path) -> bool {
    path.components().any(|c| {
        if let std::path::Component::Normal(s) = c {
            should_skip_dir_name(&s.to_string_lossy())
        } else {
            false
        }
    })
}

/// Recursively list directory contents as a tree
pub fn list_directory(root: &Path, depth: usize, show_hidden: bool) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(root) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !show_hidden && name.starts_with('.') {
                continue;
            }
            if should_skip_dir_name(&name) {
                continue;
            }
            let path = entry.path();
            let metadata = entry.metadata().ok();
            let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let is_symlink = metadata.as_ref().map(|m| m.is_symlink()).unwrap_or(false);
            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = metadata
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Utc> = t.into();
                    dt.to_rfc3339()
                });

            let children = if is_dir && depth > 0 {
                Some(list_directory(&path, depth - 1, show_hidden))
            } else {
                None
            };

            entries.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                r#type: if is_symlink {
                    "symlink".into()
                } else if is_dir {
                    "dir".into()
                } else {
                    "file".into()
                },
                size,
                modified,
                children,
            });
        }
    }
    // Sort: dirs first, then alphabetically
    entries.sort_by(|a, b| {
        let a_dir = a.r#type == "dir";
        let b_dir = b.r#type == "dir";
        b_dir.cmp(&a_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

/// Read file content with optional line range
pub fn read_file(root: &Path, rel_path: &str, offset: Option<usize>, limit: Option<usize>) -> Result<String, String> {
    // Security: prevent path traversal
    let safe_path = sanitize_path(root, rel_path)?;
    let content = fs::read_to_string(&safe_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();
    let start = offset.unwrap_or(0).min(total_lines.saturating_sub(1));
    let end = limit.map(|l| (start + l).min(total_lines)).unwrap_or(total_lines);
    let truncated = lines[start..end].join("\n");
    if end < total_lines {
        Ok(format!(
            "{}\n\n[Showing lines {}-{} of {}]",
            truncated,
            start + 1,
            end,
            total_lines
        ))
    } else {
        Ok(truncated)
    }
}

/// Write file content
pub fn write_file(root: &Path, rel_path: &str, content: &str) -> Result<String, String> {
    crate::path_guard::reject_protected_path(rel_path)?;
    let safe_path = resolve_under_root(root, rel_path)?;
    // Create parent dirs if needed
    if let Some(parent) = safe_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    fs::write(&safe_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    use sha2::Digest;
    let hash = sha2::Sha256::digest(content.as_bytes());
    Ok(format!("{:x}", hash))
}

/// Glob pattern matching
pub fn glob_search(root: &Path, glob_pattern: &str, search_path: Option<&str>) -> Result<Vec<FileEntry>, String> {
    let base = match search_path {
        Some(p) => sanitize_path(root, p)?,
        None => root.to_path_buf(),
    };

    let matcher = compile_glob_matcher(glob_pattern)?;
    let mut results = Vec::new();

    for entry in WalkDir::new(&base)
        .max_depth(20)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && !should_skip_dir_name(&name)
        })
        .flatten()
    {
        if entry.file_type().is_file() {
            let rel_str = relative_to_root(root, entry.path());
            if matcher.is_match(&rel_str) {
                let meta = entry.metadata().ok();
                results.push(FileEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    r#type: "file".into(),
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified: meta
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .map(|t| {
                            let dt: chrono::DateTime<chrono::Utc> = t.into();
                            dt.to_rfc3339()
                        }),
                    children: None,
                });
            }
        }
    }

    // Sort by modified time descending
    results.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(results)
}

/// Grep / ripgrep-style content search
pub fn grep_search(
    root: &Path,
    pattern: &str,
    search_path: Option<&str>,
    file_glob: Option<&str>,
    head_limit: Option<usize>,
) -> Result<Vec<GrepMatch>, String> {
    let base = match search_path {
        Some(p) => sanitize_path(root, p)?,
        None => root.to_path_buf(),
    };

    let re = Regex::new(pattern).map_err(|e| format!("Invalid regex: {}", e))?;
    let glob_matcher = file_glob.map(compile_glob_matcher).transpose()?;
    let limit = head_limit.unwrap_or(250);
    let mut results = Vec::new();

    for entry in WalkDir::new(&base)
        .max_depth(30)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && !should_skip_dir_name(&name)
        })
        .flatten()
    {
        if results.len() >= limit {
            break;
        }
        if entry.file_type().is_file() {
            let rel_str = relative_to_root(root, entry.path());

            if let Some(ref matcher) = glob_matcher {
                if !matcher.is_match(&rel_str) {
                    continue;
                }
            }

            if let Ok(content) = fs::read_to_string(entry.path()) {
                for (line_num, line) in content.lines().enumerate() {
                    if results.len() >= limit {
                        break;
                    }
                    if re.is_match(line) {
                        results.push(GrepMatch {
                            file: rel_str.clone(),
                            line: line_num + 1,
                            content: line.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(results)
}

// ── Helpers ──

/// Resolve `rel_path` under `root`, rejecting traversal escapes. Does not require the target to exist.
fn resolve_under_root(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel_path);
    if rel.is_absolute() {
        return Err(format!("Access denied: absolute path '{}'", rel_path));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Root not found: {}", e))?;

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

/// Sanitize a path relative to the project root. Prevents path traversal attacks.
fn sanitize_path(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_under_root(root, rel_path)?;
    let canonical = resolved
        .canonicalize()
        .map_err(|e| format!("Path not found: {}", e))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Root not found: {}", e))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!(
            "Access denied: path '{}' is outside the project directory",
            rel_path
        ));
    }
    Ok(canonical)
}

/// Normalize path separators for cross-platform glob matching.
fn normalize_rel_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn relative_to_root(root: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(root) {
        return normalize_rel_path(&rel.to_string_lossy());
    }
    if let (Ok(root_can), Ok(path_can)) = (root.canonicalize(), path.canonicalize()) {
        if let Ok(rel) = path_can.strip_prefix(&root_can) {
            return normalize_rel_path(&rel.to_string_lossy());
        }
    }
    normalize_rel_path(&path.to_string_lossy())
}

fn compile_glob_matcher(pattern: &str) -> Result<GlobMatcher, String> {
    GlobBuilder::new(pattern)
        .literal_separator(true)
        .backslash_escape(true)
        .build()
        .map_err(|e| format!("Invalid glob pattern: {}", e))
        .map(|glob| glob.compile_matcher())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_path_prevents_escape() {
        let root = Path::new("/tmp/test-project");
        let result = sanitize_path(root, "../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_under_root_allows_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let target = resolve_under_root(root, "new_file.py").unwrap();
        assert_eq!(target.file_name().unwrap(), "new_file.py");
        assert!(!target.exists());
    }

    #[test]
    fn test_glob_search_finds_nested_test_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("tests")).unwrap();
        fs::write(root.join("tests/test_hello.py"), "pass").unwrap();
        fs::write(root.join("tests/test_recorder.py"), "pass").unwrap();
        fs::write(root.join("hello.py"), "pass").unwrap();

        let results = glob_search(root, "**/test*.py", None).unwrap();
        let names: Vec<_> = results.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"test_hello.py"));
        assert!(names.contains(&"test_recorder.py"));
        assert!(!names.contains(&"hello.py"));
    }

    #[test]
    fn test_glob_matcher_accepts_windows_style_paths() {
        let matcher = compile_glob_matcher("**/test*.py").unwrap();
        assert!(matcher.is_match("tests/test_hello.py"));
        assert!(matcher.is_match("tests\\test_hello.py"));
    }
}
