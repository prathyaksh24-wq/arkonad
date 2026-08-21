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
  appStep: InstallStep;
  manualInstructions: string | null;
};

type InstallReceipt = {
  id: string;
  manifestId: string;
  toolName: string;
  publisher: string;
  version: string | null;
  source: string;
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
    </main>
    <footer class="bottombar">
      <span>Leader+Space controls</span>
      <span>Ctrl+Shift+C copy</span>
      <span>Ctrl+Shift+V paste</span>
      <span>Ctrl+Shift+Space Store</span>
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
const storeCloseButton = app.querySelector<HTMLButtonElement>("[data-store-close]")!;
const storeView = app.querySelector<HTMLElement>("[data-store-view]")!;
const storeSearch = app.querySelector<HTMLInputElement>("[data-store-search]")!;
const storeCategory = app.querySelector<HTMLSelectElement>("[data-store-category]")!;
const storeNotice = app.querySelector<HTMLDivElement>("[data-store-notice]")!;
const storeCount = app.querySelector<HTMLSpanElement>("[data-store-count]")!;
const storeList = app.querySelector<HTMLDivElement>("[data-store-list]")!;
const storeError = app.querySelector<HTMLDivElement>("[data-store-error]")!;
const storeDetail = app.querySelector<HTMLElement>("[data-store-detail]")!;

if (
  !terminalShell ||
  !terminalElement ||
  !sessionMeta ||
  !status ||
  !cwdLabel ||
  !errorPanel ||
  !storeOpenButton ||
  !storeCloseButton ||
  !storeView ||
  !storeSearch ||
  !storeCategory ||
  !storeNotice ||
  !storeCount ||
  !storeList ||
  !storeError ||
  !storeDetail
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
let storeEntries: CatalogEntry[] = [];
let selectedStoreId: string | undefined;
let storeRequestId = 0;
let storeRefreshTimer: number | undefined;
let installBusy = false;

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
  appendDetailLine(stepMeta, "Privileges", privilegeLabel(step.privileges));
  appendDetailLine(stepMeta, "Rollback", step.rollbackLimits);
  if (step.source) {
    appendInstallSource(stepMeta, "Source", step.source);
  }
  stepView.append(stepMeta);

  if (step.command) {
    stepView.append(makeElement("code", "install-command", formatCommand(step.command)));
    if (showAction) {
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

  const application = appendDetailSection(planView, "Application");
  appendInstallStep(application, entry, plan, host, plan.appStep, false);
  if (plan.supported && plan.appStep.command) {
    const buttonRow = makeElement("div", "install-button-row");
    buttonRow.append(
      createInstallButton("Approve and install", () =>
        void executeInstallStep(entry, plan, host, plan.appStep.id),
      ),
    );
    application.append(buttonRow);
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
    appendDetailLine(receipt, "Installed at", outcome.receipt.installedAt);
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
      createInstallButton("Back to install plan", () => renderInstallPlan(entry, host, plan)),
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
  if (storeOpen) {
    storeSearch.focus();
    return;
  }

  storeOpen = true;
  terminalShell.hidden = true;
  storeView.hidden = false;
  storeOpenButton.setAttribute("aria-expanded", "true");
  sessionMeta.textContent = "store browser";
  status.textContent = "store";
  status.dataset.state = "ready";
  void refreshStore();
  window.requestAnimationFrame(() => storeSearch.focus());
}

function closeStore(): void {
  if (!storeOpen) {
    terminal.focus();
    return;
  }

  storeOpen = false;
  storeView.hidden = true;
  terminalShell.hidden = false;
  storeOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = session?.shell ?? "starting terminal session…";
  renderTerminalStatus();
  fitAddon.fit();
  sendResize();
  terminal.focus();
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
storeCloseButton.addEventListener("click", closeStore);
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

window.addEventListener("keydown", (event) => {
  const storeShortcut = event.ctrlKey && event.shiftKey && event.code === "Space";
  if (storeShortcut) {
    event.preventDefault();
    if (storeOpen) {
      closeStore();
    } else {
      openStore();
    }
    return;
  }

  if (storeOpen && event.key === "Escape") {
    event.preventDefault();
    closeStore();
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
