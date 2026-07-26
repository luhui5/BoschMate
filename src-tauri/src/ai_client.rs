use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ── Unified request / response types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub provider: String,           // "anthropic" | "openai"
    pub model: String,              // "claude-sonnet-4-6" | "gpt-4o" | "qwen2.5-coder"
    pub messages: Vec<AiMessage>,
    pub tools: Option<Vec<AiToolDef>>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub api_key: Option<String>,    // for anthropic/openai
    pub base_url: Option<String>,   // for custom endpoints
    pub system: Option<String>,
    /// When true, skip TLS certificate validation (for self-signed / internal CAs).
    #[serde(default)]
    pub skip_tls_verify: bool,
}

fn build_http_client(skip_tls_verify: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(skip_tls_verify)
        .connect_timeout(std::time::Duration::from_secs(15))
        // Max idle time between stream chunks; without this a stalled
        // connection hangs forever and cancellation never gets a chance to run.
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ChatDelta {
    pub content: String,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub tool_calls: Option<Vec<ToolCallResult>>,
    pub finish_reason: String,
    pub usage: UsageInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_edits: Option<Vec<crate::code_editor::EditResult>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_edit_meta: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_log: Option<Vec<crate::ai_loop::ActivityStep>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_questions: Option<crate::ai_loop::PendingQuestions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

/// Convert internal tool defs to OpenAI / OpenAI-compatible API format.
fn to_openai_tools(tools: &[AiToolDef]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect(),
    )
}

/// Convert internal tool defs to Anthropic Messages API format.
fn to_anthropic_tools(tools: &[AiToolDef]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            })
            .collect(),
    )
}

// ── Async streaming chat ──

/// Stream chat tokens via Tauri events. Each token delta is emitted as a `chat-token`
/// event (payload carries only `delta`, not cumulative content — the frontend accumulates).
pub async fn stream_chat(
    app: AppHandle,
    req: ChatRequest,
    session_id: String,
    message_id: String,
    cancel: Arc<AtomicBool>,
) -> Result<ChatResponse, String> {
    const MAX_RETRIES: u32 = 3;
    let mut last_error = String::new();

    for attempt in 0..=MAX_RETRIES {
        if cancelled(&cancel) {
            return Ok(cancelled_response(String::new()));
        }
        if attempt > 0 {
            // A failed attempt may already have emitted partial tokens; tell the
            // frontend to discard them so the retry doesn't duplicate content.
            let _ = app.emit(
                "chat-stream-reset",
                serde_json::json!({
                    "session_id": session_id,
                    "message_id": message_id,
                }),
            );
            let delay_ms = 1000u64 * 2u64.pow(attempt - 1);
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }

        let result = match req.provider.as_str() {
            "anthropic" => {
                stream_anthropic(app.clone(), req.clone(), session_id.clone(), message_id.clone(), cancel.clone()).await
            }
            "openai" => {
                stream_openai(app.clone(), req.clone(), session_id.clone(), message_id.clone(), cancel.clone()).await
            }
            _ => return Err(format!("Unknown provider: {}", req.provider)),
        };

        match result {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                if !is_retryable_error(&e) {
                    return Err(e);
                }
                last_error = e;
            }
        }
    }
    Err(format!(
        "Operation failed after {} retries: {}",
        MAX_RETRIES, last_error
    ))
}

/// Client errors (4xx, except 408/429) won't succeed on retry — e.g. an invalid
/// API key would otherwise make the user wait through the full backoff cycle.
fn is_retryable_error(err: &str) -> bool {
    if let Some(pos) = err.find(" error ") {
        let digits: String = err[pos + 7..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(code) = digits.parse::<u16>() {
            if (400..500).contains(&code) && code != 408 && code != 429 {
                return false;
            }
        }
    }
    true
}

/// Append a network chunk to the byte buffer and drain complete SSE events
/// (separated by a blank line). The buffer must stay as raw bytes: decoding
/// per-chunk would corrupt multi-byte UTF-8 characters (e.g. Chinese text)
/// split across chunk boundaries.
fn drain_sse_events(buf: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    buf.extend_from_slice(chunk);
    let mut events = Vec::new();
    while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
        let event_bytes: Vec<u8> = buf.drain(..pos + 2).collect();
        events.push(String::from_utf8_lossy(&event_bytes[..pos]).into_owned());
    }
    events
}

/// Sort accumulated tool calls by stream index and parse the JSON argument
/// fragments. HashMap iteration order is random, which would scramble the
/// execution order of parallel tool calls.
fn finalize_tool_calls(full_tool_calls: HashMap<usize, ToolCallResult>) -> Option<Vec<ToolCallResult>> {
    if full_tool_calls.is_empty() {
        return None;
    }
    let mut entries: Vec<(usize, ToolCallResult)> = full_tool_calls.into_iter().collect();
    entries.sort_by_key(|(idx, _)| *idx);
    let mut parsed = Vec::new();
    for (_, mut tc) in entries {
        if let Value::String(ref args) = tc.arguments {
            if let Ok(parsed_args) = serde_json::from_str::<Value>(args) {
                tc.arguments = parsed_args;
            } else if args.trim().is_empty() {
                tc.arguments = serde_json::json!({});
            }
        }
        parsed.push(tc);
    }
    Some(parsed)
}

