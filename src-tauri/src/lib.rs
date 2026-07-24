// Library crate for integration tests.

pub mod ai_client;
pub mod ai_loop;
pub mod audit;
pub mod changes_db;
pub mod chat_cancel;
pub mod code_editor;
pub mod code_graph;
pub mod credentials;
pub mod crypto;
pub mod db;
pub mod error_handler;
pub mod file_watcher;
pub mod fs_ops;
pub mod git_ops;
pub mod linter_analyzer;
pub mod loop_guard;
pub mod knowledge;
pub mod knowledge_chunker;
pub mod knowledge_indexer;
pub mod knowledge_parser;
pub mod knowledge_retriever;
pub mod knowledge_tools;
pub mod memory_compressor;
pub mod models;
pub mod os_open;
pub mod os_sandbox;
pub mod outlook;
pub mod path_guard;
pub mod paused_loop;
pub mod pending_push;
pub mod pr_draft;
pub mod process_util;
pub mod recovery;
pub mod retriever;
pub mod sandbox;
pub mod skills;
pub mod skills_runtime;
pub mod ssh;
pub mod test_runner;
pub mod tools;
pub mod tracing_log;
pub mod tree_sitter_graph;
pub mod vector_store;
pub mod web_fetch;
pub mod web_search;
pub mod selection_lookup;

// Minimal AppState for library compilation
pub struct AppState {
    pub db: crate::db::Database,
    pub data_dir: std::path::PathBuf,
    pub vector_store: std::sync::Mutex<crate::vector_store::VectorStore>,
    pub knowledge_stores: crate::knowledge::KnowledgeStoreManager,
    pub chat_cancel: crate::chat_cancel::ChatCancelRegistry,
    pub loop_guard: crate::loop_guard::LoopGuardRegistry,
    pub paused_loops: crate::paused_loop::PausedLoopRegistry,
    pub file_watcher: crate::file_watcher::FileWatcherRegistry,
}
