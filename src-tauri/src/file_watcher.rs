use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter};

/// Start watching a project directory; emits `file-changed` events.
pub fn watch_project(app: AppHandle, project_id: String, root: &Path) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |res| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let _watcher = watcher;
        while let Ok(event) = rx.recv() {
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = app.emit(
                "file-changed",
                serde_json::json!({
                    "project_id": project_id,
                    "kind": format!("{:?}", event.kind),
                    "paths": paths,
                }),
            );
        }
    });

    Ok(())
}
