use regex::Regex;
use sha2::Digest;
use std::fs;
use std::path::{Path, PathBuf};

/// Apply an exact string replacement in a file. Returns a unified diff.
/// If `replace_all` is true, replaces all occurrences; otherwise requires unique match.
pub fn edit_file(
    root: &Path,
    rel_path: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
    dry_run: bool,
) -> Result<EditResult, String> {
    crate::path_guard::reject_protected_path(rel_path)?;
    let safe_path = sanitize_path(root, rel_path)?;
    let original = fs::read_to_string(&safe_path)
        .map_err(|e| format!("Failed to read {}: {}", rel_path, e))?;

    let occurrences: Vec<_> = original.match_indices(old_string).collect();

    if occurrences.is_empty() {
        return Err(format!(
            "old_string not found in {}. Make sure the string matches exactly (including whitespace).",
            rel_path
        ));
    }

    if !replace_all && occurrences.len() > 1 {
        return Err(format!(
            "old_string matches {} times in {}. Use replace_all=true or make the string more specific.",
            occurrences.len(),
            rel_path
        ));
    }

    let modified = if replace_all {
        original.replace(old_string, new_string)
    } else {
        let (pos, _) = occurrences[0];
        let mut s = String::with_capacity(original.len());
        s.push_str(&original[..pos]);
        s.push_str(new_string);
        s.push_str(&original[pos + old_string.len()..]);
        s
    };

    if !dry_run {
        // Backup original for rollback
        let hash = sha2::Sha256::digest(original.as_bytes());
        let backup_dir = root.join(".boschcode").join("backups");
        fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup dir: {}", e))?;
        let backup_name = format!("{:x}_{}", hash, rel_path.replace(['/', '\\'], "_"));
        fs::write(backup_dir.join(&backup_name), &original)
            .map_err(|e| format!("Failed to create backup: {}", e))?;

        fs::write(&safe_path, &modified)
            .map_err(|e| format!("Failed to write {}: {}", rel_path, e))?;
    }

    let diff = generate_unified_diff(rel_path, &original, &modified);

    let backup_hash = if !dry_run {
        let hash = sha2::Sha256::digest(original.as_bytes());
        Some(format!("{:x}", hash))
    } else {
        None
    };

    Ok(EditResult {
        path: rel_path.to_string(),
        replaced: occurrences.len().min(if replace_all { occurrences.len() } else { 1 }),
        diff,
        dry_run,
        backup_hash,
    })
}

/// Regex-based search and replace in a file or glob-matched files.
pub fn search_replace(
    root: &Path,
    path: &str,
    pattern: &str,
    replacement: &str,
    file_glob: Option<&str>,
    dry_run: bool,
) -> Result<Vec<EditResult>, String> {
    let re = Regex::new(pattern).map_err(|e| format!("Invalid regex: {}", e))?;
    let mut results = Vec::new();

    // Get target files
    let files: Vec<PathBuf> = if let Some(glob) = file_glob {
        let glob_re = glob_to_regex(glob)?;
        walkdir::WalkDir::new(root.join(path))
            .max_depth(20)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.') && name != "node_modules" && name != ".git" && name != "target"
            })
            .flatten()
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                let rel = e.path().strip_prefix(root).unwrap_or(e.path());
                glob_re.is_match(&rel.to_string_lossy())
            })
            .map(|e| e.path().to_path_buf())
            .collect()
    } else {
        let p = sanitize_path(root, path)?;
        if p.is_file() {
            vec![p]
        } else {
            return Err(format!("{} is a directory. Use glob to match multiple files.", path));
        }
    };

    for file_path in &files {
        let rel = file_path.strip_prefix(root).unwrap_or(file_path);
        let rel_str = rel.to_string_lossy().to_string();
        let original = fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read {}: {}", rel_str, e))?;

        let matches: Vec<_> = re.find_iter(&original).collect();
        if matches.is_empty() {
            continue;
        }

        let modified = re.replace_all(&original, replacement).to_string();

        if !dry_run {
            fs::write(file_path, &modified)
                .map_err(|e| format!("Failed to write {}: {}", rel_str, e))?;
        }

        let diff = generate_unified_diff(&rel_str, &original, &modified);
        results.push(EditResult {
            path: rel_str,
            replaced: matches.len(),
            diff,
            dry_run,
            backup_hash: None,
        });
    }

    Ok(results)
}

