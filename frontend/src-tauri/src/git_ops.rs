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
        let date = chrono::NaiveDateTime::from_timestamp_opt(time.seconds(), 0)
            .map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
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
        for path in paths {
            index
                .add_path(Path::new(path))
                .map_err(|e| format!("Add path error for '{}': {}", path, e))?;
        }
    } else {
        // Stage all
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| format!("Add all error: {}", e))?;
    }

    index.write().map_err(|e| format!("Index write error: {}", e))?;
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
pub fn create_branch(repo_path: &Path, name: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Not a git repository: {}", e))?;
    let head = repo.head().map_err(|e| format!("Head error: {}", e))?;
    let commit = head.peel_to_commit().map_err(|e| format!("Peel error: {}", e))?;
    repo.branch(name, &commit, false)
        .map_err(|e| format!("Create branch error: {}", e))?;
    Ok(())
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

        let file_status = if status.is_index_new() || status.is_wt_new() {
            "added"
        } else if status.is_index_deleted() || status.is_wt_deleted() {
            "deleted"
        } else if status.is_index_renamed() || status.is_wt_renamed() {
            "renamed"
        } else if status.is_index_modified() || status.is_wt_modified() {
            "modified"
        } else if status.is_wt_new() {
            "untracked"
        } else {
            continue; // skip clean files
        };

        files.push(GitFile {
            path,
            status: file_status.to_string(),
            staged: status.is_index_modified() || status.is_index_new() || status.is_index_deleted(),
            additions: 0,
            deletions: 0,
        });
    }

    Ok(files)
}

fn diff_to_string(repo: &Repository, diff: &git2::Diff) -> Result<String, String> {
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
