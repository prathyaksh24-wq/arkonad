# Agent CLI & Integration Tool Capability Table

Research ticket for Arkonad: which candidate agent CLIs and integration tools can be
spawned and supervised from inside a Windows terminal emulator (PTY panes/sidebar).

Date: 2026-08-14 · Branch: `research/agent-capabilities`

CLI versions verified locally on this Windows machine (via `--help` / `--version`):
`codex-cli 0.147.0`, `claude 2.1.170`, `opencode 1.18.18`.

---

## 1. Agent CLIs

### codex (OpenAI Codex CLI)

| Aspect | Finding |
|---|---|
| What | OpenAI's open-source terminal coding agent (Rust). Runs locally, executes shell commands, edits files, code review. |
| Run model | Interactive TUI (default) + `codex exec` (non-interactive) + `codex review` + `codex mcp-server` (stdio) + `codex app-server`/`remote-control` (experimental) + `codex app` (desktop). |
| TTY requirement | TUI needs a real terminal; `codex exec` is fully non-interactive (reads prompt from argv or stdin; runs piped/CI without a TTY). |
| Output format | `codex exec --json` → JSONL event stream (`thread.started`, `turn.started`, `item.*`, `turn.completed`, `turn.failed`, `error`); progress to stderr, final message to stdout; `--output-schema <file>` for validated JSON; `-o/--output-last-message <file>`. |
| Session / resume | `codex exec resume --last` / `codex resume --last [SESSION_ID] [PROMPT]`; `codex fork`; `--ephemeral` skips persistence; sessions stored under `~/.codex/sessions` (JSONL rollout). |
| Busy detection | `turn.started`/`turn.completed` JSONL events; exit codes (`--full-auto` is a deprecated alias of `--sandbox workspace-write`); for the interactive TUI: experimental `app-server` + `remote-control` websocket, or tail `~/.codex/sessions/*.jsonl`; TUI `/status` command. |
| Windows | Official. `npm install -g @openai/codex` (Node 22+), standalone installer (`irm https://chatgpt.com/codex/install.ps1 | iex`), prebuilt `codex.exe` on GitHub Releases, or WSL2. Native Windows sandbox is experimental (AppContainer-based, network-blocked by default); WSL2 gives the mature Landlock/seccomp sandbox. |
| License / maintenance | Apache-2.0 (github.com/openai/codex). Very active, multiple releases/month. |

Sources: local `codex --help` (0.147.0); https://developers.openai.com/codex/noninteractive ;
https://github.com/openai/codex ; https://learn.chatgpt.com/docs/non-interactive-mode ;
https://developers.openai.com/codex/cli/reference.

### claude (Anthropic Claude Code)

| Aspect | Finding |
|---|---|
| What | Anthropic's agentic coding CLI: repo-aware chat, edits, shell, git, subagents, agent teams. |
| Run model | Interactive TUI (default); `-p/--print` non-interactive (auto-engages when stdout is not a TTY); `--output-format text\|json\|stream-json`; `--input-format stream-json`; `claude agents` (background agents); `--remote-control`; `--tmux`/`--worktree` (teams). |
| TTY requirement | No for `-p` (pipes, CI, no TTY fine — trust dialog skipped in non-interactive mode). Interactive mode wants a terminal. |
| Output format | `-p --output-format json` (single result) or `stream-json` (realtime events, `--include-partial-messages` for chunks, `--include-hook-events`); plain text default. |
| Session / resume | `-c/--continue` (most recent), `-r/--resume [session-id]`, `--fork-session`, `--session-id <uuid>`, `--from-pr`; `--no-session-persistence`; sessions persist as JSONL under `~/.claude/projects/<cwd-hash>/<session-id>.jsonl`. |
| Busy detection | stream-json `system` events with turn boundaries; hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart/End`); `claude agents --json` lists active background sessions (explicitly "does not require a TTY"); session JSONL files; `--max-budget-usd` kill switch. |
| Windows | Official native support: Windows 10 1809+ / Server 2019+, `irm https://claude.ai/install.ps1 | iex`, `winget install Anthropic.ClaudeCode`, npm. No sandboxing on native Windows (WSL2 adds it). Git for Windows recommended for the Bash tool. |
| License / maintenance | Proprietary (Anthropic commercial terms; not OSI). Very active, near-weekly releases. |

