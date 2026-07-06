//! Structured logging with daily rotation (P9-8).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static LOG_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn init(app_dir: &PathBuf) {
    let log_dir = app_dir.join("logs");
    fs::create_dir_all(&log_dir).ok();
    *LOG_DIR.lock().unwrap() = Some(log_dir);
}

fn log_file_path() -> Option<PathBuf> {
    let dir = LOG_DIR.lock().unwrap().clone()?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    Some(dir.join(format!("boschcode-{}.log", date)))
}

pub fn info(target: &str, message: &str) {
    write_line("INFO", target, message);
}

#[allow(dead_code)]
pub fn warn(target: &str, message: &str) {
    write_line("WARN", target, message);
}

#[allow(dead_code)]
pub fn error(target: &str, message: &str) {
    write_line("ERROR", target, message);
}

fn write_line(level: &str, target: &str, message: &str) {
    let ts = chrono::Utc::now().to_rfc3339();
    let line = format!("{} {} [{}] {}\n", ts, level, target, message);
    if let Some(path) = log_file_path() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }
    #[cfg(debug_assertions)]
    eprintln!("{}", line.trim());
}
