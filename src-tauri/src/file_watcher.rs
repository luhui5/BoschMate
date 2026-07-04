use crate::fs_ops::should_skip_path;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 300;

pub struct FileWatcherRegistry {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    project_id: Mutex<Option<String>>,
}

impl FileWatcherRegistry {
    pub fn new() -> Self {
        Self {
            cancel: Mutex::new(None),
            project_id: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
        if let Some(flag) = self.cancel.lock().unwrap().take() {
            flag.store(true, Ordering::SeqCst);
        }
        *self.project_id.lock().unwrap() = None;
    }

    pub fn watch_project(
        &self,
        app: AppHandle,
        project_id: String,
        root: &Path,
    ) -> Result<(), String> {
        self.stop();

        let cancel = Arc::new(AtomicBool::new(false));
        *self.cancel.lock().unwrap() = Some(cancel.clone());
        *self.project_id.lock().unwrap() = Some(project_id.clone());

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
            loop {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }

                let first = match rx.recv() {
                    Ok(e) => e,
                    Err(_) => break,
                };

                if !event_has_relevant_paths(&first) {
                    continue;
                }

                let deadline = Instant::now() + Duration::from_millis(DEBOUNCE_MS);
                loop {
                    if cancel.load(Ordering::SeqCst) {
                        return;
                    }
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match rx.recv_timeout(remaining) {
                        Ok(_) => continue,
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }

                if cancel.load(Ordering::SeqCst) {
                    return;
                }

                let paths: Vec<String> = first
                    .paths
                    .iter()
                    .filter(|p| !should_skip_path(p))
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                if paths.is_empty() {
                    continue;
                }

                let _ = app.emit(
                    "file-changed",
                    serde_json::json!({
                        "project_id": project_id,
                        "kind": format!("{:?}", first.kind),
                        "paths": paths,
                    }),
                );
            }
        });

        Ok(())
    }
}

fn event_has_relevant_paths(event: &Event) -> bool {
    !event.paths.is_empty() && event.paths.iter().any(|p| !should_skip_path(p))
}

impl Default for FileWatcherRegistry {
    fn default() -> Self {
        Self::new()
    }
}
