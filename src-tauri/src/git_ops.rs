use crate::models::{DiffStats, GitCommit, GitDiff, GitFile, GitStatus};
use git2::{DiffOptions, Repository, StatusOptions, Sort};
use std::path::Path;

/// Get current git status
pub fn get_status(repo_path: &Path) -> Result<GitStatus, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;

    let branch = get_current_branch(&repo)?;
    let (ahead, behind) = get_ahead_behind(&repo)?;
    let files = get_status_files(&repo)?;

    Ok(GitStatus {
        branch,
        files,
        ahead,
        behind,
    })
}

/// Get diff for the working tree
pub fn get_diff(
    repo_path: &Path,
    staged: bool,
    path: Option<&str>,
    context_lines: Option<usize>,
) -> Result<GitDiff, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;

    let mut opts = DiffOptions::new();
    opts.context_lines(context_lines.unwrap_or(3) as u32);

    if let Some(p) = path {
        opts.pathspec(p);
    }

    let diff = if staged {
        // Staged changes: diff between HEAD and index
        let tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(tree.as_ref(), None, Some(&mut opts))
            .map_err(|e| format!("Diff error: {}", e))?
    } else {
        // Unstaged changes: diff between index and working dir
        repo.diff_index_to_workdir(None, Some(&mut opts))
            .map_err(|e| format!("Diff error: {}", e))?
    };

    let diff_text = diff_to_string(&repo, &diff)?;
    let stats = diff_stats(&diff)?;
    let file_list = diff_files(&diff)?;

    Ok(GitDiff {
        diff: diff_text,
        files: file_list,
        stats,
    })
}

/// Get commit history
pub fn get_log(repo_path: &Path, count: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;

    let mut revwalk = repo.revwalk().map_err(|e| format!("Revwalk error: {}", e))?;
    revwalk.push_head().map_err(|e| format!("Push head error: {}", e))?;
    revwalk.set_sorting(Sort::TIME).ok();

    let limit = count.unwrap_or(50);
    let mut commits = Vec::new();

    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| format!("Oid error: {}", e))?;
        let commit = repo.find_commit(oid).map_err(|e| format!("Find commit error: {}", e))?;
        let time = commit.time();
        let date = chrono::DateTime::from_timestamp(time.seconds(), 0)
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_default();

        commits.push(GitCommit {
            sha: oid.to_string()[..8].to_string(),
            message: commit.message().unwrap_or("").to_string().trim().to_string(),
            author: commit.author().name().unwrap_or("unknown").to_string(),
            date,
        });
    }

    Ok(commits)
}

/// Create a commit
pub fn commit(repo_path: &Path, message: &str, files: Option<Vec<String>>) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;

    let signature = repo
        .signature()
        .map_err(|e| format!("No git config found: {}. Please set user.name and user.email.", e))?;

    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;

    if let Some(ref paths) = files {
        if !paths.is_empty() {
            for path in paths {
                add_path_to_index(repo_path, &mut index, path)
                    .map_err(|e| format!("Add path error for '{}': {}", path, e))?;
            }
            index.write().map_err(|e| format!("Index write error: {}", e))?;
        }
        // empty vec: commit current index as-is (VS Code staged-only)
    } else {
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| format!("Add all error: {}", e))?;
        index.write().map_err(|e| format!("Index write error: {}", e))?;
    }

    let oid = index.write_tree().map_err(|e| format!("Write tree error: {}", e))?;
    let tree = repo.find_tree(oid).map_err(|e| format!("Find tree error: {}", e))?;

    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let commit_oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .map_err(|e| format!("Commit error: {}", e))?;

    Ok(commit_oid.to_string())
}

