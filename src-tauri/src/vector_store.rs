use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorEntry {
    pub id: String,
    pub embedding: Vec<f32>,
    pub importance: f32,
    pub last_accessed: i64, // unix timestamp
}

/// In-memory vector store with cosine similarity search.
/// Persisted to disk as JSON for simplicity (MVP: no FAISS dependency).
pub struct VectorStore {
    entries: Mutex<HashMap<String, VectorEntry>>,
    store_path: PathBuf,
    dimension: usize,
    corrupted: Mutex<bool>,
}

impl VectorStore {
    pub fn new(store_path: PathBuf, dimension: usize) -> Self {
        let mut store = VectorStore {
            entries: Mutex::new(HashMap::new()),
            store_path,
            dimension,
            corrupted: Mutex::new(false),
        };
        if let Err(e) = store.load_from_disk() {
            eprintln!("[vector_store] Load failed, marking corrupted: {}", e);
            *store.corrupted.lock().unwrap() = true;
        }
        store
    }

    pub fn is_corrupted(&self) -> bool {
        *self.corrupted.lock().unwrap()
    }

    #[allow(dead_code)]
    pub fn mark_corrupted(&self) {
        *self.corrupted.lock().unwrap() = true;
    }

    /// Rebuild in-memory index from SQLite embedding blobs.
    pub fn rebuild_from_db(&self, conn: &rusqlite::Connection) -> Result<usize, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, embedding, importance FROM memories WHERE embedding IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, f64>(2)? as f32,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut count = 0usize;
        {
            let mut entries = self.entries.lock().unwrap();
            entries.clear();
            for row in rows.flatten() {
                let (id, blob, importance) = row;
                if blob.len() % 4 != 0 {
                    continue;
                }
                let embedding: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect();
                if embedding.len() != self.dimension {
                    continue;
                }
                entries.insert(
                    id.clone(),
                    VectorEntry {
                        id,
                        embedding,
                        importance,
                        last_accessed: now_ts(),
                    },
                );
                count += 1;
            }
        }
        *self.corrupted.lock().unwrap() = false;
        self.save_to_disk()?;
        Ok(count)
    }

    /// Add or update a vector entry
    pub fn upsert(&self, id: &str, embedding: &[f32], importance: f32) -> Result<(), String> {
        if embedding.len() != self.dimension {
            return Err(format!(
                "Embedding dimension mismatch: expected {}, got {}",
                self.dimension,
                embedding.len()
            ));
        }

        let mut entries = self.entries.lock().unwrap();
        entries.insert(
            id.to_string(),
            VectorEntry {
                id: id.to_string(),
                embedding: embedding.to_vec(),
                importance,
                last_accessed: now_ts(),
            },
        );
        Ok(())
    }

    /// Remove an entry
    #[allow(dead_code)]
    pub fn remove(&self, id: &str) {
        let mut entries = self.entries.lock().unwrap();
        entries.remove(id);
    }

    /// Search by cosine similarity, returning top-k results.
    /// Applies time decay and importance weighting per the requirements doc formula:
    ///   score = α × cosine_sim + β × (1/(1+days_since_access)) + γ × importance
    pub fn search(
        &self,
        query_embedding: &[f32],
        top_k: usize,
        alpha: f32,
        beta: f32,
        gamma: f32,
    ) -> Vec<SearchResult> {
        let entries = self.entries.lock().unwrap();
        let now = now_ts();

        let mut scored: Vec<SearchResult> = entries
            .values()
            .map(|entry| {
                let cosine = cosine_similarity(query_embedding, &entry.embedding);
                let days_since = ((now - entry.last_accessed) as f64 / 86400.0).max(0.0);
                let recency = 1.0 / (1.0 + days_since) as f32;
                let score = alpha * cosine + beta * recency + gamma * entry.importance;

                SearchResult {
                    id: entry.id.clone(),
                    score,
                    cosine_sim: cosine,
                }
            })
            .collect();

        // Sort by score descending
        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(top_k);

        // Update access timestamps
        if let Ok(mut entries) = self.entries.lock() {
            for result in &scored {
                if let Some(entry) = entries.get_mut(&result.id) {
                    entry.last_accessed = now;
                }
            }
        }

        scored
    }

    /// Count total entries
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    /// Persist to disk as JSON
    pub fn save_to_disk(&self) -> Result<(), String> {
        let entries = self.entries.lock().unwrap();
        let data: Vec<&VectorEntry> = entries.values().collect();
        let json = serde_json::to_string_pretty(&data)
            .map_err(|e| format!("Serialization error: {}", e))?;

        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }
        fs::write(&self.store_path, &json).map_err(|e| format!("Write error: {}", e))?;
        Ok(())
    }

    fn load_from_disk(&mut self) -> Result<(), String> {
        if !self.store_path.exists() {
            return Ok(());
        }
        let json = fs::read_to_string(&self.store_path)
            .map_err(|e| format!("Read error: {}", e))?;
        let entries: Vec<VectorEntry> =
            serde_json::from_str(&json).map_err(|e| format!("Deserialization error: {}", e))?;

        let mut map = HashMap::new();
        for entry in entries {
            if entry.embedding.len() == self.dimension {
                map.insert(entry.id.clone(), entry);
            }
        }
        *self.entries.lock().unwrap() = map;
        *self.corrupted.lock().unwrap() = false;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub score: f32,
    pub cosine_sim: f32,
}

