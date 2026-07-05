//! Global mouse-up listener for auto selection lookup.

use super::service::SelectionLookupService;
use rdev::{Button, EventType};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

pub fn start_mouse_listener(app: AppHandle, service: Arc<SelectionLookupService>) {
    let stop = service.stop_mouse.clone();
    let service_for_thread = service.clone();
    let handle = thread::spawn(move || {
        let generation = Arc::new(AtomicU64::new(0));
        let _ = rdev::listen(move |event| {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            if !matches!(event.event_type, EventType::ButtonRelease(Button::Left)) {
                return;
            }
            let settings = service_for_thread.current_settings();
            if !super::settings::trigger_uses_auto(&settings) || settings.auto_mode != "mouse_up" {
                return;
            }

            let seq = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let delay = settings.auto_delay_ms;
            let app_trigger = app.clone();
            let service_trigger = service_for_thread.clone();
            let generation_check = generation.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(delay));
                if generation_check.load(Ordering::SeqCst) != seq {
                    return;
                }
                if service_trigger.is_auto_suppressed() {
                    return;
                }
                if super::service::is_popup_interactive(&app_trigger) {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    let _ = super::service::trigger_lookup(
                        &app_trigger,
                        &service_trigger,
                        "mouse_up",
                        None,
                    )
                    .await;
                });
            });
        });
    });
    if let Ok(mut guard) = service.mouse_thread.lock() {
        *guard = Some(handle);
    }
}

pub fn stop_mouse_listener(service: &SelectionLookupService) {
    service.stop_mouse.store(true, Ordering::Relaxed);
    if let Ok(mut guard) = service.mouse_thread.lock() {
        if let Some(_handle) = guard.take() {
            // rdev::listen cannot be interrupted cleanly; thread exits on app shutdown
        }
    }
    service.stop_mouse.store(false, Ordering::Relaxed);
}