Sources: local `claude --help` (2.1.170); https://code.claude.com/docs/en/setup ;
https://code.claude.com/docs/en/agent-teams ; local `claude agents --help`.

### opencode (opencode-ai/opencode)

| Aspect | Finding |
|---|---|
| What | Open-source (MIT) terminal AI coding agent in Go; 75+ providers, LSP, MCP, plugin system, subagents. |
| Run model | TUI (default); `opencode run <msg>` non-interactive; `opencode serve` headless HTTP server (SSE); `opencode acp` ACP server; `opencode web`; `opencode attach <url>` (attach client to running server); `opencode session list`. |
| TTY requirement | TUI needs terminal; `run`, `serve`, `acp`, `attach` are headless-capable. |
| Output format | `run --format json` (raw JSON events) or default formatted; server has REST/SSE event API. |
| Session / resume | `-c/--continue`, `-s/--session <id>`, `--fork`, `--title`; SQLite storage; `opencode session list/delete`, `opencode export/import <sessionID>`. |
| Busy detection | `run --format json` event stream; `serve` HTTP + SSE endpoints (workspace/session events); `attach` to a live server; `opencode session list`. |
| Windows | Native (npm `opencode` package; Windows binaries). TUI works in Windows Terminal via Bubble Tea/crossterm. |
| License / maintenance | MIT. Very active (v1.18.18 at check time). |

Sources: local `opencode --help`, `opencode run --help`, `opencode serve --help`, `opencode session --help` (1.18.18); https://github.com/opencode-ai/opencode ; https://opencode.ai/docs.

---

## 2. Integration tools

### charmbracelet/crush

| Aspect | Finding |
|---|---|
| What | Charm's "glamorous agentic coding" CLI (Go/Bubble Tea): LLM coding agent with sessions, LSP context, MCP, skills (Agent Skills), multi-provider (incl. Ollama local). |
| Run model | TUI (default) + `crush run` (non-interactive CLI) + `crush serve` (headless server, HTTP + SSE workspaces) + `crush logs` helper; `--yolo` bypasses permissions. |
| TTY requirement | TUI needs a terminal; `crush run` and `crush serve` are headless. |
| Windows | First-class: `winget install charmbracelet.crush`, `scoop install crush`, native PowerShell; `crushrc` (bash-based config) runs identically on Windows via a built-in bash interpreter. |
| License / maintenance | FSL-1.1-MIT (open source with trademark clause; converts to MIT after 2 years). Extremely active: 27.4k stars, 4,009 commits, steady releases. |
| Supervision fit | **Best-in-class for Arkonad**: `crush serve` exposes per-session `IsBusy` and `AttachedClients` signals over SSE; shared workspaces keyed by `--cwd`; multiple TUIs can attach to one running workspace; `crush logs --follow` for streaming output. |
| Notes | Permissions system per tool; `crush.json`/`crushrc` config; desktop notifications on turn end. |

Sources: https://github.com/charmbracelet/crush ; https://charmbracelet-crush.mintlify.app/ ;
https://deepwiki.com/charmbracelet/crush/2-getting-started (crush run); https://vercel.com/docs/ai-gateway/coding-agents/crush (Windows install options).

### SeemSeam/claude_codex_bridge (CCB)

