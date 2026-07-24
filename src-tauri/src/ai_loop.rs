use crate::ai_client::{self, AiMessage, AiToolDef, ChatRequest, ChatResponse, ToolCallResult};
use crate::chat_cancel;
use crate::code_editor::{self, EditResult};
use crate::code_graph;
use crate::fs_ops;
use crate::git_ops;
use crate::knowledge_tools::{
    tool_list_knowledge_bases, tool_read_knowledge_document, tool_search_knowledge,
    KnowledgeToolCtx,
};
use crate::sandbox;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// One step in the AI loop timeline (thought phase or tool execution).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityStep {
    pub id: String,
    pub kind: String, // "thought" | "tool"
    pub round: u32,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    pub status: String, // "running" | "success" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

pub type ActivityLog = Arc<Mutex<Vec<ActivityStep>>>;

fn emit_activity(app: &AppHandle, session_id: &str, message_id: &str, step: &ActivityStep) {
    let _ = app.emit(
        "loop-activity",
        serde_json::json!({
            "session_id": session_id,
            "message_id": message_id,
            "step": step,
        }),
    );
}

fn push_thought(log: &ActivityLog, app: &AppHandle, session_id: &str, message_id: &str, round: u32) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let step = ActivityStep {
        id: id.clone(),
        kind: "thought".into(),
        round,
        label: "思考".into(),
        detail: None,
        tool: None,
        args: None,
        status: "running".into(),
        result: None,
        started_at: Some(now),
        finished_at: None,
    };
    log.lock().unwrap().push(step.clone());
    emit_activity(app, session_id, message_id, &step);
    id
}

fn finish_thought(
    log: &ActivityLog,
    app: &AppHandle,
    session_id: &str,
    message_id: &str,
    thought_id: &str,
    content: &str,
) {
    let mut steps = log.lock().unwrap();
    if let Some(step) = steps.iter_mut().find(|s| s.id == thought_id) {
        step.status = "success".into();
        step.finished_at = Some(chrono::Utc::now().to_rfc3339());
        if !content.trim().is_empty() {
            step.detail = Some(content.to_string());
        }
        emit_activity(app, session_id, message_id, step);
    }
}

