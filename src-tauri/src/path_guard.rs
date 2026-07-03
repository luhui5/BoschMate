/// Path safety checks shared by fs_ops and code_editor.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_git_paths() {
        assert!(reject_protected_path(".git/config").is_err());
        assert!(reject_protected_path("src/.git/HEAD").is_err());
        assert!(reject_protected_path("src/main.rs").is_ok());
    }
}
