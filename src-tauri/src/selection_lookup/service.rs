//! Selection lookup trigger orchestration and popup display.

use super::capture::{capture_selection_text, read_clipboard_selection};
use super::settings::{self, SelectionLookupSettings};
use crate::AppState;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionLookupStartPayload {
    pub text: String,
    pub kbase_id: String,
    pub top_k: usize,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionLookupErrorPayload {
    pub code: String,
    pub message: String,
}

pub struct SelectionLookupService {
    pub settings: Mutex<SelectionLookupSettings>,
    pub stop_mouse: Arc<AtomicBool>,
    pub stop_clipboard: Arc<AtomicBool>,
    pub mouse_thread: Mutex<Option<JoinHandle<()>>>,
    pub clipboard_thread: Mutex<Option<JoinHandle<()>>>,
    last_trigger: Mutex<Option<(String, Instant)>>,
    pub registered_shortcut: Mutex<Option<String>>,
    /// After dismiss, ignore auto triggers briefly (close click fires mouse_up).
    suppress_auto_until: Mutex<Option<Instant>>,
}

impl SelectionLookupService {
    pub fn new(initial: SelectionLookupSettings) -> Arc<Self> {
        Arc::new(Self {
            settings: Mutex::new(initial),
            stop_mouse: Arc::new(AtomicBool::new(false)),
            stop_clipboard: Arc::new(AtomicBool::new(false)),
            mouse_thread: Mutex::new(None),
            clipboard_thread: Mutex::new(None),
            last_trigger: Mutex::new(None),
            registered_shortcut: Mutex::new(None),
            suppress_auto_until: Mutex::new(None),
        })
    }

    pub fn suppress_auto_triggers(&self, duration: Duration) {
        *self.suppress_auto_until.lock().unwrap() = Some(Instant::now() + duration);
    }

    pub fn is_auto_suppressed(&self) -> bool {
        let mut guard = self.suppress_auto_until.lock().unwrap();
        match guard.as_ref() {
            Some(until) if Instant::now() < *until => true,
            _ => {
                *guard = None;
                false
            }
        }
    }

    pub fn clear_last_trigger(&self) {
        *self.last_trigger.lock().unwrap() = None;
    }

    pub fn current_settings(&self) -> SelectionLookupSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update_settings(&self, settings: SelectionLookupSettings) {
        *self.settings.lock().unwrap() = settings;
    }
}

fn get_cursor_position() -> Option<(i32, i32)> {
    #[cfg(windows)]
    {
        use winapi::shared::windef::POINT;
        use winapi::um::winuser::GetCursorPos;
        unsafe {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point) != 0 {
                return Some((point.x, point.y));
            }
        }
    }
    None
}

fn position_popup_window(window: &WebviewWindow) {
    if let Some((x, y)) = get_cursor_position() {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: x + 12,
            y: y + 12,
        }));
    }
}

fn emit_error(app: &AppHandle, code: &str, message: &str) {
    let payload = SelectionLookupErrorPayload {
        code: code.to_string(),
        message: message.to_string(),
    };
    if let Some(popup) = app.get_webview_window("selection-popup") {
        let _ = popup.show();
        let _ = position_popup_window(&popup);
        let _ = popup.emit("selection-lookup:error", &payload);
    }
}

