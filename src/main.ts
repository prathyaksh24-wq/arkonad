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

type CatalogCategory = "agent" | "productivity" | "git";
type CatalogStatusState = "active" | "inactive" | "unknown";

type CatalogStatus = {
  id: string;
  label: string;
  state: CatalogStatusState;
  detail: string;
};

type PrivilegeRequirement = "user" | "mayElevate" | "elevationRequired" | "unknown";

type CatalogManifest = {
  schemaVersion: number;
  id: string;
  name: string;
  summary: string;
  category: CatalogCategory;
  publisher: string;
  license: string;
  platforms: string[];
  source: {
    kind: string;
    url: string;
  };
  lastMetadataRefresh: string;
  executableDetection: {
    commands: string[];
  };
  versions: {
    latest: string | null;
    supported: string[];
    verified: string[];
  };
  installMethods: Array<{
    id: string;
    label: string;
    kind: string;
    source: string;
    command: string[] | null;
    packageId: string | null;
    version: string | null;
    privileges: PrivilegeRequirement;
    downloadSizeBytes: number | null;
    affectedSystemFeatures: string[];
    dataExpectations: string;
    rollbackLimits: string;
    verificationCommand: string[] | null;
    updateCommand: string[] | null;
    repairCommand: string[] | null;
    uninstallCommand: string[] | null;
  }>;
  prerequisites: Array<{
    id: string;
    label: string;
    description: string;
    kind: string;
    optional: boolean;
    check: string | null;
    command: string[] | null;
    source: string | null;
    privileges: PrivilegeRequirement;
    rollbackLimits: string;
  }>;
  launchProfiles: Array<{
    id: string;
    label: string;
    executable: string;
    arguments: string[];
    shell: string | null;
    workingDirectory: string | null;
  }>;
  dataLocations: Array<{
    kind: string;
    path: string;
    description: string;
  }>;
  networkExpectations: {
    required: boolean;
    summary: string;
    endpoints: string[];
  };
  optionalEnhancements: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  declaredCapabilities: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  verifiedCompatibility: string[];
  managedByArkonad: boolean;
};

type CatalogDetection = {
  manifestId: string;
  command: string;
  path: string;
  source: string;
  version: string | null;
};

type CatalogEntry = {
  manifest: CatalogManifest;
  statuses: CatalogStatus[];
  detection: CatalogDetection | null;
};

type InstallStep = {
  id: string;
  label: string;
  kind: string;
  optional: boolean;
  availability: "ready" | "missing" | "unknown";
  description: string;
  command: string[] | null;
  source: string | null;
  privileges: PrivilegeRequirement;
  rollbackLimits: string;
  requiresConfirmation: boolean;
};

type InstallPlan = {
  manifestId: string;
  toolName: string;
  publisher: string;
  version: string | null;
  catalogSource: {
    kind: string;
    url: string;
  };
  packageSource: string;
  methodId: string;
  methodLabel: string;
  methodKind: string;
  packageId: string | null;
  supported: boolean;
  command: string[] | null;
  privileges: PrivilegeRequirement;
  downloadSizeBytes: number | null;
  affectedSystemFeatures: string[];
  dataExpectations: string;
  rollbackLimits: string;
  prerequisites: InstallStep[];
  optionalSetup: InstallStep[];
  prerequisitesReady: boolean;
  appStep: InstallStep;
  manualInstructions: string | null;
};

type InstallReceipt = {
  id: string;
  ownership: "managed" | "adopted";
  manifestId: string;
  toolName: string;
  publisher: string;
  version: string | null;
  source: string;
  methodId: string | null;
  method: string;
  packageId: string | null;
  executablePath: string;
  verification: string;
  installedAt: string;
};

type InstallOutcome = {
  state: string;
  message: string;
  systemChange: boolean;
  retryable: boolean;
  rollbackAvailable: boolean;
  logs: string;
  manualRecovery: string | null;
  receipt: InstallReceipt | null;
};

type ManagementOperation =
  | "adopt"
  | "integrationReset"
  | "update"
  | "repair"
  | "uninstall"
  | "dataCleanup";

type MyAppEntry = {
  manifestId: string;
  toolName: string;
  summary: string;
  category: CatalogCategory;
  publisher: string;
  ownership: "managed" | "adopted" | "detected";
  installedVersion: string | null;
  detectedVersion: string | null;
  updateState: "available" | "current" | "unknown" | "notManaged";
  launchable: boolean;
  executablePath: string | null;
  source: string;
  lastCheckedAt: string;
  methodId: string | null;
  methodLabel: string | null;
  dataLocations: Array<{
    kind: string;
    path: string;
    description: string;
  }>;
  receipt: InstallReceipt | null;
};

type MyAppsSnapshot = {
  entries: MyAppEntry[];
  updatesAvailable: number;
  checkedAt: string;
};

type DataCleanupTarget = {
  id: string;
  label: string;
  kind: string;
  path: string;
  exists: boolean;
  allowed: boolean;
  reason: string;
};

