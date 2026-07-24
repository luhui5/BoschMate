use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TestFailure {
    pub name: String,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TestRunResult {
    pub command: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub passed: bool,
    pub passed_count: u32,
    pub failed_count: u32,
    pub skipped_count: u32,
    pub failures: Vec<TestFailure>,
}

pub fn run_tests(project_root: &Path, filter: Option<&str>) -> Result<TestRunResult, String> {
    let (cmd, args) = detect_test_command(project_root, filter)?;
    execute_test(&cmd, &args, project_root)
}

fn detect_test_command(root: &Path, filter: Option<&str>) -> Result<(String, Vec<String>), String> {
    if root.join("Cargo.toml").exists() {
        let mut args = vec!["test".into(), "--".into(), "--format".into(), "terse".into()];
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
        let mut args = vec!["test".into(), "--".into(), "--run".into(), "--reporter=verbose".into()];
        if let Some(f) = filter {
            args.push(f.into());
        }
        return Ok((pm.into(), args));
    }
    if root.join("pyproject.toml").exists() || root.join("requirements.txt").exists() || root.join("setup.py").exists() {
        let mut args = vec!["-m".into(), "pytest".into(), "-v".into()];
        if let Some(f) = filter {
            args.push(f.into());
        }
        return Ok(("python".into(), args));
    }
    Err("No supported test runner found (need package.json, Cargo.toml, or pyproject.toml)".into())
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

    let (passed_count, failed_count, skipped_count, failures) = parse_test_output(&stdout, cmd);

    Ok(TestRunResult {
        command: format!("{} {}", cmd, args.join(" ")),
        exit_code,
        stdout,
        stderr,
        passed: exit_code == 0,
        passed_count,
        failed_count,
        skipped_count,
        failures,
    })
}

fn parse_test_output(output: &str, runner: &str) -> (u32, u32, u32, Vec<TestFailure>) {
    let mut passed = 0;
    let mut failed = 0;
    let mut skipped = 0;
    let mut failures = Vec::new();

    match runner {
        "cargo" => parse_cargo_test_output(output, &mut passed, &mut failed, &mut skipped, &mut failures),
        "pnpm" | "npm" | "yarn" => parse_vitest_output(output, &mut passed, &mut failed, &mut skipped, &mut failures),
        "python" => parse_pytest_output(output, &mut passed, &mut failed, &mut skipped, &mut failures),
        _ => {}
    }

    (passed, failed, skipped, failures)
}

fn parse_cargo_test_output(
    output: &str,
    passed: &mut u32,
    failed: &mut u32,
    skipped: &mut u32,
    failures: &mut Vec<TestFailure>,
) {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("test ") {
            let parts: Vec<&str> = trimmed.splitn(3, ' ').collect();
            if parts.len() >= 3 {
                let test_name = parts[1];
                let result = parts[2];
                match result {
                    "ok" => *passed += 1,
                    "FAILED" => {
                        *failed += 1;
                        failures.push(TestFailure {
                            name: test_name.to_string(),
                            message: String::new(),
                            file: None,
                            line: None,
                        });
                    }
                    "ignored" | "SKIPPED" => *skipped += 1,
                    _ => {}
                }
            }
        }
    }

    if *passed == 0 && *failed == 0 {
        if let Some(summary) = output.lines().rev().find(|l| l.contains("test result:")) {
            if let Some(p) = summary.split("passed,").nth(0) {
                if let Some(num) = p.split_whitespace().last() {
                    *passed = num.parse().unwrap_or(0);
                }
            }
            if let Some(f) = summary.split("failed,").nth(0) {
                if let Some(num) = f.split_whitespace().last() {
                    *failed = num.parse().unwrap_or(0);
                }
            }
        }
    }
}

fn parse_vitest_output(
    output: &str,
    passed: &mut u32,
    failed: &mut u32,
    skipped: &mut u32,
    failures: &mut Vec<TestFailure>,
) {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("✓") || trimmed.contains(" PASS ") {
            *passed += 1;
        } else if trimmed.starts_with("✗") || trimmed.starts_with("×") || trimmed.contains(" FAIL ") {
            *failed += 1;
            let test_name = trimmed.trim_start_matches("✓").trim_start_matches("✗").trim_start_matches("×").trim();
            failures.push(TestFailure {
                name: test_name.to_string(),
                message: String::new(),
                file: None,
                line: None,
            });
        } else if trimmed.contains("skipped") || trimmed.contains("SKIP") {
            *skipped += 1;
        }
    }

    if let Some(summary) = output.lines().rev().find(|l| l.contains("Tests")) {
        if let Some(p) = summary.split("passed").nth(0) {
            if let Some(num) = p.split_whitespace().last() {
                *passed = num.parse().unwrap_or(0);
            }
        }
        if let Some(f) = summary.split("failed").nth(0) {
            if let Some(num) = f.split_whitespace().last() {
                *failed = num.parse().unwrap_or(0);
            }
        }
    }
}

fn parse_pytest_output(
    output: &str,
    passed: &mut u32,
    failed: &mut u32,
    skipped: &mut u32,
    failures: &mut Vec<TestFailure>,
) {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.ends_with(" PASSED") || trimmed.ends_with(" PASS") {
            *passed += 1;
        } else if trimmed.ends_with(" FAILED") || trimmed.ends_with(" FAIL") {
            *failed += 1;
            let test_name = trimmed.split_whitespace().next().unwrap_or("");
            failures.push(TestFailure {
                name: test_name.to_string(),
                message: String::new(),
                file: None,
                line: None,
            });
        } else if trimmed.ends_with(" SKIPPED") || trimmed.ends_with(" SKIP") {
            *skipped += 1;
        }
    }

    if let Some(summary) = output.lines().rev().find(|l| l.contains("passed")) {
        if let Some(p) = summary.split("passed").nth(0) {
            let nums: Vec<&str> = p.split_whitespace().collect();
            if let Some(num) = nums.last() {
                *passed = num.parse().unwrap_or(0);
            }
        }
        if let Some(f) = summary.split("failed").nth(0) {
            let nums: Vec<&str> = f.split_whitespace().collect();
            if let Some(num) = nums.last() {
                *failed = num.parse().unwrap_or(0);
            }
        }
    }
}