/// List branches
pub fn list_branches(repo_path: &Path) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let branches = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| format!("Branch error: {}", e))?;

    let mut names = Vec::new();
    for branch in branches.flatten() {
        if let Ok(Some(name)) = branch.0.name() {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// Create and switch to a new branch
#[allow(dead_code)]
pub fn create_branch(repo_path: &Path, name: &str) -> Result<(), String> {
    create_and_checkout_branch(repo_path, name)
}

/// Switch to an existing branch
pub fn checkout_branch(repo_path: &Path, name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let reference = format!("refs/heads/{}", name);
    let obj = repo
        .revparse_single(&reference)
        .map_err(|e| format!("Branch '{}' not found: {}", name, e))?;
    let tree = obj
        .peel_to_tree()
        .map_err(|e| format!("Peel tree error: {}", e))?;
    repo.checkout_tree(tree.as_object(), None)
        .map_err(|e| format!("Checkout tree error: {}", e))?;
    repo.set_head(&reference)
        .map_err(|e| format!("Set HEAD error: {}", e))?;
    Ok(())
}

/// Create a branch at HEAD and check it out
pub fn create_and_checkout_branch(repo_path: &Path, name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let head = repo.head().map_err(|e| format!("Head error: {}", e))?;
    let commit = head.peel_to_commit().map_err(|e| format!("Peel error: {}", e))?;
    let branch = repo
        .branch(name, &commit, false)
        .map_err(|e| format!("Create branch error: {}", e))?;
    let refname = branch
        .get()
        .name()
        .ok_or_else(|| "Invalid branch name".to_string())?;
    repo.checkout_tree(commit.as_object(), None)
        .map_err(|e| format!("Checkout error: {}", e))?;
    repo.set_head(refname)
        .map_err(|e| format!("Set HEAD error: {}", e))?;
    Ok(())
}

fn add_path_to_index(
    repo_path: &Path,
    index: &mut git2::Index,
    path: &str,
) -> Result<(), git2::Error> {
    let full = repo_path.join(path);
    if full.exists() {
        index.add_path(Path::new(path))
    } else {
        index.add_all([path].iter(), git2::IndexAddOption::DEFAULT, None)
    }
}

/// Stage files (git add)
pub fn stage_files(repo_path: &Path, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let mut index = repo.index().map_err(|e| format!("Index error: {}", e))?;
    for path in paths {
        add_path_to_index(repo_path, &mut index, path)
            .map_err(|e| format!("Stage '{}' error: {}", path, e))?;
    }
    index.write().map_err(|e| format!("Index write error: {}", e))?;
    Ok(())
}

/// Unstage files (git reset HEAD -- paths)
pub fn unstage_files(repo_path: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut cmd = crate::process_util::command("git");
    cmd.current_dir(repo_path).arg("reset").arg("HEAD").arg("--");
    for path in paths {
        cmd.arg(path);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git reset: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
}

/// Stash working tree changes. Returns stash ref message.
pub fn stash_push(
    repo_path: &Path,
    include_untracked: bool,
    message: Option<&str>,
) -> Result<String, String> {
    let mut repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let sig = repo
        .signature()
        .map_err(|e| format!("Git signature error: {}", e))?;
    let msg = message.unwrap_or("BoschCode auto-stash");
    let mut opts = git2::StashFlags::empty();
    if include_untracked {
        opts.insert(git2::StashFlags::INCLUDE_UNTRACKED);
    }
    let oid = repo
        .stash_save(&sig, msg, Some(opts))
        .map_err(|e| format!("Stash error: {}", e))?;
    Ok(format!("Stashed as {} ({})", msg, oid))
}

pub fn stash_pop(repo_path: &Path) -> Result<(), String> {
    let mut repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    repo.stash_pop(0, None)
        .map_err(|e| format!("Stash pop error: {}", e))?;
    Ok(())
}

pub fn stash_list(repo_path: &Path) -> Result<Vec<StashEntry>, String> {
    let mut repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let mut out = Vec::new();
    repo.stash_foreach(|index, message, _| {
        out.push(StashEntry {
            index,
            message: message.to_string(),
        });
        true
    })
    .map_err(|e| format!("Stash list error: {}", e))?;
    Ok(out)
}

/// Stash if there are untracked files that would be overwritten (protection).
#[allow(dead_code)]
pub fn stash_untracked_if_needed(repo_path: &Path) -> Result<Option<String>, String> {
    let status = get_status(repo_path)?;
    let has_untracked = status.files.iter().any(|f| f.status == "untracked");
    if !has_untracked {
        return Ok(None);
    }
    let msg = stash_push(repo_path, true, Some("BoschCode: protect untracked files"))?;
    Ok(Some(msg))
}

// ── Internal helpers ──

fn get_current_branch(repo: &Repository) -> Result<String, String> {
    let head = repo.head().map_err(|e| format!("Head error: {}", e))?;
    if head.is_branch() {
        Ok(head.shorthand().unwrap_or("HEAD").to_string())
    } else {
        Ok(format!("HEAD ({})", &head.target().map(|o| o.to_string()[..8].to_string()).unwrap_or_default()))
    }
}

fn get_ahead_behind(repo: &Repository) -> Result<(usize, usize), String> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok((0, 0)),
    };
    let local = head.peel_to_commit().map_err(|_| "Peel error".to_string())?;

    let upstream = match repo
        .find_reference("HEAD")
        .ok()
        .and_then(|r| {
            let name = r.name()?;
            if name.starts_with("refs/heads/") {
                repo.find_reference(&format!("refs/remotes/origin/{}", &name[11..]))
                    .ok()
            } else {
                None
            }
        })
        .and_then(|r| r.peel_to_commit().ok())
    {
        Some(c) => c,
        None => return Ok((0, 0)),
    };

    let (ahead, behind) = repo
        .graph_ahead_behind(local.id(), upstream.id())
        .map_err(|e| format!("Graph error: {}", e))?;

    Ok((ahead, behind))
}

fn get_status_files(repo: &Repository) -> Result<Vec<GitFile>, String> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .renames_head_to_index(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Status error: {}", e))?;

    let mut files = Vec::new();
    for entry in statuses.iter() {
        let status = entry.status();
        let path = entry
            .path()
            .map(|p| p.to_string())
            .unwrap_or_default();

        let file_status = if status.is_wt_new() && !status.is_index_new() {
            "untracked"
        } else if status.is_index_new() || status.is_wt_new() {
            "added"
        } else if status.is_index_deleted() || status.is_wt_deleted() {
            "deleted"
        } else if status.is_index_renamed() || status.is_wt_renamed() {
            "renamed"
        } else if status.is_index_modified() || status.is_wt_modified() {
            "modified"
        } else {
            continue;
        };

        let staged = status.is_index_modified()
            || status.is_index_new()
            || status.is_index_deleted()
            || status.is_index_renamed();

        files.push(GitFile {
            path,
            status: file_status.to_string(),
            staged,
            additions: 0,
            deletions: 0,
        });
    }

    Ok(files)
}

fn diff_to_string(_repo: &Repository, diff: &git2::Diff) -> Result<String, String> {
    let mut buf = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        let content = String::from_utf8_lossy(line.content());
        match origin {
            '+' | '-' | ' ' => buf.push_str(&format!("{}{}", origin, content)),
            'F' | 'H' => buf.push_str(&format!("{}", content)),
            _ => {}
        }
        true
    })
    .map_err(|e| format!("Diff print error: {}", e))?;
    Ok(buf)
}