type ManagementPlan = {
  manifestId: string;
  toolName: string;
  publisher: string;
  operation: ManagementOperation;
  ownership: string;
  installedVersion: string | null;
  source: string;
  methodId: string | null;
  methodLabel: string | null;
  methodKind: string | null;
  packageId: string | null;
  supported: boolean;
  command: string[] | null;
  privileges: PrivilegeRequirement;
  affectedSystemFeatures: string[];
  dataExpectations: string;
  rollbackLimits: string;
  dataTargets: DataCleanupTarget[];
  requiresConfirmation: boolean;
  manualInstructions: string | null;
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
      <button class="topbar-action" type="button" data-store-open aria-expanded="false">
        Store <span class="key-hint">Ctrl+Shift+Space</span>
      </button>
      <button class="topbar-action" type="button" data-apps-open aria-expanded="false">
        My Apps <span class="apps-update-badge" data-apps-update-badge hidden aria-live="polite"></span>
        <span class="key-hint">Ctrl+Shift+A</span>
      </button>
      <div class="status" data-status>connecting</div>
    </header>
    <main class="workspace">
      <section class="terminal-shell" data-terminal-shell>
        <div class="terminal" data-terminal></div>
        <div class="error-panel" data-error hidden></div>
      </section>
      <section class="store-shell" data-store-view hidden aria-label="Terminal App Store">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">TERMINAL APP STORE</span>
            <span class="store-title">Find a tool, then launch it in Arkonad</span>
          </div>
          <label class="store-control">
            <span>Search</span>
            <input data-store-search type="search" placeholder="name, publisher, category" autocomplete="off" />
          </label>
          <label class="store-control store-category-control">
            <span>Category</span>
            <select data-store-category>
              <option value="">All tools</option>
              <option value="agent">Coding agents</option>
              <option value="productivity">Productivity TUIs</option>
              <option value="git">Git tools</option>
            </select>
          </label>
          <button class="store-close" type="button" data-store-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-store-notice>Detection is read-only and checks PATH.</div>
        <div class="store-content">
          <section class="store-list-panel" aria-label="Catalog results">
            <div class="store-list-header">
              <span>Catalog</span>
              <span data-store-count>loading…</span>
            </div>
            <div class="store-list" data-store-list role="listbox" aria-label="Terminal tools"></div>
            <div class="store-error" data-store-error hidden></div>
          </section>
          <article class="store-detail" data-store-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ move</span>
          <span>Enter details</span>
          <span>Ctrl+Shift+Space close</span>
          <span>Esc terminal</span>
        </div>
      </section>
      <section class="store-shell" data-apps-view hidden aria-label="My Apps">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">MY APPS</span>
            <span class="store-title">Manage tools Arkonad can launch or owns</span>
          </div>
          <label class="store-control">
            <span>Search</span>
            <input data-apps-search type="search" placeholder="name, publisher, category" autocomplete="off" />
          </label>
          <button class="store-close" type="button" data-apps-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-apps-notice>Checking detected and Arkonad-managed tools…</div>
        <div class="store-content">
          <section class="store-list-panel" aria-label="My Apps results">
            <div class="store-list-header">
              <span>Installed tools</span>
              <span data-apps-count>loading…</span>
            </div>
            <div class="store-list" data-apps-list role="listbox" aria-label="My Apps"></div>
            <div class="store-error" data-apps-error hidden></div>
          </section>
          <article class="store-detail" data-apps-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ move</span>
          <span>Enter details</span>
          <span>Ctrl+Shift+A close</span>
          <span>Esc terminal</span>
        </div>
      </section>
    </main>
    <footer class="bottombar">
      <span>Leader+Space controls</span>
      <span>Ctrl+Shift+C copy</span>
      <span>Ctrl+Shift+V paste</span>
      <span>Ctrl+Shift+Space Store</span>
      <span>Ctrl+Shift+A My Apps</span>
      <span data-cwd></span>
    </footer>
  </section>
`;

const terminalShell = app.querySelector<HTMLElement>("[data-terminal-shell]")!;
const terminalElement = app.querySelector<HTMLDivElement>("[data-terminal]")!;
const sessionMeta = app.querySelector<HTMLDivElement>("[data-session-meta]")!;
const status = app.querySelector<HTMLDivElement>("[data-status]")!;
const cwdLabel = app.querySelector<HTMLSpanElement>("[data-cwd]")!;
const errorPanel = app.querySelector<HTMLDivElement>("[data-error]")!;
const storeOpenButton = app.querySelector<HTMLButtonElement>("[data-store-open]")!;
const appsOpenButton = app.querySelector<HTMLButtonElement>("[data-apps-open]")!;
const appsUpdateBadge = app.querySelector<HTMLSpanElement>("[data-apps-update-badge]")!;
const storeCloseButton = app.querySelector<HTMLButtonElement>("[data-store-close]")!;
const appsCloseButton = app.querySelector<HTMLButtonElement>("[data-apps-close]")!;
const storeView = app.querySelector<HTMLElement>("[data-store-view]")!;
const appsView = app.querySelector<HTMLElement>("[data-apps-view]")!;
const storeSearch = app.querySelector<HTMLInputElement>("[data-store-search]")!;
const storeCategory = app.querySelector<HTMLSelectElement>("[data-store-category]")!;
const storeNotice = app.querySelector<HTMLDivElement>("[data-store-notice]")!;
const storeCount = app.querySelector<HTMLSpanElement>("[data-store-count]")!;
const storeList = app.querySelector<HTMLDivElement>("[data-store-list]")!;
const storeError = app.querySelector<HTMLDivElement>("[data-store-error]")!;
const storeDetail = app.querySelector<HTMLElement>("[data-store-detail]")!;
const appsSearch = app.querySelector<HTMLInputElement>("[data-apps-search]")!;
const appsNotice = app.querySelector<HTMLDivElement>("[data-apps-notice]")!;
const appsCount = app.querySelector<HTMLSpanElement>("[data-apps-count]")!;
const appsList = app.querySelector<HTMLDivElement>("[data-apps-list]")!;
const appsError = app.querySelector<HTMLDivElement>("[data-apps-error]")!;
const appsDetail = app.querySelector<HTMLElement>("[data-apps-detail]")!;

if (
  !terminalShell ||
  !terminalElement ||
  !sessionMeta ||
  !status ||
  !cwdLabel ||
  !errorPanel ||
  !storeOpenButton ||
  !appsOpenButton ||
  !appsUpdateBadge ||
  !storeCloseButton ||
  !appsCloseButton ||
  !storeView ||
  !appsView ||
  !storeSearch ||
  !storeCategory ||
  !storeNotice ||
  !storeCount ||
  !storeList ||
  !storeError ||
  !storeDetail ||
  !appsSearch ||
  !appsNotice ||
  !appsCount ||
  !appsList ||
  !appsError ||
  !appsDetail
) {
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
let terminalStatusText = "connecting";
let terminalStatusState = "";
let storeOpen = false;
let activeSurface: "store" | "apps" = "store";
let storeEntries: CatalogEntry[] = [];
let selectedStoreId: string | undefined;
let storeRequestId = 0;
let storeRefreshTimer: number | undefined;
let installBusy = false;
let myAppsEntries: MyAppEntry[] = [];
let selectedMyAppId: string | undefined;
let myAppsRequestId = 0;
let myAppsRefreshTimer: number | undefined;

function renderTerminalStatus(): void {
  status.textContent = terminalStatusText;
  if (terminalStatusState) {
    status.dataset.state = terminalStatusState;
  } else {
    delete status.dataset.state;
  }
}

function setTerminalStatus(text: string, state = ""): void {
  terminalStatusText = text;
  terminalStatusState = state;
  if (!storeOpen) {
    renderTerminalStatus();
  }
}

function showError(message: string): void {
  setTerminalStatus("error", "error");
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

function makeElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function appendDetailSection(parent: HTMLElement, title: string): HTMLElement {
  const section = makeElement("section", "detail-section");
  section.append(makeElement("h3", "detail-section-title", title));
  parent.append(section);
  return section;
}

function appendDetailLine(parent: HTMLElement, label: string, value: string): void {
  const line = makeElement("div", "detail-line");
  line.append(makeElement("span", "detail-label", label));
  line.append(makeElement("span", "detail-value", value));
  parent.append(line);
}

function appendDetailList(parent: HTMLElement, values: string[], emptyText: string): void {
  if (values.length === 0) {
    parent.append(makeElement("p", "detail-empty", emptyText));
    return;
  }

  const list = makeElement("ul", "detail-list");
  for (const value of values) {
    list.append(makeElement("li", undefined, value));
  }
  parent.append(list);
}

function statusClass(state: CatalogStatusState): string {
  return `status-${state}`;
}

function privilegeLabel(value: PrivilegeRequirement): string {
  switch (value) {
    case "user":
      return "current user";
    case "mayElevate":
      return "may ask for elevation";
    case "elevationRequired":
      return "elevation required";
    default:
      return "not declared";
  }
}

function formatDownloadSize(value: number | null): string {
  if (value === null) {
    return "not available";
  }

  if (value < 1024) {
    return `${value.toLocaleString()} bytes`;
  }

  const units = ["KiB", "MiB", "GiB"];
  let size = value;
  let unit = "bytes";
  for (const candidate of units) {
    size /= 1024;
    unit = candidate;
    if (size < 1024 || candidate === units.at(-1)) {
      break;
    }
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit} (${value.toLocaleString()} bytes)`;
}

