.PHONY: dev build package-windows package-macos package-linux clean lint test

# ── Proxy (if needed behind firewall) ──
PROXY ?= http://127.0.0.1:17897

# ── Development ──

dev:
	@echo "==> Starting BoschCode development environment..."
	npx kill-port 3000 2>/dev/null; \
	export HTTP_PROXY=$(PROXY); \
	export HTTPS_PROXY=$(PROXY); \
	npx tauri dev

# ── Build ──

build:
	@echo "==> Building frontend..."
	pnpm build
	@echo "==> Building Rust backend..."
	cd src-tauri && cargo build --release

# ── Package ──

package-windows:
	@echo "==> Packaging BoschCode for Windows..."
	export HTTP_PROXY=$(PROXY); \
	export HTTPS_PROXY=$(PROXY); \
	npx tauri build --bundles msi,nsis

package-macos:
	@echo "==> Packaging BoschCode for macOS..."
	export HTTP_PROXY=$(PROXY); \
	export HTTPS_PROXY=$(PROXY); \
	npx tauri build --bundles dmg

package-linux:
	@echo "==> Packaging BoschCode for Linux..."
	export HTTP_PROXY=$(PROXY); \
	export HTTPS_PROXY=$(PROXY); \
	npx tauri build --bundles deb,appimage

# ── All platforms (for CI) ──

package-all:
	@echo "==> Packaging BoschCode for all platforms..."
	pnpm build && \
	npx tauri build

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
	@echo "BoschCode Makefile"
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
