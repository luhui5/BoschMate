//! Read and send mail via Outlook desktop COM automation (Windows only).

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_COUNT: u32 = 25;
const DEFAULT_COUNT: u32 = 10;
const MAX_BODY_CHARS: usize = 8192;
const MAX_TOTAL_CHARS: usize = 102_400;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ReadParams {
    folder: String,
    filter: String,
    since: Option<String>,
    from: Option<String>,
    to: Option<String>,
    count: u32,
    include_body: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SendParams {
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body: String,
    draft: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct MailItem {
    subject: String,
    from: String,
    #[serde(default)]
    to: String,
    received: String,
    unread: bool,
    #[serde(default)]
    folder: String,
    #[serde(default)]
    body: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ReadResult {
    folder: String,
    filter: String,
    count: usize,
    messages: Vec<MailItem>,
}

#[cfg(not(target_os = "windows"))]
fn platform_error() -> String {
    "Outlook 邮件工具仅支持 Windows，且需要已安装并配置好的经典 Outlook 桌面客户端。".into()
}

/// Turn raw PowerShell/COM stderr into actionable guidance for the LLM and user.
fn format_com_error(detail: &str) -> String {
    let lower = detail.to_lowercase();
    let outlook_missing = detail.contains("80040154")
        || lower.contains("regdb_e_classnotreg")
        || lower.contains("nocomclassidentified");

    if outlook_missing {
        return "未检测到 Outlook 桌面客户端（Outlook.Application COM 未注册）。\n\n\
            outlook_read / outlook_send 需要 **经典 Outlook 桌面版**（不是网页版或「新版 Outlook」）。\n\
            - Office 家庭版 / 学生版通常 **不含** Outlook\n\
            - 请安装 Microsoft 365（含 Outlook）、Office 专业版或独立 Outlook 应用\n\
            - 安装后打开 Outlook、登录邮箱并至少启动一次，再重试"
            .into();
    }

    format!("Outlook COM error: {}", detail)
}

fn parse_read_args(args: &Value) -> Result<ReadParams, String> {
    let filter = args
        .get("filter")
        .and_then(|v| v.as_str())
        .unwrap_or("recent")
        .trim()
        .to_lowercase();
    if !matches!(
        filter.as_str(),
        "recent" | "today" | "unread" | "since"
    ) {
        return Err(format!(
            "Invalid filter: {} (use recent, today, unread, or since)",
            filter
        ));
    }

    let since = args
        .get("since")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if filter == "since" && since.is_none() {
        return Err("filter=since requires a since date (YYYY-MM-DD)".into());
    }

    let from = args
        .get("from")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let to = args
        .get("to")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let folder_explicit = args.get("folder").and_then(|v| v.as_str()).is_some();
    let folder = if folder_explicit {
        let f = args
            .get("folder")
            .and_then(|v| v.as_str())
            .unwrap_or("inbox")
            .trim()
            .to_lowercase();
        if !matches!(
            f.as_str(),
            "inbox" | "sent" | "drafts" | "deleted" | "all"
        ) {
            return Err(format!(
                "Invalid folder: {} (use inbox, sent, drafts, deleted, or all)",
                f
            ));
        }
        f
    } else if filter == "today" || from.is_some() || to.is_some() {
        "all".to_string()
    } else {
        "inbox".to_string()
    };

    let mut count = args
        .get("count")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_COUNT as u64) as u32;
    if count == 0 {
        count = DEFAULT_COUNT;
    }
    if count > MAX_COUNT {
        count = MAX_COUNT;
    }

    let include_body = args
        .get("include_body")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    Ok(ReadParams {
        folder,
        filter,
        since,
        from,
        to,
        count,
        include_body,
    })
}

fn parse_send_args(args: &Value) -> Result<SendParams, String> {
    let to = parse_email_list(args.get("to").ok_or("to required")?, "to")?;
    if to.is_empty() {
        return Err("to must contain at least one recipient".into());
    }

    let cc = args
        .get("cc")
        .map(|v| parse_email_list(v, "cc"))
        .transpose()?
        .unwrap_or_default();
    let bcc = args
        .get("bcc")
        .map(|v| parse_email_list(v, "bcc"))
        .transpose()?
        .unwrap_or_default();

    let subject = args
        .get("subject")
        .and_then(|v| v.as_str())
        .ok_or("subject required")?
        .trim()
        .to_string();
    if subject.is_empty() {
        return Err("subject required".into());
    }

    let body = args
        .get("body")
        .and_then(|v| v.as_str())
        .ok_or("body required")?
        .to_string();
    if body.trim().is_empty() {
        return Err("body required".into());
    }

    let draft = args
        .get("draft")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Ok(SendParams {
        to,
        cc,
        bcc,
        subject,
        body,
        draft,
    })
}

fn parse_email_list(value: &Value, field: &str) -> Result<Vec<String>, String> {
    let raw: Vec<String> = match value {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        Value::String(s) => s
            .split([',', ';'])
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect(),
        _ => return Err(format!("{} must be a string or array of strings", field)),
    };

    for email in &raw {
        validate_email(email)?;
    }
    Ok(raw)
}

pub fn validate_email(email: &str) -> Result<(), String> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        return Err("email address cannot be empty".into());
    }
    let Some((local, domain)) = trimmed.split_once('@') else {
        return Err(format!("Invalid email address: {}", trimmed));
    };
    if local.is_empty() || domain.is_empty() || !domain.contains('.') {
        return Err(format!("Invalid email address: {}", trimmed));
    }
    Ok(())
}