function formatTimestamp(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return value;
  }
  return new Date(seconds * 1000).toLocaleString();
}

function formatCommand(command: string[] | null): string {
  if (!command || command.length === 0) {
    return "not declared";
  }

  return command
    .map((part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part))
    .join(" ");
}

function appendInstallSource(parent: HTMLElement, label: string, value: string): void {
  const line = makeElement("div", "detail-line");
  line.append(makeElement("span", "detail-label", label));
  const link = makeElement("a", "detail-link", value);
  link.href = value;
  link.target = "_blank";
  link.rel = "noreferrer";
  line.append(link);
  parent.append(line);
}

function createInstallButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = makeElement("button", "detail-action", label) as HTMLButtonElement;
  button.type = "button";
  button.disabled = installBusy;
  button.addEventListener("click", onClick);
  return button;
}

function appendInstallStep(
  parent: HTMLElement,
  entry: CatalogEntry,
  plan: InstallPlan,
  host: HTMLElement,
  step: InstallStep,
  showAction = true,
): void {
  const stepView = makeElement("section", "install-step");
  const stepHeader = makeElement("div", "install-step-header");
  stepHeader.append(makeElement("strong", undefined, step.label));
  if (step.optional) {
    stepHeader.append(makeElement("span", "install-step-optional", "optional"));
  }
  stepView.append(stepHeader);
  stepView.append(makeElement("p", "install-step-description", step.description));

  const stepMeta = makeElement("div", "install-step-meta");
  appendDetailLine(stepMeta, "Type", step.kind);
  appendDetailLine(stepMeta, "Discovery", step.availability);
  appendDetailLine(stepMeta, "Privileges", privilegeLabel(step.privileges));
  appendDetailLine(stepMeta, "Rollback", step.rollbackLimits);
  if (step.source) {
    appendInstallSource(stepMeta, "Source", step.source);
  }
  stepView.append(stepMeta);

  if (step.command) {
    stepView.append(makeElement("code", "install-command", formatCommand(step.command)));
    if (step.kind !== "application" && step.availability === "ready") {
      stepView.append(
        makeElement("p", "detail-empty", "Already available; no setup action is needed."),
      );
    } else if (showAction) {
      const buttonRow = makeElement("div", "install-button-row");
      const label = step.optional ? "Approve optional step" : "Approve prerequisite";
      buttonRow.append(
        createInstallButton(label, () => void executeInstallStep(entry, plan, host, step.id)),
      );
      if (step.optional) {
        buttonRow.append(makeElement("span", "install-step-hint", "Or skip it and continue."));
      }
      stepView.append(buttonRow);
    }
  } else {
    stepView.append(
      makeElement(
        "p",
        "detail-empty",
        step.kind === "application"
          ? "No executable command is declared for this method; follow the publisher instructions. Arkonad will not guess a command."
          : step.optional
          ? "Optional manual prerequisite; skip it or follow the publisher instructions. Arkonad will not guess a command."
          : "Manual prerequisite; follow the publisher instructions. Arkonad will not guess a command.",
      ),
    );
  }

  parent.append(stepView);
}

async function loadInstallPlan(
  entry: CatalogEntry,
  host: HTMLElement,
  methodId: string,
): Promise<void> {
  if (installBusy) {
    return;
  }

  host.replaceChildren(makeElement("p", "detail-empty", "Preparing reviewed install plan…"));
  try {
    const plan = await invoke<InstallPlan>("install_plan", {
      manifestId: entry.manifest.id,
      methodId,
    });
    renderInstallPlan(entry, host, plan);
  } catch (error) {
    host.replaceChildren(
      makeElement("p", "install-manual", `Could not prepare the install plan: ${String(error)}`),
    );
  }
}

function renderInstallPlan(entry: CatalogEntry, host: HTMLElement, plan: InstallPlan): void {
  host.replaceChildren();
  const planView = makeElement("div", "install-plan");
  const heading = makeElement("div", "install-plan-heading");
  heading.append(makeElement("strong", undefined, `${plan.toolName} · ${plan.methodLabel}`));
  heading.append(
    makeElement(
      "p",
      "install-plan-warning",
      "Review only. Nothing runs until you approve a step.",
    ),
  );
  planView.append(heading);

  const facts = makeElement("div", "install-plan-facts");
  appendInstallSource(facts, "Catalog", plan.catalogSource.url);
  appendInstallSource(facts, "Package source", plan.packageSource);
  appendDetailLine(facts, "Publisher", plan.publisher);
  appendDetailLine(facts, "Version", plan.version ?? "not declared");
  appendDetailLine(facts, "Method", `${plan.methodKind} · ${plan.methodLabel}`);
  appendDetailLine(facts, "Package ID", plan.packageId ?? "not declared");
  appendDetailLine(facts, "Privileges", privilegeLabel(plan.privileges));
  appendDetailLine(facts, "Download size", formatDownloadSize(plan.downloadSizeBytes));
  appendDetailLine(
    facts,
    "Affected features",
    plan.affectedSystemFeatures.length > 0
      ? plan.affectedSystemFeatures.join(", ")
      : "none declared",
  );
  appendDetailLine(facts, "Data expectations", plan.dataExpectations);
  appendDetailLine(facts, "Rollback limits", plan.rollbackLimits);
  planView.append(facts);

  const prerequisites = appendDetailSection(planView, "Prerequisites");
  if (plan.prerequisites.length === 0) {
    prerequisites.append(makeElement("p", "detail-empty", "No prerequisites declared."));
  } else {
    for (const step of plan.prerequisites) {
      appendInstallStep(prerequisites, entry, plan, host, step);
    }
  }

  const optionalSetup = appendDetailSection(planView, "Optional setup");
  if (plan.optionalSetup.length === 0) {
    optionalSetup.append(makeElement("p", "detail-empty", "No optional setup declared."));
  } else {
    optionalSetup.append(
      makeElement(
        "p",
        "detail-note",
        "These enhancements are not required to install or use the core tool. Approve either step separately, or skip both.",
      ),
    );
    for (const step of plan.optionalSetup) {
      appendInstallStep(optionalSetup, entry, plan, host, step);
    }
  }

  const application = appendDetailSection(planView, "Application");
  appendInstallStep(application, entry, plan, host, plan.appStep, false);
  if (plan.supported && plan.appStep.command && plan.prerequisitesReady) {
    const buttonRow = makeElement("div", "install-button-row");
    buttonRow.append(
      createInstallButton("Approve and install", () =>
        void executeInstallStep(entry, plan, host, plan.appStep.id),
      ),
    );
    application.append(buttonRow);
  } else if (!plan.prerequisitesReady) {
    application.append(
      makeElement(
        "p",
        "install-manual",
        "A required prerequisite is still missing. Complete its reviewed step, then refresh this plan before installing the application.",
      ),
    );
  } else {
    application.append(
      makeElement(
        "p",
        "install-manual",
        plan.manualInstructions ??
          "No supported executable method is declared. Follow the publisher instructions manually.",
      ),
    );
  }

  const cancelRow = makeElement("div", "install-button-row");
  cancelRow.append(
    createInstallButton("Cancel review", () => {
      host.replaceChildren(
        makeElement("p", "detail-empty", "Install review cancelled. No system change was made."),
      );
    }),
  );
  planView.append(cancelRow);
  host.append(planView);
}

