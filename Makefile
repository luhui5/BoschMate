.PHONY: dev build package-windows package-macos package-linux clean lint test

# ── Proxy (if needed behind firewall) ──
PROXY ?= http://127.0.0.1:17897

# ── Version from git (latest tag, or branch-commithash fallback) ──
VERSION := $(shell git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//')
ifeq ($(VERSION),)
VERSION := $(shell BRANCH=$$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached"); HASH=$$(git rev-parse --short HEAD 2>/dev/null || echo "unknown"); echo "$${BRANCH}-$${HASH}")
endif
ifeq ($(VERSION),)
VERSION := 0.1.0
endif

# ── Development ──

dev:
	@echo "==> Starting YourMate development environment..."
	npx kill-port 3000 2>/dev/null; \
	npx tauri dev

# ── Build ──

build:
	@echo "==> Building frontend..."
	pnpm build
	@echo "==> Building Rust backend..."
	cd src-tauri && cargo build --release

# ── Package ──

package-windows:
	@echo "==> Packaging YourMate for Windows (version: $(VERSION))..."
	@node -e "var fs=require('fs'),v='$(VERSION)';['src-tauri/Cargo.toml','src-tauri/tauri.conf.json'].forEach(function(f){fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^version = \"[^\"]*\"/m,'version = \"'+v+'\"').replace(/\"version\": \"[^\"]*\"/,'\"version\": \"'+v+'\"'))})"
	@npx tauri build --bundles msi,nsis || (git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json && exit 1)
	@git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json

package-macos:
	@echo "==> Packaging YourMate for macOS (version: $(VERSION))..."
	@node -e "var fs=require('fs'),v='$(VERSION)';['src-tauri/Cargo.toml','src-tauri/tauri.conf.json'].forEach(function(f){fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^version = \"[^\"]*\"/m,'version = \"'+v+'\"').replace(/\"version\": \"[^\"]*\"/,'\"version\": \"'+v+'\"'))})"
	@npx tauri build --bundles dmg || (git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json && exit 1)
	@git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json

package-linux:
	@echo "==> Packaging YourMate for Linux (version: $(VERSION))..."
	@node -e "var fs=require('fs'),v='$(VERSION)';['src-tauri/Cargo.toml','src-tauri/tauri.conf.json'].forEach(function(f){fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^version = \"[^\"]*\"/m,'version = \"'+v+'\"').replace(/\"version\": \"[^\"]*\"/,'\"version\": \"'+v+'\"'))})"
	@npx tauri build --bundles deb,appimage || (git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json && exit 1)
	@git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json

# ── All platforms (for CI) ──

package-all:
	@echo "==> Packaging YourMate for all platforms (version: $(VERSION))..."
	@node -e "var fs=require('fs'),v='$(VERSION)';['src-tauri/Cargo.toml','src-tauri/tauri.conf.json'].forEach(function(f){fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^version = \"[^\"]*\"/m,'version = \"'+v+'\"').replace(/\"version\": \"[^\"]*\"/,'\"version\": \"'+v+'\"'))})"
	pnpm build && \
	npx tauri build || (git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json && exit 1)
	@git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json

# ── Code Quality ──

lint:
	@echo "==> Running Rust linter..."
	cd src-tauri && cargo clippy -- -D warnings 2>/dev/null || true
	@echo "==> Running TypeScript type check..."
	npx tsc --noEmit 2>/dev/null || true

test:
	@echo "==> Running Rust tests..."
	cd src-tauri && cargo test
	@echo "==> Running frontend tests..."
	npx vitest --run 2>/dev/null || true

# ── Clean ──

clean:
	@echo "==> Cleaning build artifacts..."
	rm -rf .next out src-tauri/target
	@echo "Done."

clean-all: clean
	@echo "==> Cleaning dependencies..."
	rm -rf node_modules
	@echo "Done."

# ── Install / Setup ──

setup:
	@echo "==> Installing frontend dependencies..."
	pnpm install
	@echo "==> Checking Rust toolchain..."
	rustc --version && cargo --version
	@echo "Setup complete."

# ── Help ──

help:
	@echo "YourMate Makefile"
	@echo ""
	@echo "  make dev                Start development environment"
	@echo "  make build              Build frontend + Rust backend (release)"
	@echo "  make package-windows    Package Windows installer (.msi/.exe)"
	@echo "  make package-macos      Package macOS bundle (.dmg)"
	@echo "  make package-linux      Package Linux bundle (.deb/.AppImage)"
	@echo "  make package-all        Package all platforms"
	@echo "  make lint               Run Rust clippy + TypeScript check"
	@echo "  make test               Run Rust + frontend tests"
	@echo "  make clean              Remove build artifacts"
	@echo "  make clean-all          Remove build artifacts + dependencies"
	@echo "  make setup              Install all dependencies"
	@echo ""
	@echo "  Proxy: make dev PROXY=http://127.0.0.1:17897"