| Aspect | Finding |
|---|---|
| What | Python "visible multi-agent CLI workspace": coordinates Codex, Claude, Gemini, opencode and other CLIs in labeled panes under tmux supervision, with cross-agent messaging, shared project memory (`.ccb/ccb_memory.md`), background daemons, mobile remote controller. |
| Run model | TUI over tmux (recommended), per-provider background daemons (`askd`), CLI commands (`ccb`, `ask`, `ccb-ping`, `ccb config ui`, `ccb update mobile`); headless daemon keeps state alive when UI closes. |
| TTY requirement | Yes for the TUI (tmux panes); daemons run headless. tmux is required on POSIX → on Windows that means WSL. |
| Windows | Partial. Platform badge: "Linux · macOS · WSL-lightweight". tmux has no native Windows port; README recommends WSL. Native path exists via WezTerm + PowerShell (`install.ps1` present, v5.x documented "Windows WezTerm + PowerShell support", `DETACHED_PROCESS` background execution) but current v8 docs are WSL-focused. |
| License / maintenance | **AGPL-3.0** (repo LICENSE) — copyleft; closed-source/commercial use requires separate license. Very active: v8.5.7, ~3.4k stars, weekly pushes, 87 open issues. |
| Supervision fit | Conceptually identical to Arkonad's goal (spawn-and-supervise multi-agent teams with per-agent panes). Rough edges: tmux dependence on Windows, AGPL licensing for a proprietary product, mobile/relay feature sprawl. Worth studying as a design reference rather than embedding. |
| Notes | Agent adapters for Codex/Claude write CCB-marked config blocks; `ccb-diagnose` inspects live pane state; config UI binds to loopback with token auth. |

Sources: https://github.com/SeemSeam/claude_codex_bridge ; LICENSE file (raw.githubusercontent.com/SeemSeam/claude_codex_bridge/main/LICENSE, AGPL-3.0); ecoste.ms metadata (last push 2026-07-26).

### llmfit (AlexsJones/llmfit)

| Aspect | Finding |
|---|---|
| What | Rust terminal tool that "right-sizes" local LLM models to your hardware: detects RAM/CPU/GPU/VRAM, scores hundreds of models on quality/speed/fit/context, recommends quantizations and runtimes (Ollama, llama.cpp, MLX, Docker Model Runner, LM Studio). Note: it is a model-selection/fit tool, not an agent runner — the "fitness trainer for terminal workflows" framing in the ticket is close: it trains YOU to pick models that fit, and can be called by agents via JSON. |
| Run model | TUI (default) + classic CLI (`llmfit --cli`, `system`, `search`, `info`, `fit`, `recommend --json`, `doctor`); JSON output for scripting; TUI plan mode for hardware planning. |
| TTY requirement | TUI needs terminal; CLI/JSON subcommands are headless-friendly. |
| Windows | Yes: `scoop install llmfit`; native binaries via GitHub Releases; cross-platform Rust (sysinfo/crossterm). |
| License / maintenance | MIT. Active: v1.1.3 (2026-07-14), ~29k stars, last push 2026-07-18. |
| Supervision fit | One-shot CLI, no supervision needed. In Arkonad it fits as a sidebar widget: "which coding model can this machine actually run / how many agents can run in parallel" (`llmfit recommend --json --use-case coding`). It can also tell you local-model feasibility to gate which agent CLIs get offered. |
| Notes | Speed estimates validated against llama.cpp benchmarks; `bench --share` community leaderboard. |

Sources: https://www.llmfit.org/ ; https://github.com/AlexsJones/llmfit (README: TUI default, `recommend --json`, scoop on Windows); https://www.everydev.ai/tools/llmfit (v1.1.3, activity).

### tweakcc (Piebald-AI/tweakcc)

| Aspect | Finding |
|---|---|
| What | Claude Code customization CLI: patches `cli.js` (npm and native installs) to change system prompts, add themes/thinking verbs/spinners, custom toolsets (`/toolset`), input-box styling, AGENTS.md support, unlock hidden/unreleased features. |
| Run model | Interactive TUI (`npx tweakcc`; React/Ink menu) + JSON config-driven patching; one-shot apply, no daemon/server. |
| TTY requirement | Interactive menu needs TTY; the patching action itself is one-shot. |
| Windows | Yes — "Supports both native/npm installs on all platforms", patches native Windows CC binaries. |
| License / maintenance | MIT. Active: v4.3.1, ~2.3k stars, weekly pushes. |
| Supervision fit | Setup-time tool, not a runtime supervisor. In Arkonad: run once per agent pane to give each Claude agent a distinct theme, restricted toolset, and custom system prompt; then Claude Code runs normally. |
| Notes | Also patches CC bugs (frozen spinner, statusline throttling, token-counter pacing). |