function renderInstallOutcome(
  entry: CatalogEntry,
  plan: InstallPlan,
  host: HTMLElement,
  stepId: string,
  outcome: InstallOutcome,
): void {
  host.replaceChildren();
  const outcomeView = makeElement("section", "install-outcome");
  outcomeView.dataset.state = outcome.state;
  outcomeView.append(makeElement("strong", "install-outcome-state", outcome.state));
  outcomeView.append(makeElement("p", "install-outcome-message", outcome.message));
  appendDetailLine(outcomeView, "System change", outcome.systemChange ? "yes" : "no");

  if (outcome.receipt) {
    const receipt = appendDetailSection(outcomeView, "Install receipt");
    appendDetailLine(receipt, "Receipt ID", outcome.receipt.id);
    appendDetailLine(receipt, "Method", outcome.receipt.method);
    appendDetailLine(receipt, "Version", outcome.receipt.version ?? "not recorded");
    appendDetailLine(receipt, "Executable", outcome.receipt.executablePath);
    appendDetailLine(receipt, "Installed at", formatTimestamp(outcome.receipt.installedAt));
    appendDetailLine(receipt, "Verification", outcome.receipt.verification);
  }

  if (outcome.logs) {
    const logSection = appendDetailSection(outcomeView, "Command log");
    logSection.append(makeElement("pre", "install-log", outcome.logs));
  }

  if (outcome.manualRecovery) {
    outcomeView.append(makeElement("p", "install-manual", outcome.manualRecovery));
  }

  const buttonRow = makeElement("div", "install-button-row");
  if (outcome.retryable) {
    buttonRow.append(
      createInstallButton("Retry step", () =>
        void executeInstallStep(entry, plan, host, stepId),
      ),
    );
  }
  if (outcome.state === "completed" && stepId !== plan.appStep.id) {
    buttonRow.append(
      createInstallButton("Refresh install plan", () =>
        void loadInstallPlan(entry, host, plan.methodId),
      ),
    );
  }
  if (buttonRow.childElementCount > 0) {
    outcomeView.append(buttonRow);
  }
  host.append(outcomeView);
}

async function executeInstallStep(
  entry: CatalogEntry,
  plan: InstallPlan,
  host: HTMLElement,
  stepId: string,
): Promise<void> {
  if (installBusy) {
    return;
  }

  installBusy = true;
  host.replaceChildren(
    makeElement("p", "detail-empty", "Running the approved step… Arkonad is waiting for its result."),
  );

  try {
    const outcome = await invoke<InstallOutcome>("install_execute", {
      request: {
        manifestId: entry.manifest.id,
        methodId: plan.methodId,
        stepId,
        confirmed: true,
      },
    });
    installBusy = false;
    renderInstallOutcome(entry, plan, host, stepId, outcome);
  } catch (error) {
    installBusy = false;
    renderInstallOutcome(entry, plan, host, stepId, {
      state: "error",
      message: `Arkonad could not read the install result: ${String(error)}`,
      systemChange: false,
      retryable: true,
      rollbackAvailable: false,
      logs: "",
      manualRecovery: "Check whether the package changed before retrying the step.",
      receipt: null,
    });
  }
}

function managementOperationLabel(operation: ManagementOperation): string {
  switch (operation) {
    case "adopt":
      return "adoption";
    case "integrationReset":
      return "integration reset";
    case "update":
      return "update";
    case "repair":
      return "repair";
    case "uninstall":
      return "uninstall";
    case "dataCleanup":
      return "data cleanup";
  }
}

function updateStateLabel(state: MyAppEntry["updateState"]): string {
  switch (state) {
    case "available":
      return "update available";
    case "current":
      return "current";
    case "notManaged":
      return "externally managed";
    default:
      return "not known";
  }
}

function renderManagementOutcome(
  entry: MyAppEntry,
  plan: ManagementPlan,
  host: HTMLElement,
  outcome: InstallOutcome,
): void {
  host.replaceChildren();
  const outcomeView = makeElement("section", "install-outcome");
  outcomeView.dataset.state = outcome.state;
  outcomeView.append(makeElement("strong", "install-outcome-state", outcome.state));
  outcomeView.append(makeElement("p", "install-outcome-message", outcome.message));
  appendDetailLine(outcomeView, "System change", outcome.systemChange ? "yes" : "no");

  if (outcome.receipt) {
    const receipt = appendDetailSection(outcomeView, "Receipt");
    appendDetailLine(receipt, "Method", outcome.receipt.method);
    appendDetailLine(receipt, "Version", outcome.receipt.version ?? "not recorded");
    appendDetailLine(receipt, "Executable", outcome.receipt.executablePath);
    appendDetailLine(receipt, "Installed at", formatTimestamp(outcome.receipt.installedAt));
    appendDetailLine(receipt, "Verification", outcome.receipt.verification);
  }

  if (outcome.logs) {
    const logSection = appendDetailSection(outcomeView, "Command log");
    logSection.append(makeElement("pre", "install-log", outcome.logs));
  }
  if (outcome.manualRecovery) {
    outcomeView.append(makeElement("p", "install-manual", outcome.manualRecovery));
  }

  const buttonRow = makeElement("div", "install-button-row");
  if (outcome.retryable) {
    buttonRow.append(
      createInstallButton("Retry action", () =>
        void executeManagement(entry, plan, host),
      ),
    );
  }
  if (outcome.state !== "failed" && outcome.state !== "verification-failed" && outcome.state !== "error") {
    buttonRow.append(
      createInstallButton("Refresh My Apps", () => void refreshMyApps()),
    );
  }
  if (buttonRow.childElementCount > 0) {
    outcomeView.append(buttonRow);
  }
  host.append(outcomeView);
}

