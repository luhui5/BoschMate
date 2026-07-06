use serde::Serialize;

/// Error severity classification per the requirements doc (Section 3.5)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum ErrorSeverity {
    /// Process cannot continue, must terminate and report
    Fatal,
    /// Current operation failed, but system can continue
    Recoverable,
    /// Operation succeeded suboptimally, can continue degraded
    Degraded,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub severity: ErrorSeverity,
    pub retryable: bool,
    pub user_message: Option<String>,
}

#[allow(dead_code)]
impl AppError {
    pub fn fatal(code: &str, message: &str) -> Self {
        AppError {
            code: code.to_string(),
            message: message.to_string(),
            severity: ErrorSeverity::Fatal,
            retryable: false,
            user_message: None,
        }
    }

    pub fn recoverable(code: &str, message: &str) -> Self {
        AppError {
            code: code.to_string(),
            message: message.to_string(),
            severity: ErrorSeverity::Recoverable,
            retryable: true,
            user_message: None,
        }
    }

    pub fn degraded(code: &str, message: &str) -> Self {
        AppError {
            code: code.to_string(),
            message: message.to_string(),
            severity: ErrorSeverity::Degraded,
            retryable: false,
            user_message: None,
        }
    }

    pub fn with_user_message(mut self, msg: &str) -> Self {
        self.user_message = Some(msg.to_string());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}: {}", self.severity_code(), self.code, self.message)
    }
}

#[allow(dead_code)]
impl AppError {
    fn severity_code(&self) -> &str {
        match self.severity {
            ErrorSeverity::Fatal => "FATAL",
            ErrorSeverity::Recoverable => "RECOVERABLE",
            ErrorSeverity::Degraded => "DEGRADED",
        }
    }
}

// ── Predefined error codes ──

#[allow(dead_code)]
impl AppError {
    pub fn file_not_found(path: &str) -> Self {
        AppError::recoverable("FILE_NOT_FOUND", &format!("File not found: {}", path))
            .with_user_message(&format!("文件未找到：{}", path))
    }

    pub fn permission_denied(path: &str) -> Self {
        AppError::recoverable("PERMISSION_DENIED", &format!("Permission denied: {}", path))
            .with_user_message(&format!("权限不足：{}", path))
    }

    pub fn llm_timeout() -> Self {
        AppError::recoverable("LLM_TIMEOUT", "Model response timed out after 30s")
            .with_user_message("模型响应超时 (30s)，已自动重试。建议切换模型或稍后重试。")
    }

    pub fn llm_rate_limited(retry_after: u64) -> Self {
        AppError::recoverable("LLM_RATE_LIMITED", &format!("Rate limited, retry after {}s", retry_after))
            .with_user_message(&format!("请求过于频繁，{} 秒后再试。", retry_after))
    }

    pub fn llm_bad_request(detail: &str) -> Self {
        AppError::recoverable("LLM_BAD_REQUEST", &format!("Bad request: {}", detail))
            .with_user_message("请求格式错误，已自动修正。")
    }

    pub fn llm_server_error(code: u16) -> Self {
        AppError::recoverable("LLM_SERVER_ERROR", &format!("Server error: {}", code))
            .with_user_message(&format!("服务端异常 ({})，正在重试…", code))
    }

    pub fn sandbox_escape() -> Self {
        AppError::fatal("SANDBOX_ESCAPE", "Command attempted to access restricted area")
            .with_user_message("命令试图访问受限区域，已被拦截。")
    }

    pub fn sandbox_dangerous(pattern: &str) -> Self {
        AppError::recoverable("SANDBOX_DANGEROUS", &format!("Dangerous command pattern: {}", pattern))
            .with_user_message(&format!("检测到危险命令模式，已被拦截。请编辑命令后重试。"))
    }

    pub fn disk_space_low(available_mb: u64) -> Self {
        AppError::degraded("DISK_SPACE_LOW", &format!("Disk space low: {}MB available", available_mb))
            .with_user_message(&format!("磁盘空间不足 ({}MB)，部分功能暂停。", available_mb))
    }

    pub fn git_conflict() -> Self {
        AppError::recoverable("GIT_CONFLICT", "Git conflict detected")
            .with_user_message("检测到 Git 冲突，请先手动解决。当前操作已暂存。")
    }

