//! Structured logging with daily rotation and log-level filtering (R6-3).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

impl LogLevel {
    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "trace" => LogLevel::Trace,
            "debug" => LogLevel::Debug,
            "info" => LogLevel::Info,
            "warn" | "warning" => LogLevel::Warn,
            "error" => LogLevel::Error,
            _ => LogLevel::Info,
        }
    }
}

struct LogConfig {
    dir: PathBuf,
    min_level: LogLevel,
    retention_days: u32,
}

static LOG_CONFIG: Mutex<Option<LogConfig>> = Mutex::new(None);

pub fn init(app_dir: &PathBuf) {
    let log_dir = app_dir.join("logs");
    fs::create_dir_all(&log_dir).ok();
    *LOG_CONFIG.lock().unwrap() = Some(LogConfig {
        dir: log_dir,
        min_level: LogLevel::Info,
        retention_days: 7,
    });
    cleanup_old_logs();
}

pub fn set_level(level: LogLevel) {
    if let Some(ref mut config) = *LOG_CONFIG.lock().unwrap() {
        config.min_level = level;
    }
}

fn log_file_path() -> Option<PathBuf> {
    let config = LOG_CONFIG.lock().unwrap();
    let cfg = config.as_ref()?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    Some(cfg.dir.join(format!("boschmate-{}.log", date)))
}

fn should_log(level: LogLevel) -> bool {
    LOG_CONFIG
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| level >= c.min_level)
        .unwrap_or(true)
}

fn write_line(level: LogLevel, target: &str, message: &str, fields: &[(&str, &str)]) {
    if !should_log(level) {
        return;
    }
    let ts = chrono::Utc::now().to_rfc3339();
    let fields_str: String = fields
        .iter()
        .map(|(k, v)| format!(" {}={}", k, v))
        .collect();
    let line = format!(
        "{} {} [{}]{}\n",
        ts,
        level.as_str(),
        target,
        &fields_str,
    );
    let full_line = if message.is_empty() {
        line
    } else {
        format!("{}  {}\n", line.trim_end(), message)
    };
    if let Some(path) = log_file_path() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(full_line.as_bytes());
        }
    }
    #[cfg(debug_assertions)]
    eprintln!("{}", full_line.trim());
}

pub fn trace(target: &str, message: &str, fields: &[(&str, &str)]) {
    write_line(LogLevel::Trace, target, message, fields);
}

pub fn debug(target: &str, message: &str, fields: &[(&str, &str)]) {
    write_line(LogLevel::Debug, target, message, fields);
}

pub fn info(target: &str, message: &str) {
    write_line(LogLevel::Info, target, message, &[]);
}

pub fn info_kv(target: &str, message: &str, fields: &[(&str, &str)]) {
    write_line(LogLevel::Info, target, message, fields);
}

pub fn warn(target: &str, message: &str) {
    write_line(LogLevel::Warn, target, message, &[]);
}

pub fn warn_kv(target: &str, message: &str, fields: &[(&str, &str)]) {
    write_line(LogLevel::Warn, target, message, fields);
}

pub fn error(target: &str, message: &str) {
    write_line(LogLevel::Error, target, message, &[]);
}

pub fn error_kv(target: &str, message: &str, fields: &[(&str, &str)]) {
    write_line(LogLevel::Error, target, message, fields);
}

fn cleanup_old_logs() {
    let config = match LOG_CONFIG.lock().unwrap().as_ref() {
        Some(c) => LogConfig {
            dir: c.dir.clone(),
            min_level: c.min_level,
            retention_days: c.retention_days,
        },
        None => return,
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(config.retention_days as u64 * 86400));
    if let Some(cutoff) = cutoff {
        if let Ok(entries) = fs::read_dir(&config.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "log").unwrap_or(false) {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if modified < cutoff {
                                let _ = fs::remove_file(path);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[macro_export]
macro_rules! log_info {
    ($target:expr, $msg:expr $(, $key:ident = $val:expr)*) => {
        $crate::tracing_log::info_kv($target, $msg, &[
            $((stringify!($key), &$val as &str)),*
        ])
    };
}

#[macro_export]
macro_rules! log_warn {
    ($target:expr, $msg:expr $(, $key:ident = $val:expr)*) => {
        $crate::tracing_log::warn_kv($target, $msg, &[
            $((stringify!($key), &$val as &str)),*
        ])
    };
}

#[macro_export]
macro_rules! log_error {
    ($target:expr, $msg:expr $(, $key:ident = $val:expr)*) => {
        $crate::tracing_log::error_kv($target, $msg, &[
            $((stringify!($key), &$val as &str)),*
        ])
    };
}
