use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TestRunResult {
    pub command: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub passed: bool,
}

/// Detect and run project tests (npm/pnpm/cargo).
pub fn run_tests(project_root: &Path, filter: Option<&str>) -> Result<TestRunResult, String> {
    let (cmd, args) = detect_test_command(project_root, filter)?;
    execute_test(&cmd, &args, project_root)
}

fn detect_test_command(root: &Path, filter: Option<&str>) -> Result<(String, Vec<String>), String> {
    if root.join("Cargo.toml").exists() {
        let mut args = vec!["test".into()];
        if let Some(f) = filter {
            args.push(f.into());
        }
        return Ok(("cargo".into(), args));
    }
    if root.join("package.json").exists() {
        let pm = if root.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if root.join("yarn.lock").exists() {
            "yarn"
        } else {
            "npm"
        };
        let mut args = vec!["test".into(), "--".into(), "--run".into()];
        if let Some(f) = filter {
            args.push(f.into());
        }
        return Ok((pm.into(), args));
    }
    Err("No supported test runner found (need package.json or Cargo.toml)".into())
}

fn execute_test(cmd: &str, args: &[String], cwd: &Path) -> Result<TestRunResult, String> {
    let mut command = crate::process_util::command(cmd);
    let output = command
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", cmd, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(TestRunResult {
        command: format!("{} {}", cmd, args.join(" ")),
        exit_code,
        stdout,
        stderr,
        passed: output.status.success(),
    })
}
