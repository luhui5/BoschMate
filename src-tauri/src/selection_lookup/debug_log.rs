//! Debug session logging for selection lookup (session d386fb).

use std::io::Write;

pub fn agent_log(hypothesis_id: &str, location: &str, message: &str, data: serde_json::Value) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../debug-d386fb.log");
    let line = serde_json::json!({
        "sessionId": "d386fb",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "runId": "post-fix-2"
    });
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{line}");
        let _ = f.flush();
    }
}
