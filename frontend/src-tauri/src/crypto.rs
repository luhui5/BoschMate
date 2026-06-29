use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use sha2::Digest;

/// Encrypt plaintext with AES-256-GCM.
/// Returns base64(ciphertext + nonce), where nonce is 96 bits (12 bytes).
pub fn encrypt(plaintext: &str, key_bytes: &[u8; 32]) -> Result<String, String> {
    let rng = SystemRandom::new();
    let unbound_key =
        UnboundKey::new(&AES_256_GCM, key_bytes).map_err(|e| format!("Key error: {:?}", e))?;
    let key = LessSafeKey::new(unbound_key);

    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes)
        .map_err(|e| format!("RNG error: {:?}", e))?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plaintext.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| format!("Encryption error: {:?}", e))?;

    // Prepend nonce to ciphertext for storage
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&in_out);

    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result))
}

/// Decrypt base64-encoded ciphertext produced by encrypt().
pub fn decrypt(encoded: &str, key_bytes: &[u8; 32]) -> Result<String, String> {
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    if data.len() < 12 {
        return Err("Ciphertext too short".into());
    }

    let nonce_bytes: [u8; 12] = data[..12].try_into().map_err(|_| "Nonce error".to_string())?;
    let ciphertext = &data[12..];

    let unbound_key =
        UnboundKey::new(&AES_256_GCM, key_bytes).map_err(|e| format!("Key error: {:?}", e))?;
    let key = LessSafeKey::new(unbound_key);
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| format!("Decryption error: {:?}", e))?;

    Ok(String::from_utf8_lossy(plaintext).to_string())
}

/// Derive a 256-bit key from a user passphrase using Argon2-style derivation.
/// For MVP, uses SHA-256 with a salt. Full Argon2id should replace this.
pub fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut hasher = sha2::Sha256::new();
    hasher.update(passphrase.as_bytes());
    hasher.update(salt);
    // Multiple rounds to slow down brute force
    let mut hash = hasher.finalize();
    for _ in 0..100_000 {
        let mut h = sha2::Sha256::new();
        h.update(&hash);
        h.update(salt);
        hash = h.finalize();
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

/// Generate a random salt
pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    SystemRandom::new().fill(&mut salt).ok();
    salt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let passphrase = "test-password-123";
        let salt = generate_salt();
        let key = derive_key(passphrase, &salt);

        let plaintext = "This is a secret memory about the codebase.";
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_wrong_key_fails() {
        let salt = generate_salt();
        let key1 = derive_key("password1", &salt);
        let key2 = derive_key("password2", &salt);

        let encrypted = encrypt("secret", &key1).unwrap();
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
    }
}
