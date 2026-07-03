//! Unified tool interface for AI Loop (P6-1).
#![allow(dead_code)]

use serde_json::Value;
use std::path::PathBuf;

pub struct ToolContext<'a> {
    pub project_root: &'a PathBuf,
    pub session_id: Option<&'a str>,
    pub execution_id: String,
}

pub trait Tool: Send + Sync {
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn auditable(&self) -> bool {
        true
    }
    fn supports_rollback(&self) -> bool {
        false
    }
    fn execute(&self, args: &Value, ctx: &ToolContext<'_>) -> Result<String, String>;
}

pub struct ReadFileTool;

impl Tool for ReadFileTool {
    fn name(&self) -> &'static str {
        "read_file"
    }
    fn description(&self) -> &'static str {
        "Read a file from the project"
    }
    fn auditable(&self) -> bool {
        false
    }
    fn execute(&self, args: &Value, ctx: &ToolContext<'_>) -> Result<String, String> {
        let path = args["path"].as_str().ok_or("path required")?;
        let offset = args["offset"].as_u64().map(|v| v as usize);
        let limit = args["limit"].as_u64().map(|v| v as usize);
        crate::fs_ops::read_file(ctx.project_root.as_path(), path, offset, limit)
    }
}

pub fn registry() -> Vec<Box<dyn Tool>> {
    vec![Box::new(ReadFileTool)]
}

pub fn tool_names() -> Vec<&'static str> {
    registry().iter().map(|t| t.name()).collect()
}
