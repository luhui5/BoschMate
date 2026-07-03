use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[allow(dead_code)]
pub const CANCELLED: &str = "CHAT_CANCELLED";

pub struct ChatCancelRegistry {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ChatCancelRegistry {
    pub fn new() -> Self {
        Self {
            flags: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, session_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.flags
            .lock()
            .unwrap()
            .insert(session_id.to_string(), flag.clone());
        flag
    }

    pub fn cancel(&self, session_id: &str, app: &AppHandle) -> bool {
        let flags = self.flags.lock().unwrap();
        if let Some(flag) = flags.get(session_id) {
            flag.store(true, Ordering::SeqCst);
            let _ = app.emit(
                "chat-cancelled",
                serde_json::json!({ "session_id": session_id }),
            );
            true
        } else {
            false
        }
    }

    pub fn clear(&self, session_id: &str) {
        self.flags.lock().unwrap().remove(session_id);
    }

    pub fn is_cancelled(cancel: &Arc<AtomicBool>) -> bool {
        cancel.load(Ordering::SeqCst)
    }
}

impl Default for ChatCancelRegistry {
    fn default() -> Self {
        Self::new()
    }
}
