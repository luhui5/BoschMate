use serde::{Deserialize, Serialize};

// ── Project ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub local_path: String,
    pub language: Option<String>,
    pub framework: Option<String>,
    pub git_remote: Option<String>,
    pub git_branch: Option<String>,
    pub ci_status: String,
    pub created_at: String,
    pub opened_at: Option<String>,
    pub last_summary: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub local_path: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub framework: Option<String>,
}

// ── Session & Message ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub mode: String,
    pub status: String,
    pub parent_id: Option<String>,
    pub token_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub mode: Option<String>,
    pub tool_calls: Option<serde_json::Value>,
    pub diffs: Option<serde_json::Value>,
    pub file_refs: Option<serde_json::Value>,
    pub token_usage: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionInput {
    pub project_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String { "ask".into() }

#[derive(Debug, Deserialize)]
pub struct SendMessageInput {
    pub session_id: String,
    pub content: String,
    pub mode: Option<String>,
}

// ── File ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub r#type: String, // "file" | "dir" | "symlink"
    pub size: u64,
    pub modified: Option<String>,
    pub children: Option<Vec<FileEntry>>,
}

#[derive(Debug, Deserialize)]
pub struct ReadFileInput {
    pub path: String,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct GlobInput {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GrepInput {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub glob: Option<String>,
    #[serde(default)]
    pub head_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepMatch {
    pub file: String,
    pub line: usize,
    pub content: String,
}

// ── Git ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitFile {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "untracked"
    pub staged: bool,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub files: Vec<GitFile>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitDiff {
    pub diff: String,
    pub files: Vec<String>,
    pub stats: DiffStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    pub added: u32,
    pub removed: u32,
    pub changed: u32,
}

// ── Memory ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub project_id: String,
    pub r#type: String,
    pub content: String,
    pub summary: Option<String>,
    pub importance: f64,
    pub source_session_id: Option<String>,
    pub access_count: i64,
    pub last_accessed_at: Option<String>,
    pub encrypted: bool,
    pub created_at: String,
}

// ── Note ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

// ── Skill ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub command: Option<String>,
}

// ── Update ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub download_url: Option<String>,
    pub size_bytes: Option<u64>,
    pub changelog: Option<String>,
}