fn truncate_body(body: &str) -> String {
    if body.chars().count() <= MAX_BODY_CHARS {
        return body.to_string();
    }
    let truncated: String = body.chars().take(MAX_BODY_CHARS).collect();
    format!("{truncated}\n\n_(body truncated at {MAX_BODY_CHARS} chars)_")
}

fn format_read_result(result: ReadResult, include_body: bool) -> String {
    let mut out = format!(
        "# Outlook — {} (filter: {})\n\nFound {} message(s)\n\n",
        result.folder, result.filter, result.count
    );

    for (i, msg) in result.messages.iter().enumerate() {
        let unread = if msg.unread { " [unread]" } else { "" };
        out.push_str(&format!(
            "## {}. {}{}\n- **From:** {}\n- **Received:** {}\n",
            i + 1,
            msg.subject,
            unread,
            msg.from,
            msg.received
        ));
        if !msg.to.is_empty() {
            out.push_str(&format!("- **To:** {}\n", msg.to));
        }
        if !msg.folder.is_empty() {
            out.push_str(&format!("- **Folder:** {}\n", msg.folder));
        }
        if include_body && !msg.body.is_empty() {
            out.push_str("\n");
            out.push_str(&msg.body);
            out.push('\n');
        }
        out.push('\n');
        if out.len() >= MAX_TOTAL_CHARS {
            out.push_str("\n_(Output truncated at size limit.)_\n");
            break;
        }
    }

    if out.len() > MAX_TOTAL_CHARS {
        out.truncate(MAX_TOTAL_CHARS);
        out.push_str("\n\n_(Output truncated at size limit.)_");
    }
    out
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str, params_json: &str) -> Result<String, String> {
    let output = crate::process_util::command("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("BOSCH_OUTLOOK_PARAMS", params_json)
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit code {}", output.status)
        };
        return Err(format_com_error(&detail));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
const READ_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$params = $env:BOSCH_OUTLOOK_PARAMS | ConvertFrom-Json
$folderName = $params.folder
$filterName = $params.filter
$count = [int]$params.count
$includeBody = [bool]$params.include_body
$since = $params.since
$fromFilter = $params.from
$toFilter = $params.to

function Get-Sender($item) {
  $sender = ''
  try { $sender = $item.SenderEmailAddress } catch { }
  if (-not $sender) {
    try { $sender = $item.SenderName } catch { $sender = '' }
  }
  return [string]$sender
}

function Get-Recipients($item) {
  $r = ''
  try { $r = [string]$item.To } catch { }
  try {
    $cc = $item.CC
    if ($cc) {
      if ($r) { $r += ';' + [string]$cc } else { $r = [string]$cc }
    }
  } catch { }
  return [string]$r
}

function Test-PersonFilters($sender, $recipients) {
  if ($fromFilter -and $sender -notlike "*$fromFilter*") { return $false }
  if ($toFilter -and $recipients -notlike "*$toFilter*") { return $false }
  return $true
}

function Get-MailFields($item, $folderPath) {
  if ($item.Class -ne 43) { return $null }
  $sender = Get-Sender $item
  $recipients = Get-Recipients $item
  if (-not (Test-PersonFilters $sender $recipients)) { return $null }
  $received = ''
  try { $received = $item.ReceivedTime.ToString('o') } catch { }
  $body = ''
  if ($includeBody) {
    try { $body = $item.Body } catch { $body = '' }
  }
  $unread = $false
  try { $unread = [bool]$item.Unread } catch { }
  return [PSCustomObject]@{
    subject = [string]$item.Subject
    from = [string]$sender
    to = [string]$recipients
    received = [string]$received
    unread = $unread
    body = [string]$body
    folder = [string]$folderPath
  }
}

function Build-Restrict($filterName, $sinceVal) {
  if ($filterName -eq 'today') {
    $start = (Get-Date).Date
    return "[ReceivedTime] >= '" + $start.ToString('M/d/yyyy h:mm tt') + "'"
  } elseif ($filterName -eq 'unread') {
    return '[Unread] = true'
  } elseif ($filterName -eq 'since' -and $sinceVal) {
    $dt = [DateTime]::Parse($sinceVal)
    return "[ReceivedTime] >= '" + $dt.ToString('M/d/yyyy h:mm tt') + "'"
  }
  return $null
}

$ol = New-Object -ComObject Outlook.Application
$ns = $ol.GetNamespace('MAPI')
$restrict = Build-Restrict $filterName $since

if ($folderName -eq 'all') {
  $maxFolders = 200
  $script:folderCount = 0
  $script:allFolders = @()

  function Collect-Folders($folders) {
    foreach ($f in $folders) {
      if ($script:folderCount -ge $maxFolders) { return }
      $script:allFolders += $f
      $script:folderCount++
      if ($f.Folders.Count -gt 0) {
        Collect-Folders $f.Folders
      }
    }
  }

  foreach ($store in $ns.Folders) {
    if ($script:folderCount -ge $maxFolders) { break }
    Collect-Folders $store.Folders
  }

  $collected = @()
  foreach ($f in $script:allFolders) {
    $folderPath = ''
    try { $folderPath = $f.FolderPath } catch { try { $folderPath = $f.Name } catch { $folderPath = '' } }
    $items = $f.Items
    try { $items.Sort('[ReceivedTime]', $true) } catch { }
    if ($restrict) {
      try { $items = $items.Restrict($restrict) } catch { }
    }
    $scanned = 0
    foreach ($item in $items) {
      if ($filterName -eq 'recent' -and $scanned -ge $count) { break }
      $scanned++
      $row = Get-MailFields $item $folderPath
      if ($row) { $collected += $row }
    }
  }

  $results = @($collected | Sort-Object { try { [DateTime]$_.received } catch { [DateTime]::MinValue } } -Descending | Select-Object -First $count)
} else {
  $folderIds = @{
    inbox = 6
    sent = 5
    drafts = 16
    deleted = 3
  }
  $folderId = $folderIds[$folderName]
  if (-not $folderId) { throw "Unknown folder: $folderName" }

  $folder = $ns.GetDefaultFolder($folderId)
  $folderPath = ''
  try { $folderPath = $folder.FolderPath } catch { $folderPath = $folderName }
  $items = $folder.Items
  $items.Sort('[ReceivedTime]', $true)

  if ($restrict) {
    try { $items = $items.Restrict($restrict) } catch { }
  }

  $results = @()
  foreach ($item in $items) {
    $row = Get-MailFields $item $folderPath
    if ($row) {
      $results += $row
      if ($results.Count -ge $count) { break }
    }
  }
}

[PSCustomObject]@{
  folder = $folderName
  filter = $filterName
  count = @($results).Count
  messages = @($results)
} | ConvertTo-Json -Compress -Depth 5
"#;

#[cfg(target_os = "windows")]
const SEND_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$params = $env:BOSCH_OUTLOOK_PARAMS | ConvertFrom-Json

$ol = New-Object -ComObject Outlook.Application
$mail = $ol.CreateItem(0)
$mail.To = ($params.to -join '; ')
if ($params.cc -and $params.cc.Count -gt 0) { $mail.CC = ($params.cc -join '; ') }
if ($params.bcc -and $params.bcc.Count -gt 0) { $mail.BCC = ($params.bcc -join '; ') }
$mail.Subject = [string]$params.subject
$mail.Body = [string]$params.body

if ($params.draft) {
  $mail.Save()
  [PSCustomObject]@{ status = 'draft'; subject = $mail.Subject; to = $mail.To } | ConvertTo-Json -Compress
} else {
  $mail.Send()
  [PSCustomObject]@{ status = 'sent'; subject = $mail.Subject; to = $mail.To } | ConvertTo-Json -Compress
}
"#;

#[cfg(target_os = "windows")]
pub fn read_mail(args: &Value) -> Result<String, String> {
    let params = parse_read_args(args)?;
    let include_body = params.include_body;
    let json = serde_json::to_string(&params).map_err(|e| e.to_string())?;
    let stdout = run_powershell(READ_SCRIPT, &json)?;

    let mut result: ReadResult =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse Outlook output: {}", e))?;

    if include_body {
        for msg in &mut result.messages {
            msg.body = truncate_body(&msg.body);
        }
    } else {
        for msg in &mut result.messages {
            msg.body.clear();
        }
    }

    Ok(format_read_result(result, include_body))
}

#[cfg(not(target_os = "windows"))]
pub fn read_mail(_args: &Value) -> Result<String, String> {
    Err(platform_error())
}

#[cfg(target_os = "windows")]
pub fn send_mail(args: &Value) -> Result<String, String> {
    let params = parse_send_args(args)?;
    let json = serde_json::to_string(&params).map_err(|e| e.to_string())?;
    let stdout = run_powershell(SEND_SCRIPT, &json)?;

    #[derive(Deserialize)]
    struct SendResult {
        status: String,
        subject: String,
        to: String,
    }

    let result: SendResult =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse Outlook output: {}", e))?;

    if result.status == "draft" {
        Ok(format!(
            "Saved draft in Outlook.\n\n- **To:** {}\n- **Subject:** {}",
            result.to, result.subject
        ))
    } else {
        Ok(format!(
            "Email sent via Outlook.\n\n- **To:** {}\n- **Subject:** {}",
            result.to, result.subject
        ))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn send_mail(_args: &Value) -> Result<String, String> {
    Err(platform_error())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_read_defaults() {
        let p = parse_read_args(&json!({})).unwrap();
        assert_eq!(p.folder, "inbox");
        assert_eq!(p.filter, "recent");
        assert_eq!(p.count, DEFAULT_COUNT);
        assert!(p.include_body);
    }

    #[test]
    fn parse_read_today_defaults_to_all() {
        let p = parse_read_args(&json!({ "filter": "today" })).unwrap();
        assert_eq!(p.folder, "all");
        assert_eq!(p.filter, "today");
    }

    #[test]
    fn parse_read_from_defaults_to_all() {
        let p = parse_read_args(&json!({ "from": "zhang" })).unwrap();
        assert_eq!(p.folder, "all");
        assert_eq!(p.from.as_deref(), Some("zhang"));
    }

    #[test]
    fn parse_read_to_defaults_to_all() {
        let p = parse_read_args(&json!({ "to": "lisi" })).unwrap();
        assert_eq!(p.folder, "all");
        assert_eq!(p.to.as_deref(), Some("lisi"));
    }

    #[test]
    fn parse_read_explicit_inbox_overrides() {
        let p = parse_read_args(&json!({ "from": "x", "folder": "inbox" })).unwrap();
        assert_eq!(p.folder, "inbox");
    }

    #[test]
    fn parse_read_today_explicit_inbox() {
        let p = parse_read_args(&json!({ "filter": "today", "folder": "inbox" })).unwrap();
        assert_eq!(p.folder, "inbox");
    }

    #[test]
    fn parse_read_accepts_all() {
        let p = parse_read_args(&json!({ "folder": "all" })).unwrap();
        assert_eq!(p.folder, "all");
    }

    #[test]
    fn parse_read_accepts_to() {
        let p = parse_read_args(&json!({ "to": "a@b.com", "folder": "sent" })).unwrap();
        assert_eq!(p.to.as_deref(), Some("a@b.com"));
        assert_eq!(p.folder, "sent");
    }

    #[test]
    fn format_read_result_includes_folder_and_to() {
        let result = ReadResult {
            folder: "all".into(),
            filter: "today".into(),
            count: 1,
            messages: vec![MailItem {
                subject: "Hello".into(),
                from: "a@b.com".into(),
                to: "c@d.com".into(),
                received: "2026-01-01".into(),
                unread: false,
                folder: "\\\\mailbox\\Inbox\\Digi colleague".into(),
                body: String::new(),
            }],
        };
        let out = format_read_result(result, false);
        assert!(out.contains("**To:** c@d.com"));
        assert!(out.contains("**Folder:**"));
        assert!(out.contains("Digi colleague"));
    }

    #[test]
    fn parse_read_caps_count() {
        let p = parse_read_args(&json!({ "count": 100 })).unwrap();
        assert_eq!(p.count, MAX_COUNT);
    }

    #[test]
    fn parse_read_since_requires_date() {
        assert!(parse_read_args(&json!({ "filter": "since" })).is_err());
    }

    #[test]
    fn parse_send_requires_to() {
        assert!(parse_send_args(&json!({ "subject": "Hi", "body": "Hello" })).is_err());
    }

    #[test]
    fn parse_send_accepts_string_to() {
        let p = parse_send_args(&json!({
            "to": "a@example.com",
            "subject": "Hi",
            "body": "Hello"
        }))
        .unwrap();
        assert_eq!(p.to, vec!["a@example.com".to_string()]);
    }

    #[test]
    fn validate_email_rejects_bad() {
        assert!(validate_email("not-an-email").is_err());
        assert!(validate_email("a@b.com").is_ok());
    }

    #[test]
    fn format_com_error_detects_missing_outlook() {
        let raw = "80040154 REGDB_E_CLASSNOTREG NoCOMClassIdentified";
        let msg = format_com_error(raw);
        assert!(msg.contains("未检测到 Outlook 桌面客户端"));
        assert!(msg.contains("Office 家庭版"));
        assert!(!msg.starts_with("Outlook COM error:"));
    }

    #[test]
    fn format_com_error_passes_through_other_errors() {
        let msg = format_com_error("MAPI profile not configured");
        assert!(msg.starts_with("Outlook COM error:"));
    }

    #[test]
    fn format_read_truncates_total() {
        let result = ReadResult {
            folder: "inbox".into(),
            filter: "recent".into(),
            count: 1,
            messages: vec![MailItem {
                subject: "Test".into(),
                from: "a@b.com".into(),
                to: String::new(),
                received: "2026-01-01".into(),
                unread: false,
                folder: String::new(),
                body: "x".repeat(MAX_TOTAL_CHARS + 1000),
            }],
        };
        let out = format_read_result(result, true);
        assert!(out.len() <= MAX_TOTAL_CHARS + 64);
    }
}