pub fn is_popup_interactive(app: &AppHandle) -> bool {
    app.get_webview_window("selection-popup")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

fn should_skip_auto_trigger(app: &AppHandle, service: &SelectionLookupService, source: &str) -> bool {
    if source != "mouse_up" && source != "clipboard" {
        return false;
    }
    if service.is_auto_suppressed() {
        return true;
    }
    if source == "mouse_up" && is_popup_interactive(app) {
        return true;
    }
    false
}

fn should_skip_cooldown(service: &SelectionLookupService, text: &str) -> bool {
    let mut guard = service.last_trigger.lock().unwrap();
    if let Some((prev, at)) = guard.as_ref() {
        if prev == text && at.elapsed() < Duration::from_secs(2) {
            return true;
        }
    }
    *guard = Some((text.to_string(), Instant::now()));
    false
}

pub async fn trigger_lookup(
    app: &AppHandle,
    service: &SelectionLookupService,
    source: &str,
    preset_text: Option<String>,
) -> Result<(), String> {
    let settings = service.current_settings();
    // #region agent log
    super::debug_log::agent_log(
        "H1",
        "service.rs:trigger_lookup",
        "enter",
        serde_json::json!({
            "source": source,
            "enabled": settings.enabled,
            "triggerMode": settings.trigger_mode,
            "autoMode": settings.auto_mode
        }),
    );
    // #endregion
    if !settings.enabled {
        return Ok(());
    }

    if should_skip_auto_trigger(app, service, source) {
        // #region agent log
        super::debug_log::agent_log(
            "H8",
            "service.rs:trigger_lookup",
            "exit auto suppressed",
            serde_json::json!({ "source": source }),
        );
        // #endregion
        return Ok(());
    }

    let state = app.state::<AppState>();
    let conn = state.db.conn.lock().unwrap();
    let kbase_id = settings::load_kbase_id(&conn);
    drop(conn);

    let Some(kbase_id) = kbase_id else {
        // #region agent log
        super::debug_log::agent_log(
            "H3",
            "service.rs:trigger_lookup",
            "exit no_kbase",
            serde_json::json!({ "source": source }),
        );
        // #endregion
        emit_error(app, "no_kbase", "请先在设置中选择默认知识库");
        return Ok(());
    };

    {
        let conn = state.db.conn.lock().unwrap();
        if !settings::kbase_exists(&conn, &kbase_id) {
            emit_error(app, "invalid_kbase", "默认知识库不存在，请重新选择");
            return Ok(());
        }
    }

    let text = if source == "clipboard" {
        preset_text.unwrap_or_else(|| read_clipboard_selection().unwrap_or_default())
    } else if let Some(text) = preset_text {
        text
    } else {
        match capture_selection_text() {
            Ok(t) => t,
            Err(e) => {
                // #region agent log
                super::debug_log::agent_log(
                    "H5",
                    "service.rs:trigger_lookup",
                    "exit capture_failed",
                    serde_json::json!({ "source": source, "error": e }),
                );
                // #endregion
                emit_error(
                    app,
                    "no_selection",
                    &format!("未能获取选中文字：{e}。可尝试切换为「复制触发」模式"),
                );
                return Ok(());
            }
        }
    };

    if text.chars().count() < settings.min_selection_chars {
        // #region agent log
        super::debug_log::agent_log(
            "H5",
            "service.rs:trigger_lookup",
            "exit too_short",
            serde_json::json!({ "source": source, "textLen": text.chars().count() }),
        );
        // #endregion
        return Ok(());
    }

    if should_skip_cooldown(service, &text) {
        // #region agent log
        super::debug_log::agent_log(
            "H5",
            "service.rs:trigger_lookup",
            "exit cooldown",
            serde_json::json!({ "source": source }),
        );
        // #endregion
        return Ok(());
    }

    let popup = app.get_webview_window("selection-popup");
    // #region agent log
    super::debug_log::agent_log(
        "H4",
        "service.rs:trigger_lookup",
        "popup lookup",
        serde_json::json!({
            "source": source,
            "popupFound": popup.is_some(),
            "labels": app.webview_windows().keys().collect::<Vec<_>>()
        }),
    );
    // #endregion
    let popup = popup.ok_or_else(|| "selection-popup window not found".to_string())?;

    position_popup_window(&popup);
    popup.show().map_err(|e| e.to_string())?;
    popup.set_focus().map_err(|e| e.to_string())?;

    let payload = SelectionLookupStartPayload {
        text,
        kbase_id,
        top_k: settings.top_k,
        source: source.to_string(),
    };
    popup
        .emit("selection-lookup:start", &payload)
        .map_err(|e| e.to_string())?;

    // #region agent log
    super::debug_log::agent_log(
        "H4",
        "service.rs:trigger_lookup",
        "success emit start",
        serde_json::json!({ "source": source, "textLen": payload.text.chars().count() }),
    );
    // #endregion

    Ok(())
}

pub async fn trigger_from_shortcut(app: AppHandle) {
    // #region agent log
    super::debug_log::agent_log(
        "H2",
        "service.rs:trigger_from_shortcut",
        "shortcut handler fired",
        serde_json::json!({
            "hasService": app.try_state::<Arc<SelectionLookupService>>().is_some()
        }),
    );
    // #endregion
    let Some(service) = app.try_state::<Arc<SelectionLookupService>>() else {
        return;
    };
    let _ = trigger_lookup(&app, &service, "shortcut", None).await;
}

pub fn register_shortcut(app: &AppHandle, service: &SelectionLookupService) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let settings = service.current_settings();
    unregister_shortcut(app, service)?;

    if !settings::trigger_uses_shortcut(&settings) {
        return Ok(());
    }

    let shortcut = settings::normalize_shortcut(&settings.shortcut);
    let register_result = app.global_shortcut().register(shortcut.as_str());
    // #region agent log
    super::debug_log::agent_log(
        "H2",
        "service.rs:register_shortcut",
        "register result",
        serde_json::json!({
            "shortcut": shortcut,
            "ok": register_result.is_ok(),
            "error": register_result.as_ref().err().map(|e| e.to_string())
        }),
    );
    // #endregion
    register_result.map_err(|e| e.to_string())?;

    *service.registered_shortcut.lock().unwrap() = Some(shortcut);
    Ok(())
}

