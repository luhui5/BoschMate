use std::collections::HashSet;
use std::sync::Mutex;

/// Prevents concurrent AI loops for the same chat session.
/// Uses explicit begin/end — do NOT rely on Drop guards across `.await` in async commands.
pub struct LoopGuardRegistry {
    active: Mutex<HashSet<String>>,
}

impl LoopGuardRegistry {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(HashSet::new()),
        }
    }

    pub fn begin(&self, session_id: &str) -> Result<(), String> {
        let mut set = self.active.lock().unwrap();
        if !set.insert(session_id.to_string()) {
            return Err("该会话已有进行中的 AI 请求，请稍候。".into());
        }
        Ok(())
    }

    pub fn end(&self, session_id: &str) {
        self.active.lock().unwrap().remove(session_id);
    }
}

impl Default for LoopGuardRegistry {
    fn default() -> Self {
        Self::new()
    }
}
