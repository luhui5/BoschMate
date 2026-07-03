use crate::ai_client::{self, AiMessage, AiToolDef, ChatRequest, ChatResponse};
use crate::code_editor;
use crate::code_graph;
use crate::fs_ops;
use crate::git_ops;
use crate::sandbox;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Available tools registered with the AI
pub fn get_tools() -> Vec<AiToolDef> {
    vec![
        AiToolDef {
            name: "read_file".into(),
            description: "Read a file from the project. Use offset/limit for line ranges.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
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
                    "path": {"type": "string"},
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
                    "path": {"type": "string"},
                    "old_string": {"type": "string"},
                    "new_string": {"type": "string"},
                    "replace_all": {"type": "boolean", "default": false}
                },
                "required": ["path", "old_string", "new_string"]
            }),
        },
        AiToolDef {
            name: "grep".into(),
            description: "Search file contents using regex patterns.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string"},
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
                    "path": {"type": "string"}
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
                    "path": {"type": "string"}
                }
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
                    "path": {"type": "string"}
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
        // Code graph tools
        AiToolDef {
            name: "list_symbols".into(),
            description: "List all symbols in a source file. Use to understand code structure.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"file_path":{"type":"string"},"kind_filter":{"type":"string"}},"required":["file_path"]}),
        },
        AiToolDef {
            name: "find_references".into(),
            description: "Find all references to a symbol across the codebase.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"symbol_name":{"type":"string"},"file_path":{"type":"string"}},"required":["symbol_name","file_path"]}),
        },
        AiToolDef {
            name: "file_deps".into(),
            description: "Analyze import/dependency relationships for a file.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"file_path":{"type":"string"},"direction":{"type":"string"}},"required":["file_path"]}),
        },
        AiToolDef {
            name: "blast_radius".into(),
            description: "Analyze what files would be affected by changing a symbol or file.".into(),
            parameters: serde_json::json!({"type":"object","properties":{"file_path":{"type":"string"},"symbol_name":{"type":"string"}},"required":["file_path"]}),
        },
    ]
}

/// Read-only tools for Bosch Assistant (workspace bound).
pub fn get_assistant_tools() -> Vec<AiToolDef> {
    let read_only = [
        "read_file",
        "grep",
        "glob",
        "list_directory",
        "git_status",
        "git_diff",
        "git_log",
        "list_symbols",
        "file_deps",
    ];
    get_tools()
        .into_iter()
        .filter(|t| read_only.contains(&t.name.as_str()))
        .collect()
}

/// Execute a tool call and return the result
pub async fn execute_tool(
    project_root: &PathBuf,
    tool_name: &str,
    args: &Value,
) -> Result<String, String> {
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
            let hash = fs_ops::write_file(project_root.as_path(), path, content)?;
            Ok(format!("File written successfully. SHA256: {}", hash))
        }
        "edit_file" => {
            let path = args["path"].as_str().ok_or("path required")?;
            let old_str = args["old_string"].as_str().ok_or("old_string required")?;
            let new_str = args["new_string"].as_str().ok_or("new_string required")?;
            let replace_all = args["replace_all"].as_bool().unwrap_or(false);
            let result = code_editor::edit_file(
                project_root.as_path(), path, old_str, new_str, replace_all, false,
            )?;
            Ok(format!(
                "Edit applied to {} ({} replacement(s))\n\n```diff\n{}\n```",
                result.path, result.replaced, result.diff
            ))
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
                ..Default::default()
            };
            let result = sandbox::execute_sandboxed(command, &work_dir, None, &config, false, None)?;
            Ok(format!(
                "Exit code: {}\nStdout:\n{}\nStderr:\n{}",
                result.exit_code, result.stdout, result.stderr
            ))
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
        _ => Err(format!("Unknown tool: {}", tool_name)),
    }
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
    messages: Vec<AiMessage>,
    system_prompt: Option<String>,
    tools: Vec<AiToolDef>,
    max_iterations: usize,
) -> Result<ChatResponse, String> {
    let mut current_messages = messages;
    let mut iteration = 0;

    loop {
        iteration += 1;
        if iteration > max_iterations {
            return Err(format!("AI Loop exceeded maximum iterations ({})", max_iterations));
        }

        // Send request to AI
        let request = ChatRequest {
            provider: provider.clone(),
            model: model.clone(),
            messages: current_messages.clone(),
            tools: Some(tools.clone()),
            temperature: Some(0.3),
            max_tokens: Some(8192),
            api_key: api_key.clone(),
            base_url: base_url.clone(),
            system: system_prompt.clone(),
        };

        let response = ai_client::stream_chat(
            app.clone(),
            request,
            session_id.clone(),
            message_id.clone(),
        )
        .await?;

        // If AI returned tool calls, execute them
        if let Some(tool_calls) = &response.tool_calls {
            if tool_calls.is_empty() {
                return Ok(response);
            }

            // Add assistant message (with tool calls)
            current_messages.push(AiMessage {
                role: "assistant".into(),
                content: response.content.clone(),
            });

            // Execute each tool call and add results
            let mut tool_results = Vec::new();
            for tc in tool_calls {
                let _ = app.emit("tool-call-start", serde_json::json!({
                    "session_id": session_id,
                    "message_id": message_id,
                    "tool": tc.name,
                    "args": tc.arguments,
                }));

                let result = execute_tool(&project_root, &tc.name, &tc.arguments).await;
                let result_str = match &result {
                    Ok(output) => output.clone(),
                    Err(err) => format!("Error: {}", err),
                };

                tool_results.push(format!(
                    "Tool: {}\nArguments: {}\nResult:\n{}",
                    tc.name,
                    serde_json::to_string_pretty(&tc.arguments).unwrap_or_default(),
                    result_str
                ));

                let _ = app.emit("tool-call-end", serde_json::json!({
                    "session_id": session_id,
                    "message_id": message_id,
                    "tool": tc.name,
                    "success": result.is_ok(),
                    "result": result_str,
                }));
            }

            // Add tool results as user messages
            current_messages.push(AiMessage {
                role: "user".into(),
                content: format!("Tool execution results:\n\n{}", tool_results.join("\n\n---\n\n")),
            });
        } else {
            // No tool calls — this is the final response
            return Ok(response);
        }
    }
}