pub fn unregister_shortcut(app: &AppHandle, service: &SelectionLookupService) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    if let Some(shortcut) = service.registered_shortcut.lock().unwrap().take() {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
    }
    Ok(())
}

pub fn restart_auto_listeners(app: &AppHandle, service: &Arc<SelectionLookupService>) {
    super::mouse_listener::stop_mouse_listener(service);
    super::clipboard_listener::stop_clipboard_listener(service);

    let settings = service.current_settings();
    if !settings::trigger_uses_auto(&settings) {
        return;
    }

    if settings.auto_mode == "mouse_up" {
        // #region agent log
        super::debug_log::agent_log(
            "H6",
            "service.rs:restart_auto_listeners",
            "start mouse listener",
            serde_json::json!({}),
        );
        // #endregion
        super::mouse_listener::start_mouse_listener(app.clone(), service.clone());
    } else if settings.auto_mode == "clipboard" {
        // #region agent log
        super::debug_log::agent_log(
            "H6",
            "service.rs:restart_auto_listeners",
            "start clipboard listener",
            serde_json::json!({}),
        );
        // #endregion
        super::clipboard_listener::start_clipboard_listener(app.clone(), service.clone());
    }
}

pub fn apply_runtime_config(app: &AppHandle, service: &Arc<SelectionLookupService>) {
    let settings = service.current_settings();
    // #region agent log
    super::debug_log::agent_log(
        "H1",
        "service.rs:apply_runtime_config",
        "apply",
        serde_json::json!({
            "enabled": settings.enabled,
            "triggerMode": settings.trigger_mode,
            "autoMode": settings.auto_mode,
            "shortcut": settings.shortcut,
            "usesShortcut": settings::trigger_uses_shortcut(&settings),
            "usesAuto": settings::trigger_uses_auto(&settings)
        }),
    );
    // #endregion
    let _ = register_shortcut(app, service);
    restart_auto_listeners(app, service);
}

pub fn init(app: &AppHandle, state: &AppState) -> Result<Arc<SelectionLookupService>, String> {
    let conn = state.db.conn.lock().unwrap();
    let initial = settings::load_settings(&conn);
    let kbase_id = settings::load_kbase_id(&conn);
    drop(conn);

    // #region agent log
    super::debug_log::agent_log(
        "H1",
        "service.rs:init",
        "loaded from db",
        serde_json::json!({
            "enabled": initial.enabled,
            "triggerMode": initial.trigger_mode,
            "kbaseIdPresent": kbase_id.is_some()
        }),
    );
    // #endregion

    let service = SelectionLookupService::new(initial);
    app.manage(service.clone());

    apply_runtime_config(app, &service);
    super::tray::setup_tray(app, service.clone())?;

    Ok(service)
}

