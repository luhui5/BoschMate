//! SSH remote project connection using system `ssh` command (R4-2).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub key_path: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Build SSH base arguments for a connection.
fn ssh_base_args(conn: &SshConnection) -> Vec<String> {
    let mut args = vec![
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
        "-p".to_string(),
        conn.port.to_string(),
        format!("{}@{}", conn.user, conn.host),
    ];
    if let Some(ref key_path) = conn.key_path {
        args.insert(0, "-i".to_string());
        args.insert(1, key_path.clone());
    }
    args
}

/// Test SSH connectivity by running a simple echo command.
pub fn test_connection(conn: &SshConnection) -> Result<String, String> {
    let mut args = ssh_base_args(conn);
    args.push("echo".to_string());
    args.push("connected".to_string());

    let output = std::process::Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| format!("SSH command failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Execute a command on the remote host via SSH.
pub fn execute_remote(
    conn: &SshConnection,
    command: &str,
    timeout_secs: u64,
) -> Result<(String, String, i32), String> {
    let mut args = ssh_base_args(conn);
    args.push(command.to_string());

    let mut cmd = std::process::Command::new("ssh");
    cmd.args(&args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    crate::process_util::hide_console(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("SSH command failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok((stdout, stderr, exit_code))
}

/// List remote directory contents via SSH.
pub fn list_remote_dir(conn: &SshConnection, remote_path: &str) -> Result<Vec<SshFileEntry>, String> {
    let (stdout, stderr, exit_code) = execute_remote(
        conn,
        &format!("ls -la --time-style=long-iso {}", remote_path),
        10,
    )?;

    if exit_code != 0 {
        return Err(format!("ls failed (exit {}): {}", exit_code, stderr));
    }

    let mut entries = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 8 {
            continue;
        }
        let name = parts[7..].join(" ");
        if name == "." || name == ".." {
            continue;
        }
        let is_dir = parts[0].starts_with('d');
        let size: u64 = parts[4].parse().unwrap_or(0);

        let path = if remote_path.ends_with('/') {
            format!("{}{}", remote_path, name)
        } else {
            format!("{}/{}", remote_path, name)
        };

        entries.push(SshFileEntry {
            name: name.to_string(),
            path,
            is_dir,
            size,
        });
    }
    Ok(entries)
}

/// Read a remote file via SSH + cat.
pub fn read_remote_file(
    conn: &SshConnection,
    remote_path: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let (stdout, stderr, exit_code) = execute_remote(
        conn,
        &format!("cat {}", remote_path),
        10,
    )?;

    if exit_code != 0 {
        return Err(format!("cat failed (exit {}): {}", exit_code, stderr));
    }

    let limit = max_bytes.min(1024 * 1024);
    Ok(if stdout.len() > limit {
        let mut truncated = stdout[..limit].to_string();
        truncated.push_str("\n… (truncated)");
        truncated
    } else {
        stdout
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssh_connection_config() {
        let conn = SshConnection {
            host: "example.com".into(),
            user: "test".into(),
            port: 22,
            key_path: None,
            password: Some("secret".into()),
        };
        assert_eq!(conn.port, 22);
        assert!(conn.password.is_some());
    }

    #[test]
    fn test_ssh_base_args_with_key() {
        let conn = SshConnection {
            host: "server.com".into(),
            user: "admin".into(),
            port: 2222,
            key_path: Some("/home/user/.ssh/id_rsa".into()),
            password: None,
        };
        let args = ssh_base_args(&conn);
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"/home/user/.ssh/id_rsa".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"2222".to_string()));
    }
}
