//! System tray for background selection lookup control.

use super::service::SelectionLookupService;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow, WebviewWindowBuilder,
};

const TRAY_ID: &str = "yourmate-tray";
const MAIN_WINDOW_LABEL: &str = "main";
const POPUP_WINDOW_LABEL: &str = "selection-popup";
const MENU_TOGGLE_ID: &str = "selection_lookup_toggle";
const MENU_OPEN_ID: &str = "selection_lookup_open";
const MENU_QUIT_ID: &str = "selection_lookup_quit";

fn resolve_main_window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return Some(window);
    }

    app.webview_windows()
        .into_iter()
        .find(|(label, _)| label.as_str() != POPUP_WINDOW_LABEL)
        .map(|(_, window)| window)
}

fn ensure_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = resolve_main_window(app) {
        return Ok(window);
    }

    let main_cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW_LABEL)
        .or_else(|| app.config().app.windows.first())
        .ok_or_else(|| "main window config missing".to_string())?;

    WebviewWindowBuilder::from_config(app, main_cfg)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

fn show_main_from_tray(app: &AppHandle) {
    let Ok(main) = ensure_main_window(app) else {
        return;
    };
    let _ = main.unminimize();
    let _ = main.show();
    let _ = main.set_focus();
}

fn toggle_label(enabled: bool) -> String {
    if enabled {
        "划词查询：已启用".into()
    } else {
        "划词查询：已禁用".into()
    }
}

fn build_tray_menu(app: &AppHandle, enabled: bool) -> Result<Menu<tauri::Wry>, String> {
    let toggle = MenuItem::with_id(
        app,
        MENU_TOGGLE_ID,
        toggle_label(enabled),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let open = MenuItem::with_id(app, MENU_OPEN_ID, "打开 YourMate", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, MENU_QUIT_ID, "退出", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;

    Menu::with_items(app, &[&toggle, &sep, &open, &sep, &quit]).map_err(|e| e.to_string())
}

pub fn setup_tray(app: &AppHandle, service: Arc<SelectionLookupService>) -> Result<(), String> {
    let enabled = service.current_settings().enabled;
    let menu = build_tray_menu(app, enabled)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .ok_or_else(|| "missing tray icon".to_string())?
                .clone(),
        )
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                MENU_TOGGLE_ID => {
                    let service = app.state::<Arc<SelectionLookupService>>();
                    let next = !service.current_settings().enabled;
                    let _ = super::service::toggle_enabled(app, next);
                }
                MENU_OPEN_ID => {
                    show_main_from_tray(app);
                }
                MENU_QUIT_ID => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    show_main_from_tray(tray.app_handle());
                }
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    show_main_from_tray(tray.app_handle());
                }
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn refresh_tray_menu(app: &AppHandle, service: &Arc<SelectionLookupService>) -> Result<(), String> {
    let enabled = service.current_settings().enabled;
    let menu = build_tray_menu(app, enabled)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