fn diff_stats(diff: &git2::Diff) -> Result<DiffStats, String> {
    let stats = diff.stats().map_err(|e| format!("Stats error: {}", e))?;
    Ok(DiffStats {
        added: stats.insertions() as u32,
        removed: stats.deletions() as u32,
        changed: stats.files_changed() as u32,
    })
}

fn diff_files(diff: &git2::Diff) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    diff.foreach(
        &mut |delta, _| {
            if let Some(path) = delta.new_file().path() {
                files.push(path.to_string_lossy().to_string());
            }
            true
        },
        None,
        None,
        None,
    )
    .map_err(|e| format!("Diff foreach error: {}", e))?;
    Ok(files)
}

#[cfg(test)]
mod stage_tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn stage_deleted_tracked_file() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("parent")
            .to_path_buf();
        let path = "components/assistant/folder-picker.tsx".to_string();
        let _ = unstage_files(&repo, std::slice::from_ref(&path));
        stage_files(&repo, std::slice::from_ref(&path)).expect("stage deleted file");
        let status = get_status(&repo).expect("status");
        let f = status
            .files
            .iter()
            .find(|f| f.path == path)
            .expect("file in status");
        assert!(f.staged, "deletion should be staged");
        assert_eq!(f.status, "deleted");
        let _ = unstage_files(&repo, std::slice::from_ref(&path));
    }

    #[test]
    fn get_status_returns_worktree_files() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("parent")
            .to_path_buf();
        let status = get_status(&repo).expect("status");
        eprintln!(
            "file_count={} staged={} unstaged={}",
            status.files.len(),
            status.files.iter().filter(|f| f.staged).count(),
            status.files.iter().filter(|f| !f.staged).count()
        );
        assert!(
            !status.files.is_empty(),
            "expected git changes in dev repo"
        );
    }
}
