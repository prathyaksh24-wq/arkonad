# Arkonad

> The deepest fire, born of friction, that never goes out.

A terminal-native app store and launcher for Windows, macOS, and Linux. Arkonad runs inside your existing terminal using Ratatui/Crossterm. Choose a tool or open a real shell; exit the child to return to Arkonad.

## Run the current source

```sh
cargo run --manifest-path src-tauri/Cargo.toml --bin arkonad
```

Use `-- store` to open the Store directly. On this checkout, `pnpm dev` also finds the Rust toolchain on D:. See [native UI, keys, and current limitations](docs/terminal-native.md).

After the release build, this single line opens the current Windows executable
from either PowerShell or Command Prompt:

```cmd
D:\Repos\arkonad\src-tauri\target\release\arkonad.exe
```

## Install

These commands require a **published native release**. They will reject a legacy desktop-only release. Until the first native release is published, run the source above.

PowerShell:

```powershell
irm https://raw.githubusercontent.com/prathyaksh24-wq/arkonad/main/install.ps1 | iex
```

Windows Command Prompt:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/prathyaksh24-wq/arkonad/main/install.ps1 | iex"
```

macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/prathyaksh24-wq/arkonad/main/install.sh | sh
```

Open a new terminal after installation and type `arkonad`. The shorter `arkond` spelling is installed as an alias.

## Status

In active development. Tracked on the [wayfinder map](https://github.com/prathyaksh24-wq/arkonad/issues/1).

## Design research

- `research/terminal-foundations.md` — ConPTY / xterm.js / Tauri stack decisions
- `research/agent-capabilities.md` — agent CLI + integration tool capability table
- `research/catalog-shortlist.md` — ranked integration candidates from the awesome-tui catalogs
- `docs/release/windows-first-release.md` — Windows installer, migration, update, and release-test rules
