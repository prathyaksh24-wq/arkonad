# Catalog Integration Candidate Shortlist

Research deliverable for the Arkonad catalog feature. Purpose: identify the best candidate external TUI/CLI tools to integrate per feature family, ranked, with a recommended MVP tool set. All facts below were verified against project pages / docs as of 2026-08-14; URLs are cited inline.

- Scope: Windows-native support is the hard filter (Arkonad is a Windows terminal).
- Sources: `terminaltrove.com` TUI catalog (~400 tools) and the awesome-tui AI/LLM list (32 tools) — both fetched 2026-08-12.
- Method: cross-check each flagged candidate against its GitHub repo / docs / package registries; reject or downgrade anything without native Windows support or with a rough Windows story.

## Legend

- Windows: `native` = official Windows builds/package manager support; `wsl` = Linux-only, needs WSL; `none` = no Windows path.
- Effort: integration effort inside Arkonad (launch-in-pane vs embedded vs bundled). Impact: user value vs cost.
- Grades: A = ship in v1; B = strong candidate, ship later or pilot; C = needs verification; ✗ = red flag for Windows.

---

## 1. Multiplexer core (panes / tabs / sessions)

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **zellij** | Full terminal multiplexer: panes, tabs, sessions, layouts, plugins; Claude Code supports `teammateMode: zellij` | native (since v0.44.0, 2026-03-23 — https://www.heise.de/en/news/Now-also-for-Windows-Terminal-multiplexer-Zellij-0-44-0-released-11221441.html ; https://zellij.dev/news/remote-sessions-windows-cli/) | winget / scoop / binary | MIT | very active | pane-in-app or delegated mux | B — high impact but heavy; overlaps Arkonad's own pane model. Pilot before committing |
| 2 | tmux | De-facto standard multiplexer | none (WSL only) | — | ISC | active | — | ✗ |
| 3 | **cy** (`cfoust/cy`) | "Time travel in the terminal" — mux with session replay | none — linux/macos only (https://terminaltrove.com/cy/) | — | MIT | active (~1.5k commits) | — | ✗ |

---

## 2. Time-travel history / session replay

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **atuin** (`atuinsh/atuin`) | Cross-device shell history with context, sync, statistics, Ctrl-R search; ideal on Windows PowerShell | native (winget / scoop) | winget | MIT | very active | hook into shell, ship search TUI | A |
| 2 | **hishtory** (`ddworken/hishtory`) | Context-rich history (cwd, exit code, duration), E2E-encrypted sync, Ctrl-R TUI, AI shell assistance | client runs on Windows, but official shell hooks are bash/zsh/fish only (https://github.com/ddworken/hishtory) | binary via install script / mise | MIT | very active (0.335, 437 versions, 2.3k commits) | TUI is spawn-in-pane | B− — PowerShell hook is unofficial, prefer atuin on Windows |
| 3 | **cy** (`cfoust/cy`) | True session replay multiplexer | none — linux/macos only | — | MIT | — | — | ✗ |

---

## 3. File manager

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **yazi** (`sxyazi/yazi`) | Blazing-fast terminal file manager; vim keybinds, previews (image preview needs chafa/ueberzugpp) | native (winget / scoop) | winget | MIT | very active | spawn-in-pane | A |
| 2 | **superfile** (`MHNightCat/superfile`) | Modern multi-pane file manager | native (binary releases) | binary / winget | MIT | active | spawn-in-pane | B |

---

## 4. System monitor

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **btm / bottom** (`ClementTsang/bottom`) | Cross-platform `top`/`htop` alternative: CPU/GPU/mem/net/temp widgets | native (winget / scoop) | winget | MIT | very active | spawn-in-pane or widget | A |
| 2 | **btop** | Fancy system monitor (Linux/macOS first) | none native — needs `btop4win` port or WSL (https://x-cmd.com/install/btop/) | — | Apache-2.0 | active | — | ✗ (use btm) |
| 3 | **glances** | Python cross-platform monitor | native (pip / winget) | pip | AGPL-3.0 | active | spawn-in-pane | B− heavy runtime |

---

## 5. Cheatsheets

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **navi** (`denisidoro/navi`) | Interactive cheatsheet browser; community sheets; fuzzy search | native binary exists; requires fzf/skim (https://github.com/denisidoro/navi) | binary / scoop | Apache-2.0 | active (17.4k stars) | keybind + spawn-in-pane | B — fzf dependency |
| 2 | **tealdeer** (`dbrgn/tealdeer`) | Fast offline `tldr` man-page summaries | native (winget) | winget | MIT | very active | keybind | B+ (zero-dep, not in flagged list but strongest low-effort option) |
| 3 | **eg** (`srsudar/eg`) | Example-driven cheatsheets | native (binary) | binary | MIT | maintained | keybind | C — verify packaging |

---

## 6. AI sidecar chat

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **aichat** (`sigoden/aichat`) | All-in-one LLM CLI: Shell Assistant, Chat-REPL, RAG, agents, 20+ providers | native (scoop; prebuilt Windows binaries) (https://github.com/sigoden/aichat) | scoop / binary | MIT OR Apache-2.0 | very active (10.3k stars) | spawn-in-pane / split | A |
| 2 | **llmfit** (`AlexsJones/llmfit`) | Right-sizes LLM models to your hardware; interactive TUI default; local runtimes (Ollama/llama.cpp/MLX/LM Studio); benchmark & share; Authenticode-signed Windows binaries (https://github.com/AlexsJones/llmfit) | native (scoop) | scoop | MIT | very active (31.4k stars) | spawn-in-pane | A — complements chat sidecars, not a chat itself |
| 3 | **oterm** (`ggozad/oterm`) | Terminal client for LLMs (Textual); Ollama/OpenAI/Anthropic + any pydantic-ai provider; MCP | native (uvx / pip) | uvx | MIT | active (2.4k stars) | spawn-in-pane | B |
| 4 | **elia** (`darrenburns/elia`) | Keyboard-centric LLM TUI (Textual); SQLite store; local + hosted models | native (pipx) | pipx | Apache-2.0 | maintained (2.5k stars) | spawn-in-pane | B |
| 5 | **tenere** (`pythops/tenere`) | TUI for LLMs, local-first; Windows config path exists (`~/AppData/Roaming/tenere/config.toml`) | native | cargo / binary | AGPL-3.0 | active | spawn-in-pane | B− copyleft caveat |

---

## 7. Agent status / team tools

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **claude_codex_bridge** (`SeemSeam/claude_codex_bridge`) | Visible multi-agent workspace — Claude/Codex/Gemini/OpenCode etc. in split panes (WezTerm or tmux backend); ships install.cmd/install.ps1/install.sh; documented to work on Linux/macOS/WSL and Windows native (https://github.com/SeemSeam/claude_codex_bridge) | native (WezTerm backend) or WSL | install.ps1 / install.cmd | LICENSE file present (verify type before bundling) | very active (3.4k stars, 1.6k commits; v8.5.6 — note v8.5.5 was withdrawn 2026-08-05) | pane grid | B — pilot; tmux-centric core + fast release cadence |
| 2 | **tweakcc** (`Piebald-AI/tweakcc`) | Patches Claude Code: custom system prompts, themes, thinking verbs, spinners, toolsets, input highlighters; explicit Windows/macOS/Linux support incl. native binaries (https://github.com/Piebald-AI/tweakcc) | native (npm) | npm (`npx tweakcc`) | MIT | very active (2.4k stars, v4.0.0, verified against CC 2.1.162) | out-of-band — patches CC install | B — Claude-Code-specific, not Arkonad-native |
| 3 | **sidecar** (`marcus/sidecar`) | TUI dashboard for AI coding agents | none native — macOS/Linux/WSL only (https://terminaltrove.com/sidecar/) | binary | MIT | new | — | ✗ |
| 4 | **toad** (`batrachianai/toad`) | Agent-swarm orchestrator with Agent Client Protocol | none — Linux/macOS only, Windows on roadmap (https://github.com/batrachianai/toad) | pip | AGPL-3.0 | active (3.4k stars) | — | ✗ |

---

## 8. Output filtering / telemetry / viewers

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **fx** (`antonmedv/fx`) | Interactive JSON viewer/explorer, jq-style | native (winget) | winget | MIT | active | keybind / spawn-in-pane | A |
| 2 | **toolong** (`bottlerocketlabs/toolong`) | Log viewer with search, tail, error filtering, telemetry-ish summaries (Textual) | native (winget / pip) | winget | MIT | active | keybind | B |
| 3 | **tv (Tidy Viewer)** (`alexhallam/tv`) | CSV/TSV/PSV/Parquet pretty printer with column styling; streaming for big files | native (Windows release binaries) (https://github.com/alexhallam/tv) | binary / cargo | MIT + Unlicense (dual) | maintained (2.2k stars) | keybind (pipe-aware) | B |
| 4 | **glow** (`charmbracelet/glow`) | Render markdown in the terminal | native (winget) | winget | MIT | very active | keybind | B |
| 5 | **lnav** (`tstack/lnav`) | Log file navigator: SQL queries, histograms, error views | "mostly works": Windows binaries need `msys-2.0.dll` in same dir, emoji/encoding issues, no winget yet (https://github.com/tstack/lnav/discussions/1492) | binary | BSD-2 | active | keybind | C — rough Windows story |
| 6 | **jless** (`pauljuliusmartinez/jless`) | Interactive JSON pager | none — "currently supports macOS and Linux. Windows support is planned." (https://github.com/pauljuliusmartinez/jless) | — | MIT | maintained (5.4k stars) | — | ✗ (fx covers this) |

---

## 9. Dev workflow (git / gh)

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **gitui** (`extrawurst/gitui`) | Fast git TUI: blame, staging, stash, log | native (winget) | winget | MIT | very active | spawn-in-pane | B |
| 2 | **gh-dash** (`dlvhdr/gh-dash`) | GitHub dashboard TUI: PRs, issues, checks | native (winget) | winget | MIT | very active | spawn-in-pane | B |

---

## 10. Cool / fun / aesthetic

| Rank | Tool | What it does | Windows | Install | License | Health | Embed | Grade |
|---|---|---|---|---|---|---|---|---|
| 1 | **vhs** (`charmbracelet/vhs`) | Declarative terminal GIF/MP4/WebM recorder from `.tape` scripts; CI-friendly | native (winget / scoop); requires ttyd + ffmpeg (https://github.com/charmbracelet/vhs) | winget | MIT | very active | dev-only, not runtime | B — great for docs/demos of Arkonad itself |
| 2 | **glow** | Markdown with pizzazz (see §8) | native | winget | MIT | very active | keybind | B |
| 3 | **television** (`alexpasmantier/television`) | General-purpose fuzzy finder TUI | native (winget) | winget | MIT | active | keybind | C — verify against MVP needs |

Honorable mentions (not verified in this pass — flag for follow-up): `mprocs` (multi-process runner, Go, MIT), `superfile` (see §3), `diskbloom` (disk usage TUI — Windows unverified), `hwinfo-tui` (Linux-only), `wintui` / `ntop-windows` (Windows-specific, niche), `herdr`, `ralph-tui`, `amux` (Linux-first, unverified).

---

## Red flags (popular tools that do NOT fit native Windows)

| Tool | Problem |
|---|---|
| `cy` (cfoust) | Unix-only time-travel mux — no Windows |
| `jless` | JSON pager — macOS/Linux only, "Windows planned" |
| `toad` | Agent orchestration — Linux/macOS only, Windows on roadmap |
| `btop` | No native Windows — btop4win fork or WSL required |
| `sidecar` | macOS/Linux/WSL only — no native Windows |
| `hishtory` | Official hooks bash/zsh/fish only — PowerShell hook unofficial |
| `lnav` | Windows binaries exist but rough (msys-2.0.dll, encoding/emoji, no winget) |
| `claude_codex_bridge` | tmux-centric core; Windows-native needs WezTerm backend; v8.5.5 was withdrawn (release turbulence) |
| `tenere` / `toad` / `glances` | AGPL-3.0 copyleft — legal review before bundling |

---

## Recommended v1 tool set (proposal — for decision)

Tier 1 — ship in v1 (all Windows-native via winget/scoop, all permissive licenses):

| Tool | One-line reason |
|---|---|
| **btm** | The only first-class native Windows system monitor; winget install |
| **yazi** | Fastest cross-platform terminal file manager, native Windows |
| **fx** | JSON viewing is the highest-frequency power-user need; jq-style |
| **glow** | Markdown rendering everywhere; zero-dependency charm tool |
| **gitui** | Git power without leaving the terminal; native Windows |
| **aichat** | LLM sidecar chat with Shell Assistant — the AI differentiator |
| **atuin** | History search/sync done right on PowerShell/Windows |
| **navi** (or tealdeer) | Cheatsheet discovery; navi needs fzf — tealdeer if we want zero deps |

Tier 2 — pilot / v1.1 (bigger effort or narrower fit):

| Tool | One-line reason |
|---|---|
| **llmfit** | Hardware-aware model fitting — differentiator for local-AI users; signed Windows builds |
| **tweakcc** | Claude Code theming/prompt control — cheap win for CC users |
| **claude_codex_bridge** | Multi-agent pane orchestration — pilot with WezTerm backend, watch release stability |
| **zellij** | Real multiplexing — evaluate overlap with Arkonad's own pane model before committing |
| **tv (Tidy Viewer)** | CSV/Parquet pretty printing — niche but delightful |
| **toolong** | Log telemetry view — needs Windows polish check |
| **vhs** | Docs/demo generation for Arkonad itself |

Hold: `tenere` (AGPL), `hishtory` (PowerShell gap), `sidecar`/`toad`/`cy`/`jless`/`btop` (no native Windows), `lnav` (rough Windows).

## Sources

- terminaltrove.com TUI catalog + tool pages (fetched 2026-08-12)
- awesome-tui AI/LLM tool list (fetched 2026-08-12)
- Project GitHub repos and READMEs: zellij-org/zellij, cfoust/cy, ddworken/hishtory, atuinsh/atuin, sxyazi/yazi, MHNightCat/superfile, ClementTsang/bottom, denisidoro/navi, dbrgn/tealdeer, sigoden/aichat, AlexsJones/llmfit, ggozad/oterm, darrenburns/elia, pythops/tenere, SeemSeam/claude_codex_bridge, Piebald-AI/tweakcc, marcus/sidecar, batrachianai/toad, antonmedv/fx, bottlerocketlabs/toolong, alexhallam/tv, charmbracelet/glow, charmbracelet/vhs, tstack/lnav, pauljuliusmartinez/jless, extrawurst/gitui, dlvhdr/gh-dash
- https://github.com/tstack/lnav/discussions/1492 (Windows status)
- https://x-cmd.com/install/btop/ (Windows support matrix)
- https://github.com/anthropics/claude-code/issues/23574 (WezTerm as split-pane backend context)