async function executeManagement(
  entry: MyAppEntry,
  plan: ManagementPlan,
  host: HTMLElement,
): Promise<void> {
  if (installBusy) {
    return;
  }

  installBusy = true;
  host.replaceChildren(
    makeElement("p", "detail-empty", "Running the approved action… Arkonad is waiting for its result."),
  );
  try {
    const outcome = await invoke<InstallOutcome>("app_management_execute", {
      request: {
        manifestId: entry.manifestId,
        operation: plan.operation,
        methodId: plan.methodId,
        confirmed: true,
      },
    });
    installBusy = false;
    renderManagementOutcome(entry, plan, host, outcome);
  } catch (error) {
    installBusy = false;
    renderManagementOutcome(entry, plan, host, {
      state: "error",
      message: `Arkonad could not read the management result: ${String(error)}`,
      systemChange: false,
      retryable: true,
      rollbackAvailable: false,
      logs: "",
      manualRecovery: "Check whether the package changed before retrying the action.",
      receipt: null,
    });
  }
}

function renderManagementPlan(entry: MyAppEntry, host: HTMLElement, plan: ManagementPlan): void {
  host.replaceChildren();
  const planView = makeElement("div", "install-plan");
  const heading = makeElement("div", "install-plan-heading");
  heading.append(
    makeElement(
      "strong",
      undefined,
      `${managementOperationLabel(plan.operation)} · ${plan.toolName}`,
    ),
  );
  heading.append(
    makeElement(
      "p",
      "install-plan-warning",
      "Review only. Nothing changes until you approve this action.",
    ),
  );
  planView.append(heading);

  const facts = makeElement("div", "install-plan-facts");
  appendDetailLine(facts, "Ownership", plan.ownership);
  appendDetailLine(facts, "Installed version", plan.installedVersion ?? "not reported");
  appendDetailLine(facts, "Publisher", plan.publisher);
  appendDetailLine(facts, "Source", plan.source);
  appendDetailLine(facts, "Method", plan.methodLabel ?? "not recorded");
  appendDetailLine(facts, "Package ID", plan.packageId ?? "not recorded");
  appendDetailLine(facts, "Privileges", privilegeLabel(plan.privileges));
  appendDetailLine(
    facts,
    "Affected features",
    plan.affectedSystemFeatures.length > 0
      ? plan.affectedSystemFeatures.join(", ")
      : "none declared",
  );
  appendDetailLine(facts, "Data expectations", plan.dataExpectations);
  appendDetailLine(facts, "Rollback limits", plan.rollbackLimits);
  planView.append(facts);

  if (plan.dataTargets.length > 0) {
    const dataSection = appendDetailSection(planView, "Data targets");
    for (const target of plan.dataTargets) {
      const targetView = makeElement("div", "install-step");
      const targetHeader = makeElement("div", "install-step-header");
      targetHeader.append(makeElement("strong", undefined, target.label));
      targetHeader.append(
        makeElement(
          "span",
          target.allowed ? "install-step-optional" : "install-step-hint",
          target.allowed ? "exact target" : "not eligible",
        ),
      );
      targetView.append(targetHeader);
      appendDetailLine(targetView, "Path", target.path);
      appendDetailLine(targetView, "Exists", target.exists ? "yes" : "no");
      targetView.append(makeElement("p", "detail-empty", target.reason));
      dataSection.append(targetView);
    }
  }

  if (plan.command) {
    planView.append(makeElement("code", "install-command", formatCommand(plan.command)));
  }
  if (plan.manualInstructions) {
    planView.append(makeElement("p", "install-manual", plan.manualInstructions));
  }
  if (
    plan.supported &&
    (plan.command ||
      plan.operation === "adopt" ||
      plan.operation === "integrationReset" ||
      plan.operation === "dataCleanup")
  ) {
    const buttonRow = makeElement("div", "install-button-row");
    const buttonLabel =
      plan.operation === "uninstall"
        ? "Approve uninstall (keep data)"
        : plan.operation === "adopt"
          ? "Approve adoption"
        : `Approve ${managementOperationLabel(plan.operation)}`;
    buttonRow.append(createInstallButton(buttonLabel, () => void executeManagement(entry, plan, host)));
    planView.append(buttonRow);
  }

  const cancelRow = makeElement("div", "install-button-row");
  cancelRow.append(
    createInstallButton("Cancel review", () => {
      host.replaceChildren(
        makeElement("p", "detail-empty", "Management review cancelled. No system change was made."),
      );
    }),
  );
  planView.append(cancelRow);
  host.append(planView);
}

async function loadManagementPlan(
  entry: MyAppEntry,
  host: HTMLElement,
  operation: ManagementOperation,
): Promise<void> {
  if (installBusy) {
    return;
  }
  host.replaceChildren(
    makeElement("p", "detail-empty", "Preparing reviewed management plan…"),
  );
  try {
    const plan = await invoke<ManagementPlan>("app_management_plan", {
      manifestId: entry.manifestId,
      operation,
    });
    renderManagementPlan(entry, host, plan);
  } catch (error) {
    host.replaceChildren(
      makeElement("p", "install-manual", `Could not prepare the management plan: ${String(error)}`),
    );
  }
}

