use std::path::Path;
use std::process::Command;

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

/// Run project linter (eslint / cargo clippy / ruff).
pub fn run_linter(project_root: &Path, target: Option<&str>) -> Result<LintResult, String> {
    let (cmd, args) = detect_lint_command(project_root, target)?;
    execute_lint(&cmd, &args, project_root)
}

fn detect_lint_command(root: &Path, target: Option<&str>) -> Result<(String, Vec<String>), String> {
    if root.join("Cargo.toml").exists() {
        let mut args = vec!["clippy".into(), "--".into(), "-D".into(), "warnings".into()];
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
        let mut args = vec!["run".into(), "lint".into()];
        if let Some(t) = target {
            args.push("--".into());
            args.push(t.into());
        }
        return Ok((pm.into(), args));
    }
    if root.join("pyproject.toml").exists() || root.join("requirements.txt").exists() {
        let mut args = vec!["check".into(), ".".into()];
        if let Some(t) = target {
            args.pop();
            args.push(t.into());
        }
        return Ok(("ruff".into(), args));
    }
    Err("No supported linter found".into())
}

fn execute_lint(cmd: &str, args: &[String], cwd: &Path) -> Result<LintResult, String> {
    let output = Command::new(cmd)
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
    let issues = parse_lint_output(&raw);

    Ok(LintResult {
        command: format!("{} {}", cmd, args.join(" ")),
        exit_code,
        issues,
        raw_output: raw,
    })
}

fn parse_lint_output(raw: &str) -> Vec<LintIssue> {
    let mut issues = Vec::new();
    for line in raw.lines() {
        // Common format: file:line:col: message
        if let Some((rest, msg)) = line.split_once(": error") {
            if let Some((file_part, col_msg)) = rest.rsplit_once(':') {
                if let Some((file_line, col)) = file_part.rsplit_once(':') {
                    if let Some((file, line_num)) = file_line.rsplit_once(':') {
                        issues.push(LintIssue {
                            file: file.to_string(),
                            line: line_num.parse().unwrap_or(0),
                            column: col.parse().unwrap_or(0),
                            severity: "error".into(),
                            message: format!("error{}", msg),
                            rule: None,
                        });
                    }
                }
            }
        }
    }
    issues
}
