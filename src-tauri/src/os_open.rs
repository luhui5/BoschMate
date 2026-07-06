//! Open URLs, apps, files, and folders via the system (Tauri opener + fallbacks).

use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenKind {
    Auto,
    Url,
    App,
    File,
    Folder,
    Reveal,
}

pub fn parse_open_kind(raw: Option<&str>) -> OpenKind {
    match raw.unwrap_or("auto").trim().to_lowercase().as_str() {
        "url" => OpenKind::Url,
        "app" | "application" => OpenKind::App,
        "file" => OpenKind::File,
        "folder" | "dir" | "directory" => OpenKind::Folder,
        "reveal" => OpenKind::Reveal,
        _ => OpenKind::Auto,
    }
}

/// Resolve `target` against optional workspace root for relative paths.
pub fn resolve_target_path(target: &str, workspace_root: Option<&Path>) -> PathBuf {
    let trimmed = target.trim();
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return path;
    }
    if let Some(root) = workspace_root {
        return root.join(trimmed);
    }
    path
}

fn is_url(s: &str) -> bool {
    let lower = s.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn detect_kind(target: &str, resolved: &Path) -> OpenKind {
    if is_url(target) {
        return OpenKind::Url;
    }
    if resolved.exists() {
        if resolved.is_dir() {
            return OpenKind::Folder;
        }
        return OpenKind::File;
    }
    let lower = target.to_lowercase();
    if lower.ends_with(".exe") || lower.ends_with(".app") || lower.ends_with(".lnk") {
        return OpenKind::App;
    }
    OpenKind::App
}

/// Known app aliases → executable paths (Windows-focused; extend as needed).
fn resolve_app_alias(name: &str) -> Option<PathBuf> {
    let key = name.trim().to_lowercase();
    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").ok()?;
        let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| pf.clone());
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidates: Vec<(&str, PathBuf)> = vec![
            (
                "wechat",
                PathBuf::from(&pf).join("Tencent").join("WeChat").join("WeChat.exe"),
            ),
            (
                "微信",
                PathBuf::from(&pf).join("Tencent").join("WeChat").join("WeChat.exe"),
            ),
            (
                "vscode",
                PathBuf::from(&local)
                    .join("Programs")
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
            ),
            ("code", PathBuf::from(&local).join("Programs").join("Microsoft VS Code").join("Code.exe")),
            ("notepad", PathBuf::from(r"C:\Windows\System32\notepad.exe")),
            ("calc", PathBuf::from(r"C:\Windows\System32\calc.exe")),
            (
                "chrome",
                PathBuf::from(&pf).join("Google").join("Chrome").join("Application").join("chrome.exe"),
            ),
            (
                "firefox",
                PathBuf::from(&pf).join("Mozilla Firefox").join("firefox.exe"),
            ),
            (
                "edge",
                PathBuf::from(&pf86).join("Microsoft").join("Edge").join("Application").join("msedge.exe"),
            ),
        ];
        for (alias, path) in candidates {
            if key == alias && path.exists() {
                return Some(path);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = key;
        // Common macOS apps could be added here (open -a "WeChat")
    }
    let _ = name;
    None
}

fn spawn_windows_start(target: &str) -> Result<(), String> {
    crate::process_util::command("cmd")
        .args(["/C", "start", "", target])
        .spawn()
        .map_err(|e| format!("Failed to start application: {}", e))?;
    Ok(())
}

fn open_app(app: &AppHandle, target: &str, with_app: Option<&str>) -> Result<String, String> {
    let opener = app.opener();

    if let Some(app_id) = with_app {
        if let Ok(()) = opener.open_path(target, Some(app_id)) {
            return Ok(format!("Opened `{}` with `{}`.", target, app_id));
        }
    }

    let path = PathBuf::from(target);
    if path.exists() {
        if let Ok(()) = opener.open_path(target, with_app) {
            return Ok(format!("Opened `{}`.", target));
        }
    }

    if let Some(resolved) = resolve_app_alias(target) {
        let path_str = resolved.to_string_lossy();
        if let Ok(()) = opener.open_path(path_str.as_ref(), None::<&str>) {
            return Ok(format!("Opened `{}` (resolved from alias `{}`).", path_str, target));
        }
    }

    #[cfg(target_os = "windows")]
    {
        spawn_windows_start(target)?;
        return Ok(format!("Started `{}` via shell.", target));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open app: {}", e))?;
        return Ok(format!("Opened `{}`.", target));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
        return Ok(format!("Opened `{}`.", target));
    }
}

pub fn open_target(
    app: &AppHandle,
    target: &str,
    kind: OpenKind,
    with_app: Option<&str>,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("target is required".into());
    }

    let resolved = resolve_target_path(trimmed, workspace_root);
    let resolved_str = resolved.to_string_lossy().to_string();
    let effective_kind = if kind == OpenKind::Auto {
        detect_kind(trimmed, &resolved)
    } else {
        kind
    };

    let opener = app.opener();

    match effective_kind {
        OpenKind::Url => {
            if !is_url(trimmed) {
                return Err(format!("Expected URL (http/https), got: {}", trimmed));
            }
            opener
                .open_url(trimmed, with_app)
                .map_err(|e| format!("Failed to open URL: {}", e))?;
            Ok(format!("Opened URL `{}`.", trimmed))
        }
        OpenKind::Reveal => {
            let path = if resolved.exists() {
                resolved_str.clone()
            } else {
                trimmed.to_string()
            };
            opener
                .reveal_item_in_dir(&path)
                .map_err(|e| format!("Failed to reveal in file manager: {}", e))?;
            Ok(format!("Revealed `{}` in file manager.", path))
        }
        OpenKind::Folder => {
            let path_owned = if resolved.is_dir() {
                resolved_str.clone()
            } else if let Some(parent) = resolved.parent() {
                if parent.exists() {
                    parent.to_string_lossy().to_string()
                } else {
                    trimmed.to_string()
                }
            } else {
                trimmed.to_string()
            };
            opener
                .open_path(&path_owned, with_app)
                .map_err(|e| format!("Failed to open folder: {}", e))?;
            Ok(format!("Opened folder `{}`.", path_owned))
        }
        OpenKind::File => {
            let path = if resolved.is_file() {
                resolved_str.as_str()
            } else {
                trimmed
            };
            opener
                .open_path(path, with_app)
                .map_err(|e| format!("Failed to open file: {}", e))?;
            Ok(format!("Opened file `{}`.", path))
        }
        OpenKind::App | OpenKind::Auto => open_app(app, trimmed, with_app),
    }
}

