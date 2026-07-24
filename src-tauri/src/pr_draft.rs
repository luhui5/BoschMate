use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PrDraft {
    pub title: String,
    pub description: String,
    pub branch: Option<String>,
    pub base_branch: Option<String>,
    pub file_count: usize,
    pub commit_count: usize,
}

pub fn generate_pr_draft(
    repo_path: &std::path::Path,
    base_branch: Option<&str>,
) -> Result<PrDraft, String> {
    let repo = git2::Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let branch = head.shorthand().map(|s| s.to_string());

    let base = base_branch.unwrap_or("main");
    let base_ref = format!("refs/heads/{}", base);

    let head_oid = head.target().ok_or("HEAD has no target")?;
    let base_oid = repo
        .find_reference(&base_ref)
        .or_else(|_| repo.find_reference(&format!("refs/remotes/origin/{}", base)))
        .map_err(|_| format!("Base branch '{}' not found", base))?
        .target()
        .ok_or("Base ref has no target")?;

    let base_obj = repo.find_object(base_oid, None).map_err(|e| e.to_string())?;
    let head_obj = repo.find_object(head_oid, None).map_err(|e| e.to_string())?;

    let mut diff_opts = git2::DiffOptions::new();
    let diff = repo
        .diff_tree_to_tree(
            base_obj.as_tree(),
            head_obj.as_tree(),
            Some(&mut diff_opts),
        )
        .map_err(|e| format!("Diff failed: {}", e))?;

    let file_count = diff.deltas().len();
    let stats = diff.stats().map_err(|e| format!("Diff stats failed: {}", e))?;
    let files_changed = stats.files_changed();
    let insertions = stats.insertions();
    let deletions = stats.deletions();

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_range(&format!("{}..{}", base_oid, head_oid)).map_err(|e| e.to_string())?;
    let commit_count = revwalk.count();

    let mut commit_msgs = Vec::new();
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_range(&format!("{}..{}", base_oid, head_oid)).map_err(|e| e.to_string())?;
    for oid in revwalk {
        if let Ok(oid) = oid {
            if let Ok(commit) = repo.find_commit(oid) {
                let msg = commit.message().unwrap_or("").trim().to_string();
                if !msg.is_empty() {
                    commit_msgs.push(msg);
                }
            }
        }
    }

    let file_list: Vec<String> = diff
        .deltas()
        .filter_map(|d| d.new_file().path().and_then(|p| p.to_str().map(|s| s.to_string())))
        .collect();

    let title = generate_title(&branch, &commit_msgs);
    let description = format_description(
        &branch,
        &commit_msgs,
        &file_list,
        files_changed,
        insertions,
        deletions,
        commit_count,
    );

    Ok(PrDraft {
        title,
        description,
        branch,
        base_branch: Some(base.to_string()),
        file_count,
        commit_count,
    })
}

fn generate_title(branch: &Option<String>, commits: &[String]) -> String {
    if let Some(msg) = commits.last() {
        let first_line = msg.lines().next().unwrap_or("");
        let title = first_line.trim();
        if title.len() <= 80 {
            return title.to_string();
        }
        return format!("{}…", &title[..77]);
    }
    if let Some(b) = branch {
        return b.replace('-', " ").replace('_', " ");
    }
    "Code changes".to_string()
}

fn format_description(
    branch: &Option<String>,
    commits: &[String],
    files: &[String],
    files_changed: usize,
    insertions: usize,
    deletions: usize,
    commit_count: usize,
) -> String {
    let mut desc = String::new();

    if let Some(b) = branch {
        desc.push_str(&format!("## Branch\n\n`{}`\n\n", b));
    }

    desc.push_str("## Summary\n\n");
    desc.push_str(&format!(
        "- **{}** commits\n- **{}** files changed (+{} / -{})\n\n",
        commit_count, files_changed, insertions, deletions
    ));

    desc.push_str("## Commits\n\n");
    for msg in commits.iter().rev().take(10) {
        let first_line = msg.lines().next().unwrap_or(msg);
        desc.push_str(&format!("- {}\n", first_line));
    }
    desc.push('\n');

    if !files.is_empty() {
        desc.push_str("## Changed Files\n\n");
        for f in files.iter().take(30) {
            desc.push_str(&format!("- `{}`\n", f));
        }
        if files.len() > 30 {
            desc.push_str(&format!("- *…and {} more files*\n", files.len() - 30));
        }
        desc.push('\n');
    }

    desc.push_str("## Description\n\n<!-- Add a brief description of the changes -->\n");

    desc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_title_from_commits() {
        let title = generate_title(&None, &["Add new feature for user auth".into()]);
        assert_eq!(title, "Add new feature for user auth");
    }

    #[test]
    fn test_generate_title_from_branch() {
        let title = generate_title(&Some("fix-login-bug".into()), &[]);
        assert_eq!(title, "fix login bug");
    }
}
