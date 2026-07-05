//! Text chunking for knowledge base RAG.

const TARGET_CHARS: usize = 800;
const OVERLAP_CHARS: usize = 100;
const MIN_CHUNK_CHARS: usize = 50;

/// Split text into overlapping chunks for embedding.
pub fn chunk_text(text: &str) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }
    if normalized.chars().count() <= TARGET_CHARS {
        return vec![normalized.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    let char_indices: Vec<(usize, char)> = normalized.char_indices().collect();
    let total = char_indices.len();

    while start < total {
        let end_target = (start + TARGET_CHARS).min(total);
        let mut end = end_target;

        if end < total {
            if let Some(split) = find_split_point(&char_indices, start, end_target) {
                end = split;
            }
        }

        let byte_start = char_indices[start].0;
        let byte_end = if end >= total {
            normalized.len()
        } else {
            char_indices[end].0
        };
        let piece = normalized[byte_start..byte_end].trim();
        if piece.chars().count() >= MIN_CHUNK_CHARS || chunks.is_empty() {
            chunks.push(piece.to_string());
        }

        if end >= total {
            break;
        }

        let next_start = end.saturating_sub(overlap_char_count(&char_indices, end, OVERLAP_CHARS));
        if next_start <= start {
            start = end;
        } else {
            start = next_start;
        }
    }

    chunks
}

fn overlap_char_count(_char_indices: &[(usize, char)], _end: usize, overlap: usize) -> usize {
    overlap
}

fn find_split_point(char_indices: &[(usize, char)], start: usize, end_target: usize) -> Option<usize> {
    let window_start = start.saturating_add(TARGET_CHARS / 2);
    for i in (window_start..end_target).rev() {
        let ch = char_indices[i].1;
        if ch == '\n' {
            return Some(i + 1);
        }
    }
    for i in (window_start..end_target).rev() {
        if char_indices[i].1.is_whitespace() {
            return Some(i + 1);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_returns_empty() {
        assert!(chunk_text("").is_empty());
        assert!(chunk_text("   ").is_empty());
    }

    #[test]
    fn short_text_single_chunk() {
        let chunks = chunk_text("hello world");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "hello world");
    }

    #[test]
    fn long_text_multiple_chunks_with_overlap() {
        let para = "word ".repeat(200);
        let chunks = chunk_text(&para);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.chars().count() <= TARGET_CHARS + 50);
        }
    }

    #[test]
    fn prefers_paragraph_break() {
        let text = format!("{}\n\n{}", "a".repeat(500), "b".repeat(500));
        let chunks = chunk_text(&text);
        assert!(chunks.len() >= 2);
    }
}
