# Terminal Foundations Research — Arkonad

**Ticket:** Terminal foundations for a Tauri v2 + ConPTY + xterm.js terminal shell on Windows.
**Scope:** Research only (no project code). Version state verified against live sources, Aug 2026.
**Branch:** `research/terminal-foundations`

---

## Executive Summary

The proposed stack is viable and has working precedents (Tauri + `portable-pty` + xterm.js). Three
findings materially shape the design:

1. **ConPTY I/O is synchronous-only at the OS level.** Microsoft documents `CreatePseudoConsole`
   pipes as restricted to synchronous `ReadFile`/`WriteFile` (no OVERLAPPED), and recommends each
   channel be serviced on its own thread to avoid deadlocks. Async runtimes (tokio) must therefore
   wrap the PTY in dedicated blocking threads/`spawn_blocking` and bridge via channels — you cannot
   `await` the pipes directly.
2. **xterm 6.0.0 (Dec 2025) removed the canvas renderer** — the renderer choice is now DOM or WebGL
   only. xterm's write buffer is finite (~50 MB) and excess data is **discarded**, so real
   backpressure from JS → Rust is mandatory for bursty output (`git clone`).
3. **Tauri v2 does not expose raw keyboard events to Rust** (`WindowEvent::KeyboardInput` is an open
   feature request). Keyboard capture must happen in JS (xterm's hidden-textarea model) with
   `preventDefault`, plus care with WebView2 browser accelerators and Alt/AltGr quirks.

The recommended PTY crate is **`portable-pty` (v0.9.0)** rather than the standalone `conpty`
crate: it is the only one of the candidates that is actively maintained, battle-tested in a
production terminal (WezTerm), and has a ConPTY backend that already solves the hard parts
(handle lifecycle, `STARTUPINFOEX` plumbing, resize, exit detection).

---

## 1. ConPTY from Rust on Windows

### 1.1 What ConPTY is (the OS contract)

ConPTY (Windows Pseudo Console) lets a host app run a character-mode child (cmd, PowerShell, WSL)
without a visible console window. The host creates a pair of pipes, calls `CreatePseudoConsole`,
then spawns the child with `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` in `STARTUPINFOEX`. conhost runs
headless, translating between the legacy Console API (used by the child) and a **UTF-8 text/VT
stream** on the pipes.

- **Input pipe**: host writes UTF-8 text/VT sequences; conhost converts them to `INPUT_RECORD`s
  ("as if typed by user"). <sup>[1](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)</sup>
- **Output pipe**: host reads UTF-8 text/VT sequences rendering the buffer changes. <sup>[1](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)</sup>
- **Resize**: `ResizePseudoConsole(hPC, COORD)`; **close**: `ClosePseudoConsole(hPC)` terminates the
  child *and its entire process tree*. <sup>[2](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)</sup>
- Full reference implementation of host-side plumbing: Windows Terminal's `ConptyConnection` and
  the `samples/ConPTY/*` projects in `microsoft/terminal`. <sup>[3](https://github.com/microsoft/terminal)</sup>

### 1.2 Crate landscape (as of Aug 2026)

| Crate | Version / activity | ConPTY backend | Async | Notes |
|---|---|---|---|---|
| **`portable-pty`** (wezterm) | 0.9.0 (Feb 2025); ~36.5k downloads/mo, ~4M all-time | Yes | No (by design — see §1.3) | Traits-based (`PtySystem`/`MasterPty`/`SlavePty`), `CommandBuilder`, exit status, process-tree kill. The engine behind WezTerm. <sup>[4](https://crates.io/crates/portable-pty)</sup> |
| **`conpty`** (zhiburt) | 0.7.0 (Sep 2024; stale ~2y); 370k total downloads | Yes (only) | No | Minimal sync API: `Process::spawn(Command)`, `output()/input()`, `resize(x,y)`, `exit(code)`, `is_alive()`, `set_echo()`, `wait()`. Used by expectrl. Windows-only. <sup>[5](https://docs.rs/conpty/latest/conpty/struct.Process.html)</sup> |
| **`winpty-rs`** (andfoy) | 0.4.1 (Jan 2025) | Yes (plus legacy WinPTY) | No | Dual backend; heavier (links winpty agent binaries for legacy path). <sup>[6](https://lib.rs/crates/winpty-rs)</sup> |
| **`pseudoterminal`** (michaelvanstraten) | 0.1.0 (2023) | Yes | "not implemented yet" (per README warning) | Cross-platform sync PTY. <sup>[7](https://github.com/michaelvanstraten/pseudoterminal)</sup> |
| **`rust-pty`** | — | Yes | Unified async interface | Niche; low adoption. <sup>[8](https://docs.rs/rust-pty)</sup> |
| **`xpty`** | Mar 2026 | Yes (fork of portable-pty) | "Async-ready" | New fork; unproven, worth watching. <sup>[9](https://crates.io/crates/xpty)</sup> |
| **`tauri-plugin-pty`** (Tnze) | 0.1.1 (Aug 2025) | Yes (wraps portable-pty) | Yes (channels) | Tauri plugin + `tauri-pty` npm package; self-described "Developing! Welcome to contribute". <sup>[10](https://lib.rs/crates/tauri-plugin-pty)</sup> |

### 1.3 How to spawn / resize / read-write / lifecycle

`portable-pty` shape (the recommended crate):

```rust
let pty_system = native_pty_system();                    // ConPTY on Windows, forkpty elsewhere
let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
let child = pair.slave.spawn_command(CommandBuilder::new("powershell.exe"))?;
let mut reader = pair.master.try_clone_reader()?;        // blocking read, UTF-8 VT bytes
let mut writer = pair.master.take_writer()?;             // blocking write, UTF-8 bytes
pair.master.resize(PtySize { rows, cols, .. })?;         // → ResizePseudoConsole
child.kill(); / child.wait(); / pair.master.close();     // close kills the whole tree
```
<sup>[4](https://crates.io/crates/portable-pty)</sup> <sup>[11](https://docs.rs/portable-pty/latest/portable_pty/)</sup>

`conpty` (zhiburt) shape — everything is on `Process` and sync:
`Process::spawn(Command)` (any command, not just cmd.exe), `output() -> PipeReader`,
`input() -> PipeWriter`, `resize(x: i16, y: i16)`, `exit(code)`, `is_alive()`, `wait(ms)`,
`set_echo(bool)`; `Drop` closes the pseudo console (kills the tree). Its doc warns not to stop
reading solely on `is_alive() == false` (output can still be buffered). <sup>[5](https://docs.rs/conpty/latest/conpty/struct.Process.html)</sup>

### 1.4 Known pitfalls (verified against sources)

1. **ConPTY pipes are synchronous-only.** `CreatePseudoConsole` docs: the channels "are currently
   restricted to synchronous I/O" (ReadFile/WriteFile without OVERLAPPED). <sup>[12](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)</sup>
   Wez (maintainer of portable-pty) confirms: portable-pty has no async implementation because of
   this; async usage is done at a higher level via a thread bridge (smol `Unblock`/tokio
   `spawn_blocking`). <sup>[13](https://github.com/nextest-rs/nextest/issues/1357)</sup>
2. **One thread per channel, or deadlock.** Microsoft: "Servicing all of the pseudoconsole
   activities on the same thread may result in a deadlock where one of the communications buffers
   is filled and waiting for your action while you attempt to dispatch a blocking request on
   another channel." Also: after `CreateProcess`, the host must close the pipe ends it gave the
   console (`inputReadSide`/`outputWriteSide`) or broken-channel detection fails. And closing the
   console may emit a final frame on output that must be drained before teardown. <sup>[2](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)</sup>
3. **Encoding: UTF-8 on the wire, never UTF-16.** ConPTY input/output are UTF-8 text/VT
   (conhost converts to/from its internal UTF-16 buffer). A host app should send UTF-8 bytes and
   receive UTF-8 bytes. Rust's `String`/`&[u8]` maps directly; do not use `OsString`-W APIs for
   the stream. <sup>[1](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)</sup> <sup>[14](https://github.com/microsoft/terminal/discussions/13806)</sup>
4. **Newline handling.** Output from ConPTY contains VT streams with `\r\n` line endings (as the
   console renders them) — feed them to xterm.js verbatim. For input, Microsoft's own sample sends
   `\n` and it works for cmd (<sup>[1](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)</sup>),
   but the robust convention used by terminals (incl. node-pty's Windows backend) is to send
   `\r` (or `\r\n`) for Enter; `\n`-only input is the classic cause of "Enter does nothing" bugs
   in some apps. Do not transform output; transform input only if the shell misbehaves.
5. **Resize only affects subsequent output.** `ResizePseudoConsole` changes the conhost buffer;
   resize first (xterm fit → PTY resize), then let the shell repaint. xterm.js 5.2+ has
   `windowsPty: { backend: 'conpty', buildNumber }` (replaces deprecated `windowsMode`) to mimic
   ConPTY reflow behavior on resize. <sup>[15](https://github.com/xtermjs/xterm.js/releases)</sup>
6. **Lifecycle.** `ClosePseudoConsole` terminates the child and its whole tree — this is how you
   avoid orphaned shells on window close (also the documented way; Tabby-style apps must call it on
   close). Closing while the child is still starting can surface a `0xc0000142` error dialog from
   the client app. <sup>[2](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)</sup>
7. **Real-world deadlock evidence for Tauri+PTY:** "Tauri + expectrl PTY: interactive CLI freezes
   when waiting for input (read thread holds mutex)" — a blocking reader inside the wrong thread
   model deadlocks the app. This is exactly why the reader must be a dedicated thread feeding an
   async channel, not a command awaiting the pipe. <sup>[16](https://stackoverflow.com/questions/79758154/tauri-expectrl-pty-interactive-cli-freezes-when-waiting-for-input-read-threa)</sup>

---

## 2. xterm.js

### 2.1 Current version state (verified Aug 2026)

- **Latest stable: `@xterm/xterm` 6.0.0**, released 2025-12-22; `@xterm/headless` 6.0.0 in lockstep;
  a 6.1.0 beta line exists. <sup>[17](https://www.npmjs.com/package/@xterm/xterm)</sup> <sup>[18](https://registry.npmjs.org/@xterm/headless/latest)</sup> <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup>
- **6.0.0 highlights** relevant to a terminal app: synchronized output (DEC 2026, reduces flicker
  during big repaints), progress addon, built-in OSC 52 (clipboard escape) support, ESM via esbuild,
  `onWriteParsed` exposed, and — **breaking — the canvas renderer was removed** (#5105); DOM or
  WebGL are the two renderers. `windowsMode` was fully removed (use `windowsPty`). <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup>
- Tabby currently ships `@xterm/xterm ^5.4.0` with addons canvas 0.6, fit 0.9, image 0.7, ligatures
  0.8, search 0.14, serialize 0.12, unicode11 0.7, webgl 0.17 — i.e. the xterm 5.x ecosystem;
  6.x is stable for ~8 months and is the forward-looking pin. <sup>[20](https://raw.githubusercontent.com/Eugeny/tabby/master/tabby-terminal/package.json)</sup>

### 2.2 Addon ecosystem (6.0.0-compatible line)

| Addon | Role | Verdict for Arkonad |
|---|---|---|
| `@xterm/addon-fit` | Compute cols/rows to match container; `proposeDimensions()` | **Use** (with `ResizeObserver`) |
| `@xterm/addon-web-links` | URL detection + click (OSC 8 aware in recent versions) | **Use** |
| `@xterm/addon-search` | Find box; 6.0 added `SearchLineCache` for speed | **Use** |
| `@xterm/addon-webgl` | WebGL2 canvas renderer — the fast path | **Use** on WebView2 (WebGL2 supported); fall back to DOM renderer |
| `@xterm/addon-serialize` | Serialize terminal state (with `@xterm/headless`) | **Use** if tab-restore/reconnect wanted |
| `@xterm/addon-unicode-graphemes` | Grapheme clustering | **Experimental**; optional |
| `@xterm/addon-unicode11` | Unicode 11 width tables | Optional (CJK width) |
| `@xterm/addon-themes` / `addon-clipboard` | Theme presets / clipboard helpers | Optional |
| `@xterm/addon-image` | iTerm2/sixel images | Optional, later |
| `@xterm/addon-canvas` | Canvas renderer | **Removed in 6.x — do not depend on it** |
| `@xterm/addon-attach` / `addon-socket` | WebSocket/stream attach | Not needed (we have Rust IPC) |

Addon list and "experimental" marker for graphemes from the xterm.js README; compatible-version
tables published per release. <sup>[21](https://github.com/xtermjs/xterm.js)</sup> <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup>

### 2.3 How Windows Terminal and Tabby wire it

- **Windows Terminal does *not* use xterm.js** — its FAQ states plainly: "Visual Studio Code is
  xtermjs and written in TypeScript while Windows Terminal is native code." Windows Terminal is a
  native C++ app (AtlasEngine GPU renderer) talking to ConPTY through a 3-pipe model (input,
  output, signal pipe for resize/clear/focus). Its value for us is as the reference ConPTY host
  implementation, not as an xterm consumer. <sup>[22](https://learn.microsoft.com/en-us/windows/terminal/faq)</sup> <sup>[23](https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalConnection/ConptyConnection.cpp)</sup>
- **Tabby** (github.com/Eugeny/tabby) is **Electron + Angular**, local shells via **node-pty**
  (which uses ConPTY on Windows ≥1809) in the main process, forwarded to xterm.js in the renderer
  over Electron IPC — the same shape we replicate with Tauri IPC. It runs xterm 5.4 and uses
  WebGL/canvas renderers, fit, search, serialize, unicode11, image, ligatures. <sup>[20](https://raw.githubusercontent.com/Eugeny/tabby/master/tabby-terminal/package.json)</sup> <sup>[24](https://github.com/eugeny/tabby)</sup> <sup>[25](https://github.com/microsoft/node-pty)</sup>
- VS Code is the biggest xterm.js consumer and the closest "wiring" reference (xterm.js + PTY
  over IPC + write-callback backpressure). <sup>[21](https://github.com/xtermjs/xterm.js)</sup>

### 2.4 Performance / large scrollback

- `term.write()` is non-blocking and buffers; data is parsed under a per-frame (≤16 ms) time
  budget. Sustained throughput is ~5–35 MB/s with a hardcoded **50 MB write buffer** — beyond that,
  data is **discarded**. Fast producers must apply flow control. <sup>[26](https://xtermjs.org/docs/guides/flowcontrol)</sup>
- The canonical handbrake is `term.write(chunk, callback)` (fires when the chunk was processed);
  over IPC you typically ACK in batches rather than per-chunk. <sup>[26](https://xtermjs.org/docs/guides/flowcontrol)</sup>
- Rendering: DOM renderer (fine for small workloads) vs WebGL2 (recommended for scrollback-heavy
  use; canvas renderer is gone in 6.x). Search in 6.0 got a line cache for big buffers. <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup>
- Scrollback is an in-memory `CircularList` (rows + scrollback); keep `scrollback` modest
  (e.g. 5–10k lines) or provide "clear on reflow" UX; xterm does not virtualize — memory grows with
  scrollback × line content.

### 2.5 `@xterm/headless` vs browser build

- Browser `@xterm/xterm` renders to DOM/WebGL and drives input capture.
- `@xterm/headless` is the same emulator core with no DOM dependency, for Node.js (state tracking,
  server-side sessions, serialization/restore with `addon-serialize`). <sup>[18](https://registry.npmjs.org/@xterm/headless/latest)</sup>
- For Arkonad (single-process Tauri app) the browser build is the one that matters; headless is
  only relevant if a future "detached sessions" or test harness is added. Keep both in the same
  monorepo if used (they version in lockstep).

---

## 3. Tauri v2 webview viability for a terminal

### 3.1 Current state

- Tauri v2.11.x line is current (`tauri` crate 2.11.4, `@tauri-apps/api` 2.11.1, `wry` 0.56,
  `tao` 0.36, Jun–Jul 2026). WebView2 (Evergreen) is the Windows webview. <sup>[27](https://v2.tauri.app/release/)</sup>
- Tauri 2.0 introduced raw IPC (bypass JSON) and the `Channel` streaming API. <sup>[28](https://v2.tauri.app/blog/tauri-20)</sup>

### 3.2 Keyboard capture — the main webview caveat

- **Tauri does not expose `WindowEvent::KeyboardInput` to Rust** (open feature request #11671 since
  Nov 2024). The recommended path is JS-side `keydown` listeners + `preventDefault`, forwarding
  only what the backend needs. <sup>[29](https://github.com/tauri-apps/tauri/issues/11671)</sup>
  (This matches xterm.js's own hidden-textarea model — a terminal does not need raw key events;
  xterm translates keys/IME into escape sequences and `onData` bytes.)
- WebView2 quirks that matter for a terminal: browser accelerator keys intercept some chords
  (disable them; WebView2 `AreBrowserAcceleratorKeysEnabled=false` is the native knob, wry exposes
  related settings via window config); Alt/AltGr events are inconsistent (missed keyup, "stuck"
  Alt state); Tab/ESC behavior changes if the new `AllowHostInputProcessing` mode is used. <sup>[30](https://stackoverflow.com/questions/79349080/how-to-properly-handle-or-block-alt-and-altgr-key-behavior-in-webview2-or-webvie)</sup> <sup>[31](https://weblog.west-wind.com/posts/2025/Aug/20/Using-the-new-WebView2-AllowHostInputProcessing-Keyboard-Mapping-Feature)</sup>
- Practical rule: handle all terminal keys in JS (`keydown` + `beforeinput`/composition events for
  IME), reserve Rust-side handling for app-level shortcuts via Tauri menus/`global-shortcut`, and
  test AltGr + IME on Windows early.

### 3.3 Clipboard

- Official plugin **`tauri-plugin-clipboard-manager` 2.3.2** (crate + `@tauri-apps/plugin-clipboard-manager` npm) — text read/write on Windows, macOS, Linux. For OSC 52 and terminal copy/paste this is sufficient. <sup>[32](https://github.com/tauri-apps/tauri-plugin-clipboard-manager)</sup>
- xterm 6.0 also has native OSC 52 support; route it to the plugin. <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup>

### 3.4 IPC throughput for PTY byte streams

- **`tauri::ipc::Channel` is the right primitive for PTY output.** Rust sends `Vec<u8>`; it stays
  raw on the wire (no JSON/base64) and arrives in JS as `ArrayBuffer`/`Uint8Array`. Channels are
  ordered and lower overhead than repeated `invoke`. <sup>[33](https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html)</sup> <sup>[34](https://v2.tauri.app/develop/calling-frontend/)</sup>
- **Input (JS → Rust)** can be an `invoke` whose `Uint8Array`/`ArrayBuffer` argument is shipped as
  raw bytes (Tauri 2.x raw payloads), avoiding base64. <sup>[28](https://v2.tauri.app/blog/tauri-20)</sup> <sup>[35](https://v2.tauri.app/develop/calling-rust/)</sup>
- Performance envelope: plain JSON `invoke` is ~1k calls/s/webview; payloads >~100 KB should use
  raw/Channel paths (a community report measured ~100 ms for an 11.8 MB raw `Response`; a 3 MB
  JSON push ~200 ms). Channel send is the streaming-optimized path (small payloads go via `eval`,
  larger via the fetch-backed queue). <sup>[36](https://github.com/tauri-apps/tauri/issues/13405)</sup> <sup>[37](https://docs.rs/tauri/latest/src/tauri/ipc/channel.rs.html)</sup>
- **Caveat: `Channel` is unbounded on the Rust side** — if JS can't drain, memory grows. You must
  impose your own bound (bounded tokio channel behind it + drop policy). <sup>[38](https://tauri.app/develop/calling-frontend/)</sup>
- For future very-high-bandwidth needs, Tauri's own `examples/streaming` shows the streaming
  protocol approach; a named-pipe sidecar remains the escape hatch. <sup>[39](https://github.com/tauri-apps/tauri/tree/dev/examples/streaming)</sup> <sup>[36](https://github.com/tauri-apps/tauri/issues/13405)</sup>

### 3.5 Known Tauri + terminal projects

- **marc2332/tauri-terminal** (129★): exactly the proposed stack — Tauri + xterm.js + portable-pty.
  Minimal but proof the IPC shape works. <sup>[40](https://github.com/marc2332/tauri-terminal)</sup>
- **Tnze/tauri-plugin-pty** (0.1.1): portable-pty wrapped as a Tauri plugin with `spawn/onData/write`
  over channels; usable as a starting point but explicitly early-stage. <sup>[10](https://lib.rs/crates/tauri-plugin-pty)</sup>
- **Hermes IDE** (Tauri 2 + React + portable-pty, "AI terminal"): same architecture in production
  use (multi-session, split panes, WebGL rendering). <sup>[41](https://skillsmp.com/skills/aradotso-hermes-skills-skills-hermes-ide-terminal)</sup>
- **DomTerm**: an xterm.js-based terminal with a Tauri/Wry desktop front-end option. <sup>[21](https://github.com/xtermjs/xterm.js)</sup>
- Note: the ticket's "fudo" reference could not be verified — no meaningful Tauri/terminal project
  named "fudo" was found (only an unrelated sudo→doas wrapper). Treat that name as noise.
- ttyd-style apps (web terminal gateways) are xterm.js consumers but use WebSocket transports —
  not applicable to a desktop Tauri app beyond inspiration. <sup>[42](http://xtermjs.org/)</sup>

---

## 4. PTY stream plumbing patterns

### 4.1 Recommended architecture (threads → bounded channel → Channel)

```
[conhost.exe] ←ConPTY pipes→ [PTY reader thread]   [PTY writer (single task)]
   (blocking read)    reader──► tokio::sync::mpsc (bounded, ~64–256 chunks)
                                  │ drop-oldest on overflow (backpressure policy)
                                  ▼
                         forwarder task ──► tauri::ipc::Channel<Vec<u8>> ──► JS onmessage
                                                                    (ArrayBuffer → term.write)
   term.onData (escape bytes) ──► invoke('pty_write', Uint8Array) ──► writer task ──► PTY input pipe
```

- ConPTY pipes are sync-only (§1.4.1) → **one blocking thread reads output, one writes input**
  (Microsoft's own two-thread guidance, §1.4.2). Bridge into tokio with `spawn_blocking` or raw
  threads + `std::sync::mpsc` → `tokio::sync::mpsc` handoff.
- Write **coalescing**: xterm `onData` produces tiny bursts (keystrokes, paste). Batch input
  through the writer task (small timer or count-based flush) instead of one pipe `WriteFile` per
  keystroke — reduces conhost processing overhead and IPC churn. Node-pty/Tabby effectively do
  this on the same side.
- `Channel` is unbounded (§3.4) → the *tokio* channel is the real bound. When full, **drop oldest**
  chunks (a terminal that can't render fast enough should shed output, not OOM) — but see 4.2:
  prefer real backpressure so `git clone` output is *paused*, not dropped, if you want faithful
  history.

### 4.2 Backpressure end-to-end

1. **PTY → Rust**: blocking read loop is naturally throttled — conhost only produces what fits in
   pipe buffers; don't spin.
2. **Rust → JS**: use `term.write(chunk, callback)` and send an ACK (or count-based batch ACK) back
   over a tiny invoke/`Channel` control message; the forwarder pauses the tokio channel when the
   in-flight budget is exhausted. This mirrors the documented xterm flow-control recipe
   (pause/resume on write callback). <sup>[26](https://xtermjs.org/docs/guides/flowcontrol)</sup>
3. **JS → Rust**: `onData` is already human-paced; the 50 MB xterm write-buffer guard is on the
   output path (Rust → JS), which is covered by 1–2.

### 4.3 Handling `git clone`-style bursts

- `git clone` on a fast disk can emit many MB in seconds; the chain is: conhost flush → pipe →
  reader thread → tokio channel → Channel → JS → xterm write buffer (50 MB hard limit, data
  discarded beyond it). <sup>[26](https://xtermjs.org/docs/guides/flowcontrol)</sup>
- Mitigations in priority order: (a) real ACK-based pacing so xterm never exceeds its buffer;
  (b) WebGL renderer for cheap repaints; (c) sane scrollback cap so memory doesn't balloon;
  (d) `synchronized output` (DEC 2026, new in xterm 6.0) to coalesce repaints into single frames. <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup>
- Windows Terminal handles the same burst by reading output on dedicated threads with large
  buffers and frame-batching renders — the same shape as 4.1. <sup>[23](https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalConnection/ConptyConnection.cpp)</sup>

---

## 5. Recommendations (final lineup)

### Rust crates

| Crate | Version | Use-as-is vs fork | Rationale |
|---|---|---|---|
| `portable-pty` | 0.9.0 | **Use as-is** (pin `=0.9`; fork only if we must add tokio integration — prefer wrapping) | Only actively maintained, production-grade ConPTY abstraction (WezTerm); solves STARTUPINFOEX/handle-lifetime/exit/kill-tree correctly. Sync-only is fine: we wrap in threads by design (§4.1). <sup>[4](https://crates.io/crates/portable-pty)</sup> |
| `tokio` | 1.x (current) | Use as-is | Async runtime for the app; PTY bridged via `spawn_blocking`/threads. <sup>[13](https://github.com/nextest-rs/nextest/issues/1357)</sup> |
| `tauri` | 2.11.x | Use as-is | Current v2 line; `ipc::Channel<Vec<u8>>` raw streaming + raw `Uint8Array` invoke args. <sup>[27](https://v2.tauri.app/release/)</sup> |
| `tauri-plugin-clipboard-manager` | 2.3.x | Use as-is | Official clipboard plugin (OSC 52, copy/paste). <sup>[32](https://github.com/tauri-apps/tauri-plugin-clipboard-manager)</sup> |
| `windows` (windows-sys) | latest | Optional, direct use | Only if we need platform knobs portable-pty doesn't expose (e.g. custom signal handling); not required for v1. |
| `conpty` (zhiburt) | 0.7.0 | **Do not use** (stale ~2y, sync-only, minimal API) | Fallback reference for the raw API shape only. <sup>[5](https://docs.rs/conpty/latest/conpty/struct.Process.html)</sup> |
| `tauri-plugin-pty` | 0.1.1 | Use only as a study reference | Wraps portable-pty already; immature, self-described developing. <sup>[10](https://lib.rs/crates/tauri-plugin-pty)</sup> |

### JS packages

| Package | Version | Use-as-is vs fork | Rationale |
|---|---|---|---|
| `@xterm/xterm` | **6.0.0** | Use as-is | Current stable; canvas renderer removed so DOM/WebGL are the choices; includes synchronized-output, OSC 52, ESM. <sup>[17](https://www.npmjs.com/package/@xterm/xterm)</sup> <sup>[19](https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0)</sup> |
| `@xterm/addon-fit` | 0.10.x | Use as-is | Grid sizing + `ResizeObserver` → `resize()` to ConPTY. |
| `@xterm/addon-webgl` | 0.17.x | Use as-is (with DOM fallback) | Fastest renderer; WebGL2 is supported by WebView2. |
| `@xterm/addon-web-links` | 0.11.x | Use as-is | URL detection/clicking. |
| `@xterm/addon-search` | 0.14.x | Use as-is | Find with line cache in 6.x. |
| `@xterm/addon-serialize` (+ `@xterm/headless`) | 0.12.x / 6.0.0 | Use as-is, later | Tab-restore/state persistence; optional phase-2. <sup>[18](https://registry.npmjs.org/@xterm/headless/latest)</sup> |
| `@xterm/addon-unicode-graphemes` | (experimental) | Optional | Only if grapheme clustering is required. |
| `@tauri-apps/api` | 2.11.x | Use as-is | `Channel` + `invoke` bindings. <sup>[27](https://v2.tauri.app/release/)</sup> |
| `@tauri-apps/plugin-clipboard-manager` | 2.3.x | Use as-is | Clipboard access. <sup>[32](https://github.com/tauri-apps/tauri-plugin-clipboard-manager)</sup> |

### Explicit non-choices

- **Do not** build on the standalone `conpty` crate (stale) or `winpty-rs` (legacy WinPTY baggage).
- **Do not** plan around `@xterm/addon-canvas` (removed in 6.x).
- **Do not** rely on Rust-side keyboard events (not exposed by Tauri v2; JS-side capture only). <sup>[29](https://github.com/tauri-apps/tauri/issues/11671)</sup>
- **Do not** assume Windows Terminal is an xterm.js precedent — it is native; use Tabby/VS Code
  for xterm wiring and `microsoft/terminal` only as ConPTY host reference. <sup>[22](https://learn.microsoft.com/en-us/windows/terminal/faq)</sup>
- **No fork needed anywhere** in the core lineup today; the fork points (if ever) are
  `portable-pty` (tokio-native integration) and `@xterm/addon-webgl` (WebView2-specific bugs).

---

## Red flags (things that won't work / need care on Windows + Tauri)

1. **No async ConPTY.** You cannot `await` ConPTY pipes; tokio must be bridged via blocking
   threads/`spawn_blocking`. Ignoring this produces the documented single-thread deadlock — and
   there is a real Stack Overflow report of exactly this freezing a Tauri+PTY app. <sup>[12](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)</sup> <sup>[13](https://github.com/nextest-rs/nextest/issues/1357)</sup> <sup>[16](https://stackoverflow.com/questions/79758154/tauri-expectrl-pty-interactive-cli-freezes-when-waiting-for-input-read-threa)</sup>
2. **xterm discards output beyond its ~50 MB write buffer.** Without ACK-based backpressure,
   `git clone`-style bursts silently truncate the terminal. <sup>[26](https://xtermjs.org/docs/guides/flowcontrol)</sup>
3. **Tauri `Channel` is unbounded** — must be capped by an app-side bounded queue or memory grows
   when the webview is slow (e.g. window minimized/throttled). <sup>[38](https://tauri.app/develop/calling-frontend/)</sup>
4. **No Rust-side raw keyboard events in Tauri v2**; WebView2 has Alt/AltGr and accelerator-key
   quirks — terminal key handling must live in JS with `preventDefault` and early IME testing. <sup>[29](https://github.com/tauri-apps/tauri/issues/11671)</sup> <sup>[30](https://stackoverflow.com/questions/79349080/how-to-properly-handle-or-block-alt-and-altgr-key-behavior-in-webview2-or-webvie)</sup>
5. **Encoding traps:** ConPTY is UTF-8-only on the wire (no UTF-16 passthrough); do not re-encode.
   Newline translation differs between input (`\r` convention) and output (`\r\n` VT stream,
   pass through untouched). <sup>[1](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)</sup> <sup>[14](https://github.com/microsoft/terminal/discussions/13806)</sup>
6. **Lifecycle:** close of the pseudo console kills the child *tree*; closing during startup shows
   `0xc0000142`; missed handle cleanup causes broken-channel hangs. Sequence teardown carefully
   (drain final frame, then `ClosePseudoConsole`). <sup>[2](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)</sup>
7. **IPC ceiling:** large JSON payloads over Tauri IPC are slow (measured ~100 ms for ~12 MB
   raw / ~200 ms for 3 MB JSON). Always use `Channel<Vec<u8>>`/raw `Uint8Array`; keep JSON invoke
   payloads small. <sup>[36](https://github.com/tauri-apps/tauri/issues/13405)</sup>
8. **"fudo" doesn't exist as a Tauri terminal** — don't waste time looking for prior art under that
   name; the real precedents are `marc2332/tauri-terminal`, `tauri-plugin-pty`, Hermes IDE, DomTerm.

---

## Sources

1. Microsoft DevBlogs — *Introducing the Windows Pseudo Console (ConPTY)* (2018, updated 2021): https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/
2. Microsoft Learn — *Creating a Pseudoconsole session*: https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
3. microsoft/terminal (samples/ConPTY, winconpty): https://github.com/microsoft/terminal
4. portable-pty on crates.io: https://crates.io/crates/portable-pty
5. conpty (zhiburt) docs.rs: https://docs.rs/conpty/latest/conpty/struct.Process.html
6. winpty-rs on lib.rs: https://lib.rs/crates/winpty-rs
7. michaelvanstraten/pseudoterminal: https://github.com/michaelvanstraten/pseudoterminal
8. rust-pty docs.rs: https://docs.rs/rust-pty
9. xpty on crates.io: https://crates.io/crates/xpty
10. tauri-plugin-pty on lib.rs: https://lib.rs/crates/tauri-plugin-pty
11. portable-pty docs.rs: https://docs.rs/portable-pty/latest/portable_pty/
12. Microsoft Learn — CreatePseudoConsole (sync I/O restriction): https://learn.microsoft.com/en-us/windows/console/createpseudoconsole
13. wez on portable-pty async — nextest issue #1357: https://github.com/nextest-rs/nextest/issues/1357
14. microsoft/terminal discussion #13806 — UTF-16 vs UTF-8 output: https://github.com/microsoft/terminal/discussions/13806
15. xterm.js releases (windowsMode → windowsPty): https://github.com/xtermjs/xterm.js/releases
16. Stack Overflow — Tauri + expectrl PTY freeze: https://stackoverflow.com/questions/79758154/tauri-expectrl-pty-interactive-cli-freezes-when-waiting-for-input-read-threa
17. @xterm/xterm on npm: https://www.npmjs.com/package/@xterm/xterm
18. @xterm/headless registry metadata: https://registry.npmjs.org/@xterm/headless/latest
19. xterm.js 6.0.0 release notes (GitHub API): https://api.github.com/repos/xtermjs/xterm.js/releases/tags/6.0.0
20. Tabby terminal package.json: https://raw.githubusercontent.com/Eugeny/tabby/master/tabby-terminal/package.json
21. xtermjs/xterm.js README: https://github.com/xtermjs/xterm.js
22. Windows Terminal FAQ (xterm.js vs native): https://learn.microsoft.com/en-us/windows/terminal/faq
23. microsoft/terminal ConptyConnection.cpp: https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalConnection/ConptyConnection.cpp
24. Eugeny/tabby: https://github.com/Eugeny/tabby
25. microsoft/node-pty: https://github.com/microsoft/node-pty
26. xterm.js Flowcontrol guide: https://xtermjs.org/docs/guides/flowcontrol
27. Tauri ecosystem releases: https://v2.tauri.app/release/
28. Tauri 2.0 stable release blog (raw requests): https://v2.tauri.app/blog/tauri-20
29. tauri issue #11671 — WindowEvent::KeyboardInput: https://github.com/tauri-apps/tauri/issues/11671
30. Stack Overflow — WebView2 Alt/AltGr handling: https://stackoverflow.com/questions/79349080/how-to-properly-handle-or-block-alt-and-altgr-key-behavior-in-webview2-or-webvie
31. Rick Strahl — WebView2 AllowHostInputProcessing: https://weblog.west-wind.com/posts/2025/Aug/20/Using-the-new-WebView2-AllowHostInputProcessing-Keyboard-Mapping-Feature
32. tauri-plugin-clipboard-manager: https://github.com/tauri-apps/tauri-plugin-clipboard-manager
33. tauri::ipc::Channel docs: https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html
34. Tauri docs — Calling the Frontend (channels): https://v2.tauri.app/develop/calling-frontend/
35. Tauri docs — Calling Rust (raw payloads): https://v2.tauri.app/develop/calling-rust/
36. tauri issue #13405 — large binary payload IPC: https://github.com/tauri-apps/tauri/issues/13405
37. tauri ipc channel.rs source: https://docs.rs/tauri/latest/src/tauri/ipc/channel.rs.html
38. Tauri docs — Channel backpressure note: https://tauri.app/develop/calling-frontend/
39. tauri examples/streaming: https://github.com/tauri-apps/tauri/tree/dev/examples/streaming
40. marc2332/tauri-terminal: https://github.com/marc2332/tauri-terminal
41. Hermes IDE terminal skill/architecture: https://skillsmp.com/skills/aradotso-hermes-skills-skills-hermes-ide-terminal
42. xtermjs.org (real-world uses): http://xtermjs.org/