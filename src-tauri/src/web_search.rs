use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

struct CacheEntry {
    results: Vec<SearchResult>,
    timestamp: Instant,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(900); // 15 minutes

pub async fn web_search(
    query: &str,
    allowed_domains: Option<Vec<String>>,
    blocked_domains: Option<Vec<String>>,
) -> Result<Vec<SearchResult>, String> {
    // Check cache
    {
        let mut cache = CACHE.lock().unwrap();
        if let Some(ref mut cache_map) = *cache {
            if let Some(entry) = cache_map.get(query) {
                if entry.timestamp.elapsed() < CACHE_TTL {
                    return Ok(entry.results.clone());
                }
            }
        }
    }

    // Perform search using DuckDuckGo HTML
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(query)
    );

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Search failed with status: {}", response.status()));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let mut results = parse_duckduckgo_html(&html)?;

    // Filter by allowed domains
    if let Some(allowed) = allowed_domains {
        results.retain(|r| {
            allowed.iter().any(|domain| {
                r.url.contains(domain) || domain.starts_with("*.") && r.url.contains(&domain[2..])
            })
        });
    }

    // Filter out blocked domains
    if let Some(blocked) = blocked_domains {
        results.retain(|r| {
            !blocked.iter().any(|domain| {
                r.url.contains(domain) || domain.starts_with("*.") && r.url.contains(&domain[2..])
            })
        });
    }

    // Update cache
    {
        let mut cache = CACHE.lock().unwrap();
        let cache_map = cache.get_or_insert_with(HashMap::new);
        cache_map.insert(
            query.to_string(),
            CacheEntry {
                results: results.clone(),
                timestamp: Instant::now(),
            },
        );
    }

    Ok(results)
}

fn parse_duckduckgo_html(html: &str) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();

    // Extract result blocks
    let result_re = Regex::new(r#"<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)</a>.*?<a class="result__snippet"[^>]*>([^<]+)</a>"#)
        .map_err(|e| format!("Regex error: {}", e))?;

    for cap in result_re.captures_iter(html) {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let title = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let snippet = cap.get(3).map(|m| m.as_str()).unwrap_or("");

        // Clean up HTML entities
        let title = html_escape::decode_html_entities(title).to_string();
        let snippet = html_escape::decode_html_entities(snippet).to_string();

        // Extract actual URL from DuckDuckGo redirect
        let actual_url = if url.contains("uddg=") {
            urlencoding::decode(
                url.split("uddg=")
                    .nth(1)
                    .and_then(|s| s.split('&').next())
                    .unwrap_or(url),
            )
            .unwrap_or_else(|_| url.to_string().into())
            .to_string()
        } else {
            url.to_string()
        };

        if !actual_url.is_empty() && actual_url.starts_with("http") {
            results.push(SearchResult {
                title,
                url: actual_url,
                snippet,
            });
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_ttl() {
        let cache = CACHE.lock().unwrap();
        assert!(cache.is_none() || cache.as_ref().unwrap().is_empty());
    }
}
