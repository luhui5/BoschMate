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
    pub last_accessed: i64,
}

/// Internal storage: pre-normalized embedding for fast cosine similarity.
struct NormalizedEntry {
    embedding: Vec<f32>,
    norm: f32,
    importance: f32,
    last_accessed: i64,
}

/// Vector store with optimized brute-force cosine search.
/// Uses pre-normalized embeddings to avoid repeated norm computation during search.
/// For ≤10k entries with 768-dim vectors, brute-force is well under 50ms on modern CPUs.
pub struct VectorStore {
    entries: Mutex<HashMap<String, NormalizedEntry>>,
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
            let norm = compute_norm(&embedding);
            entries.insert(
                id.clone(),
                NormalizedEntry {
                    embedding,
                    norm,
                    importance,
                    last_accessed: now_ts(),
                },
            );
            count += 1;
        }

        drop(entries);
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

        let norm = compute_norm(embedding);
        let mut entries = self.entries.lock().unwrap();
        entries.insert(
            id.to_string(),
            NormalizedEntry {
                embedding: embedding.to_vec(),
                norm,
                importance,
                last_accessed: now_ts(),
            },
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub fn remove(&self, id: &str) {
        self.entries.lock().unwrap().remove(id);
    }

    /// Search by cosine similarity with weighted scoring:
    ///   score = α × cosine_sim + β × recency + γ × importance
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
        let query_norm = compute_norm(query_embedding);

        let mut scored: Vec<SearchResult> = entries
            .iter()
            .map(|(id, entry)| {
                let cosine = cosine_similarity_normalized(query_embedding, query_norm, &entry.embedding, entry.norm);
                let days_since = ((now - entry.last_accessed) as f64 / 86400.0).max(0.0);
                let recency = 1.0 / (1.0 + days_since) as f32;
                let score = alpha * cosine + beta * recency + gamma * entry.importance;

                SearchResult {
                    id: id.clone(),
                    score,
                    cosine_sim: cosine,
                }
            })
            .collect();

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(top_k);

        // Update access timestamps
        drop(entries);
        if let Ok(mut entries) = self.entries.lock() {
            for result in &scored {
                if let Some(entry) = entries.get_mut(&result.id) {
                    entry.last_accessed = now;
                }
            }
        }

        scored
    }

    pub fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    /// Parallel batch search using rayon for large workloads (>1000 entries).
    /// Uses the same weighted scoring but distributes computation across threads.
    pub fn search_parallel(
        &self,
        query_embedding: &[f32],
        top_k: usize,
        alpha: f32,
        beta: f32,
        gamma: f32,
    ) -> Vec<SearchResult> {
        use rayon::prelude::*;
        let entries = self.entries.lock().unwrap();
        let entry_count = entries.len();

        // Use parallel search only for larger datasets
        if entry_count < 1000 {
            drop(entries);
            return self.search(query_embedding, top_k, alpha, beta, gamma);
        }

        let now = now_ts();
        let query_norm = compute_norm(query_embedding);
        let entries_vec: Vec<(String, Vec<f32>, f32, f32, i64)> = entries
            .iter()
            .map(|(id, e)| {
                (
                    id.clone(),
                    e.embedding.clone(),
                    e.norm,
                    e.importance,
                    e.last_accessed,
                )
            })
            .collect();
        drop(entries);

        let mut scored: Vec<SearchResult> = entries_vec
            .par_iter()
            .map(|(id, embedding, norm, importance, last_accessed)| {
                let cosine = cosine_similarity_normalized(
                    query_embedding,
                    query_norm,
                    embedding,
                    *norm,
                );
                let days_since = ((now - last_accessed) as f64 / 86400.0).max(0.0);
                let recency = 1.0 / (1.0 + days_since) as f32;
                let score = alpha * cosine + beta * recency + gamma * importance;

                SearchResult {
                    id: id.clone(),
                    score,
                    cosine_sim: cosine,
                }
            })
            .collect();

        scored
            .par_sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
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

    /// Persist to disk as JSON
    pub fn save_to_disk(&self) -> Result<(), String> {
        let entries = self.entries.lock().unwrap();
        let data: Vec<VectorEntry> = entries
            .iter()
            .map(|(id, e)| VectorEntry {
                id: id.clone(),
                embedding: e.embedding.clone(),
                importance: e.importance,
                last_accessed: e.last_accessed,
            })
            .collect();

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
                let norm = compute_norm(&entry.embedding);
                map.insert(
                    entry.id.clone(),
                    NormalizedEntry {
                        embedding: entry.embedding,
                        norm,
                        importance: entry.importance,
                        last_accessed: entry.last_accessed,
                    },
                );
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

fn compute_norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-8)
}

