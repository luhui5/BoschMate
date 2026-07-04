//! Fetch public HTTPS URLs and convert HTML to Markdown for the AI loop.

use htmd::HtmlToMarkdown;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

struct CacheEntry {
    body: String,
    fetched_at: Instant,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_cache(key: &str) -> Option<String> {
    let guard = cache().lock().ok()?;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() > CACHE_TTL {
        return None;
    }
    Some(entry.body.clone())
}

fn write_cache(key: String, body: String) {
    if let Ok(mut guard) = cache().lock() {
        guard.insert(key, CacheEntry {
            body,
            fetched_at: Instant::now(),
        });
    }
}

/// Normalize URL: require http(s), upgrade http → https.
pub fn normalize_fetch_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("url required".into());
    }
    let mut parsed = url::Url::parse(trimmed).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" => {
            parsed
                .set_scheme("https")
                .map_err(|_| "Failed to upgrade HTTP to HTTPS".to_string())?;
        }
        "https" => {}
        other => return Err(format!("Unsupported URL scheme: {} (only http/https)", other)),
    }
    if parsed.host_str().is_none() {
        return Err("URL must include a host".into());
    }
    validate_host_not_private(parsed.host_str().unwrap())?;
    Ok(parsed.to_string())
}

fn validate_host_not_private(host: &str) -> Result<(), String> {
    let lower = host.to_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Err("Fetching localhost URLs is not allowed".into());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("Fetching private or local network URLs is not allowed".into());
        }
        return Ok(());
    }

    if lower == "127.0.0.1" || lower == "::1" || lower == "0.0.0.0" {
        return Err("Fetching local network URLs is not allowed".into());
    }

    Ok(())
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_ipv4(v4) || v4.is_loopback() || v4.is_unspecified() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || is_unique_local_ipv6(v6),
    }
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_loopback() || ip.is_link_local()
}

fn is_unique_local_ipv6(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

fn extract_title(html: &str) -> String {
    let lower = html.to_lowercase();
    if let Some(start) = lower.find("<title") {
        if let Some(gt) = lower[start..].find('>') {
            let content_start = start + gt + 1;
            if let Some(end) = lower[content_start..].find("</title>") {
                let title = html[content_start..content_start + end]
                    .trim()
                    .replace('\n', " ")
                    .replace('\r', " ");
                if !title.is_empty() {
                    return title;
                }
            }
        }
    }
    "Untitled".to_string()
}

fn html_to_markdown(html: &str) -> String {
    let converter = HtmlToMarkdown::builder()
        .skip_tags(vec!["script", "style", "noscript"])
        .build();
    converter
        .convert(html)
        .unwrap_or_else(|_| String::new())
        .trim()
        .to_string()
}

fn fetch_http(url: &str) -> Result<(String, String, bool), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .map_err(|e| format!("Fetch failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }

    let final_url = resp.url().to_string();
    if let Some(host) = resp.url().host_str() {
        validate_host_not_private(host)?;
    }

    let bytes = resp
        .bytes()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let truncated = bytes.len() > MAX_BODY_BYTES;
    let slice = if truncated {
        &bytes[..MAX_BODY_BYTES]
    } else {
        &bytes
    };

    let html = String::from_utf8_lossy(slice).into_owned();
    Ok((html, final_url, truncated))
}

fn format_result(title: &str, url: &str, markdown: &str, prompt: Option<&str>, truncated: bool) -> String {
    let mut out = format!("# {}\n\nSource: {}\n\n{}", title, url, markdown);
    if truncated {
        out.push_str("\n\n_(Response truncated at 2MB limit.)_");
    }
    if let Some(p) = prompt.filter(|s| !s.trim().is_empty()) {
        out.push_str("\n\n---\nFocus hint: ");
        out.push_str(p.trim());
    }
    out
}

/// Fetch a URL and return Markdown content for the AI tool result.
pub fn fetch_url(raw_url: &str, prompt: Option<&str>) -> Result<String, String> {
    let url = normalize_fetch_url(raw_url)?;

    if let Some(cached) = read_cache(&url) {
        return Ok(format!("{cached}\n\n_(Cached result, fetched within last 15 minutes.)_"));
    }

    let (html, final_url, truncated) = fetch_http(&url)?;
    let title = extract_title(&html);
    let mut markdown = html_to_markdown(&html);
    if markdown.is_empty() {
        markdown = "(No readable text content)".to_string();
    }

    let result = format_result(&title, &final_url, &markdown, prompt, truncated);
    write_cache(url, result.clone());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_upgrades_http_to_https() {
        let u = normalize_fetch_url("http://example.com/page").unwrap();
        assert_eq!(u, "https://example.com/page");
    }

    #[test]
    fn normalize_rejects_localhost() {
        assert!(normalize_fetch_url("http://127.0.0.1/").is_err());
        assert!(normalize_fetch_url("https://localhost/").is_err());
    }

    #[test]
    fn normalize_rejects_private_ip() {
        assert!(normalize_fetch_url("http://192.168.1.1/").is_err());
        assert!(normalize_fetch_url("http://10.0.0.1/").is_err());
    }

    #[test]
    fn normalize_rejects_bad_scheme() {
        assert!(normalize_fetch_url("file:///etc/passwd").is_err());
        assert!(normalize_fetch_url("ftp://example.com").is_err());
    }

    #[test]
    fn extract_title_from_html() {
        let html = "<html><head><title>Hello World</title></head><body></body></html>";
        assert_eq!(extract_title(html), "Hello World");
    }
}
