use crate::ai_loop::PausedLoopState;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct PausedLoopRegistry {
    states: Mutex<HashMap<String, PausedLoopState>>,
}

impl PausedLoopRegistry {
    pub fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, session_id: &str, state: PausedLoopState) {
        self.states
            .lock()
            .unwrap()
            .insert(session_id.to_string(), state);
    }

    pub fn take(&self, session_id: &str) -> Option<PausedLoopState> {
        self.states.lock().unwrap().remove(session_id)
    }

    pub fn clear(&self, session_id: &str) {
        self.states.lock().unwrap().remove(session_id);
    }
}

impl Default for PausedLoopRegistry {
    fn default() -> Self {
        Self::new()
    }
}
