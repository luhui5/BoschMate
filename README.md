# YourMate

Local AI coding agent — Tauri v2 desktop app + Next.js UI.

## Features

- **Your Mate** — standalone chat with optional workspace folder binding
- **Project workspace** — Ask / Plan / Edit / Auto agent modes with tool calling
- **Git integration** — status, diff, commit from the sidebar
- **Memory system** — SQLite + vector search, compress & manage in Settings
- **Slash commands** — `/test`, `/lint`, `/format`, `/changelog`, etc.
- **Ultra-lightweight** — ~7 MB memory footprint, runs smoothly even on resource-constrained machines

## Prerequisites

- Node.js 22+, pnpm 10+
- Rust stable (for Tauri backend)
- [Ollama](https://ollama.com) (optional, for local models)

### Linux (Tauri deps)

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

## Development

```bash
pnpm install
pnpm tauri dev
```

Browser-only UI preview (mock backend):

```bash
pnpm dev
```

## Build

```bash
pnpm build
pnpm tauri build
```

## Configuration

- **Models**: Settings → Model — add Ollama or OpenAI-compatible API (e.g. DeepSeek)
- **API keys**: stored in OS Keychain (Windows Credential Manager / macOS Keychain)
- **Updates**: set `YOURMATE_UPDATE_REPO` env to `owner/repo` for GitHub release checks

## Docs

- [Product spec](docs/原始需求.md)
- [Development plan](docs/开发计划.md)

## License

Private / internal — see repository owner.
