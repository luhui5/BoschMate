use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LintIssue {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
    pub rule: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LintResult {
    pub command: String,
    pub exit_code: i32,
    pub issues: Vec<LintIssue>,
    pub raw_output: String,
}

pub fn run_linter(project_root: &Path, target: Option<&str>) -> Result<LintResult, String> {
    let (cmd, args) = detect_lint_command(project_root, target)?;
    execute_lint(&cmd, &args, project_root)
}

fn detect_lint_command(root: &Path, target: Option<&str>) -> Result<(String, Vec<String>), String> {
    if root.join("Cargo.toml").exists() {
        let mut args = vec![
            "clippy".into(),
            "--message-format=json".into(),
        ];
        if let Some(t) = target {
            args.push("--".into());
            args.push(t.into());
        }
        return Ok(("cargo".into(), args));
    }
    if root.join("package.json").exists() {
        let pm = if root.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else {
            "npm"
        };
        let mut args = vec!["run".into(), "lint".into(), "--".into(), "--format=json".into()];
        if let Some(t) = target {
            args.push(t.into());
        }
        return Ok((pm.into(), args));
    }
    if root.join("pyproject.toml").exists() || root.join("requirements.txt").exists() {
        let mut args = vec!["check".into(), "--output-format=json".into()];
        if let Some(t) = target {
            args.push(t.into());
        } else {
            args.push(".".into());
        }
        return Ok(("ruff".into(), args));
    }
    Err("No supported linter found".into())
}

fn execute_lint(cmd: &str, args: &[String], cwd: &Path) -> Result<LintResult, String> {
    let output = crate::process_util::command(cmd)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", cmd, e))?;

    let raw = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let exit_code = output.status.code().unwrap_or(-1);
    let issues = parse_lint_output(&raw, cmd);

    Ok(LintResult {
        command: format!("{} {}", cmd, args.join(" ")),
        exit_code,
        issues,
        raw_output: raw,
    })
}

fn parse_lint_output(raw: &str, linter: &str) -> Vec<LintIssue> {
    match linter {
        "cargo" => parse_clippy_json(raw),
        "pnpm" | "npm" => parse_eslint_json(raw),
        "ruff" => parse_ruff_json(raw),
        _ => parse_generic_format(raw),
    }
}

fn parse_clippy_json(raw: &str) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    for line in raw.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if json.get("reason").and_then(|r| r.as_str()) == Some("compiler-message") {
                if let Some(message) = json.get("message") {
                    let level = message.get("level").and_then(|l| l.as_str()).unwrap_or("warning");
                    let msg = message.get("message").and_then(|m| m.as_str()).unwrap_or("");
                    let code = message.get("code")
                        .and_then(|c| c.get("code"))
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string());

                    if let Some(span) = message.get("spans")
                        .and_then(|s| s.as_array())
                        .and_then(|arr| arr.first())
                    {
                        let file = span.get("file_name").and_then(|f| f.as_str()).unwrap_or("");
                        let line_num = span.get("line_start").and_then(|l| l.as_u64()).unwrap_or(0) as u32;
                        let col = span.get("column_start").and_then(|c| c.as_u64()).unwrap_or(0) as u32;

                        issues.push(LintIssue {
                            file: file.to_string(),
                            line: line_num,
                            column: col,
                            severity: level.to_string(),
                            message: msg.to_string(),
                            rule: code,
                        });
                    }
                }
            }
        }
    }
    issues
}

fn parse_eslint_json(raw: &str) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(arr) = json.as_array() {
            for file_result in arr {
                let file = file_result.get("filePath").and_then(|f| f.as_str()).unwrap_or("");
                if let Some(messages) = file_result.get("messages").and_then(|m| m.as_array()) {
                    for msg in messages {
                        let line = msg.get("line").and_then(|l| l.as_u64()).unwrap_or(0) as u32;
                        let col = msg.get("column").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
                        let severity = match msg.get("severity").and_then(|s| s.as_u64()) {
                            Some(2) => "error",
                            Some(1) => "warning",
                            _ => "info",
                        };
                        let message = msg.get("message").and_then(|m| m.as_str()).unwrap_or("");
                        let rule = msg.get("ruleId").and_then(|r| r.as_str()).map(|s| s.to_string());

                        issues.push(LintIssue {
                            file: file.to_string(),
                            line,
                            column: col,
                            severity: severity.to_string(),
                            message: message.to_string(),
                            rule,
                        });
                    }
                }
            }
        }
    }
    issues
}

fn parse_ruff_json(raw: &str) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(arr) = json.as_array() {
            for item in arr {
                let file = item.get("filename").and_then(|f| f.as_str()).unwrap_or("");
                let loc = item.get("location");
                let line = loc.and_then(|l| l.get("row")).and_then(|r| r.as_u64()).unwrap_or(0) as u32;
                let col = loc.and_then(|l| l.get("column")).and_then(|c| c.as_u64()).unwrap_or(0) as u32;
                let code = item.get("code").and_then(|c| c.as_str()).unwrap_or("");
                let message = item.get("message").and_then(|m| m.as_str()).unwrap_or("");
                let severity = item.get("severity").and_then(|s| s.as_str()).unwrap_or("warning");

                issues.push(LintIssue {
                    file: file.to_string(),
                    line,
                    column: col,
                    severity: severity.to_string(),
                    message: message.to_string(),
                    rule: Some(code.to_string()),
                });
            }
        }
    }
    issues
}

fn parse_generic_format(raw: &str) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let (severity, _rest) = if trimmed.contains(": error:") || trimmed.contains(": error ") {
            ("error", trimmed.split_once(": error").map(|(_, r)| r).unwrap_or(trimmed))
        } else if trimmed.contains(": warning:") || trimmed.contains(": warning ") {
            ("warning", trimmed.split_once(": warning").map(|(_, r)| r).unwrap_or(trimmed))
        } else {
            continue;
        };

        let parts: Vec<&str> = trimmed.splitn(4, ':').collect();
        if parts.len() >= 4 {
            let file = parts[0].trim();
            let line_num = parts[1].trim().parse().unwrap_or(0);
            let col = parts[2].trim().parse().unwrap_or(0);
            let message = parts[3].trim();

            issues.push(LintIssue {
                file: file.to_string(),
                line: line_num,
                column: col,
                severity: severity.to_string(),
                message: message.to_string(),
                rule: None,
            });
        }
    }
    issues
}