Sources: https://github.com/Piebald-AI/tweakcc ; https://piebald.ai/blog/tweakcc-v4 ; repodepot.quetzals.ai metadata (v4.3.1, MIT, weekly pushes).

---

## 3. Cross-cutting notes: busy-state detection & session management

### Busy/idle detection from outside

| Tool | Best mechanism |
|---|---|
| codex | `codex exec --json` JSONL: `turn.started` / `turn.completed` / `turn.failed` / process exit. Interactive mode: experimental `app-server` + `remote-control`, or watch `~/.codex/sessions/*.jsonl`. |
| claude | `-p --output-format stream-json` event stream (turn events); `claude agents --json` (background sessions, no TTY needed); hooks (`UserPromptSubmit`/`SessionStart` etc.) → post to Arkonad; watch `~/.claude/projects/**/*.jsonl`. |
| opencode | `run --format json` event stream; `opencode serve` HTTP/SSE events; `opencode attach` to live server; `opencode session list`. |
| crush | `crush serve` SSE workspaces expose `IsBusy` + `AttachedClients` per session (explicit, documented signals); `crush logs --follow`. |
| CCB | `ccb-ping`/daemon state, `ccb-diagnose` pane-state classification (working / waiting-input / stale / error / dead); built for this exact job. |
| llmfit / tweakcc | Not applicable — one-shot tools, no running state. |

Practical rule: prefer process-alive + event-stream approaches (JSONL/SSE) over screen scraping;
all four agent CLIs emit machine-readable events natively, so Arkonad should not need PTY
output parsing for state — only for live log display.

### Session management

- All four agent CLIs persist sessions on disk and support resume by id/`--last`:
  codex (`exec resume --last`), claude (`-r`, `--fork-session`), opencode (`-s`, `--fork`,
  `session list`), crush (session picker, workspaces).
- None of the four has a first-class "list sessions of a running instance via API" except
  opencode (`session list`, server API) and crush (`serve` workspaces). For codex/claude,
  Arkonad should manage resume ids itself (capture id from JSONL `thread.started` /
  session-id flag) and pass them back on re-spawn.
- Background/daemonized execution is natively supported by opencode (`serve`), crush
  (`serve`) and CCB (askd daemons); codex and claude are process-per-session (claude adds
  background agents + remote-control).

---

## 4. Red flags

1. **claude_codex_bridge is AGPL-3.0 and tmux-bound on Windows.** Embedding it (or
   vendoring its adapter code) in a proprietary Arkonad would trigger copyleft. Its primary
   Windows path is WSL; the native WezTerm path is legacy/secondary. Treat as a design
   reference, not a dependency.
2. **codex native Windows sandbox is experimental.** Fine for supervised panes (workspace-write
   default, network blocked by default), but don't claim parity with its Linux sandbox.
3. **claude's native Windows build has no sandboxing** (WSL2 required for that). Arkonad's
   own supervision must be the safety boundary.
4. **codex `exec --json` schema is unversioned** — field renames have broken consumers in the
   past (`item_type`→`type`); pin the codex version or parse defensively.
5. **llmfit and tweakcc are not runtime supervision tools** — they are one-shot helpers
   (model fit scoring / CC customization). Don't plan long-lived supervision for them.
6. **CCB feature sprawl** (mobile relay, encrypted pairing, config UI) is over-engineered for
   a terminal-embedded sidebar; rolling your own supervisor over the four CLIs' native event
   streams is likely simpler and more robust than adopting CCB wholesale.

## 5. Bottom line for Arkonad

- All three agent CLIs (codex, claude, opencode) are spawn-and-supervise friendly on Windows:
  non-interactive modes, machine-readable output, session resume, no real-TTY requirement.
- crush is the closest "batteries-included" supervisor-ready agent (headless serve + IsBusy
  SSE signals) and is worth a pilot as an embedded pane.
- CCB is the closest reference for the multi-agent-pane product concept, but is disqualified
  as a dependency by AGPL + Windows/tmux friction.
- llmfit is a cheap, high-value sidebar widget; tweakcc is a nice-to-have setup utility for
  per-pane Claude theming/toolset isolation.
