#!/bin/sh
# Pre-commit hook (P8-10): run fast unit tests before commit.
set -e
cd "$(dirname "$0")/.."
echo "Running vitest..."
npx vitest --run
echo "Running cargo test (lib tests)..."
cd src-tauri && cargo test --lib 2>/dev/null || cargo test
echo "Pre-commit checks passed."