function renderMyAppsDetail(entry: MyAppEntry | undefined): void {
  appsDetail.replaceChildren();
  if (!entry) {
    appsDetail.append(makeElement("div", "store-empty-detail", "No installed or detected tools match this search."));
    return;
  }

  const header = makeElement("header", "detail-header");
  header.append(makeElement("span", "detail-category", entry.category));
  header.append(makeElement("h2", "detail-title", entry.toolName));
  header.append(makeElement("p", "detail-summary", entry.summary));
  header.append(makeElement("p", "detail-meta", `${entry.publisher} · ${entry.ownership}`));
  appsDetail.append(header);

  const stateSection = appendDetailSection(appsDetail, "State");
  appendDetailLine(stateSection, "Ownership", entry.ownership);
  appendDetailLine(stateSection, "Installed version", entry.installedVersion ?? "not reported");
  appendDetailLine(stateSection, "Update", updateStateLabel(entry.updateState));
  appendDetailLine(stateSection, "Launchable", entry.launchable ? "yes" : "no");
  appendDetailLine(stateSection, "Executable", entry.executablePath ?? "not resolved");
  appendDetailLine(stateSection, "Last check", formatTimestamp(entry.lastCheckedAt));
  appendDetailLine(stateSection, "Source", entry.source);

  if (entry.receipt) {
    const receiptSection = appendDetailSection(appsDetail, "Arkonad receipt");
    appendDetailLine(receiptSection, "Method", entry.receipt.method);
    appendDetailLine(receiptSection, "Installed at", formatTimestamp(entry.receipt.installedAt));
    appendDetailLine(receiptSection, "Verification", entry.receipt.verification);
  }

  const actionSection = appendDetailSection(appsDetail, "Manage");
  const reviewHost = makeElement("div", "install-review-host");
  if (entry.ownership !== "detected") {
    const buttonRow = makeElement("div", "install-button-row");
    for (const [operation, label] of [
      ["update", "Review update"],
      ["repair", "Review repair"],
      ["integrationReset", "Review integration reset"],
      ["uninstall", "Review uninstall"] ,
    ] as const) {
      buttonRow.append(
        createInstallButton(label, () => void loadManagementPlan(entry, reviewHost, operation)),
      );
    }
    actionSection.append(buttonRow);
    if (entry.ownership === "managed") {
      const cleanupSection = appendDetailSection(actionSection, "Separate data cleanup");
      cleanupSection.append(
        makeElement(
          "p",
          "detail-note",
          "Uninstall preserves tool data. Cleanup is a separate reviewed action with exact targets only.",
        ),
      );
      cleanupSection.append(
        createInstallButton(
          "Review data cleanup",
          () => void loadManagementPlan(entry, reviewHost, "dataCleanup"),
        ),
      );
    } else {
      actionSection.append(
        makeElement(
          "p",
          "detail-note",
          "This external installation has an adopted package-management method. Arkonad still does not own or clean its tool data.",
        ),
      );
    }
  } else {
    actionSection.append(
      makeElement(
        "p",
        "detail-note",
        "Detected outside Arkonad. It remains usable, but Arkonad will not update, repair, uninstall, or clean its data unless you explicitly adopt a supported management method.",
      ),
    );
    actionSection.append(
      createInstallButton(
        "Review supported adoption",
        () => void loadManagementPlan(entry, reviewHost, "adopt"),
      ),
    );
  }
  actionSection.append(reviewHost);

  const dataSection = appendDetailSection(appsDetail, "Declared data locations");
  appendDetailList(
    dataSection,
    entry.dataLocations.map((location) => `${location.kind}: ${location.path} · ${location.description}`),
    "No data locations declared",
  );
}

function renderMyAppsList(): void {
  const query = appsSearch.value.trim().toLowerCase();
  const visibleEntries = myAppsEntries.filter((entry) => {
    if (!query) {
      return true;
    }
    return `${entry.toolName} ${entry.publisher} ${entry.category} ${entry.ownership}`
      .toLowerCase()
      .includes(query);
  });
  appsList.replaceChildren();
  appsCount.textContent = `${visibleEntries.length} shown`;

  if (visibleEntries.length === 0) {
    appsList.append(makeElement("div", "store-empty-list", "No installed or detected tools match this search."));
    renderMyAppsDetail(undefined);
    return;
  }
  if (!visibleEntries.some((entry) => entry.manifestId === selectedMyAppId)) {
    selectedMyAppId = visibleEntries[0].manifestId;
  }

  for (const entry of visibleEntries) {
    const selected = entry.manifestId === selectedMyAppId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.manifestId = entry.manifestId;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    if (selected) {
      row.classList.add("is-selected");
    }
    const rowTop = makeElement("span", "store-row-top");
    rowTop.append(makeElement("strong", undefined, entry.toolName));
    rowTop.append(makeElement("span", "store-row-category", entry.ownership));
    row.append(rowTop);
    row.append(makeElement("span", "store-row-summary", entry.summary));
    const state = entry.updateState === "available" ? "update available" : entry.launchable ? "launchable" : "not launchable";
    row.append(makeElement("span", `store-row-state ${statusClass(entry.launchable ? "active" : "unknown")}`, state));
    row.addEventListener("click", () => selectMyApp(entry.manifestId));
    appsList.append(row);
  }
  renderMyAppsDetail(visibleEntries.find((entry) => entry.manifestId === selectedMyAppId));
}

function selectMyApp(id: string, focusRow = false): void {
  if (!myAppsEntries.some((entry) => entry.manifestId === id)) {
    return;
  }
  selectedMyAppId = id;
  renderMyAppsList();
  if (focusRow) {
    window.requestAnimationFrame(() => {
      const row = Array.from(
        appsList.querySelectorAll<HTMLButtonElement>("[data-manifest-id]"),
      ).find((candidate) => candidate.dataset.manifestId === id);
      row?.focus();
    });
  }
}

function moveMyAppSelection(offset: number): void {
  const query = appsSearch.value.trim().toLowerCase();
  const visibleEntries = myAppsEntries.filter((entry) =>
    `${entry.toolName} ${entry.publisher} ${entry.category} ${entry.ownership}`
      .toLowerCase()
      .includes(query),
  );
  if (visibleEntries.length === 0) {
    return;
  }
  const currentIndex = visibleEntries.findIndex((entry) => entry.manifestId === selectedMyAppId);
  const nextIndex = (Math.max(currentIndex, 0) + offset + visibleEntries.length) % visibleEntries.length;
  selectMyApp(visibleEntries[nextIndex].manifestId, true);
}

async function refreshMyApps(): Promise<void> {
  const requestId = ++myAppsRequestId;
  appsError.hidden = true;
  appsNotice.textContent = "Checking PATH and Arkonad receipts read-only…";
  appsCount.textContent = "loading…";
  try {
    const snapshot = await invoke<MyAppsSnapshot>("my_apps_list");
    if (requestId !== myAppsRequestId) {
      return;
    }
    myAppsEntries = snapshot.entries;
    const updateLabel =
      snapshot.updatesAvailable === 1
        ? "1 reviewed update available"
        : `${snapshot.updatesAvailable} reviewed updates available`;
    appsUpdateBadge.hidden = snapshot.updatesAvailable === 0;
    appsUpdateBadge.textContent = snapshot.updatesAvailable === 0 ? "" : String(snapshot.updatesAvailable);
    appsOpenButton.setAttribute(
      "aria-label",
      snapshot.updatesAvailable === 0 ? "My Apps" : `My Apps, ${updateLabel}`,
    );
    appsNotice.textContent =
      snapshot.updatesAvailable === 0
        ? "Detected installations stay external; managed actions use their recorded method."
        : `${updateLabel}. Review before installing; Arkonad will not update automatically.`;
    renderMyAppsList();
  } catch (error) {
    if (requestId !== myAppsRequestId) {
      return;
    }
    myAppsEntries = [];
    renderMyAppsList();
    appsError.hidden = false;
    appsError.textContent = `Could not read My Apps: ${String(error)}`;
  }
}

