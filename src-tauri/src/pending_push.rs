//! Pending push request storage for confirmation flow (R3-5).

use std::path::PathBuf;
use std::sync::Mutex;

pub struct PendingPush {
    pub project_root: PathBuf,
    pub remote: String,
    pub branch: String,
    pub callback_id: String,
}

static PENDING_PUSH: Mutex<Option<PendingPush>> = Mutex::new(None);

pub fn store_push_request(
    project_root: PathBuf,
    remote: String,
    branch: String,
    callback_id: String,
) {
    *PENDING_PUSH.lock().unwrap() = Some(PendingPush {
        project_root,
        remote,
        branch,
        callback_id,
    });
}

pub fn take_push_request(callback_id: &str) -> Option<PendingPush> {
    let mut guard = PENDING_PUSH.lock().unwrap();
    if let Some(ref pending) = *guard {
        if pending.callback_id == callback_id {
            return guard.take();
        }
    }
    None
}

pub fn get_pending_push() -> Option<(String, String, String, String)> {
    let guard = PENDING_PUSH.lock().unwrap();
    guard.as_ref().map(|p| {
        (
            p.project_root.to_string_lossy().to_string(),
            p.remote.clone(),
            p.branch.clone(),
            p.callback_id.clone(),
        )
    })
}

pub fn cancel_push(callback_id: &str) -> bool {
    let mut guard = PENDING_PUSH.lock().unwrap();
    if let Some(ref pending) = *guard {
        if pending.callback_id == callback_id {
            *guard = None;
            return true;
        }
    }
    false
}
