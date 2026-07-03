use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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
    pub provider: String,           // "anthropic" | "openai" | "ollama"
    pub model: String,              // "claude-sonnet-4-6" | "gpt-4o" | "qwen2.5-coder"
    pub messages: Vec<AiMessage>,
    pub tools: Option<Vec<AiToolDef>>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub api_key: Option<String>,    // for anthropic/openai
    pub base_url: Option<String>,   // for ollama / custom endpoints
    pub system: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDelta {
    pub content: String,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Stream chat tokens via Tauri events. Each token is emitted as `chat-token` event.
pub async fn stream_chat(
    app: AppHandle,
    req: ChatRequest,
    session_id: String,
    message_id: String,
) -> Result<ChatResponse, String> {
    match req.provider.as_str() {
        "anthropic" => stream_anthropic(app, req, session_id, message_id).await,
        "openai" => stream_openai(app, req, session_id, message_id).await,
        "ollama" => stream_ollama(app, req, session_id, message_id).await,
        _ => Err(format!("Unknown provider: {}", req.provider)),
    }
}

// ── Anthropic ──

async fn stream_anthropic(
    app: AppHandle,
    req: ChatRequest,
    session_id: String,
    message_id: String,
) -> Result<ChatResponse, String> {
    let api_key = req.api_key.clone().ok_or("Anthropic API key required")?;
    let client = reqwest::Client::new();
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
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find("\n\n") {
            let event_str = buf[..pos].to_string();
            buf = buf[pos + 2..].to_string();

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
                                "content": full_content,
                            }));
                        }
                        // Tool use
                        if event["type"] == "content_block_start" {
                            if event["content_block"]["type"] == "tool_use" {
                                let idx = full_tool_calls.len();
                                if let Some(name) = event["content_block"]["name"].as_str() {
                                    let tool_id = format!("toolu_{}", idx);
                                    let id = event["content_block"]["id"]
                                        .as_str()
                                        .unwrap_or(&tool_id);
                                    full_tool_calls.insert(idx, ToolCallResult {
                                        id: id.to_string(),
                                        name: name.to_string(),
                                        arguments: Value::Null,
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
                        // Usage
                        if let Some(usage) = event.get("usage") {
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

    // Parse accumulated tool call arguments from JSON fragments
    let tool_calls = if full_tool_calls.is_empty() {
        None
    } else {
        let mut parsed = Vec::new();
        for (_, mut tc) in full_tool_calls {
            if let Value::String(ref args) = tc.arguments {
                if let Ok(parsed_args) = serde_json::from_str::<Value>(args) {
                    tc.arguments = parsed_args;
                }
            }
            parsed.push(tc);
        }
        Some(parsed)
    };

    Ok(ChatResponse {
        content: full_content,
        tool_calls,
        finish_reason,
        usage: UsageInfo {
            prompt_tokens,
            completion_tokens,
        },
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
) -> Result<ChatResponse, String> {
    let client = reqwest::Client::new();
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
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find("\n\n") {
            let event_str = buf[..pos].to_string();
            buf = buf[pos + 2..].to_string();

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
                                        "content": full_content,
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

    let tool_calls = if full_tool_calls.is_empty() {
        None
    } else {
        let mut parsed = Vec::new();
        for (_, mut tc) in full_tool_calls {
            if let Value::String(ref args) = tc.arguments {
                if let Ok(parsed_args) = serde_json::from_str::<Value>(args) {
                    tc.arguments = parsed_args;
                }
            }
            parsed.push(tc);
        }
        Some(parsed)
    };

    Ok(ChatResponse {
        content: full_content,
        tool_calls,
        finish_reason,
        usage: UsageInfo {
            prompt_tokens,
            completion_tokens,
        },
    })
}

// ── Ollama (local, OpenAI-compatible) ──

async fn stream_ollama(
    app: AppHandle,
    req: ChatRequest,
    session_id: String,
    message_id: String,
) -> Result<ChatResponse, String> {
    let client = reqwest::Client::new();
    let base = req.base_url.unwrap_or_else(|| "http://localhost:11434/v1".into());
    let model = if req.model.is_empty() { "qwen2.5-coder" } else { &req.model };

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

    let response = client
        .post(format!("{}/chat/completions", base))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed (is it running?): {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error {}: {}", status, text));
    }

    // Parse Ollama SSE stream (OpenAI-compatible)
    let mut full_content = String::new();
    let mut prompt_tokens: u32 = 0;
    let mut completion_tokens: u32 = 0;

    let mut stream = response.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find("\n\n") {
            let event_str = buf[..pos].to_string();
            buf = buf[pos + 2..].to_string();

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
                                        "content": full_content,
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ChatResponse {
        content: full_content,
        tool_calls: None,
        finish_reason: "stop".into(),
        usage: UsageInfo {
            prompt_tokens,
            completion_tokens,
        },
    })
}

// ── Get available models ──

pub async fn list_ollama_models(base_url: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/tags", base_url))
        .send()
        .await
        .map_err(|e| format!("Ollama not reachable: {}", e))?;

    let json: Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    let models = json["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
        .collect();

    Ok(models)
}