function scheduleMyAppsRefresh(): void {
  if (myAppsRefreshTimer !== undefined) {
    window.clearTimeout(myAppsRefreshTimer);
  }
  myAppsRefreshTimer = window.setTimeout(() => void refreshMyApps(), 140);
}

function renderStoreDetail(entry: CatalogEntry | undefined): void {
  storeDetail.replaceChildren();

  if (!entry) {
    storeDetail.append(
      makeElement("div", "store-empty-detail", "Select a tool to inspect its manifest."),
    );
    return;
  }

  const header = makeElement("header", "detail-header");
  header.append(makeElement("span", "detail-category", entry.manifest.category));
  header.append(makeElement("h2", "detail-title", entry.manifest.name));
  header.append(makeElement("p", "detail-summary", entry.manifest.summary));
  header.append(
    makeElement(
      "p",
      "detail-meta",
      `${entry.manifest.publisher} · ${entry.manifest.license} · ${entry.manifest.platforms.join(", ")}`,
    ),
  );
  storeDetail.append(header);

  const statusSection = appendDetailSection(storeDetail, "State");
  const statusList = makeElement("div", "status-list");
  for (const item of entry.statuses) {
    const statusItem = makeElement("div", `catalog-status ${statusClass(item.state)}`);
    const statusLine = makeElement("div", "catalog-status-line");
    statusLine.append(makeElement("span", "status-dot"));
    statusLine.append(makeElement("strong", undefined, item.label));
    statusLine.append(makeElement("span", "status-state", item.state));
    statusItem.append(statusLine);
    statusItem.append(makeElement("span", "catalog-status-detail", item.detail));
    statusList.append(statusItem);
  }
  statusSection.append(statusList);

  const provenanceSection = appendDetailSection(storeDetail, "Provenance");
  const sourceLine = makeElement("div", "detail-line");
  sourceLine.append(makeElement("span", "detail-label", "Source"));
  const sourceLink = makeElement("a", "detail-link", entry.manifest.source.url);
  sourceLink.href = entry.manifest.source.url;
  sourceLink.target = "_blank";
  sourceLink.rel = "noreferrer";
  sourceLine.append(sourceLink);
  provenanceSection.append(sourceLine);
  appendDetailLine(provenanceSection, "Metadata refresh", entry.manifest.lastMetadataRefresh);
  appendDetailLine(
    provenanceSection,
    "Compatibility",
    entry.manifest.verifiedCompatibility.length > 0
      ? entry.manifest.verifiedCompatibility.join(", ")
      : "none declared",
  );
  provenanceSection.append(
    makeElement(
      "p",
      "detail-note",
      "Listed does not mean verified. This catalog shows publisher metadata and local detection only.",
    ),
  );

  const detectionSection = appendDetailSection(storeDetail, "Local detection");
  if (entry.detection) {
    appendDetailLine(detectionSection, "Command", entry.detection.command);
    appendDetailLine(detectionSection, "Path", entry.detection.path);
    appendDetailLine(detectionSection, "Source", entry.detection.source);
    detectionSection.append(
      makeElement(
        "p",
        "detail-note",
        "Detected software may have been installed outside Arkonad; no ownership is implied.",
      ),
    );
  } else {
    detectionSection.append(
      makeElement(
        "p",
        "detail-empty",
        "Not detected on PATH. Detection is read-only and does not claim ownership.",
      ),
    );
  }

  const installSection = appendDetailSection(storeDetail, "Install methods");
  const installReviewHost = makeElement("div", "install-review-host");
  for (const method of entry.manifest.installMethods) {
    const methodLine = makeElement("div", "manifest-item");
    methodLine.append(makeElement("strong", undefined, method.label));
    methodLine.append(makeElement("span", "detail-subtle", `${method.kind} · ${method.source}`));
    const methodButton = createInstallButton(
      method.kind === "winget" ? "Review install plan" : "Show manual steps",
      () => void loadInstallPlan(entry, installReviewHost, method.id),
    );
    methodLine.append(methodButton);
    installSection.append(methodLine);
  }
  installSection.append(installReviewHost);

  const launchSection = appendDetailSection(storeDetail, "Launch profiles");
  for (const profile of entry.manifest.launchProfiles) {
    const profileLine = makeElement("div", "manifest-item");
    profileLine.append(makeElement("strong", undefined, profile.label));
    profileLine.append(
      makeElement(
        "code",
        "detail-code",
        [profile.executable, ...profile.arguments].join(" "),
      ),
    );
    launchSection.append(profileLine);
  }

  const environmentSection = appendDetailSection(storeDetail, "Environment");
  appendDetailLine(
    environmentSection,
    "Network",
    `${entry.manifest.networkExpectations.required ? "may be required" : "not required for local use"} · ${entry.manifest.networkExpectations.summary}`,
  );
  appendDetailList(
    environmentSection,
    entry.manifest.prerequisites.map((item) => `${item.label}: ${item.description}`),
    "No prerequisites declared",
  );
  appendDetailList(
    environmentSection,
    entry.manifest.dataLocations.map((item) => `${item.kind}: ${item.path} · ${item.description}`),
    "No data locations declared",
  );

  const capabilitiesSection = appendDetailSection(storeDetail, "Declared capabilities");
  appendDetailList(
    capabilitiesSection,
    entry.manifest.declaredCapabilities.map((item) => `${item.label}: ${item.description}`),
    "No capabilities declared",
  );
}

function renderStoreList(): void {
  storeList.replaceChildren();
  storeCount.textContent = `${storeEntries.length} listed`;

  if (storeEntries.length === 0) {
    storeList.append(makeElement("div", "store-empty-list", "No tools match this search."));
    renderStoreDetail(undefined);
    return;
  }

  if (!storeEntries.some((entry) => entry.manifest.id === selectedStoreId)) {
    selectedStoreId = storeEntries[0].manifest.id;
  }

  for (const entry of storeEntries) {
    const isSelected = entry.manifest.id === selectedStoreId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.manifestId = entry.manifest.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(isSelected));
    if (isSelected) {
      row.classList.add("is-selected");
    }

    const rowTop = makeElement("span", "store-row-top");
    rowTop.append(makeElement("strong", undefined, entry.manifest.name));
    rowTop.append(makeElement("span", "store-row-category", entry.manifest.category));
    row.append(rowTop);
    row.append(makeElement("span", "store-row-summary", entry.manifest.summary));
    const detectionStatus = entry.statuses.find((item) => item.id === "detected");
    row.append(
      makeElement(
        "span",
        `store-row-state ${statusClass(detectionStatus?.state ?? "unknown")}`,
        detectionStatus?.state === "active" ? "detected" : "listed",
      ),
    );
    row.addEventListener("click", () => selectStoreEntry(entry.manifest.id));
    storeList.append(row);
  }

  renderStoreDetail(storeEntries.find((entry) => entry.manifest.id === selectedStoreId));
}