/// Rollback a previous edit by restoring from backup. Returns SHA256 of restored content.
pub fn rollback_edit(root: &Path, backup_hash: &str, rel_path: &str) -> Result<String, String> {
    let backup_dir = root.join(".boschcode").join("backups");
    let backup_name = format!("{}_{}", backup_hash, rel_path.replace(['/', '\\'], "_"));
    let backup_path = backup_dir.join(&backup_name);

    if !backup_path.exists() {
        return Err(format!("Backup not found for {} (hash: {})", rel_path, backup_hash));
    }

    let content = fs::read_to_string(&backup_path)
        .map_err(|e| format!("Failed to read backup: {}", e))?;
    let target = sanitize_path(root, rel_path)?;
    fs::write(&target, &content)
        .map_err(|e| format!("Failed to rollback {}: {}", rel_path, e))?;

    let restored_hash = sha2::Sha256::digest(content.as_bytes());
    Ok(format!("{:x}", restored_hash))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EditResult {
    pub path: String,
    pub replaced: usize,
    pub diff: String,
    pub dry_run: bool,
    /// SHA256 of original content before edit (for rollback).
    pub backup_hash: Option<String>,
}

// ── Helpers ──

fn sanitize_path(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let resolved = root.join(rel_path);
    // For files that don't exist yet, just verify parent dir is in scope
    if let Some(parent) = resolved.parent() {
        if parent.exists() {
            let canonical = parent.canonicalize().map_err(|_| format!("Path not accessible: {}", rel_path))?;
            let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
            if !canonical.starts_with(&canonical_root) {
                return Err(format!("Access denied: path is outside project directory"));
            }
        }
    }
    Ok(resolved)
}

fn generate_unified_diff(filename: &str, original: &str, modified: &str) -> String {
    let mut diff = String::new();
    diff.push_str(&format!("--- a/{}\n", filename));
    diff.push_str(&format!("+++ b/{}\n", filename));

    // Simple line-by-line diff
    let orig_lines: Vec<&str> = original.lines().collect();
    let mod_lines: Vec<&str> = modified.lines().collect();

    // Use patience-diff-like approach: find common prefix and suffix
    let mut prefix = 0;
    while prefix < orig_lines.len() && prefix < mod_lines.len()
        && orig_lines[prefix] == mod_lines[prefix]
    {
        prefix += 1;
    }

    let mut suffix = 0;
    while suffix < orig_lines.len() - prefix
        && suffix < mod_lines.len() - prefix
        && orig_lines[orig_lines.len() - 1 - suffix] == mod_lines[mod_lines.len() - 1 - suffix]
    {
        suffix += 1;
    }

    let context = 3;
    let start = if prefix > context { prefix - context } else { 0 };
    let end_orig = (orig_lines.len() - suffix + context).min(orig_lines.len());
    let end_mod = (mod_lines.len() - suffix + context).min(mod_lines.len());

    diff.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        start + 1,
        end_orig - start,
        start + 1,
        end_mod - start,
    ));

    // Show context + deletions + insertions
    let mut i = start;
    let mut j = start;

    let orig_tail = if end_orig < orig_lines.len() { end_orig } else { orig_lines.len() };
    let mod_tail = if end_mod < mod_lines.len() { end_mod } else { mod_lines.len() };

    while i < orig_tail || j < mod_tail {
        if i < orig_tail && j < mod_tail && orig_lines[i] == mod_lines[j] {
            diff.push_str(&format!(" {}\n", orig_lines[i]));
            i += 1;
            j += 1;
        } else if i < orig_tail && j < mod_tail {
            diff.push_str(&format!("-{}\n", orig_lines[i]));
            diff.push_str(&format!("+{}\n", mod_lines[j]));
            i += 1;
            j += 1;
        } else if i < orig_tail {
            diff.push_str(&format!("-{}\n", orig_lines[i]));
            i += 1;
        } else if j < mod_tail {
            diff.push_str(&format!("+{}\n", mod_lines[j]));
            j += 1;
        } else {
            break;
        }
    }

    diff
}

fn glob_to_regex(pattern: &str) -> Result<Regex, String> {
    let escaped = regex::escape(pattern);
    let regex_str = escaped
        .replace(r"\*\*/\*", ".*")
        .replace(r"\*\*", ".*")
        .replace(r"\*", "[^/]*")
        .replace(r"\?", ".");
    Regex::new(&format!("^{}$", regex_str))
        .map_err(|e| format!("Invalid glob: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edit_file_unique_match() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.txt");
        fs::write(&file, "hello world\nfoo bar\n").unwrap();

        let result = edit_file(
            dir.path(),
            "test.txt",
            "hello world",
            "goodbye world",
            false,
            true,
        )
        .unwrap();

        assert_eq!(result.replaced, 1);
        assert!(result.diff.contains("goodbye world"));
        assert!(result.dry_run);
    }

    #[test]
    fn blocks_git_write() {
        let dir = tempfile::tempdir().unwrap();
        let git_dir = dir.path().join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(git_dir.join("config"), "[core]").unwrap();
        let err = edit_file(dir.path(), ".git/config", "[core]", "[core]\n", false, false);
        assert!(err.is_err());
        assert!(err.unwrap_err().contains(".git"));
    }
}