fn cancelled(cancel: &Arc<AtomicBool>) -> bool {
    crate::chat_cancel::ChatCancelRegistry::is_cancelled(cancel)
}

fn cancelled_response(content: String) -> ChatResponse {
    ChatResponse {
        content,
        tool_calls: None,
        finish_reason: "cancelled".into(),
        usage: UsageInfo {
            prompt_tokens: 0,
            completion_tokens: 0,
        },
        pending_edits: None,
        pending_edit_meta: None,
        activity_log: None,
        pending_questions: None,
    }
}

// ── Anthropic ──

async fn stream_anthropic(
    app: AppHandle,
    req: ChatRequest,
    session_id: String,
    message_id: String,
    cancel: Arc<AtomicBool>,
) -> Result<ChatResponse, String> {
    let api_key = req.api_key.clone().ok_or("Anthropic API key required")?;
    let client = build_http_client(req.skip_tls_verify)?;
    let model = if req.model.is_empty() { "claude-sonnet-4-6".to_string() } else { req.model.clone() };

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": req.max_tokens.unwrap_or(4096),
        "temperature": req.temperature.unwrap_or(0.7),
        "stream": true,
        "messages": build_anthropic_messages(&req),
    });

    if let Some(ref sys) = req.system {
        body["system"] = serde_json::json!(sys);
    }

    if let Some(ref tools) = req.tools {
        body["tools"] = to_anthropic_tools(tools);
    }

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic error {}: {}", status, text));
    }

    // Parse SSE stream
    let mut full_content = String::new();
    let mut full_tool_calls: HashMap<usize, ToolCallResult> = HashMap::new();
    let mut finish_reason = String::from("stop");
    let mut prompt_tokens: u32 = 0;
    let mut completion_tokens: u32 = 0;

    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        if cancelled(&cancel) {
            finish_reason = "cancelled".into();
            break;
        }
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;

        for event_str in drain_sse_events(&mut buf, &chunk) {
            for line in event_str.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        break;
                    }
                    if let Ok(event) = serde_json::from_str::<Value>(data) {
                        // Content block delta
                        if let Some(delta) = event["delta"]["text"].as_str() {
                            full_content.push_str(delta);
                            let _ = app.emit("chat-token", serde_json::json!({
                                "session_id": session_id,
                                "message_id": message_id,
                                "delta": delta,
                            }));
                        }
                        // Tool use: key by the SSE content block index — argument
                        // deltas reference this index, not the tool-call ordinal.
                        if event["type"] == "content_block_start" {
                            if event["content_block"]["type"] == "tool_use" {
                                if let (Some(idx), Some(name)) = (
                                    event["index"].as_u64(),
                                    event["content_block"]["name"].as_str(),
                                ) {
                                    let tool_id = format!("toolu_{}", idx);
                                    let id = event["content_block"]["id"]
                                        .as_str()
                                        .unwrap_or(&tool_id);
                                    full_tool_calls.insert(idx as usize, ToolCallResult {
                                        id: id.to_string(),
                                        name: name.to_string(),
                                        arguments: Value::String(String::new()),
                                    });
                                }
                            }
                        }
                        if event["type"] == "content_block_delta" {
                            if let Some(idx) = event["index"].as_u64() {
                                if let Some(args) = event["delta"]["partial_json"].as_str() {
                                    if let Some(tc) = full_tool_calls.get_mut(&(idx as usize)) {
                                        let existing = tc.arguments.as_str().unwrap_or("");
                                        // accumulate JSON fragments
                                        let merged = format!("{}{}", existing, args);
                                        tc.arguments = Value::String(merged.clone());
                                        let _ = app.emit("chat-tool-delta", serde_json::json!({
                                            "session_id": session_id,
                                            "message_id": message_id,
                                            "index": idx,
                                            "name": tc.name,
                                            "arguments_delta": args,
                                        }));
                                    }
                                }
                            }
                        }
                        // Usage: message_start nests it under "message", message_delta
                        // has it at the top level.
                        for usage in [event.get("usage"), event["message"].get("usage")]
                            .into_iter()
                            .flatten()
                        {
                            if let Some(pt) = usage["input_tokens"].as_u64() {
                                prompt_tokens = pt as u32;
                            }
                            if let Some(ct) = usage["output_tokens"].as_u64() {
                                completion_tokens = ct as u32;
                            }
                        }
                        // Stop reason
                        if let Some(reason) = event["delta"]["stop_reason"].as_str() {
                            finish_reason = reason.to_string();
                        }
                    }
                }
            }
        }
    }

    Ok(ChatResponse {
        content: full_content,
        tool_calls: finalize_tool_calls(full_tool_calls),
        finish_reason,
        usage: UsageInfo {
            prompt_tokens,
            completion_tokens,
        },
        pending_edits: None,
        pending_edit_meta: None,
        activity_log: None,
        pending_questions: None,
    })
}

