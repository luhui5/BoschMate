//! Capture selected text via simulated copy + clipboard read/restore.

use std::thread;
use std::time::Duration;

struct SavedClipboard {
    text: Option<String>,
}

fn read_clipboard_text() -> Result<Option<String>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_text() {
        Ok(text) => Ok(Some(text)),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

fn clear_clipboard() -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.clear().map_err(|e| e.to_string())
}

fn save_clipboard() -> Result<SavedClipboard, String> {
    Ok(SavedClipboard {
        text: read_clipboard_text()?,
    })
}

fn restore_clipboard(saved: &SavedClipboard) -> Result<(), String> {
    match &saved.text {
        Some(text) => write_clipboard_text(text),
        None => clear_clipboard(),
    }
}

fn simulate_copy() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        enigo
            .key(Key::Meta, Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('c'), Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Meta, Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('c'), Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Read currently selected text by simulating copy. Restores clipboard afterward.
pub fn capture_selection_text() -> Result<String, String> {
    let saved = save_clipboard()?;
    let result = (|| {
        simulate_copy()?;
        thread::sleep(Duration::from_millis(80));
        let text = read_clipboard_text()?.unwrap_or_default();
        Ok(text.trim().to_string())
    })();
    let _ = restore_clipboard(&saved);
    result
}

/// Read text directly from clipboard (for clipboard auto-trigger mode).
pub fn read_clipboard_selection() -> Result<String, String> {
    Ok(read_clipboard_text()?.unwrap_or_default().trim().to_string())
}