#[tauri::command]
pub async fn selection_lookup_apply_settings(
    app: AppHandle,
    app_state: State<'_, AppState>,
    service: State<'_, Arc<SelectionLookupService>>,
    mut settings: SelectionLookupSettings,
) -> Result<(), String> {
    settings.shortcut = settings::normalize_shortcut(&settings.shortcut);
    // #region agent log
    super::debug_log::agent_log(
        "H1",
        "service.rs:selection_lookup_apply_settings",
        "apply from frontend",
        serde_json::json!({
            "enabled": settings.enabled,
            "triggerMode": settings.trigger_mode,
            "autoMode": settings.auto_mode,
            "shortcut": settings.shortcut
        }),
    );
    // #endregion
    {
        let conn = app_state.db.conn.lock().unwrap();
        match settings::save_settings(&conn, &settings) {
            Ok(()) => {
                // #region agent log
                super::debug_log::agent_log(
                    "H7",
                    "service.rs:selection_lookup_apply_settings",
                    "save ok",
                    serde_json::json!({}),
                );
                // #endregion
            }
            Err(e) => {
                // #region agent log
                super::debug_log::agent_log(
                    "H7",
                    "service.rs:selection_lookup_apply_settings",
                    "save failed",
                    serde_json::json!({ "error": e }),
                );
                // #endregion
                return Err(e);
            }
        }
    }

    service.update_settings(settings.clone());
    // #region agent log
    super::debug_log::agent_log(
        "H7",
        "service.rs:selection_lookup_apply_settings",
        "before apply_runtime_config",
        serde_json::json!({ "enabled": settings.enabled }),
    );
    // #endregion
    apply_runtime_config(&app, &service);
    if let Err(e) = super::tray::refresh_tray_menu(&app, &service) {
        // #region agent log
        super::debug_log::agent_log(
            "H7",
            "service.rs:selection_lookup_apply_settings",
            "tray refresh failed",
            serde_json::json!({ "error": e }),
        );
        // #endregion
    }
    // #region agent log
    super::debug_log::agent_log(
        "H1",
        "service.rs:selection_lookup_apply_settings",
        "completed",
        serde_json::json!({
            "enabled": settings.enabled,
            "triggerMode": settings.trigger_mode,
            "usesAuto": settings::trigger_uses_auto(&settings),
            "usesShortcut": settings::trigger_uses_shortcut(&settings)
        }),
    );
    // #endregion
    Ok(())
}

#[tauri::command]
pub async fn hide_selection_popup(app: AppHandle) -> Result<(), String> {
    if let Some(service) = app.try_state::<Arc<SelectionLookupService>>() {
        let delay = service.current_settings().auto_delay_ms;
        // Close button mouse-up would re-trigger lookup after debounce.
        service.suppress_auto_triggers(Duration::from_millis(delay + 800));
        service.clear_last_trigger();
        // #region agent log
        super::debug_log::agent_log(
            "H9",
            "service.rs:hide_selection_popup",
            "cleared last_trigger",
            serde_json::json!({}),
        );
        // #endregion
    }
    if let Some(popup) = app.get_webview_window("selection-popup") {
        popup.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn continue_selection_in_assistant(
    app: AppHandle,
    text: String,
    kbase_id: Option<String>,
) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        let _ = app.emit(
            "assistant-prefill-query",
            serde_json::json!({
                "text": text,
                "kbaseId": kbase_id,
            }),
        );
    }
    hide_selection_popup(app).await
}

#[tauri::command]
pub fn get_selection_lookup_settings(state: State<'_, AppState>) -> SelectionLookupSettings {
    let conn = state.db.conn.lock().unwrap();
    settings::load_settings(&conn)
}

pub fn reload_settings_from_db(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let service = app.state::<Arc<SelectionLookupService>>();
    let conn = state.db.conn.lock().unwrap();
    let loaded = settings::load_settings(&conn);
    drop(conn);
    service.update_settings(loaded);
    apply_runtime_config(app, &service);
    super::tray::refresh_tray_menu(app, &service)
}

pub fn toggle_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let service = app.state::<Arc<SelectionLookupService>>();
    let mut settings = service.current_settings();
    settings.enabled = enabled;
    {
        let conn = state.db.conn.lock().unwrap();
        settings::save_settings(&conn, &settings)?;
    }
    service.update_settings(settings);
    apply_runtime_config(app, &service);
    super::tray::refresh_tray_menu(app, &service)
}
