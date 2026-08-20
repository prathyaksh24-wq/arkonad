import "@xterm/xterm/css/xterm.css";
import "./style.css";

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";

type SessionInfo = {
  id: string;
  shell: string;
  cwd: string;
};

type SessionExited = {
  id: string;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Arkonad root element is missing");
}

app.innerHTML = `
  <section class="frame">
    <header class="topbar">
      <div class="brand"><span class="ember">◆</span><span>arkonad</span></div>
      <div class="session-meta" data-session-meta>starting terminal session…</div>
      <div class="status" data-status>connecting</div>
    </header>
    <main class="terminal-shell">
      <div class="terminal" data-terminal></div>
      <div class="error-panel" data-error hidden></div>
    </main>
    <footer class="bottombar">
      <span>Leader+Space controls</span>
      <span>Ctrl+Shift+C copy</span>
      <span>Ctrl+Shift+V paste</span>
      <span data-cwd></span>
    </footer>
  </section>
`;

const terminalElement = app.querySelector<HTMLDivElement>("[data-terminal]")!;
const sessionMeta = app.querySelector<HTMLDivElement>("[data-session-meta]")!;
const status = app.querySelector<HTMLDivElement>("[data-status]")!;
const cwdLabel = app.querySelector<HTMLSpanElement>("[data-cwd]")!;
const errorPanel = app.querySelector<HTMLDivElement>("[data-error]")!;

if (!terminalElement || !sessionMeta || !status || !cwdLabel || !errorPanel) {
  throw new Error("Arkonad frame elements are missing");
}

const terminal = new Terminal({
  allowProposedApi: false,
  convertEol: false,
  cursorBlink: true,
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 14,
  scrollback: 10_000,
  theme: {
    background: "#090b0e",
    foreground: "#e8ecef",
    cursor: "#ff9c4a",
    cursorAccent: "#090b0e",
    selectionBackground: "#36404a",
    black: "#090b0e",
    red: "#ff766b",
    green: "#9ed67a",
    yellow: "#ffcf70",
    blue: "#83b8ff",
    magenta: "#d8a3ff",
    cyan: "#7bd7d1",
    white: "#e8ecef",
    brightBlack: "#68737d",
    brightWhite: "#ffffff",
  },
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.loadAddon(new SearchAddon());
terminal.loadAddon(new WebLinksAddon());

try {
  terminal.loadAddon(new WebglAddon());
} catch {
  // WebGL is an optional renderer. xterm's DOM renderer remains the fallback.
}

terminal.open(terminalElement);
fitAddon.fit();
terminal.focus();

let session: SessionInfo | undefined;
let resizeTimer: number | undefined;

function showError(message: string): void {
  status.textContent = "error";
  status.dataset.state = "error";
  errorPanel.hidden = false;
  errorPanel.textContent = message;
}

function sendResize(): void {
  if (!session) {
    return;
  }

  const dimensions = fitAddon.proposeDimensions();
  if (!dimensions) {
    return;
  }

  void invoke("resize_session", {
    id: session.id,
    cols: dimensions.cols,
    rows: dimensions.rows,
  }).catch((error: unknown) => showError(String(error)));
}

function scheduleResize(): void {
  if (resizeTimer !== undefined) {
    window.clearTimeout(resizeTimer);
  }
  resizeTimer = window.setTimeout(sendResize, 80);
}

terminal.onData((data) => {
  if (!session) {
    return;
  }

  void invoke("write_session", {
    id: session.id,
    data: new TextEncoder().encode(data),
  }).catch((error: unknown) => showError(String(error)));
});

terminal.attachCustomKeyEventHandler((event) => {
  if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) {
    return true;
  }

  if (event.key.toLowerCase() === "c" && terminal.hasSelection()) {
    event.preventDefault();
    void writeText(terminal.getSelection()).catch((error: unknown) => showError(String(error)));
    return false;
  }

  if (event.key.toLowerCase() === "v") {
    event.preventDefault();
    void readText()
      .then((text) => terminal.paste(text))
      .catch((error: unknown) => showError(String(error)));
    return false;
  }

  return true;
});

window.addEventListener("resize", scheduleResize);
window.addEventListener("beforeunload", () => {
  if (session) {
    void invoke("close_session", { id: session.id });
  }
});

void listen<SessionExited>("session-exited", (event) => {
  if (event.payload.id !== session?.id) {
    return;
  }
  status.textContent = "stopped";
  status.dataset.state = "stopped";
  terminal.write("\r\n\u001b[90m[session stopped]\u001b[0m\r\n");
});

async function startSession(): Promise<void> {
  const output = new Channel<Uint8Array>();
  output.onmessage = (chunk) => terminal.write(chunk);

  try {
    session = await invoke<SessionInfo>("create_session", {
      request: {
        cols: fitAddon.proposeDimensions()?.cols ?? 120,
        rows: fitAddon.proposeDimensions()?.rows ?? 40,
        cwd: null,
        shell: null,
      },
      onOutput: output,
    });
    sessionMeta.textContent = session.shell;
    cwdLabel.textContent = session.cwd;
    status.textContent = "ready";
    status.dataset.state = "ready";
    sendResize();
    terminal.focus();
  } catch (error) {
    showError(`Could not start the terminal session: ${String(error)}`);
  }
}

void startSession();