    pub fn faiss_unavailable() -> Self {
        AppError::degraded("FAISS_UNAVAILABLE", "Vector search unavailable, using keyword fallback")
            .with_user_message("语义搜索暂时不可用，已切换为关键词搜索。")
    }

    pub fn db_corrupted() -> Self {
        AppError::fatal("DB_CORRUPTED", "Database corruption detected")
            .with_user_message("数据库已损坏，请从备份恢复。")
    }

    pub fn ipc_error(detail: &str) -> Self {
        AppError::fatal("IPC_ERROR", &format!("IPC communication error: {}", detail))
            .with_user_message("内部通信异常，请重启应用。")
    }
}

// ── Retry helper ──

/// Exponential backoff retry for recoverable operations
pub async fn retry_with_backoff<F, Fut, T>(
    max_retries: u32,
    operation: F,
) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut last_error = String::new();
    for attempt in 0..=max_retries {
        match operation().await {
            Ok(val) => return Ok(val),
            Err(e) => {
                last_error = e;
                if attempt < max_retries {
                    let delay_ms = 1000u64 * 2u64.pow(attempt);
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
            }
        }
    }
    Err(format!("Operation failed after {} retries: {}", max_retries, last_error))
}

// ── System health check ──

#[derive(Debug, Clone, Serialize)]
pub struct SystemHealth {
    pub mode: String, // "full" | "degraded" | "offline"
    pub subsystems: Vec<SubsystemHealth>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubsystemHealth {
    pub name: String,
    pub healthy: bool,
    pub message: Option<String>,
}

pub fn check_disk_space(data_dir: &std::path::Path) -> serde_json::Value {
    let available_mb = disk_available_mb(data_dir).unwrap_or(9999);
    let warning = available_mb < 100;
    serde_json::json!({
        "available_mb": available_mb,
        "warning": warning,
        "message": if warning {
            format!("磁盘空间不足 ({}MB)", available_mb)
        } else {
            String::new()
        },
    })
}

fn disk_available_mb(path: &std::path::Path) -> Option<u64> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("df")
            .args(["-m", path.to_str()?])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let line = text.lines().nth(1)?;
        let avail = line.split_whitespace().nth(3)?.parse::<u64>().ok()?;
        return Some(avail);
    }
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use winapi::shared::ntdef::ULARGE_INTEGER;
        use winapi::um::fileapi::GetDiskFreeSpaceExW;

        let path_str = path.to_str()?;
        let root = if path_str.len() >= 2 && path_str.as_bytes()[1] == b':' {
            format!("{}:\\", &path_str[..1])
        } else {
            return None;
        };
        let wide: Vec<u16> = OsStr::new(&root)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free_bytes: ULARGE_INTEGER = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return None;
        }
        let bytes = unsafe { *free_bytes.QuadPart() };
        return Some(bytes / (1024 * 1024));
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

pub async fn check_system_health(
    db_path: &std::path::Path,
    ollama_url: Option<&str>,
    data_dir: Option<&std::path::Path>,
) -> SystemHealth {
    let mut subsystems = Vec::new();

    // Check database
    subsystems.push(SubsystemHealth {
        name: "database".into(),
        healthy: db_path.exists(),
        message: if db_path.exists() { None } else { Some("Database file not found".into()) },
    });

    // Check Ollama if configured
    if let Some(url) = ollama_url {
        let client = reqwest::Client::new();
        let healthy = client
            .get(format!("{}/api/tags", url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        subsystems.push(SubsystemHealth {
            name: "ollama".into(),
            healthy,
            message: if healthy { None } else { Some("Ollama not reachable".into()) },
        });
    }

    // Check disk space
    if let Some(dir) = data_dir {
        let disk = check_disk_space(dir);
        let warning = disk["warning"].as_bool().unwrap_or(false);
        subsystems.push(SubsystemHealth {
            name: "disk".into(),
            healthy: !warning,
            message: disk["message"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        });
    }

    let all_healthy = subsystems.iter().all(|s| s.healthy);
    let any_critical = subsystems.iter().any(|s| s.name == "database" && !s.healthy);

    let mode = if any_critical {
        "offline"
    } else if !all_healthy {
        "degraded"
    } else {
        "full"
    };

    SystemHealth {
        mode: mode.into(),
        subsystems,
    }
}
