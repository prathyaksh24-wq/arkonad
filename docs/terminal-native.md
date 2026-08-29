# Native terminal interface

Arkonad now starts as a Ratatui/Crossterm executable. It does not start Vite,
Tauri, a WebView, or an embedded terminal emulator. The original amber Store
mockup remains the Store target. The launch screen now uses the refined visual
language from the separate preview: animated cell art, a slash-command prompt,
guided setup, named palettes, and optional half-block pets. Pets remain a
separate local preference; the Store was not changed into a tools/pets tab UI.

## Running from source

Use Rust 1.88 or later. No Node.js or WebView installation is needed for the TUI.

```sh
cargo run --manifest-path src-tauri/Cargo.toml --bin arkonad
cargo run --manifest-path src-tauri/Cargo.toml --bin arkonad -- store
cargo build --release --manifest-path src-tauri/Cargo.toml --bin arkonad
```

On this Windows checkout, Cargo is at `D:\Toolchains\cargo\bin\cargo.exe`.
The source helper `pnpm dev` finds that installation if Cargo is not on PATH.
`pnpm build` now builds the terminal binary. `pnpm desktop:build` retains the
old frontend build for regression checks.

## Screens and keys

On first run, `arkonad` opens a five-step guided setup. Later launches open the
slash-command prompt or the startup surface selected during setup. Direct
entries are `home`, `onboard`, `store`, `apps`, `agents`, `files`, `git`,
`status`, `pets`, `settings`, and `shell`. `arkonad open <catalog-id>` opens a
detected tool. `--cwd <directory>` chooses the working directory.
`--theme amber|phosphor|ember|gruvbox|dracula|google84` overrides the theme for one run.
`arkonad list` prints catalog/detection JSON without requiring a TTY.

- On the landing screen, type / to see commands; arrows choose, Tab completes,
  and Enter runs the selected Arkonad command. Plain text is never sent to a shell.
- `/term` hands the complete terminal to the real interactive shell; `exit`
  returns to the same Arkonad session.
- `/onboard`, `/status`, `/theme`, and `/pets` open the refined native screens.
- Arrows or j/k move; Enter opens a detected app or its install review.
- / edits search; Escape finishes editing, clears search, or returns home.
- i reviews installation; u reviews update; x reviews uninstall; a reviews adoption.
- v shows publisher, network, and data information; ? shows all keys.
- s opens a real interactive shell; `exit` returns to Arkonad.
- Ctrl+P or : opens commands. Commands include the screen names, `shell`,
  `open <id>`, `cd <path>`, and `quit`.
- In a review, arrows/PgUp/PgDn scroll, Tab selects a prerequisite step,
  Y approves that exact step, and Escape cancels. Enter does not approve changes.

Layouts use terminal columns and rows, square box borders, a highlighted row,
and a keybar. Narrow terminals use a single list; details remain available with
v or i. Under 38 columns or 16 rows, the app shows a resize message.
The terminal host owns the font. Arkonad honors `NO_COLOR`; CRT glow and
transparency remain host settings, not simulated web effects.

## Runtime and data

The TUI suspends raw mode and its alternate screen before running a child with
inherited stdin/stdout/stderr. It re-enters and redraws after either a normal
exit or a spawn failure. Ctrl+C reaches the child without killing Arkonad.
The selected child retains its own interface and theme.

The existing catalog, installer, settings, receipt format, and approval checks
are shared with the desktop frontend. `AppData` is the only frontend-specific
seam for locating files. The default directory still uses `ai.arkonad.terminal`
under the platform's user data directory. `ARKONAD_DATA_DIR` can select an
absolute directory for isolated tests. Invalid settings are not overwritten.

Catalog membership is not installation support. All 32 imported AI entries and
the four additional built-ins are visible. Most entries currently link to
publisher instructions; the reviewed WinGet recipe for lazygit is executable
on Windows. The TUI does not invent commands or versions. Update and uninstall
remain gated by a receipt proving the package is managed or adopted.

## Migration scope

The native UI covers guided setup, the command launch screen, Store, installed
apps, agent/tool selection, session status, optional local pets, shell handoff,
install/lifecycle review, and appearance/shell settings. Only one child
owns the foreground terminal at a time. Existing multi-pane supervision,
Agent Tasks/worktrees, integration previews, and desktop workspace recovery
are preserved in the optional desktop build; they have not yet been ported to
native screens. No sessions or task data are deleted by this change.

The desktop binary is now explicitly named `arkonad-desktop` and requires the
`desktop` Cargo feature. It is not the default command or native release asset.

## Distribution and validation

Installers select deterministic native executables, require SHA256 checksums,
and retain Windows signature/macOS signature and Gatekeeper checks. Windows
wrappers invoke synchronously; POSIX installs the executable itself. Neither
uses `start` or `open` to launch another window. `ARKONAD_INSTALL_DIR` can place
binaries on another drive. Installers preserve app data and prior binaries.

The release workflow builds six platform/architecture targets and creates a
draft. A maintainer must test and publish the first native release before the
public one-line commands can download it. This source change does not publish
a release or install anything on the host.

Tests include the actual renderer at small/large terminal sizes, keyboard
navigation, filtering, confirmation/cancellation, shared install/receipt tests,
and CLI behavior with redirected input. `scripts/render-tui-preview.ps1` draws
PNG evidence from the real Ratatui cell buffer; it is not a browser prototype.

Framework references: [Ratatui 0.29](https://docs.rs/ratatui/0.29.0/ratatui/).
