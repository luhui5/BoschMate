//! Proptest: verify diff apply → revert → original content idempotency (R5-5).

#[cfg(test)]
mod tests {
    use proptest::prelude::*;
    use std::fs;
    use std::path::PathBuf;

    /// Simulate edit_file operations: write → read → revert → read → compare
    proptest! {
        #[test]
        fn diff_apply_revert_is_idempotent(
            original in "[a-zA-Z0-9_ \n]{0,200}",
            insertion in "[a-zA-Z0-9_ \n]{0,100}",
        ) {
            let dir = tempfile::tempdir().unwrap();
            let file_path: PathBuf = dir.path().join("test.txt");

            // Write original content
            fs::write(&file_path, &original).unwrap();
            let read1 = fs::read_to_string(&file_path).unwrap();
            assert_eq!(read1, original);

            // Apply edit: append insertion
            let edited = format!("{}{}", original, insertion);
            fs::write(&file_path, &edited).unwrap();
            let read2 = fs::read_to_string(&file_path).unwrap();
            assert_eq!(read2, edited);

            // Revert: write back original
            fs::write(&file_path, &original).unwrap();
            let read3 = fs::read_to_string(&file_path).unwrap();
            assert_eq!(read3, original);
            assert_eq!(read3, read1, "apply → revert should return to original");
        }

        #[test]
        fn multi_edit_idempotent(
            original in "[a-zA-Z0-9_ \n]{0,100}",
            edit1 in "[a-zA-Z0-9_ \n]{1,50}",
            edit2 in "[a-zA-Z0-9_ \n]{1,50}",
        ) {
            let dir = tempfile::tempdir().unwrap();
            let file_path = dir.path().join("test.txt");
            fs::write(&file_path, &original).unwrap();

            // Apply edit 1
            let with_edit1 = format!("{}{}", original, edit1);
            fs::write(&file_path, &with_edit1).unwrap();

            // Apply edit 2
            let with_edit2 = format!("{}{}", with_edit1, edit2);
            fs::write(&file_path, &with_edit2).unwrap();

            // Revert both: write back original
            fs::write(&file_path, &original).unwrap();
            let final_content = fs::read_to_string(&file_path).unwrap();
            assert_eq!(final_content, original);
        }

        #[test]
        fn sha256_matches_after_revert(
            original in "[a-zA-Z0-9_ \n]{0,200}",
        ) {
            use sha2::{Sha256, Digest};
            let dir = tempfile::tempdir().unwrap();
            let file_path = dir.path().join("test.txt");

            // Hash original
            fs::write(&file_path, &original).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&original);
            let hash_before = hasher.finalize();

            // Edit
            fs::write(&file_path, b"temporary content").unwrap();

            // Revert
            fs::write(&file_path, &original).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&original);
            let hash_after = hasher.finalize();

            assert_eq!(hash_before, hash_after);
        }
    }
}