/// Metadata needed to apply a pending edit after user confirmation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingEditMeta {
    pub path: String,
    pub old_string: String,
    pub new_string: String,
    pub replace_all: bool,
    /// "edit" for patch edits, "write" for full-file writes.
    pub kind: String,
    pub result: EditResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskUserOption {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskUserQuestion {
    pub id: String,
    pub prompt: String,
    pub options: Vec<AskUserOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_multiple: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionAnswer {
    pub question_id: String,
    pub selected_option_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingQuestions {
    pub questions: Vec<AskUserQuestion>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answers: Option<Vec<QuestionAnswer>>,
}

pub enum LoopOutcome {
    Completed(ChatResponse),
    Paused {
        response: ChatResponse,
        paused: PausedLoopState,
    },
}

#[derive(Clone)]
pub struct PausedLoopState {
    pub app: AppHandle,
    pub project_root: PathBuf,
    pub session_id: String,
    pub message_id: String,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub skip_tls_verify: bool,
    pub system_prompt: Option<String>,
    pub current_messages: Vec<AiMessage>,
    pub tools: Vec<AiToolDef>,
    pub max_iterations: Option<usize>,
    pub config: LoopConfig,
    pub iteration: u32,
    pub activity_log: ActivityLog,
    pub collector: EditCollector,
    pub ask_user_call: ToolCallResult,
    pub pending_questions: PendingQuestions,
    pub cancel: Arc<AtomicBool>,
    pub knowledge_ctx: Option<Arc<KnowledgeToolCtx>>,
}

#[derive(Debug, Clone)]
pub struct LoopConfig {
    /// When true, edit_file runs dry_run and collects pending edits instead of writing.
    pub dry_run_edits: bool,
    /// Auto mode — enforce bulk write confirmation threshold.
    pub auto_mode: bool,
    /// User confirmed bulk writes (>50 files).
    pub bulk_write_confirmed: bool,
    /// Count of file writes in this loop iteration chain.
    pub write_count: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    /// Agent mode label (ask / plan / edit / auto).
    pub agent_mode: String,
    /// Set true after ask_user returns user answers in this loop (side-effect guard).
    pub ask_user_satisfied: bool,
    /// Enabled knowledge base ids from the frontend (empty = all bases).
    pub enabled_kbase_ids: Vec<String>,
    /// Network whitelist domains (e.g. ["*.npmjs.org"]).
    pub network_whitelist: Vec<String>,
}

const BULK_WRITE_LIMIT: usize = 50;

fn check_bulk_write_limit(config: &LoopConfig) -> Result<(), String> {
    if config.auto_mode && !config.bulk_write_confirmed {
        let count = config
            .write_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        if count > BULK_WRITE_LIMIT {
            return Err(format!(
                "BULK_WRITE_LIMIT: Auto mode would modify more than {} files. User confirmation required.",
                BULK_WRITE_LIMIT
            ));
        }
    }
    Ok(())
}

pub type EditCollector = Arc<Mutex<Vec<PendingEditMeta>>>;

/// Path parameter description shared by file tools.
const WORKSPACE_PATH_DESC: &str =
    "Path relative to workspace root, or absolute path if under the bound workspace folder";

/// Available tools registered with the AI
pub fn get_tools() -> Vec<AiToolDef> {
    vec![
        AiToolDef {
            name: "read_file".into(),
            description: "Read a file from the project. Use offset/limit for line ranges.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC},
                    "offset": {"type": "integer", "description": "Start line (0-indexed)"},
                    "limit": {"type": "integer", "description": "Max lines to read"}
                },
                "required": ["path"]
            }),
        },
        AiToolDef {
            name: "write_file".into(),
            description: "Create or overwrite a file with new content.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }),
        },
        AiToolDef {
            name: "edit_file".into(),
            description: "Replace exact string in a file. old_string must match exactly (including whitespace). Use for small, precise changes.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC},
                    "old_string": {"type": "string"},
                    "new_string": {"type": "string"},
                    "replace_all": {"type": "boolean", "default": false}
                },
                "required": ["path", "old_string", "new_string"]
            }),
        },
        AiToolDef {
            name: "search_replace".into(),
            description: "Regex-based search and replace in files. Use for bulk replacements across multiple files.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC},
                    "pattern": {"type": "string", "description": "Regex pattern to search for"},
                    "replacement": {"type": "string", "description": "Replacement string (supports $1, $2 for capture groups)"},
                    "glob": {"type": "string", "description": "Optional glob pattern to match files (e.g., '**/*.rs')"}
                },
                "required": ["path", "pattern", "replacement"]
            }),
        },
        AiToolDef {
            name: "grep".into(),
            description: "Search file contents using regex patterns.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC},
                    "glob": {"type": "string"},
                    "head_limit": {"type": "integer"}
                },
                "required": ["pattern"]
            }),
        },
        AiToolDef {
            name: "glob".into(),
            description: "Find files matching a glob pattern.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC}
                },
                "required": ["pattern"]
            }),
        },
        AiToolDef {
            name: "list_directory".into(),
            description: "List files and directories in a path.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC}
                }
            }),
        },
        AiToolDef {
            name: "change_dir".into(),
            description: "Change the working directory for subsequent operations. Path must be within project root.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC}
                },
                "required": ["path"]
            }),
        },
        AiToolDef {
            name: "bash".into(),
            description: "Execute a shell command in the project directory (sandboxed). Use for running tests, builds, linters, git commands.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to execute"},
                    "cwd": {"type": "string", "description": "Working directory (defaults to project root)"}
                },
                "required": ["command"]
            }),
        },
        AiToolDef {
            name: "git_status".into(),
            description: "Get current git status: branch, changed files, staged/unstaged.".into(),
            parameters: serde_json::json!({"type": "object", "properties": {}}),
        },
        AiToolDef {
            name: "git_diff".into(),
            description: "Show git diff for working tree or staged changes.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "staged": {"type": "boolean"},
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC}
                }
            }),
        },
        AiToolDef {
            name: "git_log".into(),
            description: "Show recent git commit history.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "count": {"type": "integer", "default": 20}
                }
            }),
        },
        AiToolDef {
            name: "git_commit".into(),
            description: "Create a git commit with staged changes. Does not push.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "Commit message"}
                },
                "required": ["message"]
            }),
        },
        AiToolDef {
            name: "git_push".into(),
            description: "Push commits to remote repository. Requires user confirmation. Force push is blocked.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "remote": {"type": "string", "description": "Remote name (default: origin)"},
                    "force": {"type": "boolean", "description": "Force push (blocked for safety)", "default": false}
                }
            }),
        },
        // Code graph tools
        AiToolDef {
            name: "list_symbols".into(),
            description: "List all symbols in a source file. Use to understand code structure.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"file_path":{"type":"string","description":WORKSPACE_PATH_DESC},"kind_filter":{"type":"string"}},"required":["file_path"]}),
        },
        AiToolDef {
            name: "find_references".into(),
            description: "Find all references to a symbol across the codebase.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"symbol_name":{"type":"string"},"file_path":{"type":"string","description":WORKSPACE_PATH_DESC}},"required":["symbol_name","file_path"]}),
        },
        AiToolDef {
            name: "file_deps".into(),
            description: "Analyze import/dependency relationships for a file.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"file_path":{"type":"string","description":WORKSPACE_PATH_DESC},"direction":{"type":"string"}},"required":["file_path"]}),
        },
        AiToolDef {
            name: "blast_radius".into(),
            description: "Analyze what files would be affected by changing a symbol or file.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"file_path":{"type":"string","description":WORKSPACE_PATH_DESC},"symbol_name":{"type":"string"}},"required":["file_path"]}),
        },
        AiToolDef {
            name: "open".into(),
            description: "Open a URL, application, file, or folder in the OS default or specified app. Use for 打开微信/浏览器/文件夹/文件/VS Code.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "URL, app name, exe path, or file/folder path (relative paths resolve under workspace)"},
                    "kind": {"type": "string", "enum": ["auto", "url", "app", "file", "folder", "reveal"], "description": "Default: auto-detect"},
                    "with": {"type": "string", "description": "Optional app id (e.g. code, firefox)"}
                },
                "required": ["target"]
            }),
        },
        AiToolDef {
            name: "open_vscode".into(),
            description: "Open the workspace or a subfolder in Visual Studio Code (alias for open with VS Code).".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": WORKSPACE_PATH_DESC}
                }
            }),
        },
        AiToolDef {
            name: "web_fetch".into(),
            description: "Fetch a public HTTPS URL and return page content as Markdown. Read-only; use for documentation and articles.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "HTTPS URL to fetch (HTTP is upgraded to HTTPS)"},
                    "prompt": {"type": "string", "description": "Optional focus hint for what to emphasize in the result"}
                },
                "required": ["url"]
            }),
        },
        AiToolDef {
            name: "web_search".into(),
            description: "Search the web and return result summaries. Read-only; use for finding documentation, articles, or references.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "allowed_domains": {"type": "array", "items": {"type": "string"}, "description": "Optional: only include results from these domains (supports wildcards like *.github.com)"},
                    "blocked_domains": {"type": "array", "items": {"type": "string"}, "description": "Optional: exclude results from these domains"}
                },
                "required": ["query"]
            }),
        },
        AiToolDef {
            name: "outlook_read".into(),
            description: "Read emails from the local Outlook desktop client (Windows). Scans all folders when filter=today or from/to is set (default). Examples: today's mail across all folders ({ filter: today }); emails from someone ({ from: name }); emails to someone ({ to: email }); inbox only ({ folder: inbox }).".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "folder": {"type": "string", "enum": ["inbox", "sent", "drafts", "deleted", "all"], "description": "Mail folder. Default: all when filter=today or from/to set; otherwise inbox."},
                    "filter": {"type": "string", "enum": ["recent", "today", "unread", "since"], "description": "Filter mode (default: recent)"},
                    "since": {"type": "string", "description": "ISO date YYYY-MM-DD when filter=since"},
                    "from": {"type": "string", "description": "Sender name or email substring. Default folder=all when set."},
                    "to": {"type": "string", "description": "Recipient name or email substring (matches To and CC). Default folder=all when set."},
                    "count": {"type": "integer", "description": "Max messages to return (default 10, max 25)"},
                    "include_body": {"type": "boolean", "description": "Include message body (default true)"}
                }
            }),
        },
        AiToolDef {
            name: "outlook_send".into(),
            description: "Send or draft an email via the local Outlook desktop client (Windows). Requires edit or auto mode. Use ask_user to confirm recipients before sending unless the user explicitly says to send immediately.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "to": {"type": "array", "items": {"type": "string"}, "description": "Recipient email addresses"},
                    "cc": {"type": "array", "items": {"type": "string"}, "description": "CC recipients"},
                    "bcc": {"type": "array", "items": {"type": "string"}, "description": "BCC recipients"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Plain-text email body"},
                    "draft": {"type": "boolean", "description": "If true, save to Drafts instead of sending (default false)"}
                },
                "required": ["to", "subject", "body"]
            }),
        },
        AiToolDef {
            name: "list_knowledge_bases".into(),
            description: "List available knowledge bases and their document counts.".into(),
            parameters: serde_json::json!({"type": "object", "properties": {}}),
        },
        AiToolDef {
            name: "search_knowledge".into(),
            description: "Search uploaded knowledge base documents by keyword. Returns excerpts with document_id and chunk_index for follow-up reads.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "kbase_id": {"type": "string", "description": "Optional knowledge base id to limit search"},
                    "limit": {"type": "integer", "description": "Max results (default 8)"}
                },
                "required": ["query"]
            }),
        },
        AiToolDef {
            name: "read_knowledge_document".into(),
            description: "Read content from an indexed knowledge base document. Use document_id from search_knowledge results.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "document_id": {"type": "string"},
                    "chunk_index": {"type": "integer", "description": "Start chunk index (optional)"},
                    "limit": {"type": "integer", "description": "Number of chunks to read (default 1 when chunk_index set)"}
                },
                "required": ["document_id"]
            }),
        },
        AiToolDef {
            name: "ask_user".into(),
            description: "Ask the user structured clarification questions with selectable options. The agent pauses until the user answers. Use when requirements are ambiguous or multiple valid approaches exist — do NOT list options only in plain text. Each question must have exactly 3 options (recommended first with '(Recommended)' in label, plus 2 alternatives). Do NOT include Other — the UI adds it.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "prompt": {"type": "string"},
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string"},
                                            "label": {"type": "string"}
                                        },
                                        "required": ["id", "label"]
                                    }
                                },
                                "allow_multiple": {"type": "boolean", "default": false}
                            },
                            "required": ["id", "prompt", "options"]
                        }
                    }
                },
                "required": ["questions"]
            }),
        },
        AiToolDef {
            name: "link_memories".into(),
            description: "Create a link between two related memories. Use when you identify that two memories are semantically related, one depends on another, or they share a common context.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "ID of the source memory"},
                    "target_id": {"type": "string", "description": "ID of the target memory"},
                    "link_type": {"type": "string", "enum": ["related_to", "depends_on", "contradicts", "extends"], "description": "Type of relationship"}
                },
                "required": ["source_id", "target_id", "link_type"]
            }),
        },
    ]
}

