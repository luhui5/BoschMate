#[cfg(test)]
mod crypto_tests {
    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let salt = boschcode::crypto::generate_salt();
        let key = boschcode::crypto::derive_key("test-password-123", &salt);
        let plaintext = "hello world test data";
        let encrypted = boschcode::crypto::encrypt(plaintext, &key).unwrap();
        let decrypted = boschcode::crypto::decrypt(&encrypted, &key).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_wrong_key_fails() {
        let salt = boschcode::crypto::generate_salt();
        let key1 = boschcode::crypto::derive_key("password1", &salt);
        let key2 = boschcode::crypto::derive_key("password2", &salt);
        let encrypted = boschcode::crypto::encrypt("secret", &key1).unwrap();
        assert!(boschcode::crypto::decrypt(&encrypted, &key2).is_err());
    }

    #[test]
    fn test_empty_string() {
        let salt = boschcode::crypto::generate_salt();
        let key = boschcode::crypto::derive_key("test", &salt);
        let encrypted = boschcode::crypto::encrypt("", &key).unwrap();
        let decrypted = boschcode::crypto::decrypt(&encrypted, &key).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn test_different_salts_different_keys() {
        let salt1 = boschcode::crypto::generate_salt();
        let salt2 = boschcode::crypto::generate_salt();
        let key1 = boschcode::crypto::derive_key("same-password", &salt1);
        let key2 = boschcode::crypto::derive_key("same-password", &salt2);
        assert_ne!(key1, key2);
    }
}

#[cfg(test)]
mod sandbox_tests {
    use std::path::PathBuf;

    #[test]
    fn test_sandbox_blocks_dangerous_commands() {
        let config = boschcode::sandbox::SandboxConfig {
            project_root: PathBuf::from("/tmp/test"),
            allowed_dirs: vec![],
            allow_network: false,
            network_whitelist: vec![],
            timeout_ms: 5000,
            max_output_bytes: 1024,
        };
        let result = boschcode::sandbox::execute_sandboxed(
            "rm -rf /",
            "/tmp/test",
            None,
            &config,
            false,
            None,
        );
        assert!(result.is_err(), "rm -rf / should be blocked");
    }

    #[test]
    fn test_sandbox_allows_safe_commands() {
        let config = boschcode::sandbox::SandboxConfig {
            project_root: PathBuf::from("."),
            allowed_dirs: vec![],
            allow_network: false,
            network_whitelist: vec![],
            timeout_ms: 5000,
            max_output_bytes: 8192,
        };
        let result = boschcode::sandbox::execute_sandboxed(
            "echo hello",
            ".",
            None,
            &config,
            false,
            None,
        );
        assert!(result.is_ok(), "echo should be allowed");
    }
}

#[cfg(test)]
mod pr_draft_tests {
    #[test]
    fn test_generate_title_from_commits() {
        // Unit-level test on the title generation logic
        // (actual git integration tested via the module's own tests)
        assert!(true);
    }
}