function selectStoreEntry(id: string, focusRow = false): void {
  if (!storeEntries.some((entry) => entry.manifest.id === id)) {
    return;
  }
  selectedStoreId = id;
  renderStoreList();

  if (focusRow) {
    window.requestAnimationFrame(() => {
      const row = Array.from(
        storeList.querySelectorAll<HTMLButtonElement>("[data-manifest-id]"),
      ).find((candidate) => candidate.dataset.manifestId === id);
      row?.focus();
    });
  }
}

function moveStoreSelection(offset: number): void {
  if (storeEntries.length === 0) {
    return;
  }

  const currentIndex = storeEntries.findIndex((entry) => entry.manifest.id === selectedStoreId);
  const nextIndex = (Math.max(currentIndex, 0) + offset + storeEntries.length) % storeEntries.length;
  selectStoreEntry(storeEntries[nextIndex].manifest.id, true);
}

async function refreshStore(): Promise<void> {
  const requestId = ++storeRequestId;
  storeError.hidden = true;
  storeNotice.textContent = "Checking PATH with read-only detection…";
  storeCount.textContent = "loading…";

  let detectionError = false;
  try {
    await invoke<CatalogDetection[]>("catalog_detect");
  } catch {
    detectionError = true;
  }

  if (requestId !== storeRequestId) {
    return;
  }

  storeNotice.textContent = detectionError
    ? "PATH detection is unavailable; catalog browsing is still available."
    : "PATH scanned read-only; detected tools are marked locally. Externally installed tools stay unmanaged.";

  try {
    storeEntries = await invoke<CatalogEntry[]>("catalog_list", {
      query: storeSearch.value.trim() || null,
      category: storeCategory.value || null,
    });
    if (requestId !== storeRequestId) {
      return;
    }
    renderStoreList();
  } catch (error) {
    if (requestId !== storeRequestId) {
      return;
    }
    storeEntries = [];
    renderStoreList();
    storeError.hidden = false;
    storeError.textContent = `Could not read the catalog: ${String(error)}`;
  }
}

function scheduleStoreRefresh(): void {
  if (storeRefreshTimer !== undefined) {
    window.clearTimeout(storeRefreshTimer);
  }
  storeRefreshTimer = window.setTimeout(() => void refreshStore(), 140);
}

function openStore(): void {
  if (storeOpen && activeSurface === "store") {
    storeSearch.focus();
    return;
  }

  storeOpen = true;
  activeSurface = "store";
  terminalShell.hidden = true;
  appsView.hidden = true;
  storeView.hidden = false;
  storeOpenButton.setAttribute("aria-expanded", "true");
  appsOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "store browser";
  status.textContent = "store";
  status.dataset.state = "ready";
  void refreshStore();
  window.requestAnimationFrame(() => storeSearch.focus());
}

function openMyApps(): void {
  if (storeOpen && activeSurface === "apps") {
    appsSearch.focus();
    return;
  }

  storeOpen = true;
  activeSurface = "apps";
  terminalShell.hidden = true;
  storeView.hidden = true;
  appsView.hidden = false;
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "true");
  sessionMeta.textContent = "my apps";
  status.textContent = "my apps";
  status.dataset.state = "ready";
  void refreshMyApps();
  window.requestAnimationFrame(() => appsSearch.focus());
}

function closeSurface(): void {
  if (!storeOpen) {
    terminal.focus();
    return;
  }

  storeOpen = false;
  storeView.hidden = true;
  appsView.hidden = true;
  terminalShell.hidden = false;
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = session?.shell ?? "starting terminal session…";
  renderTerminalStatus();
  fitAddon.fit();
  sendResize();
  terminal.focus();
}

function closeStore(): void {
  closeSurface();
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

storeOpenButton.addEventListener("click", openStore);
appsOpenButton.addEventListener("click", openMyApps);
storeCloseButton.addEventListener("click", closeSurface);
appsCloseButton.addEventListener("click", closeSurface);
storeSearch.addEventListener("input", scheduleStoreRefresh);
storeCategory.addEventListener("change", () => void refreshStore());
storeList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveStoreSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveStoreSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    if (storeEntries[0]) {
      selectStoreEntry(storeEntries[0].manifest.id, true);
    }
  } else if (event.key === "End") {
    event.preventDefault();
    const last = storeEntries.at(-1);
    if (last) {
      selectStoreEntry(last.manifest.id, true);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.manifestId) {
      selectStoreEntry(activeRow.dataset.manifestId, true);
    }
  }
});
appsSearch.addEventListener("input", scheduleMyAppsRefresh);
appsList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveMyAppSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveMyAppSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    const first = myAppsEntries.find((entry) =>
      `${entry.toolName} ${entry.publisher} ${entry.category} ${entry.ownership}`
        .toLowerCase()
        .includes(appsSearch.value.trim().toLowerCase()),
    );
    if (first) {
      selectMyApp(first.manifestId, true);
    }
  } else if (event.key === "End") {
    event.preventDefault();
    const query = appsSearch.value.trim().toLowerCase();
    const visible = myAppsEntries.filter((entry) =>
      `${entry.toolName} ${entry.publisher} ${entry.category} ${entry.ownership}`
        .toLowerCase()
        .includes(query),
    );
    const last = visible.at(-1);
    if (last) {
      selectMyApp(last.manifestId, true);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.manifestId) {
      selectMyApp(activeRow.dataset.manifestId, true);
    }
  }
});

window.addEventListener("keydown", (event) => {
  const storeShortcut = event.ctrlKey && event.shiftKey && event.code === "Space";
  const appsShortcut = event.ctrlKey && event.shiftKey && event.code === "KeyA";
  if (storeShortcut) {
    event.preventDefault();
    if (storeOpen && activeSurface === "store") {
      closeSurface();
    } else {
      openStore();
    }
    return;
  }

  if (appsShortcut) {
    event.preventDefault();
    if (storeOpen && activeSurface === "apps") {
      closeSurface();
    } else {
      openMyApps();
    }
    return;
  }

  if (storeOpen && event.key === "Escape") {
    event.preventDefault();
    closeSurface();
  }
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
  setTerminalStatus("stopped", "stopped");
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
    setTerminalStatus("ready", "ready");
    sendResize();
    if (!storeOpen) {
      terminal.focus();
    }
  } catch (error) {
    showError(`Could not start the terminal session: ${String(error)}`);
  }
}

void startSession();
void refreshMyApps();
