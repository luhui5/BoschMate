mod capture;
mod clipboard_listener;
mod debug_log;
mod mouse_listener;
pub mod service;
mod settings;
mod tray;

pub use service::{
    continue_selection_in_assistant, get_selection_lookup_settings, hide_selection_popup,
    init, reload_settings_from_db, selection_lookup_apply_settings, trigger_from_shortcut,
    SelectionLookupService,
};
pub use settings::{should_close_to_tray, SelectionLookupSettings, SETTINGS_KEY};
