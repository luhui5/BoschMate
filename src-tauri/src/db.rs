use rusqlite::{Connection, Result, params};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Database {
    pub conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(app_dir: &PathBuf) -> Result<Self> {
        std::fs::create_dir_all(app_dir).ok();
        let db_path = app_dir.join("boschmate.db");
        let conn = Connection::open(&db_path)?;

        // Performance pragmas
        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA cache_size = -64000;
        ")?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.run_migrations()?;
        db.seed_assistant_project(app_dir)?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                local_path TEXT NOT NULL UNIQUE,
                language TEXT,
                framework TEXT,
                git_remote TEXT,
                git_branch TEXT,
                ci_status TEXT NOT NULL DEFAULT 'none',
                created_at TEXT NOT NULL,
                opened_at TEXT,
                last_summary TEXT,
                settings TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT,
                mode TEXT NOT NULL DEFAULT 'ask',
                status TEXT NOT NULL DEFAULT 'active',
                parent_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                token_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                mode TEXT,
                tool_calls TEXT,
                diffs TEXT,
                file_refs TEXT,
                token_usage TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

            CREATE TABLE IF NOT EXISTS changes (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                message_id TEXT REFERENCES messages(id),
                file_path TEXT NOT NULL,
                diff_text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                snapshot_id TEXT,
                edit_meta TEXT,
                created_at TEXT NOT NULL,
                applied_at TEXT
            );

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                summary TEXT,
                embedding BLOB,
                source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                access_count INTEGER DEFAULT 0,
                last_accessed_at TEXT,
                version INTEGER DEFAULT 1,
                compressed_from TEXT,
                encrypted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_memories_project_type ON memories(project_id, type);
            CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(project_id, importance DESC);

            CREATE TABLE IF NOT EXISTS memory_links (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                link_type TEXT NOT NULL DEFAULT 'related',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vector_index_meta (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                dimension INTEGER NOT NULL DEFAULT 768,
                entry_count INTEGER NOT NULL DEFAULT 0,
                backend TEXT NOT NULL DEFAULT 'json',
                last_rebuild_at TEXT,
                status TEXT NOT NULL DEFAULT 'ok'
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                content,
                content='memories',
                content_rowid='rowid'
            );

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                version TEXT NOT NULL,
                source TEXT NOT NULL,
                entry_point TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                enabled INTEGER NOT NULL DEFAULT 1,
                installed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                scope TEXT NOT NULL CHECK(scope IN ('global','project')),
                project_id TEXT,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                UNIQUE(scope, project_id, key)
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
                command TEXT NOT NULL,
                cwd TEXT NOT NULL,
                exit_code INTEGER,
                stdout TEXT,
                stderr TEXT,
                duration_ms INTEGER,
                sandboxed INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_bases (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id TEXT PRIMARY KEY,
                kbase_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                chunk_count INTEGER NOT NULL DEFAULT 0,
                storage_path TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kbase ON knowledge_documents(kbase_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                kbase_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding BLOB,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kbase ON knowledge_chunks(kbase_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id, chunk_index);

            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
                content,
                content='knowledge_chunks',
                content_rowid='rowid'
            );
        ")?;

        // Migrate legacy DBs missing edit_meta column
        let _ = conn.execute("ALTER TABLE changes ADD COLUMN edit_meta TEXT", []);
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN questions TEXT", []);

        let _ = conn.execute_batch("
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
              INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
              INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
              INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
              INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
              INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
              INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
              INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
              INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
            END;
        ");

        Ok(())
    }

    pub fn rebuild_vector_index_meta(conn: &Connection, project_id: Option<&str>, count: i64) -> Result<(), String> {
        let id = project_id.unwrap_or("__global__");
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO vector_index_meta (id, project_id, dimension, entry_count, backend, last_rebuild_at, status)
             VALUES (?1, ?2, 768, ?3, 'json', ?4, 'ok')
             ON CONFLICT(id) DO UPDATE SET entry_count = ?3, last_rebuild_at = ?4, status = 'ok'",
            rusqlite::params![id, project_id, count, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn check_db_integrity(conn: &Connection) -> Result<bool, String> {
        let ok: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        Ok(ok == "ok")
    }

    /// Virtual project for Bosch Assistant standalone chat (FK target for assistant sessions).
    pub fn seed_assistant_project(&self, app_dir: &PathBuf) -> Result<()> {
        let assistant_dir = app_dir.join("assistant");
        std::fs::create_dir_all(&assistant_dir).ok();
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let path = assistant_dir.to_string_lossy().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, local_path, created_at, opened_at) VALUES ('__assistant__', 'Bosch Assistant', ?1, ?2, ?2)",
            params![path, now],
        )?;
        Ok(())
    }

    /// Clear FK references that block session deletion (legacy schema without ON DELETE CASCADE).
    pub fn prepare_session_delete(conn: &Connection, session_id: &str) -> Result<()> {
        conn.execute(
            "UPDATE memories SET source_session_id = NULL WHERE source_session_id = ?1",
            params![session_id],
        )?;
        conn.execute(
            "UPDATE sessions SET parent_id = NULL WHERE parent_id = ?1",
            params![session_id],
        )?;
        conn.execute(
            "DELETE FROM audit_log WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    pub fn delete_session_cascade(conn: &Connection, session_id: &str) -> Result<()> {
        Self::prepare_session_delete(conn, session_id)?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(())
    }

    pub fn delete_project_cascade(conn: &Connection, project_id: &str) -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE memories SET source_session_id = NULL WHERE project_id = ?1",
            params![project_id],
        )?;
        tx.execute(
            "UPDATE sessions SET parent_id = NULL WHERE project_id = ?1",
            params![project_id],
        )?;
        tx.execute(
            "DELETE FROM audit_log WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?1)",
            params![project_id],
        )?;
        tx.execute(
            "DELETE FROM settings WHERE scope = 'project' AND project_id = ?1",
            params![project_id],
        )?;
        tx.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Seed built-in skills on first run
    pub fn seed_builtin_skills(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM skills", [], |r| r.get(0))?;
        if count > 0 {
            return Ok(());
        }

        let now = chrono::Utc::now().to_rfc3339();
        let skills = vec![
            ("run-tests", "Auto-detect and run project tests", Some("/test")),
            ("format-code", "Run formatter (prettier/rustfmt)", Some("/format")),
            ("lint-check", "Run linter and generate fix suggestions", Some("/lint")),
            ("generate-changelog", "Generate changelog from Git history", Some("/changelog")),
            ("dependency-check", "Check outdated deps and CVEs", Some("/deps")),
            ("project-init", "Initialize a project from a template", Some("/init")),
        ];

        for (i, (name, _desc, cmd)) in skills.iter().enumerate() {
            conn.execute(
                "INSERT INTO skills (id, name, version, source, entry_point, permissions, enabled, installed_at) VALUES (?1, ?2, '1.0.0', 'builtin', '', '[]', 1, ?3)",
                params![format!("builtin-{}", i), name, now],
            )?;
            // Store description as a setting
            let _ = cmd; // commands are resolved at runtime
        }

        Ok(())
    }
}