// ── Math helpers ──

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-8);
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-8);
    (dot / (norm_a * norm_b)).clamp(-1.0, 1.0)
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Embedding client: call Ollama embedding API ──

/// Generate embeddings using Ollama's API.
/// Requires Ollama running locally with an embedding model (e.g. nomic-embed-text).
pub async fn generate_embedding(
    text: &str,
    ollama_url: &str,
    model: &str,
) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "prompt": text,
    });

    let response = client
        .post(format!("{}/api/embeddings", ollama_url))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama embedding request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Ollama API error {}: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let embedding: Vec<f32> = json["embedding"]
        .as_array()
        .ok_or("No embedding in response")?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect();

    Ok(embedding)
}

// ── Memory compression ──

/// Compress similar memories by finding groups with high cosine similarity
/// and merging them into summary entries.
pub fn compress_memories(
    store: &VectorStore,
    similarity_threshold: f32,
    min_group_size: usize,
) -> Vec<Vec<String>> {
    let entries = store.entries.lock().unwrap();
    let entry_list: Vec<&VectorEntry> = entries.values().collect();

    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut used = vec![false; entry_list.len()];

    for i in 0..entry_list.len() {
        if used[i] {
            continue;
        }

        let mut group = vec![entry_list[i].id.clone()];
        used[i] = true;

        for j in (i + 1)..entry_list.len() {
            if used[j] {
                continue;
            }
            let sim = cosine_similarity(&entry_list[i].embedding, &entry_list[j].embedding);
            if sim >= similarity_threshold {
                group.push(entry_list[j].id.clone());
                used[j] = true;
            }
        }

        if group.len() >= min_group_size {
            groups.push(group);
        }
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 0.0).abs() < 0.01);

        let c = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &c) - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_vector_store_search() {
        let dir = tempfile::tempdir().unwrap();
        let store = VectorStore::new(dir.path().join("vectors.json"), 3);

        store.upsert("a", &[1.0, 0.0, 0.0], 0.5).unwrap();
        store.upsert("b", &[0.9, 0.1, 0.0], 0.8).unwrap();
        store.upsert("c", &[0.0, 1.0, 0.0], 0.3).unwrap();

        let results = store.search(&[1.0, 0.0, 0.0], 2, 0.6, 0.25, 0.15);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "a"); // best match
    }

    #[test]
    fn test_compress_memories() {
        let dir = tempfile::tempdir().unwrap();
        let store = VectorStore::new(dir.path().join("vectors.json"), 3);

        store.upsert("a", &[1.0, 0.0, 0.0], 0.5).unwrap();
        store.upsert("b", &[0.95, 0.05, 0.0], 0.5).unwrap();
        store.upsert("c", &[0.0, 1.0, 0.0], 0.5).unwrap();

        let groups = compress_memories(&store, 0.9, 2);
        assert_eq!(groups.len(), 1); // a and b should be grouped
        assert!(groups[0].contains(&"a".to_string()));
        assert!(groups[0].contains(&"b".to_string()));
    }
}