fn build_anthropic_messages(req: &ChatRequest) -> Vec<Value> {
    let mut msgs = Vec::new();
    for m in &req.messages {
        msgs.push(serde_json::json!({
            "role": m.role,
            "content": m.content,
        }));
    }
    msgs
}

// ── OpenAI ──

async fn stream_openai(
    app: AppHandle,
    req: ChatRequest,
    session_id: String,
    message_id: String,
    cancel: Arc<AtomicBool>,
) -> Result<ChatResponse, String> {
    let client = build_http_client(req.skip_tls_verify)?;
    let base = req.base_url.unwrap_or_else(|| "https://api.openai.com/v1".into());
    let model = if req.model.is_empty() { "gpt-4o" } else { &req.model };

    let mut messages: Vec<Value> = Vec::new();
    if let Some(ref sys) = req.system {
        messages.push(serde_json::json!({ "role": "system", "content": sys }));
    }
    for m in &req.messages {
        messages.push(serde_json::json!({
            "role": m.role,
            "content": m.content,
        }));
    }

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": req.max_tokens.unwrap_or(4096),
        "temperature": req.temperature.unwrap_or(0.7),
        "stream": true,
    });

    if let Some(ref tools) = req.tools {
        body["tools"] = to_openai_tools(tools);
    }

    let mut request_builder = client
        .post(format!("{}/chat/completions", base))
        .header("Content-Type", "application/json");

    // Only attach API key if provided (custom endpoints may not require auth)
    if let Some(ref api_key) = req.api_key {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = request_builder
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI error {}: {}", status, text));
    }

    let mut full_content = String::new();
    let mut full_tool_calls: HashMap<usize, ToolCallResult> = HashMap::new();
    let mut finish_reason = String::from("stop");
    let mut prompt_tokens: u32 = 0;
    let mut completion_tokens: u32 = 0;

    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        if cancelled(&cancel) {
            finish_reason = "cancelled".into();
            break;
        }
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;

        for event_str in drain_sse_events(&mut buf, &chunk) {
            for line in event_str.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        break;
                    }
                    if let Ok(event) = serde_json::from_str::<Value>(data) {
                        if let Some(choices) = event["choices"].as_array() {
                            for choice in choices {
                                if let Some(delta) = choice["delta"]["content"].as_str() {
                                    full_content.push_str(delta);
                                    let _ = app.emit("chat-token", serde_json::json!({
                                        "session_id": session_id,
                                        "message_id": message_id,
                                        "delta": delta,
                                    }));
                                }
                                // Tool calls
                                if let Some(tc_deltas) = choice["delta"]["tool_calls"].as_array() {
                                    for tc in tc_deltas {
                                        let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                                        let entry = full_tool_calls.entry(idx).or_insert_with(|| {
                                            ToolCallResult {
                                                id: tc["id"].as_str().unwrap_or("").to_string(),
                                                name: tc["function"]["name"].as_str().unwrap_or("").to_string(),
                                                arguments: Value::String(String::new()),
                                            }
                                        });
                                        if let Some(id) = tc["id"].as_str() {
                                            entry.id = id.to_string();
                                        }
                                        if let Some(name) = tc["function"]["name"].as_str() {
                                            entry.name = name.to_string();
                                        }
                                        if let Some(args) = tc["function"]["arguments"].as_str() {
                                            let existing = entry.arguments.as_str().unwrap_or("");
                                            entry.arguments = Value::String(format!("{}{}", existing, args));
                                            let _ = app.emit("chat-tool-delta", serde_json::json!({
                                                "session_id": session_id,
                                                "message_id": message_id,
                                                "index": idx,
                                                "name": entry.name,
                                                "arguments_delta": args,
                                            }));
                                        }
                                    }
                                }
                                if let Some(reason) = choice["finish_reason"].as_str() {
                                    if !reason.is_empty() {
                                        finish_reason = reason.to_string();
                                    }
                                }
                            }
                        }
                        if let Some(usage) = event.get("usage") {
                            if let Some(pt) = usage["prompt_tokens"].as_u64() {
                                prompt_tokens = pt as u32;
                            }
                            if let Some(ct) = usage["completion_tokens"].as_u64() {
                                completion_tokens = ct as u32;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ChatResponse {
        content: full_content,
        tool_calls: finalize_tool_calls(full_tool_calls),
        finish_reason,
        usage: UsageInfo {
            prompt_tokens,
            completion_tokens,
        },
        pending_edits: None,
        pending_edit_meta: None,
        activity_log: None,
        pending_questions: None,
    })
}
