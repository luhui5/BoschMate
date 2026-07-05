//! Clipboard polling listener for auto selection lookup.

use super::service::SelectionLookupService;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

pub fn start_clipboard_listener(app: AppHandle, service: Arc<SelectionLookupService>) {
    let stop = service.stop_clipboard.clone();
    let service_for_thread = service.clone();
    let handle = thread::spawn(move || {
        let mut last_seen = String::new();
        let mut last_processed = String::new();
        while !stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(500));
            if stop.load(Ordering::Relaxed) {
                break;
            }

            let settings = service_for_thread.current_settings();
            if !super::settings::trigger_uses_auto(&settings) || settings.auto_mode != "clipboard"
            {
                continue;
            }

            let text = match super::capture::read_clipboard_selection() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if text.is_empty() || text == last_seen {
                continue;
            }
            last_seen = text.clone();
            if text == last_processed {
                continue;
            }

            thread::sleep(Duration::from_millis(settings.auto_delay_ms));
            if stop.load(Ordering::Relaxed) {
                break;
            }

            let refreshed = super::capture::read_clipboard_selection().unwrap_or_default();
            if refreshed != text {
                last_seen = refreshed;
                continue;
            }

            last_processed = text.clone();
            if service_for_thread.is_auto_suppressed() {
                continue;
            }
            let app_trigger = app.clone();
            let service_trigger = service_for_thread.clone();
            let text_for_trigger = text.clone();
            tauri::async_runtime::spawn(async move {
                let _ = super::service::trigger_lookup(
                    &app_trigger,
                    &service_trigger,
                    "clipboard",
                    Some(text_for_trigger),
                )
                .await;
            });
        }
    });
    if let Ok(mut guard) = service.clipboard_thread.lock() {
        *guard = Some(handle);
    }
}

pub fn stop_clipboard_listener(service: &SelectionLookupService) {
    service.stop_clipboard.store(true, Ordering::Relaxed);
    if let Ok(mut guard) = service.clipboard_thread.lock() {
        if let Some(_handle) = guard.take() {
            // polling thread stops on next loop iteration
        }
    }
    service.stop_clipboard.store(false, Ordering::Relaxed);
}