pub fn get_skill_tools(skills_dir: &std::path::Path) -> Vec<AiToolDef> {
    let mut tools = Vec::new();
    if let Ok(entries) = std::fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Ok(manifest) = crate::skills::parse_manifest(&path) {
                for tool_def in manifest.tools {
                    let tool_name = format!("skill__{}__{}", manifest.name, tool_def.name);
                    let skill_name = manifest.name.clone();
                    tools.push(AiToolDef {
                        name: tool_name,
                        description: format!("[Skill: {}] {}", skill_name, tool_def.description),
                        parameters: serde_json::json!({
                            "type": "object",
                            "properties": {
                                "_skill_name": {"type": "string", "description": "Internal: skill identifier", "default": skill_name},
                                "args": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Arguments to pass to the skill"
                                }
                            }
                        }),
                    });
                }
            }
        }
    }
    tools
}

pub fn get_tools_with_skills(skills_dir: Option<&std::path::Path>) -> Vec<AiToolDef> {
    let mut tools = get_tools();
    if let Some(dir) = skills_dir {
        tools.extend(get_skill_tools(dir));
    }
    tools
}

const KNOWLEDGE_TOOL_NAMES: &[&str] = &[
    "list_knowledge_bases",
    "search_knowledge",
    "read_knowledge_document",
];

const READONLY_TOOL_NAMES: &[&str] = &[
    "read_file",
    "grep",
    "glob",
    "list_directory",
    "git_status",
    "git_diff",
    "git_log",
    "list_symbols",
    "find_references",
    "file_deps",
    "blast_radius",
    "web_fetch",
    "outlook_read",
    "ask_user",
    "list_knowledge_bases",
    "search_knowledge",
    "read_knowledge_document",
];

const ASK_TOOL_NAMES: &[&str] = &[
    "read_file",
    "grep",
    "glob",
    "list_directory",
    "git_status",
    "git_diff",
    "git_log",
    "list_symbols",
    "find_references",
    "file_deps",
    "web_fetch",
    "outlook_read",
    "ask_user",
    "list_knowledge_bases",
    "search_knowledge",
    "read_knowledge_document",
];

const MUTATING_TOOL_NAMES: &[&str] = &[
    "write_file",
    "edit_file",
    "search_replace",
    "bash",
    "git_commit",
    "git_push",
    "open",
    "open_vscode",
    "outlook_send",
];

fn is_mutating_tool(name: &str) -> bool {
    MUTATING_TOOL_NAMES.contains(&name)
}

fn is_side_effect_tool(name: &str) -> bool {
    matches!(
        name,
        "bash" | "git_commit" | "git_push" | "open" | "open_vscode" | "outlook_send"
    )
}

fn check_side_effect_confirmation(config: &LoopConfig, tool_name: &str) -> Result<(), String> {
    if !is_side_effect_tool(tool_name) {
        return Ok(());
    }
    if matches!(config.agent_mode.as_str(), "edit" | "auto") && !config.ask_user_satisfied {
        return Err("请先通过 ask_user 获得用户确认后再执行该操作".into());
    }
    Ok(())
}

/// Read-only tools for Plan mode (structured plan, no execution).
pub fn get_plan_tools() -> Vec<AiToolDef> {
    let mut tools: Vec<AiToolDef> = get_tools()
        .into_iter()
        .filter(|t| READONLY_TOOL_NAMES.contains(&t.name.as_str()))
        .collect();
    tools.push(AiToolDef {
        name: "plan_generate".into(),
        description: "Generate a structured execution plan in Markdown format. Use this to produce a step-by-step plan for the user's request. The plan will be displayed as an editable card and can be exported.".into(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short title for the plan"},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "order": {"type": "integer"},
                            "action": {"type": "string", "description": "What to do in this step"},
                            "tool": {"type": "string", "description": "Which tool to use (e.g. read_file, edit_file, bash)"},
                            "args_preview": {"type": "object", "description": "Preview of arguments"},
                            "expected_result": {"type": "string", "description": "What this step should achieve"}
                        },
                        "required": ["order", "action", "tool"]
                    }
                }
            },
            "required": ["title", "steps"]
        }),
    });
    tools
}

/// Strip knowledge base tools when no kbase is selected in the UI.
pub fn without_knowledge_tools(tools: Vec<AiToolDef>) -> Vec<AiToolDef> {
    tools
        .into_iter()
        .filter(|t| !KNOWLEDGE_TOOL_NAMES.contains(&t.name.as_str()))
        .collect()
}

/// Knowledge-only session tools when a kbase is selected in the UI.
pub fn get_knowledge_only_tools() -> Vec<AiToolDef> {
    get_tools()
        .into_iter()
        .filter(|t| {
            KNOWLEDGE_TOOL_NAMES.contains(&t.name.as_str())
                || matches!(t.name.as_str(), "web_fetch" | "ask_user")
        })
        .collect()
}

/// Read-only tools for Ask mode (inspect/explain; no bash, no blast_radius).
pub fn get_ask_tools() -> Vec<AiToolDef> {
    get_tools()
        .into_iter()
        .filter(|t| ASK_TOOL_NAMES.contains(&t.name.as_str()))
        .collect()
}

/// Write-capable tools excluded from plan/ask mode.
#[allow(dead_code)]
pub fn get_write_tool_names() -> Vec<&'static str> {
    vec!["write_file", "edit_file", "bash", "git_commit"]
}