/// Open workspace path in VS Code (alias for open_vscode tool).
pub fn open_vscode_workspace(
    app: &AppHandle,
    workspace_root: &Path,
    rel: &str,
) -> Result<String, String> {
    let target = workspace_root.join(rel);
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("Path not found: {} ({})", rel, e))?;
    let path_str = canonical.to_string_lossy().to_string();

    if let Ok(msg) = open_target(
        app,
        &path_str,
        OpenKind::Auto,
        Some("code"),
        None,
    ) {
        return Ok(msg);
    }

    // Fallback: shell `code` commands (existing behavior)
    open_vscode_shell_fallback(&path_str)
}

fn open_vscode_shell_fallback(path_arg: &str) -> Result<String, String> {
    let quoted = format!("\"{}\"", path_arg.replace('"', "\\\""));
    #[cfg(target_os = "windows")]
    let commands: Vec<String> = {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let mut cmds = vec![format!("code {}", quoted)];
        if !local.is_empty() {
            cmds.push(format!(
                "\"{}\\Programs\\Microsoft VS Code\\Code.exe\" {}",
                local.replace('"', ""),
                quoted
            ));
        }
        cmds
    };
    #[cfg(not(target_os = "windows"))]
    let commands = vec![format!("code {}", quoted)];

    let mut last_err = String::new();
    for command in commands {
        #[cfg(target_os = "windows")]
        let spawn = crate::process_util::command("cmd").args(["/C", &command]).spawn();
        #[cfg(not(target_os = "windows"))]
        let spawn = std::process::Command::new("sh")
            .args(["-c", &command])
            .spawn();
        match spawn {
            Ok(_) => {
                return Ok(format!(
                    "Opened Visual Studio Code for `{}` (command: `{}`).",
                    path_arg, command
                ));
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!(
        "Could not open VS Code for `{}` ({}). Install `code` on PATH or VS Code.",
        path_arg, last_err
    ))
}