/// Cosine similarity using pre-computed norms — avoids recomputing norms per entry.
fn cosine_similarity_normalized(a: &[f32], norm_a: f32, b: &[f32], norm_b: f32) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    (dot / (norm_a * norm_b)).clamp(-1.0, 1.0)
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Embedding client ──

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

pub fn compress_memories(
    store: &VectorStore,
    similarity_threshold: f32,
    min_group_size: usize,
) -> Vec<Vec<String>> {
    let entries = store.entries.lock().unwrap();
    let entry_list: Vec<(&String, &NormalizedEntry)> = entries.iter().collect();

    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut used = vec![false; entry_list.len()];

    for i in 0..entry_list.len() {
        if used[i] {
            continue;
        }

        let mut group = vec![entry_list[i].0.clone()];
        used[i] = true;

        for j in (i + 1)..entry_list.len() {
            if used[j] {
                continue;
            }
            let sim = cosine_similarity_normalized(
                &entry_list[i].1.embedding,
                entry_list[i].1.norm,
                &entry_list[j].1.embedding,
                entry_list[j].1.norm,
            );
            if sim >= similarity_threshold {
                group.push(entry_list[j].0.clone());
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
        let norm_a = compute_norm(&a);
        let norm_b = compute_norm(&b);
        assert!((cosine_similarity_normalized(&a, norm_a, &b, norm_b) - 0.0).abs() < 0.01);

        let c = vec![1.0, 0.0, 0.0];
        let norm_c = compute_norm(&c);
        assert!((cosine_similarity_normalized(&a, norm_a, &c, norm_c) - 1.0).abs() < 0.01);
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
        // "b" wins because higher importance (0.8 vs 0.5) compensates for slightly lower cosine
        assert_eq!(results[0].id, "b");
    }

    #[test]
    fn test_compress_memories() {
        let dir = tempfile::tempdir().unwrap();
        let store = VectorStore::new(dir.path().join("vectors.json"), 3);

        store.upsert("a", &[1.0, 0.0, 0.0], 0.5).unwrap();
        store.upsert("b", &[0.95, 0.05, 0.0], 0.5).unwrap();
        store.upsert("c", &[0.0, 1.0, 0.0], 0.5).unwrap();

        let groups = compress_memories(&store, 0.9, 2);
        assert_eq!(groups.len(), 1);
        assert!(groups[0].contains(&"a".to_string()));
        assert!(groups[0].contains(&"b".to_string()));
    }

    #[test]
    fn test_vector_store_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vectors.json");

        {
            let store = VectorStore::new(path.clone(), 3);
            store.upsert("a", &[1.0, 0.0, 0.0], 0.5).unwrap();
            store.upsert("b", &[0.0, 1.0, 0.0], 0.8).unwrap();
            store.save_to_disk().unwrap();
        }

        let store2 = VectorStore::new(path, 3);
        assert_eq!(store2.len(), 2);
    }

    #[test]
    fn test_benchmark_10k_search() {
        let dir = tempfile::tempdir().unwrap();
        let store = VectorStore::new(dir.path().join("vectors.json"), 768);

        // Insert 10k random 768-dim vectors
        let mut rng_state: u64 = 42;
        for i in 0..10_000 {
            let embedding: Vec<f32> = (0..768)
                .map(|_| {
                    rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
                    (rng_state >> 33) as f32 / (u32::MAX as f32)
                })
                .collect();
            store
                .upsert(&format!("mem_{}", i), &embedding, 0.5)
                .unwrap();
        }

        let query: Vec<f32> = (0..768)
            .map(|_| {
                rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
                (rng_state >> 33) as f32 / (u32::MAX as f32)
            })
            .collect();

        let start = std::time::Instant::now();
        let results = store.search(&query, 10, 0.6, 0.25, 0.15);
        let elapsed = start.elapsed();

        assert_eq!(results.len(), 10);
        eprintln!(
            "[bench] 10k x 768d search: {:.1}ms",
            elapsed.as_secs_f64() * 1000.0
        );
    }
}