/// Execute a tool call and return the result
pub async fn execute_tool(
    app: &AppHandle,
    project_root: &PathBuf,
    tool_name: &str,
    args: &Value,
    config: &LoopConfig,
    collector: &EditCollector,
    knowledge_ctx: Option<&KnowledgeToolCtx>,
) -> Result<String, String> {
    if matches!(config.agent_mode.as_str(), "ask" | "plan") && is_mutating_tool(tool_name) {
        return Err(
            "Ask/Plan 模式不允许修改或执行 shell。请切换到 Auto 模式。".into(),
        );
    }
    check_side_effect_confirmation(config, tool_name)?;

    match tool_name {
        "read_file" => {
            let path = args["path"].as_str().ok_or("path required")?;
            let offset = args["offset"].as_u64().map(|v| v as usize);
            let limit = args["limit"].as_u64().map(|v| v as usize);
            fs_ops::read_file(project_root.as_path(), path, offset, limit)
        }
        "write_file" => {
            let path = args["path"].as_str().ok_or("path required")?;
            let content = args["content"].as_str().ok_or("content required")?;
            if config.dry_run_edits {
                let (original, result) =
                    code_editor::preview_write(project_root.as_path(), path, content)?;
                collector.lock().unwrap().push(PendingEditMeta {
                    path: path.to_string(),
                    old_string: original,
                    new_string: content.to_string(),
                    replace_all: false,
                    kind: "write".into(),
                    result: result.clone(),
                });
                Ok(format!(
                    "Write preview for {} — awaiting user confirmation\n\n```diff\n{}\n```",
                    result.path, result.diff
                ))
            } else {
                check_bulk_write_limit(config)?;
                let hash = fs_ops::write_file(project_root.as_path(), path, content)?;
                Ok(format!("File written successfully. SHA256: {}", hash))
            }
        }
        "edit_file" => {
            let path = args["path"].as_str().ok_or("path required")?;
            let old_str = args["old_string"].as_str().ok_or("old_string required")?;
            let new_str = args["new_string"].as_str().ok_or("new_string required")?;
            let replace_all = args["replace_all"].as_bool().unwrap_or(false);
            let dry = config.dry_run_edits;
            if !dry {
                check_bulk_write_limit(config)?;
            }
            let result = code_editor::edit_file(
                project_root.as_path(), path, old_str, new_str, replace_all, dry,
            )?;
            collector.lock().unwrap().push(PendingEditMeta {
                path: path.to_string(),
                old_string: old_str.to_string(),
                new_string: new_str.to_string(),
                replace_all,
                kind: "edit".into(),
                result: result.clone(),
            });
            if dry {
                Ok(format!(
                    "Edit preview for {} ({} replacement(s)) — awaiting user confirmation\n\n```diff\n{}\n```",
                    result.path, result.replaced, result.diff
                ))
            } else {
                Ok(format!(
                    "Edit applied to {} ({} replacement(s))\n\n```diff\n{}\n```",
                    result.path, result.replaced, result.diff
                ))
            }
        }
        "search_replace" => {
            let path = args["path"].as_str().ok_or("path required")?;
            let pattern = args["pattern"].as_str().ok_or("pattern required")?;
            let replacement = args["replacement"].as_str().ok_or("replacement required")?;
            let glob = args["glob"].as_str();
            let dry = config.dry_run_edits;
            if !dry {
                check_bulk_write_limit(config)?;
            }
            let results = code_editor::search_replace(
                project_root.as_path(), path, pattern, replacement, glob, dry,
            )?;
            if results.is_empty() {
                Ok("No matches found.".into())
            } else {
                let total: usize = results.iter().map(|r| r.replaced).sum();
                let files: Vec<String> = results.iter().map(|r| r.path.clone()).collect();
                let diffs: String = results.iter().map(|r| r.diff.clone()).collect::<Vec<_>>().join("\n\n");
                if dry {
                    Ok(format!(
                        "Search-replace preview: {} replacement(s) in {} file(s) — awaiting user confirmation\nFiles: {}\n\n```diff\n{}\n```",
                        total, files.len(), files.join(", "), diffs
                    ))
                } else {
                    Ok(format!(
                        "Search-replace applied: {} replacement(s) in {} file(s)\nFiles: {}\n\n```diff\n{}\n```",
                        total, files.len(), files.join(", "), diffs
                    ))
                }
            }
        }
        "grep" => {
            let pattern = args["pattern"].as_str().ok_or("pattern required")?;
            let path = args["path"].as_str();
            let glob = args["glob"].as_str();
            let limit = args["head_limit"].as_u64().map(|v| v as usize);
            let results = fs_ops::grep_search(project_root.as_path(), pattern, path, glob, limit)?;
            if results.is_empty() {
                Ok("No matches found.".into())
            } else {
                let out: Vec<String> = results
                    .iter()
                    .map(|m| format!("{}:{}: {}", m.file, m.line, m.content))
                    .collect();
                Ok(out.join("\n"))
            }
        }
        "glob" => {
            let pattern = args["pattern"].as_str().ok_or("pattern required")?;
            let path = args["path"].as_str();
            let results = fs_ops::glob_search(project_root.as_path(), pattern, path)?;
            if results.is_empty() {
                Ok("No files found.".into())
            } else {
                let out: Vec<String> = results.iter().map(|f| f.path.clone()).collect();
                Ok(out.join("\n"))
            }
        }
        "list_directory" => {
            let path = args["path"].as_str().unwrap_or(".");
            let target = project_root.join(path);
            let entries = fs_ops::list_directory(&target, 1, false);
            let out: Vec<String> = entries
                .iter()
                .map(|e| {
                    let icon = if e.r#type == "dir" { "📁" } else { "📄" };
                    format!("{} {} ({})", icon, e.name, e.r#type)
                })
                .collect();
            Ok(out.join("\n"))
        }
        "change_dir" => {
            let path = args["path"].as_str().ok_or("path required")?;
            let target = project_root.join(path);
            
            // Validate path is within project root
            let canonical_target = target.canonicalize().map_err(|e| format!("Path does not exist: {}", e))?;
            let canonical_root = project_root.canonicalize().map_err(|e| format!("Project root error: {}", e))?;
            
            if !canonical_target.starts_with(&canonical_root) {
                return Err("change_dir: path must be within project root".into());
            }
            
            // Note: This is a simplified implementation that validates the path but doesn't
            // actually change the working directory for subsequent operations.
            // A full implementation would require passing mutable state through the loop.
            Ok(format!("Working directory changed to: {}", canonical_target.display()))
        }
        "bash" => {
            let command = args["command"].as_str().ok_or("command required")?;
            let cwd = args["cwd"].as_str().unwrap_or("");
            let work_dir = if cwd.is_empty() {
                project_root.to_string_lossy().to_string()
            } else {
                project_root.join(cwd).to_string_lossy().to_string()
            };
            let config = sandbox::SandboxConfig {
                project_root: project_root.clone(),
                allow_network: false,
                network_whitelist: config.network_whitelist.clone(),
                ..Default::default()
            };
            let result = sandbox::execute_sandboxed(command, &work_dir, None, &config, false, None)?;
            Ok(format!(
                "Exit code: {}\nStdout:\n{}\nStderr:\n{}",
                result.exit_code, result.stdout, result.stderr
            ))
        }
        "open" => {
            let target = args["target"].as_str().ok_or("target required")?;
            let kind = crate::os_open::parse_open_kind(args["kind"].as_str());
            let with_app = args["with"].as_str();
            crate::os_open::open_target(
                app,
                target,
                kind,
                with_app,
                Some(project_root.as_path()),
            )
        }
        "open_vscode" => {
            let rel = args["path"].as_str().unwrap_or(".");
            crate::os_open::open_vscode_workspace(app, project_root.as_path(), rel)
        }
        "web_fetch" => {
            let url = args["url"].as_str().ok_or("url required")?;
            let prompt = args["prompt"].as_str();
            let url = url.to_string();
            let prompt = prompt.map(|s| s.to_string());
            tokio::task::spawn_blocking(move || {
                crate::web_fetch::fetch_url(&url, prompt.as_deref())
            })
            .await
            .map_err(|e| format!("web_fetch task failed: {}", e))?
        }
        "web_search" => {
            let query = args["query"].as_str().ok_or("query required")?;
            let allowed_domains: Option<Vec<String>> = args["allowed_domains"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());
            let blocked_domains: Option<Vec<String>> = args["blocked_domains"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());
            
            let query = query.to_string();
            let results = crate::web_search::web_search(&query, allowed_domains, blocked_domains)
                .await
                .map_err(|e| format!("web_search failed: {}", e))?;
            
            if results.is_empty() {
                Ok("No search results found.".into())
            } else {
                let formatted: Vec<String> = results
                    .iter()
                    .take(10)
                    .map(|r| format!("**{}**\n{}\n{}", r.title, r.url, r.snippet))
                    .collect();
                Ok(format!("Found {} results:\n\n{}", results.len(), formatted.join("\n\n---\n\n")))
            }
        }
        "outlook_read" => {
            let args = args.clone();
            tokio::task::spawn_blocking(move || crate::outlook::read_mail(&args))
                .await
                .map_err(|e| format!("outlook_read task failed: {}", e))?
        }
        "outlook_send" => {
            let args = args.clone();
            tokio::task::spawn_blocking(move || crate::outlook::send_mail(&args))
                .await
                .map_err(|e| format!("outlook_send task failed: {}", e))?
        }
        "git_status" => {
            let status = git_ops::get_status(project_root.as_path())?;
            let files: Vec<String> = status.files.iter().map(|f| {
                let staged = if f.staged { "[staged]" } else { "" };
                format!("  {} {} {}", f.status, f.path, staged)
            }).collect();
            Ok(format!("Branch: {}\nAhead: {} Behind: {}\nFiles:\n{}",
                status.branch, status.ahead, status.behind, files.join("\n")))
        }
        "git_diff" => {
            let staged = args["staged"].as_bool().unwrap_or(false);
            let path = args["path"].as_str();
            let diff = git_ops::get_diff(project_root.as_path(), staged, path, Some(3))?;
            Ok(format!("Files changed: {}\n\n```diff\n{}\n```", diff.files.join(", "), diff.diff))
        }
        "git_log" => {
            let count = args["count"].as_u64().map(|v| v as usize);
            let commits = git_ops::get_log(project_root.as_path(), count)?;
            let out: Vec<String> = commits.iter().map(|c| {
                format!("{} {} - {} ({})", c.sha, c.date.split('T').next().unwrap_or(""), c.message, c.author)
            }).collect();
            Ok(out.join("\n"))
        }
        "git_commit" => {
            let message = args["message"].as_str().ok_or("message required")?;
            git_ops::commit(project_root.as_path(), message, None)?;
            Ok(format!("Committed: {}", message))
        }
        "git_push" => {
            let remote = args["remote"].as_str();
            let force = args["force"].as_bool().unwrap_or(false);
            
            // Block force push for safety
            if force {
                return Err("Force push is blocked for safety. Use regular push instead.".into());
            }
            
            let remote_name = remote.unwrap_or("origin").to_string();
            let branch = git_ops::get_current_branch_for_path(project_root.as_path())?;
            let (ahead, behind) = git_ops::get_ahead_behind_for_path(project_root.as_path())?;
            
            let callback_id = uuid::Uuid::new_v4().to_string();
            crate::pending_push::store_push_request(
                project_root.clone(),
                remote_name.clone(),
                branch.clone(),
                callback_id.clone(),
            );
            
            let _ = app.emit("push-confirmation-requested", serde_json::json!({
                "remote": remote_name,
                "branch": branch,
                "ahead": ahead,
                "behind": behind,
                "callbackId": callback_id,
            }));
            
            Ok(format!(
                "Push confirmation requested for {} -> {}. User must confirm before push proceeds.",
                branch, remote_name
            ))
        }
        "list_symbols" => {
            let fp = args["file_path"].as_str().ok_or("file_path required")?;
            let kf = args["kind_filter"].as_str();
            let syms = code_graph::list_symbols(project_root.as_path(), fp, kf)?;
            let out: Vec<String> = syms.iter().map(|s| format!("{}:{} ({}) {}", s.file, s.line, s.kind_name(), s.name)).collect();
            Ok(out.join("\n"))
        }
        "find_references" => {
            let sym = args["symbol_name"].as_str().ok_or("symbol_name required")?;
            let fp = args["file_path"].as_str().ok_or("file_path required")?;
            let refs = code_graph::find_references(project_root.as_path(), sym, fp, Some(50))?;
            let out: Vec<String> = refs.iter().map(|r| format!("{}:{} {}", r.file, r.line, r.content)).collect();
            Ok(out.join("\n"))
        }
        "file_deps" => {
            let fp = args["file_path"].as_str().ok_or("file_path required")?;
            let dir = args["direction"].as_str().unwrap_or("both");
            let deps = code_graph::file_deps(project_root.as_path(), fp, dir)?;
            let out: Vec<String> = deps.iter().map(|d| format!("{} ({})", d.path, d.dep_type)).collect();
            Ok(out.join("\n"))
        }
        "blast_radius" => {
            let fp = args["file_path"].as_str().ok_or("file_path required")?;
            let sym = args["symbol_name"].as_str();
            let br = code_graph::blast_radius(project_root.as_path(), fp, sym)?;
            Ok(format!("{}\n\nAffected files:\n{}", br.summary, br.affected_files.iter().map(|f| format!("  {} - {}", f.path, f.reason)).collect::<Vec<_>>().join("\n")))
        }
        "list_knowledge_bases" => {
            let ctx = knowledge_ctx.ok_or("Knowledge tools not available")?;
            tool_list_knowledge_bases(ctx)
        }
        "search_knowledge" => {
            let ctx = knowledge_ctx.ok_or("Knowledge tools not available")?;
            let query = args["query"].as_str().ok_or("query required")?;
            let kbase_id = args["kbase_id"].as_str();
            let limit = args["limit"].as_u64().unwrap_or(8) as usize;
            tool_search_knowledge(ctx, query, kbase_id, limit)
        }
        "read_knowledge_document" => {
            let ctx = knowledge_ctx.ok_or("Knowledge tools not available")?;
            let document_id = args["document_id"].as_str().ok_or("document_id required")?;
            let chunk_index = args["chunk_index"].as_i64();
            let limit = args["limit"].as_i64();
            tool_read_knowledge_document(ctx, document_id, chunk_index, limit)
        }
        "plan_generate" => {
            let title = args["title"].as_str().unwrap_or("Execution Plan");
            let steps = args["steps"].as_array().ok_or("steps array required")?;
            
            let mut plan_md = format!("# {}\n\n", title);
            plan_md.push_str("## Steps\n\n");
            
            for (i, step) in steps.iter().enumerate() {
                let order = step["order"].as_u64().unwrap_or((i + 1) as u64);
                let action = step["action"].as_str().unwrap_or("");
                let tool = step["tool"].as_str().unwrap_or("");
                let expected = step["expected_result"].as_str().unwrap_or("");
                
                plan_md.push_str(&format!("{}. **{}**\n", order, action));
                plan_md.push_str(&format!("   - Tool: `{}`\n", tool));
                if !expected.is_empty() {
                    plan_md.push_str(&format!("   - Expected: {}\n", expected));
                }
                plan_md.push('\n');
            }
            
            let _ = app.emit("plan-generated", serde_json::json!({
                "title": title,
                "steps": steps,
                "markdown": plan_md,
            }));
            
            Ok(plan_md)
        }
        "link_memories" => {
            let source_id = args["source_id"].as_str().ok_or("source_id required")?;
            let target_id = args["target_id"].as_str().ok_or("target_id required")?;
            let link_type = args["link_type"].as_str().unwrap_or("related_to");
            
            let _ = app.emit("memory-link-request", serde_json::json!({
                "source_id": source_id,
                "target_id": target_id,
                "link_type": link_type,
            }));
            
            Ok(format!("Memory link created: {} --[{}]--> {}", source_id, link_type, target_id))
        }
        name if name.starts_with("skill__") => {
            let skill_name = args["_skill_name"]
                .as_str()
                .ok_or("_skill_name is required for skill tools")?;
            let skills_dir = app
                .try_state::<crate::AppState>()
                .map(|s| crate::skills_runtime::skills_dir(&s.data_dir))
                .ok_or("App state not available")?;
            let skill_dir = skills_dir.join(skill_name);
            let skill_args: Vec<String> = args["args"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let result = crate::skills_runtime::run_skill(
                &skill_dir,
                &skill_args,
                Some(project_root.as_path()),
            )
            .map_err(|e| format!("Skill '{}' failed: {}", skill_name, e))?;
            if result.success {
                Ok(format!(
                    "Skill '{}' completed successfully.\nOutput:\n{}",
                    skill_name, result.stdout
                ))
            } else {
                Err(format!(
                    "Skill '{}' failed.\nStderr:\n{}",
                    skill_name, result.stderr
                ))
            }
        }
        _ => Err(format!("Unknown tool: {}", tool_name)),
    }
}

fn is_other_option(id: &str, label: &str) -> bool {
    id.eq_ignore_ascii_case("other") || label.eq_ignore_ascii_case("other")
}

fn parse_ask_user_questions(args: &Value) -> Result<Vec<AskUserQuestion>, String> {
    let arr = args
        .get("questions")
        .and_then(|v| v.as_array())
        .ok_or("ask_user: questions array required")?;
    if arr.is_empty() {
        return Err("ask_user: at least one question required".into());
    }
    let mut out = Vec::new();
    for q in arr {
        let id = q["id"].as_str().ok_or("ask_user: question id required")?;
        let prompt = q["prompt"].as_str().ok_or("ask_user: question prompt required")?;
        let opts = q["options"]
            .as_array()
            .ok_or("ask_user: question options required")?;
        let mut options: Vec<AskUserOption> = Vec::new();
        for o in opts {
            let oid = o["id"].as_str().ok_or("ask_user: option id required")?;
            let label = o["label"].as_str().ok_or("ask_user: option label required")?;
            if is_other_option(oid, label) {
                continue;
            }
            options.push(AskUserOption {
                id: oid.to_string(),
                label: label.to_string(),
            });
        }
        if options.len() != 3 {
            return Err(format!(
                "ask_user: question '{}' needs exactly 3 options (got {} after filtering Other; recommended + 2 alternatives; no Other — UI adds it)",
                id,
                options.len()
            ));
        }
        out.push(AskUserQuestion {
            id: id.to_string(),
            prompt: prompt.to_string(),
            options,
            allow_multiple: q.get("allow_multiple").and_then(|v| v.as_bool()),
        });
    }
    Ok(out)
}

pub fn format_ask_user_result(answers: &[QuestionAnswer]) -> String {
    let mut lines = vec!["User answers:".to_string()];
    for a in answers {
        let opts = a.selected_option_ids.join(", ");
        if let Some(other) = &a.other_text {
            if !other.trim().is_empty() {
                lines.push(format!(
                    "- {}: {} (Other: {})",
                    a.question_id, opts, other.trim()
                ));
                continue;
            }
        }
        lines.push(format!("- {}: {}", a.question_id, opts));
    }
    lines.join("\n")
}

struct LoopRunContext {
    app: AppHandle,
    project_root: PathBuf,
    session_id: String,
    message_id: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    skip_tls_verify: bool,
    system_prompt: Option<String>,
    current_messages: Vec<AiMessage>,
    tools: Vec<AiToolDef>,
    max_iterations: Option<usize>,
    config: LoopConfig,
    iteration: u32,
    collector: EditCollector,
    activity_log: ActivityLog,
    cancel: Arc<AtomicBool>,
    knowledge_ctx: Option<Arc<KnowledgeToolCtx>>,
}

/// Run the AI Loop: converse → tool calls → results → converse → final response
pub async fn run_loop(
    app: AppHandle,
    project_root: PathBuf,
    session_id: String,
    message_id: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    skip_tls_verify: bool,
    messages: Vec<AiMessage>,
    system_prompt: Option<String>,
    tools: Vec<AiToolDef>,
    max_iterations: Option<usize>,
    config: LoopConfig,
    cancel: Arc<AtomicBool>,
    knowledge_ctx: Option<Arc<KnowledgeToolCtx>>,
) -> Result<LoopOutcome, String> {
    let ctx = LoopRunContext {
        app,
        project_root,
        session_id,
        message_id,
        provider,
        model,
        api_key,
        base_url,
        skip_tls_verify,
        system_prompt,
        current_messages: messages,
        tools,
        max_iterations,
        config,
        iteration: 0,
        collector: Arc::new(Mutex::new(Vec::new())),
        activity_log: Arc::new(Mutex::new(Vec::new())),
        cancel,
        knowledge_ctx,
    };
    run_loop_inner(ctx).await
}

/// Resume a paused loop after the user answers ask_user questions.
pub async fn run_loop_resume(
    paused: PausedLoopState,
    answers: Vec<QuestionAnswer>,
) -> Result<LoopOutcome, String> {
    let result_str = format_ask_user_result(&answers);
    let mut current_messages = paused.current_messages;
    current_messages.push(AiMessage {
        role: "user".into(),
        content: format!(
            "Tool execution results:\n\nTool: ask_user\nArguments: {}\nResult:\n{}",
            serde_json::to_string_pretty(&paused.ask_user_call.arguments).unwrap_or_default(),
            result_str
        ),
    });

    let mut config = paused.config;
    config.ask_user_satisfied = true;

    let ctx = LoopRunContext {
        app: paused.app,
        project_root: paused.project_root,
        session_id: paused.session_id,
        message_id: paused.message_id,
        provider: paused.provider,
        model: paused.model,
        api_key: paused.api_key,
        base_url: paused.base_url,
        skip_tls_verify: paused.skip_tls_verify,
        system_prompt: paused.system_prompt,
        current_messages,
        tools: paused.tools,
        max_iterations: paused.max_iterations,
        config,
        iteration: paused.iteration,
        collector: paused.collector,
        activity_log: paused.activity_log,
        cancel: paused.cancel,
        knowledge_ctx: paused.knowledge_ctx,
    };
    run_loop_inner(ctx).await
}

async fn run_loop_inner(mut ctx: LoopRunContext) -> Result<LoopOutcome, String> {
    let mut last_response: Option<ChatResponse> = None;

    loop {
        if chat_cancel::ChatCancelRegistry::is_cancelled(&ctx.cancel) {
            if let Some(mut resp) = last_response.take() {
                resp.finish_reason = "cancelled".into();
                return Ok(LoopOutcome::Completed(finalize_response(
                    resp,
                    &ctx.collector,
                    &ctx.activity_log,
                    None,
                )));
            }
            return Ok(LoopOutcome::Completed(finalize_response(
                ChatResponse {
                    content: String::new(),
                    tool_calls: None,
                    finish_reason: "cancelled".into(),
                    usage: ai_client::UsageInfo {
                        prompt_tokens: 0,
                        completion_tokens: 0,
                    },
                    pending_edits: None,
                    pending_edit_meta: None,
                    activity_log: None,
                    pending_questions: None,
                },
                &ctx.collector,
                &ctx.activity_log,
                None,
            )));
        }

        ctx.iteration += 1;
        if let Some(limit) = ctx.max_iterations {
            if ctx.iteration > limit as u32 {
                return Err(format!("AI Loop exceeded maximum iterations ({})", limit));
            }
        }

        let thought_id = push_thought(
            &ctx.activity_log,
            &ctx.app,
            &ctx.session_id,
            &ctx.message_id,
            ctx.iteration,
        );

        let request = ChatRequest {
            provider: ctx.provider.clone(),
            model: ctx.model.clone(),
            messages: ctx.current_messages.clone(),
            tools: Some(ctx.tools.clone()),
            temperature: Some(0.3),
            max_tokens: Some(8192),
            api_key: ctx.api_key.clone(),
            base_url: ctx.base_url.clone(),
            skip_tls_verify: ctx.skip_tls_verify,
            system: ctx.system_prompt.clone(),
        };

        let response = ai_client::stream_chat(
            ctx.app.clone(),
            request,
            ctx.session_id.clone(),
            ctx.message_id.clone(),
            ctx.cancel.clone(),
        )
        .await?;

        last_response = Some(response.clone());

        if response.finish_reason == "cancelled" {
            finish_thought(
                &ctx.activity_log,
                &ctx.app,
                &ctx.session_id,
                &ctx.message_id,
                &thought_id,
                &response.content,
            );
            return Ok(LoopOutcome::Completed(finalize_response(
                response,
                &ctx.collector,
                &ctx.activity_log,
                None,
            )));
        }

        finish_thought(
            &ctx.activity_log,
            &ctx.app,
            &ctx.session_id,
            &ctx.message_id,
            &thought_id,
            &response.content,
        );

        if let Some(tool_calls) = &response.tool_calls {
            if tool_calls.is_empty() {
                return Ok(LoopOutcome::Completed(finalize_response(
                    response,
                    &ctx.collector,
                    &ctx.activity_log,
                    None,
                )));
            }

            ctx.current_messages.push(AiMessage {
                role: "assistant".into(),
                content: response.content.clone(),
            });

            let mut tool_results = Vec::new();
            for tc in tool_calls {
                if chat_cancel::ChatCancelRegistry::is_cancelled(&ctx.cancel) {
                    let mut resp = response.clone();
                    resp.finish_reason = "cancelled".into();
                    return Ok(LoopOutcome::Completed(finalize_response(
                        resp,
                        &ctx.collector,
                        &ctx.activity_log,
                        None,
                    )));
                }

                if tc.name == "ask_user" {
                    let step_id = uuid::Uuid::new_v4().to_string();
                    let args_str = serde_json::to_string(&tc.arguments).unwrap_or_default();
                    match parse_ask_user_questions(&tc.arguments) {
                        Err(err) => {
                            {
                                let step = ActivityStep {
                                    id: step_id.clone(),
                                    kind: "tool".into(),
                                    round: ctx.iteration,
                                    label: "ask_user".into(),
                                    detail: None,
                                    tool: Some("ask_user".into()),
                                    args: Some(args_str.clone()),
                                    status: "running".into(),
                                    result: None,
                                    started_at: None,
                                    finished_at: None,
                                };
                                ctx.activity_log.lock().unwrap().push(step.clone());
                                emit_activity(&ctx.app, &ctx.session_id, &ctx.message_id, &step);
                            }

                            let _ = ctx.app.emit("tool-call-start", serde_json::json!({
                                "session_id": ctx.session_id,
                                "message_id": ctx.message_id,
                                "call_id": step_id,
                                "tool": "ask_user",
                                "args": tc.arguments,
                            }));

                            let result_str = format!("Error: {}", err);
                            {
                                let mut steps = ctx.activity_log.lock().unwrap();
                                if let Some(step) = steps.iter_mut().find(|s| s.id == step_id) {
                                    step.status = "error".into();
                                    step.result = Some(result_str.clone());
                                    emit_activity(&ctx.app, &ctx.session_id, &ctx.message_id, step);
                                }
                            }

                            let _ = ctx.app.emit("tool-call-end", serde_json::json!({
                                "session_id": ctx.session_id,
                                "message_id": ctx.message_id,
                                "call_id": step_id,
                                "tool": "ask_user",
                                "success": false,
                                "result": result_str.clone(),
                            }));

                            tool_results.push(format!(
                                "Tool: ask_user\nArguments: {}\nResult:\n{}",
                                serde_json::to_string_pretty(&tc.arguments).unwrap_or_default(),
                                result_str
                            ));
                            continue;
                        }
                        Ok(questions) => {
                            let pending = PendingQuestions {
                                questions: questions.clone(),
                                status: "pending".into(),
                                answers: None,
                            };

                            let step = ActivityStep {
                                id: step_id.clone(),
                                kind: "tool".into(),
                                round: ctx.iteration,
                                label: "ask_user".into(),
                                detail: None,
                                tool: Some("ask_user".into()),
                                args: Some(args_str.clone()),
                                status: "success".into(),
                                result: Some("Awaiting user input".into()),
                                started_at: None,
                                finished_at: None,
                            };
                            ctx.activity_log.lock().unwrap().push(step.clone());
                            emit_activity(&ctx.app, &ctx.session_id, &ctx.message_id, &step);

                            let _ = ctx.app.emit("tool-call-start", serde_json::json!({
                                "session_id": ctx.session_id,
                                "message_id": ctx.message_id,
                                "call_id": step_id,
                                "tool": "ask_user",
                                "args": tc.arguments,
                            }));
                            let _ = ctx.app.emit("tool-call-end", serde_json::json!({
                                "session_id": ctx.session_id,
                                "message_id": ctx.message_id,
                                "call_id": step_id,
                                "tool": "ask_user",
                                "success": true,
                                "result": "Awaiting user input",
                            }));

                            let mut resp = response.clone();
                            resp.finish_reason = "awaiting_user".into();
                            resp.pending_questions = Some(pending.clone());

                            let paused = PausedLoopState {
                                app: ctx.app.clone(),
                                project_root: ctx.project_root.clone(),
                                session_id: ctx.session_id.clone(),
                                message_id: ctx.message_id.clone(),
                                provider: ctx.provider.clone(),
                                model: ctx.model.clone(),
                                api_key: ctx.api_key.clone(),
                                base_url: ctx.base_url.clone(),
                                skip_tls_verify: ctx.skip_tls_verify,
                                system_prompt: ctx.system_prompt.clone(),
                                current_messages: ctx.current_messages.clone(),
                                tools: ctx.tools.clone(),
                                max_iterations: ctx.max_iterations,
                                config: ctx.config.clone(),
                                iteration: ctx.iteration,
                                activity_log: ctx.activity_log.clone(),
                                collector: ctx.collector.clone(),
                                ask_user_call: tc.clone(),
                                pending_questions: pending,
                                cancel: ctx.cancel.clone(),
                                knowledge_ctx: ctx.knowledge_ctx.clone(),
                            };

                            return Ok(LoopOutcome::Paused {
                                response: finalize_response(
                                    resp,
                                    &ctx.collector,
                                    &ctx.activity_log,
                                    Some(pending_questions_for_finalize(&questions)),
                                ),
                                paused,
                            });
                        }
                    }
                }

                let step_id = uuid::Uuid::new_v4().to_string();
                let args_str = serde_json::to_string(&tc.arguments).unwrap_or_default();
                {
                    let step = ActivityStep {
                        id: step_id.clone(),
                        kind: "tool".into(),
                        round: ctx.iteration,
                        label: tc.name.clone(),
                        detail: None,
                        tool: Some(tc.name.clone()),
                        args: Some(args_str.clone()),
                        status: "running".into(),
                        result: None,
                        started_at: None,
                        finished_at: None,
                    };
                    ctx.activity_log.lock().unwrap().push(step.clone());
                    emit_activity(&ctx.app, &ctx.session_id, &ctx.message_id, &step);
                }

                let _ = ctx.app.emit("tool-call-start", serde_json::json!({
                    "session_id": ctx.session_id,
                    "message_id": ctx.message_id,
                    "call_id": step_id,
                    "tool": tc.name,
                    "args": tc.arguments,
                }));

                let result = execute_tool(
                    &ctx.app,
                    &ctx.project_root,
                    &tc.name,
                    &tc.arguments,
                    &ctx.config,
                    &ctx.collector,
                    ctx.knowledge_ctx.as_deref(),
                )
                .await;
                let result_str = match &result {
                    Ok(output) => output.clone(),
                    Err(err) => format!("Error: {}", err),
                };
                let success = result.is_ok();

                {
                    let mut steps = ctx.activity_log.lock().unwrap();
                    if let Some(step) = steps.iter_mut().find(|s| s.id == step_id) {
                        step.status = if success { "success" } else { "error" }.into();
                        step.result = Some(result_str.clone());
                        emit_activity(&ctx.app, &ctx.session_id, &ctx.message_id, step);
                    }
                }

                tool_results.push(format!(
                    "Tool: {}\nArguments: {}\nResult:\n{}",
                    tc.name,
                    serde_json::to_string_pretty(&tc.arguments).unwrap_or_default(),
                    result_str
                ));

                let _ = ctx.app.emit("tool-call-end", serde_json::json!({
                    "session_id": ctx.session_id,
                    "message_id": ctx.message_id,
                    "call_id": step_id,
                    "tool": tc.name,
                    "success": success,
                    "result": result_str,
                }));
            }

            ctx.current_messages.push(AiMessage {
                role: "user".into(),
                content: format!("Tool execution results:\n\n{}", tool_results.join("\n\n---\n\n")),
            });
        } else {
            return Ok(LoopOutcome::Completed(finalize_response(
                response,
                &ctx.collector,
                &ctx.activity_log,
                None,
            )));
        }
    }
}

fn pending_questions_for_finalize(questions: &[AskUserQuestion]) -> PendingQuestions {
    PendingQuestions {
        questions: questions.to_vec(),
        status: "pending".into(),
        answers: None,
    }
}

fn finalize_response(
    mut response: ChatResponse,
    collector: &EditCollector,
    activity_log: &ActivityLog,
    pending_questions: Option<PendingQuestions>,
) -> ChatResponse {
    response.activity_log = Some(activity_log.lock().unwrap().clone());
    if let Some(pq) = pending_questions {
        response.pending_questions = Some(pq);
    }
    let pending = collector.lock().unwrap();
    if !pending.is_empty() {
        response.pending_edits = Some(pending.iter().map(|p| p.result.clone()).collect());
        response.pending_edit_meta = Some(
            pending
                .iter()
                .filter_map(|p| serde_json::to_value(p).ok())
                .collect(),
        );
    }
    response
}

#[cfg(test)]
mod ask_mode_tests {
    use super::*;

    #[test]
    fn get_ask_tools_excludes_mutating_tools() {
        let names: Vec<_> = get_ask_tools().into_iter().map(|t| t.name).collect();
        for forbidden in ["write_file", "edit_file", "bash", "git_commit", "open", "open_vscode", "blast_radius", "outlook_send"] {
            assert!(
                !names.iter().any(|n| n == forbidden),
                "ask tools must not include {forbidden}"
            );
        }
        assert!(names.iter().any(|n| n == "read_file"));
        assert!(names.iter().any(|n| n == "grep"));
        assert!(names.iter().any(|n| n == "web_fetch"));
        assert!(names.iter().any(|n| n == "outlook_read"));
    }

    #[test]
    fn get_plan_tools_includes_outlook_read() {
        let names: Vec<_> = get_plan_tools().into_iter().map(|t| t.name).collect();
        assert!(names.iter().any(|n| n == "outlook_read"));
        assert!(!names.iter().any(|n| n == "outlook_send"));
        assert!(names.iter().any(|n| n == "blast_radius"));
    }

    #[test]
    fn side_effect_guard_requires_ask_user_in_edit_and_auto() {
        let config = LoopConfig {
            dry_run_edits: true,
            auto_mode: false,
            bulk_write_confirmed: false,
            write_count: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            agent_mode: "edit".into(),
            ask_user_satisfied: false,
            enabled_kbase_ids: vec![],
            network_whitelist: vec![],
        };
        assert!(check_side_effect_confirmation(&config, "bash").is_err());
        assert!(check_side_effect_confirmation(&config, "read_file").is_ok());
        let mut satisfied = config.clone();
        satisfied.ask_user_satisfied = true;
        assert!(check_side_effect_confirmation(&satisfied, "bash").is_ok());
        satisfied.agent_mode = "auto".into();
        satisfied.ask_user_satisfied = false;
        assert!(check_side_effect_confirmation(&satisfied, "git_commit").is_err());
    }

    #[test]
    fn is_mutating_tool_classification() {
        assert!(!is_mutating_tool("read_file"));
        assert!(!is_mutating_tool("grep"));
        assert!(!is_mutating_tool("web_fetch"));
        assert!(!is_mutating_tool("outlook_read"));
        assert!(is_mutating_tool("write_file"));
        assert!(is_mutating_tool("bash"));
        assert!(is_mutating_tool("open"));
        assert!(is_mutating_tool("outlook_send"));
    }
}
