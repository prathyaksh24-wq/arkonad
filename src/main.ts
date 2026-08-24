import "@xterm/xterm/css/xterm.css";
import "./style.css";

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";

type SessionInfo = {
  id: string;
  shell: string;
  shellPath: string | null;
  cwd: string;
};

type SessionExited = {
  id: string;
};

type SplitOrientation = "vertical" | "horizontal";
type FocusDirection = "left" | "right" | "up" | "down";

type LayoutNode =
  | { kind: "leaf"; paneId: string }
  | {
      kind: "split";
      orientation: SplitOrientation;
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

type FramePane = {
  id: string;
  session: SessionInfo;
};

type FrameTab = {
  id: string;
  title: string;
  root: LayoutNode;
  panes: FramePane[];
  focusedPaneId: string;
};

type FrameSnapshot = {
  tabs: FrameTab[];
  activeTabId: string | null;
  focusedPaneId: string | null;
};

type WorkspaceSettings = {
  leaderChord: string;
  agentPolicies?: Record<string, AgentPolicy>;
};

type WorkspaceDocument = {
  schemaVersion: number;
  id: string;
  name: string;
  root: string;
  repositoryRoot: string | null;
  frame: FrameSnapshot;
  appPins: string[];
  launchProfiles: CustomAppProfile[];
  settings: WorkspaceSettings;
  savedAt: string;
};

type WorkspaceLoadResult = {
  status: "empty" | "ready" | "invalid";
  message: string;
  workspace: WorkspaceDocument | null;
};

type RecoveryPane = {
  tabId: string;
  tabTitle: string;
  pane: FramePane;
};

type FrameCloseResult = {
  closed: boolean;
  requiresConfirmation: boolean;
  message: string;
  snapshot: FrameSnapshot;
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

type AgentPermissionMode = "ask" | "approve" | "bypass";
type AgentFollowUpMode = "queue" | "steer";
type AgentSessionMode = "task" | "chat";
type AgentPolicyScope = "workspace" | "session";

type AgentPolicy = {
  permission: AgentPermissionMode;
  followUp: AgentFollowUpMode;
};

type AgentEntry = {
  id: string;
  name: string;
  summary: string;
  publisher: string;
  installed: boolean;
  launchable: boolean;
  executablePath: string | null;
  profileId: string | null;
  ownership: string | null;
  storeEntryId: string;
};

type AgentLaunchContext = {
  mode: AgentSessionMode;
  task: string;
  policy: AgentPolicy;
  workspaceRoot: string | null;
  agentTaskId?: string;
  agentTaskWorktreePath?: string;
};

type AgentSessionState =
  | "starting"
  | "working"
  | "waitingForInput"
  | "waitingForApproval"
  | "done"
  | "failed"
  | "stopped"
  | "interrupted";
type AgentStateSource = "process" | "providerEvent" | "outputObservation";
type AttentionKind = "approval" | "question" | "failure" | "completion";
type AgentFollowUpStatus = "queued" | "delivering" | "delivered";

type AgentAdapterCapability = {
  agentId: string;
  verified: boolean;
  declaredEventSource: string | null;
  supportsSteer: boolean;
  nativeTuiNote: string;
};

type AgentAttentionItem = {
  id: string;
  kind: AttentionKind;
  message: string;
  source: AgentStateSource;
  acknowledged: boolean;
  createdAt: string;
};

type AgentFollowUp = {
  id: string;
  message: string;
  requestedMode: AgentFollowUpMode;
  effectiveMode: AgentFollowUpMode;
  status: AgentFollowUpStatus;
  statusMessage: string;
  createdAt: string;
  deliveredAt: string | null;
};

type AgentSessionRecord = {
  id: string;
  sessionId: string;
  workspaceId: string | null;
  workspaceName: string;
  workspaceRoot: string;
  tabId: string | null;
  paneId: string | null;
  agentId: string;
  agentName: string;
  state: AgentSessionState;
  stateSource: AgentStateSource;
  stateDetail: string;
  followUpMode: AgentFollowUpMode;
  adapter: AgentAdapterCapability;
  enhancedEventsActive: boolean;
  attention: AgentAttentionItem[];
  followUps: AgentFollowUp[];
  createdAt: string;
  updatedAt: string;
};

type AgentSupervisionSnapshot = {
  sessions: AgentSessionRecord[];
  adapters: AgentAdapterCapability[];
};

type AgentFollowUpResult = {
  followUp: AgentFollowUp;
  session: AgentSessionRecord;
};

type AgentTaskStatus =
  | "preparing"
  | "ready"
  | "active"
  | "handoffReady"
  | "setupFailed"
  | "cancelled"
  | "cancelledPreserved";
type WorktreeLeaseStatus = "reserved" | "active";

type WorktreeLease = {
  ownerId: string;
  agentId: string;
  sessionId: string | null;
  status: WorktreeLeaseStatus;
  acquiredAt: string;
};

type ControlHandoff = {
  id: string;
  previousOwner: string;
  newOwner: string;
  newOwnerName: string;
  branch: string;
  worktreePath: string;
  changes: string;
  checks: string;
  pendingDecisions: string;
  createdAt: string;
};

type AgentTask = {
  id: string;
  status: AgentTaskStatus;
  repositoryRoot: string;
  baseBranch: string;
  taskBranch: string;
  worktreeRoot: string;
  worktreePath: string;
  taskSummary: string;
  agentId: string;
  agentName: string;
  permissionMode: AgentPermissionMode;
  lease: WorktreeLease | null;
  handoffs: ControlHandoff[];
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type AgentTaskPlan = {
  repositoryRoot: string | null;
  repositoryName: string | null;
  baseBranch: string | null;
  taskBranch: string | null;
  worktreeRoot: string | null;
  worktreePath: string | null;
  taskSummary: string;
  agentId: string;
  agentName: string;
  permissionMode: AgentPermissionMode;
  repositoryStatus: "clean" | "dirty" | "unknown";
  repositoryStatusDetail: string;
  freeSpaceBytes: number | null;
  freeSpaceOk: boolean;
  canCreate: boolean;
  blockers: string[];
  recoveryOptions: string[];
};

type AgentTaskCancelResult = {
  task: AgentTask;
  action: string;
  removedWorktree: boolean;
  preservedWorktree: boolean;
  message: string;
};

type LaunchpadEntry = {
  id: string;
  source: "catalog" | "custom";
  name: string;
  summary: string;
  category: CatalogCategory | null;
  publisher: string | null;
  launchable: boolean;
  executablePath: string | null;
  profileId: string | null;
  supportsWorkingDirectory: boolean;
  pinned: boolean;
  newlyInstalled: boolean;
  lastLaunchedAt: string | null;
};

type LaunchLocation =
  | { kind: "currentDirectory" }
  | { kind: "directory"; path: string }
  | { kind: "newWorkspace"; name: string };

type CustomAppProfile = {
  id: string;
  name: string;
  executable: string;
  arguments: string[];
  shell: string | null;
  workingDirectory: string | null;
  supportsWorkingDirectory: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type CustomAppDraft = {
  id?: string | null;
  name: string;
  executable: string;
  arguments: string[];
  shell: string | null;
  workingDirectory: string | null;
  supportsWorkingDirectory: boolean;
  enabled: boolean;
};

type CustomAppValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  executablePath: string | null;
  shellPath: string | null;
  workingDirectory: string | null;
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
  launchProfileId: string | null;
  supportsWorkingDirectory: boolean;
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

type StartupBehavior = "terminal" | "store" | "apps" | "launchpad" | "lastWorkspace";
type OnboardingChoiceId = "terminal" | "store" | "apps" | "agent" | "restore";

type OnboardingChoice = {
  id: OnboardingChoiceId;
  label: string;
  description: string;
  detail: string;
};

const onboardingChoices: OnboardingChoice[] = [
  {
    id: "terminal",
    label: "Open Terminal",
    description: "Start a blank shell session in the current directory.",
    detail: "Nothing is installed or connected.",
  },
  {
    id: "store",
    label: "Browse Store",
    description: "Explore Catalog Tools before deciding whether to install one.",
    detail: "Install review starts only after you choose a tool.",
  },
  {
    id: "apps",
    label: "My Apps",
    description: "See tools Arkonad can already detect or launch.",
    detail: "Existing installations remain under their own ownership.",
  },
  {
    id: "agent",
    label: "Use a Coding Agent",
    description: "Browse coding agents that can run in an Arkonad Session.",
    detail: "Sign-in and agent permissions stay inside the selected tool.",
  },
  {
    id: "restore",
    label: "Restore Workspace",
    description: "Open the last saved Workspace location when one is available.",
    detail: "If there is no saved location, Arkonad opens a blank shell.",
  },
];

const startupBehaviorOptions: Array<{ value: StartupBehavior; label: string }> = [
  { value: "terminal", label: "Terminal" },
  { value: "store", label: "Store" },
  { value: "apps", label: "My Apps" },
  { value: "launchpad", label: "Launchpad" },
  { value: "lastWorkspace", label: "Last Workspace" },
];

const onboardingCompletedStorageKey = "arkonad.onboarding.completed";
const startupBehaviorStorageKey = "arkonad.startup.behavior";
const lastWorkspaceStorageKey = "arkonad.workspace.last-path";

function readLocalPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalPreference(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // A storage failure should not prevent a user from opening the terminal.
  }
}

function parseStartupBehavior(value: string | null): StartupBehavior {
  switch (value) {
    case "store":
    case "apps":
    case "launchpad":
    case "lastWorkspace":
    case "terminal":
      return value;
    default:
      return "terminal";
  }
}

function startupBehaviorLabel(value: StartupBehavior): string {
  return startupBehaviorOptions.find((option) => option.value === value)?.label ?? "Terminal";
}

const defaultAgentPolicy: AgentPolicy = {
  permission: "ask",
  followUp: "queue",
};

function normalizeAgentPermission(value: unknown): AgentPermissionMode {
  return value === "approve" || value === "bypass" ? value : "ask";
}

function normalizeAgentFollowUp(value: unknown): AgentFollowUpMode {
  return value === "steer" ? "steer" : "queue";
}

function normalizeAgentPolicy(value: unknown): AgentPolicy {
  if (!value || typeof value !== "object") {
    return { ...defaultAgentPolicy };
  }
  const candidate = value as { permission?: unknown; followUp?: unknown };
  return {
    permission: normalizeAgentPermission(candidate.permission),
    followUp: normalizeAgentFollowUp(candidate.followUp),
  };
}

function normalizeAgentPolicies(value: unknown): Record<string, AgentPolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([id]) => id.trim().length > 0)
      .map(([id, policy]) => [id, normalizeAgentPolicy(policy)]),
  );
}

function effectiveAgentPolicy(agentId: string): AgentPolicy {
  return (
    sessionAgentOverrides.get(agentId) ??
    workspaceAgentPolicies[agentId] ??
    { ...defaultAgentPolicy }
  );
}

function agentPermissionLabel(value: AgentPermissionMode): string {
  return {
    ask: "Ask for Approval",
    approve: "Approve for Me",
    bypass: "Bypass Permissions",
  }[value];
}

function agentFollowUpLabel(value: AgentFollowUpMode): string {
  return value === "steer" ? "Steer" : "Queue";
}

function agentPolicySummary(policy: AgentPolicy): string {
  return `${agentPermissionLabel(policy.permission)} · ${agentFollowUpLabel(policy.followUp)}`;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Arkonad root element is missing");
}

app.innerHTML = `
  <section class="frame">
    <header class="topbar">
      <div class="brand"><span class="ember">◆</span><span>arkonad</span></div>
      <div class="session-meta" data-session-meta>starting terminal session…</div>
      <button class="topbar-action" type="button" data-launchpad-open aria-expanded="false">
        Launchpad <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-store-open aria-expanded="false">
        Store <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-apps-open aria-expanded="false">
        My Apps <span class="apps-update-badge" data-apps-update-badge hidden aria-live="polite"></span>
        <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-agents-open aria-expanded="false">
        Agents <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-tasks-open aria-expanded="false">
        Tasks <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-attention-open aria-expanded="false">
        Attention <span class="attention-badge" data-attention-badge hidden aria-live="polite"></span>
        <span class="key-hint">palette</span>
      </button>
      <div class="status" data-status>connecting</div>
    </header>
    <main class="workspace">
      <section
        class="onboarding-screen"
        data-onboarding
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        <div class="onboarding-card">
          <header class="onboarding-heading">
            <span class="store-eyebrow">FIRST RUN · ONBOARDING</span>
            <h1 id="onboarding-title">Choose how to start Arkonad</h1>
            <p id="onboarding-description">
              Arkonad hosts terminal apps in Sessions. Nothing is installed, signed in, or connected during this step.
            </p>
          </header>
          <div class="onboarding-content">
            <section class="onboarding-choice-panel" aria-labelledby="onboarding-choice-heading">
              <div class="onboarding-panel-heading">
                <span id="onboarding-choice-heading">Start here</span>
                <span class="onboarding-panel-hint">↑↓ choose · Enter open</span>
              </div>
              <div
                class="onboarding-options"
                data-onboarding-options
                role="listbox"
                aria-label="First-run choices"
              ></div>
            </section>
            <section class="onboarding-preferences" aria-labelledby="onboarding-preferences-heading">
              <span class="store-eyebrow" id="onboarding-preferences-heading">NEXT TIME</span>
              <label class="onboarding-select-control">
                <span>When Arkonad opens again</span>
                <select data-onboarding-startup aria-label="Startup behavior">
                  <option value="terminal">Terminal · blank shell</option>
                  <option value="store">Store</option>
                  <option value="apps">My Apps</option>
                  <option value="launchpad">Launchpad</option>
                  <option value="lastWorkspace">Last Workspace</option>
                </select>
              </label>
              <p class="onboarding-note">
                You can change this later from Leader → Settings. Last Workspace uses the most recent saved Session location.
              </p>
              <p class="onboarding-message" data-onboarding-message aria-live="polite"></p>
            </section>
          </div>
          <footer class="onboarding-footer">
            <span>Enter open</span>
            <span>Esc terminal</span>
            <span>Plain-language help is on this screen</span>
          </footer>
        </div>
      </section>
      <section class="terminal-shell" data-terminal-shell>
        <div class="frame-tabs" data-frame-tabs role="tablist" aria-label="Arkonad sessions"></div>
        <div class="frame-layout" data-frame-layout aria-label="Arkonad workspace"></div>
        <div class="error-panel" data-error hidden></div>
      </section>
      <section
        class="workspace-recovery"
        data-workspace-recovery
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-recovery-title"
        aria-describedby="workspace-recovery-description"
      >
        <div class="workspace-recovery-card">
          <header class="workspace-recovery-heading">
            <span class="store-eyebrow">WORKSPACE RECOVERY</span>
            <h1 id="workspace-recovery-title">Review before restoring</h1>
            <p id="workspace-recovery-description" data-workspace-recovery-message>
              Saved processes are not restarted automatically.
            </p>
          </header>
          <div class="workspace-recovery-list" data-workspace-recovery-list role="list"></div>
          <div class="workspace-recovery-actions">
            <button class="detail-action" type="button" data-workspace-restart-all>Restart all and restore layout</button>
            <button class="detail-action" type="button" data-workspace-open-shell>Open blank shell</button>
            <button class="store-close" type="button" data-workspace-dismiss>Dismiss Workspace</button>
          </div>
          <footer class="store-footer">
            <span>Restart starts a new shell only</span>
            <span>Inspect shows saved metadata</span>
            <span>No commands are replayed</span>
          </footer>
        </div>
      </section>
      <section class="command-overlay" data-command-overlay hidden aria-label="Arkonad command palette">
        <div class="command-card">
          <div class="command-heading">
            <div>
              <span class="store-eyebrow">ARKONAD LEADER</span>
              <span class="store-title">Command palette</span>
            </div>
            <button class="store-close" type="button" data-command-close>Esc · close</button>
          </div>
          <label class="store-control command-search-control">
            <span>Command</span>
            <input data-command-search type="search" placeholder="Type a command" autocomplete="off" />
          </label>
          <div class="command-list" data-command-list role="listbox" aria-label="Arkonad commands"></div>
          <div class="command-message" data-command-message aria-live="polite"></div>
          <div class="store-footer command-footer">
            <span>↑↓ move</span>
            <span>Enter run</span>
            <span data-leader-hint>Leader Ctrl+Space</span>
            <span>Esc close</span>
          </div>
        </div>
      </section>
      <section class="store-shell" data-launchpad-view hidden aria-label="Launchpad">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">LAUNCHPAD</span>
            <span class="store-title">Open a Launchable Tool in the Arkonad PTY</span>
          </div>
          <label class="store-control">
            <span>Search</span>
            <input data-launchpad-search type="search" placeholder="name, category, publisher" autocomplete="off" />
          </label>
          <button class="store-close" type="button" data-launchpad-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-launchpad-notice>Only tools ready to launch appear here.</div>
        <div class="store-content">
          <section class="store-list-panel" aria-label="Launchable tools">
            <div class="store-list-header">
              <span>Launchable tools</span>
              <span data-launchpad-count>loading…</span>
            </div>
            <div class="store-list" data-launchpad-list role="listbox" aria-label="Launchpad tools"></div>
            <div class="store-error" data-launchpad-error hidden></div>
          </section>
          <article class="store-detail" data-launchpad-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ move</span>
          <span>Enter launch details</span>
          <span>Leader palette</span>
          <span>Esc terminal</span>
        </div>
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
          <span>Leader palette</span>
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
          <span>Leader palette</span>
          <span>Esc terminal</span>
        </div>
      </section>
      <section class="store-shell agent-cockpit" data-agents-view hidden aria-label="Coding agents">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">AGENT COCKPIT</span>
            <span class="store-title">Choose an agent, then choose Task or General Chat</span>
          </div>
          <label class="store-control">
            <span>Search</span>
            <input data-agent-search type="search" placeholder="name, publisher" autocomplete="off" />
          </label>
          <button class="store-close" type="button" data-agents-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-agent-notice>
          Installed and launchable agents appear first. Unavailable agents stay linked to their Store page.
        </div>
        <div class="store-content">
          <section class="store-list-panel" aria-label="Coding agents">
            <div class="store-list-header">
              <span>Agents</span>
              <span data-agent-count>loading…</span>
            </div>
            <div class="store-list" data-agent-list role="listbox" aria-label="Coding agents"></div>
            <div class="store-error" data-agent-error hidden></div>
          </section>
          <article class="store-detail" data-agent-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ choose agent</span>
          <span>Enter open task setup</span>
          <span>Policy stays visible</span>
          <span>Esc terminal</span>
        </div>
      </section>
      <section class="store-shell attention-queue" data-attention-view hidden aria-label="Attention Queue">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">ATTENTION QUEUE</span>
            <span class="store-title">Approvals, questions, failures, completion, and queued follow-ups</span>
          </div>
          <label class="store-control">
            <span>Search</span>
            <input data-attention-search type="search" placeholder="workspace, agent, state" autocomplete="off" />
          </label>
          <button class="store-close" type="button" data-attention-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-attention-notice>
          Every state names its evidence source. Output observations are marked uncertain.
        </div>
        <div class="store-content">
          <section class="store-list-panel" aria-label="Agent sessions needing attention">
            <div class="store-list-header">
              <span>Sessions</span>
              <span data-attention-count>loading…</span>
            </div>
            <div class="store-list" data-attention-list role="listbox" aria-label="Supervised agent sessions"></div>
            <div class="store-error" data-attention-error hidden></div>
          </section>
          <article class="store-detail" data-attention-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ choose session</span>
          <span>Enter inspect</span>
          <span>Return exact context</span>
          <span>Esc terminal</span>
        </div>
      </section>
      <section class="store-shell agent-task-center" data-tasks-view hidden aria-label="Agent Tasks">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">AGENT TASKS</span>
            <span class="store-title">Isolated Worktrees, writers, and explicit handoffs</span>
          </div>
          <label class="store-control">
            <span>Search</span>
            <input data-tasks-search type="search" placeholder="task, branch, repository, owner" autocomplete="off" />
          </label>
          <button class="store-close" type="button" data-tasks-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-tasks-notice>
          One Worktree Lease can be active at a time. Cancellation preserves changed Worktrees.
        </div>
        <div class="store-content">
          <section class="store-list-panel" aria-label="Agent Tasks">
            <div class="store-list-header">
              <span>Tasks</span>
              <span data-tasks-count>loading…</span>
            </div>
            <div class="store-list" data-tasks-list role="listbox" aria-label="Agent Tasks"></div>
            <div class="store-error" data-tasks-error hidden></div>
          </section>
          <article class="store-detail" data-tasks-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ choose task</span>
          <span>Enter inspect</span>
          <span>Lease is explicit</span>
          <span>Esc terminal</span>
        </div>
      </section>
    </main>
    <footer class="bottombar">
      <span>Leader opens commands</span>
      <span>Palette: Launch App</span>
      <span>Palette: Store</span>
      <span>Palette: My Apps</span>
      <span>Palette: Agent Tasks</span>
      <span>Palette: Attention</span>
      <span>Palette: New Tab</span>
      <span>Palette: Split</span>
      <span data-cwd></span>
    </footer>
  </section>
`;

const terminalShell = app.querySelector<HTMLElement>("[data-terminal-shell]")!;
const onboardingScreen = app.querySelector<HTMLElement>("[data-onboarding]")!;
const onboardingOptions = app.querySelector<HTMLDivElement>("[data-onboarding-options]")!;
const onboardingStartup = app.querySelector<HTMLSelectElement>("[data-onboarding-startup]")!;
const onboardingMessage = app.querySelector<HTMLParagraphElement>("[data-onboarding-message]")!;
const frameTabs = app.querySelector<HTMLDivElement>("[data-frame-tabs]")!;
const frameLayout = app.querySelector<HTMLDivElement>("[data-frame-layout]")!;
const sessionMeta = app.querySelector<HTMLDivElement>("[data-session-meta]")!;
const status = app.querySelector<HTMLDivElement>("[data-status]")!;
const cwdLabel = app.querySelector<HTMLSpanElement>("[data-cwd]")!;
const errorPanel = app.querySelector<HTMLDivElement>("[data-error]")!;
const workspaceRecovery = app.querySelector<HTMLElement>("[data-workspace-recovery]")!;
const workspaceRecoveryMessage = app.querySelector<HTMLElement>("[data-workspace-recovery-message]")!;
const workspaceRecoveryList = app.querySelector<HTMLDivElement>("[data-workspace-recovery-list]")!;
const workspaceRestartAllButton = app.querySelector<HTMLButtonElement>("[data-workspace-restart-all]")!;
const workspaceOpenShellButton = app.querySelector<HTMLButtonElement>("[data-workspace-open-shell]")!;
const workspaceDismissButton = app.querySelector<HTMLButtonElement>("[data-workspace-dismiss]")!;
const launchpadOpenButton = app.querySelector<HTMLButtonElement>("[data-launchpad-open]")!;
const storeOpenButton = app.querySelector<HTMLButtonElement>("[data-store-open]")!;
const appsOpenButton = app.querySelector<HTMLButtonElement>("[data-apps-open]")!;
const agentsOpenButton = app.querySelector<HTMLButtonElement>("[data-agents-open]")!;
const tasksOpenButton = app.querySelector<HTMLButtonElement>("[data-tasks-open]")!;
const attentionOpenButton = app.querySelector<HTMLButtonElement>("[data-attention-open]")!;
const attentionBadge = app.querySelector<HTMLSpanElement>("[data-attention-badge]")!;
const appsUpdateBadge = app.querySelector<HTMLSpanElement>("[data-apps-update-badge]")!;
const launchpadCloseButton = app.querySelector<HTMLButtonElement>("[data-launchpad-close]")!;
const storeCloseButton = app.querySelector<HTMLButtonElement>("[data-store-close]")!;
const appsCloseButton = app.querySelector<HTMLButtonElement>("[data-apps-close]")!;
const launchpadView = app.querySelector<HTMLElement>("[data-launchpad-view]")!;
const storeView = app.querySelector<HTMLElement>("[data-store-view]")!;
const appsView = app.querySelector<HTMLElement>("[data-apps-view]")!;
const launchpadSearch = app.querySelector<HTMLInputElement>("[data-launchpad-search]")!;
const launchpadNotice = app.querySelector<HTMLDivElement>("[data-launchpad-notice]")!;
const launchpadCount = app.querySelector<HTMLSpanElement>("[data-launchpad-count]")!;
const launchpadList = app.querySelector<HTMLDivElement>("[data-launchpad-list]")!;
const launchpadError = app.querySelector<HTMLDivElement>("[data-launchpad-error]")!;
const launchpadDetail = app.querySelector<HTMLElement>("[data-launchpad-detail]")!;
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
const agentsView = app.querySelector<HTMLElement>("[data-agents-view]")!;
const agentsCloseButton = app.querySelector<HTMLButtonElement>("[data-agents-close]")!;
const agentSearch = app.querySelector<HTMLInputElement>("[data-agent-search]")!;
const agentNotice = app.querySelector<HTMLDivElement>("[data-agent-notice]")!;
const agentCount = app.querySelector<HTMLSpanElement>("[data-agent-count]")!;
const agentList = app.querySelector<HTMLDivElement>("[data-agent-list]")!;
const agentError = app.querySelector<HTMLDivElement>("[data-agent-error]")!;
const agentDetail = app.querySelector<HTMLElement>("[data-agent-detail]")!;
const tasksView = app.querySelector<HTMLElement>("[data-tasks-view]")!;
const tasksCloseButton = app.querySelector<HTMLButtonElement>("[data-tasks-close]")!;
const tasksSearch = app.querySelector<HTMLInputElement>("[data-tasks-search]")!;
const tasksNotice = app.querySelector<HTMLDivElement>("[data-tasks-notice]")!;
const tasksCount = app.querySelector<HTMLSpanElement>("[data-tasks-count]")!;
const tasksList = app.querySelector<HTMLDivElement>("[data-tasks-list]")!;
const tasksError = app.querySelector<HTMLDivElement>("[data-tasks-error]")!;
const tasksDetail = app.querySelector<HTMLElement>("[data-tasks-detail]")!;
const attentionView = app.querySelector<HTMLElement>("[data-attention-view]")!;
const attentionCloseButton = app.querySelector<HTMLButtonElement>("[data-attention-close]")!;
const attentionSearch = app.querySelector<HTMLInputElement>("[data-attention-search]")!;
const attentionNotice = app.querySelector<HTMLDivElement>("[data-attention-notice]")!;
const attentionCount = app.querySelector<HTMLSpanElement>("[data-attention-count]")!;
const attentionList = app.querySelector<HTMLDivElement>("[data-attention-list]")!;
const attentionError = app.querySelector<HTMLDivElement>("[data-attention-error]")!;
const attentionDetail = app.querySelector<HTMLElement>("[data-attention-detail]")!;
const commandOverlay = app.querySelector<HTMLElement>("[data-command-overlay]")!;
const commandCloseButton = app.querySelector<HTMLButtonElement>("[data-command-close]")!;
const commandSearch = app.querySelector<HTMLInputElement>("[data-command-search]")!;
const commandList = app.querySelector<HTMLDivElement>("[data-command-list]")!;
const commandMessage = app.querySelector<HTMLDivElement>("[data-command-message]")!;
const leaderHint = app.querySelector<HTMLSpanElement>("[data-leader-hint]")!;

if (
  !terminalShell ||
  !onboardingScreen ||
  !onboardingOptions ||
  !onboardingStartup ||
  !onboardingMessage ||
  !frameTabs ||
  !frameLayout ||
  !sessionMeta ||
  !status ||
  !cwdLabel ||
  !errorPanel ||
  !workspaceRecovery ||
  !workspaceRecoveryMessage ||
  !workspaceRecoveryList ||
  !workspaceRestartAllButton ||
  !workspaceOpenShellButton ||
  !workspaceDismissButton ||
  !launchpadOpenButton ||
  !storeOpenButton ||
  !appsOpenButton ||
  !agentsOpenButton ||
  !tasksOpenButton ||
  !attentionOpenButton ||
  !attentionBadge ||
  !appsUpdateBadge ||
  !launchpadCloseButton ||
  !storeCloseButton ||
  !appsCloseButton ||
  !launchpadView ||
  !storeView ||
  !appsView ||
  !launchpadSearch ||
  !launchpadNotice ||
  !launchpadCount ||
  !launchpadList ||
  !launchpadError ||
  !launchpadDetail ||
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
  !appsDetail ||
  !agentsView ||
  !agentsCloseButton ||
  !agentSearch ||
  !agentNotice ||
  !agentCount ||
  !agentList ||
  !agentError ||
  !agentDetail ||
  !tasksView ||
  !tasksCloseButton ||
  !tasksSearch ||
  !tasksNotice ||
  !tasksCount ||
  !tasksList ||
  !tasksError ||
  !tasksDetail ||
  !attentionView ||
  !attentionCloseButton ||
  !attentionSearch ||
  !attentionNotice ||
  !attentionCount ||
  !attentionList ||
  !attentionError ||
  !attentionDetail ||
  !commandOverlay ||
  !commandCloseButton ||
  !commandSearch ||
  !commandList ||
  !commandMessage ||
  !leaderHint
) {
  throw new Error("Arkonad frame elements are missing");
}

type PaneRuntime = {
  pane: FramePane;
  host: HTMLDivElement;
  terminalHost: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
};

const paneRuntimes = new Map<string, PaneRuntime>();
let frameSnapshot: FrameSnapshot = {
  tabs: [],
  activeTabId: null,
  focusedPaneId: null,
};
let session: SessionInfo | undefined;
let resizeTimer: number | undefined;
let terminalStatusText = "connecting";
let terminalStatusState = "";
let storeOpen = false;
let activeSurface: "launchpad" | "store" | "apps" | "agents" | "tasks" | "attention" = "launchpad";
let launchpadEntries: LaunchpadEntry[] = [];
let selectedLaunchpadId: string | undefined;
let launchpadRequestId = 0;
let launchpadRefreshTimer: number | undefined;
let storeEntries: CatalogEntry[] = [];
let selectedStoreId: string | undefined;
let storeRequestId = 0;
let storeRefreshTimer: number | undefined;
let installBusy = false;
let myAppsEntries: MyAppEntry[] = [];
let selectedMyAppId: string | undefined;
let myAppsRequestId = 0;
let myAppsRefreshTimer: number | undefined;
let customAppEntries: CustomAppProfile[] = [];
let editingCustomAppId: string | undefined;
let launchBusy = false;
let agentEntries: AgentEntry[] = [];
let selectedAgentId: string | undefined;
let agentRequestId = 0;
let agentRefreshTimer: number | undefined;
let agentMode: AgentSessionMode = "task";
let agentDraftTask = "";
let agentDraftPermission: AgentPermissionMode = "ask";
let agentDraftFollowUp: AgentFollowUpMode = "queue";
let agentDraftScope: AgentPolicyScope = "workspace";
let agentTaskPlan: AgentTaskPlan | undefined;
let agentTasks: AgentTask[] = [];
let selectedTaskId: string | undefined;
let taskRequestId = 0;
let taskPlanRequestId = 0;
let taskDraftBaseBranch = "";
let taskDraftBranch = "";
let taskDraftWorktreeRoot = "";
let taskDraftEntryId: string | undefined;
let agentSupervision: AgentSupervisionSnapshot = { sessions: [], adapters: [] };
let selectedSupervisionId: string | undefined;
let attentionRequestId = 0;
const supervisedSessionIds = new Set<string>();
const agentObservationBuffers = new Map<string, string>();
const agentObservationTimers = new Map<string, number>();
let commandOverlayOpen = false;
let selectedCommandId: string | undefined;
let pendingClose: "pane" | "tab" | undefined;
let onboardingOpen = false;
let selectedOnboardingChoice: OnboardingChoiceId = "terminal";
let startupBehavior = parseStartupBehavior(readLocalPreference(startupBehaviorStorageKey));
let terminalStarted = false;
let terminalStartPromise: Promise<void> | undefined;
const leaderStorageKey = "arkonad.leader-chord";
let leaderChord = readLocalPreference(leaderStorageKey) ?? "ctrl+space";
let activeWorkspaceId: string | null = null;
let activeWorkspaceName = "Arkonad Workspace";
let pendingWorkspace: WorkspaceDocument | null = null;
let targetRecoveryPaneId: string | undefined;
let workspaceRecoveryOpen = false;
let workspaceRestoring = false;
let workspaceMetadataReady = false;
let launchpadMetadataReady = false;
let customAppMetadataReady = false;
let workspaceSaveTimer: number | undefined;
let workspaceSaveInFlight: Promise<void> | undefined;
let workspaceAgentPolicies: Record<string, AgentPolicy> = {};
const sessionAgentOverrides = new Map<string, AgentPolicy>();

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
  if (!storeOpen && !commandOverlayOpen) {
    renderTerminalStatus();
  }
}

function showError(message: string): void {
  setTerminalStatus("error", "error");
  errorPanel.hidden = false;
  errorPanel.textContent = message;
}

function focusedPane(): FramePane | undefined {
  const activeTab = frameSnapshot.tabs.find((tab) => tab.id === frameSnapshot.activeTabId);
  if (!activeTab) {
    return undefined;
  }
  return activeTab.panes.find((pane) => pane.id === activeTab.focusedPaneId);
}

function paneForSession(sessionId: string): FramePane | undefined {
  return frameSnapshot.tabs
    .flatMap((tab) => tab.panes)
    .find((pane) => pane.session.id === sessionId);
}

function updateFocusedSession(): void {
  session = focusedPane()?.session;
  sessionMeta.textContent = session?.shell ?? "no active session";
  cwdLabel.textContent = session?.cwd ?? "";
  rememberLastWorkspace(session?.cwd);
}

function sendResizeForPane(runtime: PaneRuntime): void {
  const dimensions = runtime.fitAddon.proposeDimensions();
  if (!dimensions) {
    return;
  }
  void invoke("resize_session", {
    id: runtime.pane.session.id,
    cols: dimensions.cols,
    rows: dimensions.rows,
  }).catch((error: unknown) => showError(String(error)));
}

function sendResize(): void {
  for (const runtime of paneRuntimes.values()) {
    sendResizeForPane(runtime);
  }
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

function rememberLastWorkspace(path: string | undefined): void {
  const normalizedPath = path?.trim();
  if (normalizedPath) {
    writeLocalPreference(lastWorkspaceStorageKey, normalizedPath);
  }
}

function lastWorkspacePath(): string | null {
  return readLocalPreference(lastWorkspaceStorageKey)?.trim() || null;
}

function setTopbarActionsDisabled(disabled: boolean): void {
  launchpadOpenButton.disabled = disabled;
  storeOpenButton.disabled = disabled;
  appsOpenButton.disabled = disabled;
  agentsOpenButton.disabled = disabled;
  tasksOpenButton.disabled = disabled;
  attentionOpenButton.disabled = disabled;
}

function renderOnboardingChoices(focusSelected = false): void {
  onboardingOptions.replaceChildren();
  for (const choice of onboardingChoices) {
    const selected = choice.id === selectedOnboardingChoice;
    const button = makeElement("button", "onboarding-option") as HTMLButtonElement;
    button.type = "button";
    button.id = `onboarding-option-${choice.id}`;
    button.role = "option";
    button.ariaSelected = selected ? "true" : "false";
    button.tabIndex = selected ? 0 : -1;
    const key = makeElement("span", "onboarding-option-key", String(onboardingChoices.indexOf(choice) + 1));
    const copy = makeElement("span", "onboarding-option-copy");
    copy.append(
      makeElement("strong", "onboarding-option-label", choice.label),
      makeElement("span", "onboarding-option-description", choice.description),
      makeElement("span", "onboarding-option-detail", choice.detail),
    );
    button.append(key, copy);
    button.addEventListener("click", () => {
      selectedOnboardingChoice = choice.id;
      renderOnboardingChoices(true);
    });
    onboardingOptions.append(button);
  }

  onboardingOptions.setAttribute(
    "aria-activedescendant",
    `onboarding-option-${selectedOnboardingChoice}`,
  );
  if (focusSelected) {
    window.requestAnimationFrame(() => {
      onboardingOptions
        .querySelector<HTMLButtonElement>(`#onboarding-option-${selectedOnboardingChoice}`)
        ?.focus();
    });
  }
}

function moveOnboardingSelection(offset: number): void {
  const currentIndex = onboardingChoices.findIndex(
    (choice) => choice.id === selectedOnboardingChoice,
  );
  const nextIndex = (Math.max(currentIndex, 0) + offset + onboardingChoices.length) % onboardingChoices.length;
  selectedOnboardingChoice = onboardingChoices[nextIndex].id;
  renderOnboardingChoices(true);
}

function saveOnboardingPreferences(): void {
  startupBehavior = parseStartupBehavior(onboardingStartup.value);
  writeLocalPreference(startupBehaviorStorageKey, startupBehavior);
  writeLocalPreference(onboardingCompletedStorageKey, "true");
}

function closeOnboarding(): void {
  onboardingOpen = false;
  onboardingScreen.hidden = true;
  setTopbarActionsDisabled(false);
  onboardingMessage.textContent = "";
}

function refreshWorkspaceMetadata(): void {
  void refreshLaunchpad();
  void refreshMyApps();
}

function completeOnboarding(choiceId: OnboardingChoiceId): void {
  selectedOnboardingChoice = choiceId;
  saveOnboardingPreferences();
  closeOnboarding();
  refreshWorkspaceMetadata();

  switch (choiceId) {
    case "store":
      openStore("");
      break;
    case "apps":
      openMyApps();
      break;
    case "agent":
      openAgentCockpit();
      break;
    case "restore":
      void loadWorkspaceOnStartup();
      break;
    default:
      void startSession();
      break;
  }
}

function openOnboarding(): void {
  onboardingOpen = true;
  onboardingScreen.hidden = false;
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = true;
  storeOpen = false;
  setTopbarActionsDisabled(true);
  sessionMeta.textContent = "first run";
  status.textContent = "onboarding";
  status.dataset.state = "ready";
  onboardingStartup.value = startupBehavior;
  selectedOnboardingChoice = "terminal";
  renderOnboardingChoices(true);
}

function openStartupBehavior(): void {
  refreshWorkspaceMetadata();
  switch (startupBehavior) {
    case "store":
      openStore();
      break;
    case "apps":
      openMyApps();
      break;
    case "launchpad":
      openLaunchpad();
      break;
    case "lastWorkspace":
      void loadWorkspaceOnStartup();
      break;
    default:
      void startSession();
      break;
  }
}

function createPaneRuntime(pane: FramePane): PaneRuntime {
  const host = makeElement("section", "frame-pane") as HTMLDivElement;
  host.dataset.paneId = pane.id;
  host.tabIndex = -1;

  const header = makeElement("div", "pane-header");
  header.append(makeElement("span", "pane-title", pane.session.shell));
  header.append(makeElement("span", "pane-cwd", pane.session.cwd));

  const terminalHost = makeElement("div", "terminal") as HTMLDivElement;
  host.append(header, terminalHost);

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
    // WebGL is optional; xterm's DOM renderer remains the fallback.
  }

  terminal.onData((data) => {
    void invoke("write_session", {
      id: pane.session.id,
      data: new TextEncoder().encode(data),
    }).catch((error: unknown) => showError(String(error)));
  });
  terminalHost.addEventListener("focusin", () => {
    if (frameSnapshot.focusedPaneId !== pane.id) {
      void focusPaneFromUser(pane.id);
    }
  });
  host.addEventListener("mousedown", () => {
    if (frameSnapshot.focusedPaneId !== pane.id) {
      void focusPaneFromUser(pane.id);
    }
  });
  terminal.open(terminalHost);

  return { pane, host, terminalHost, terminal, fitAddon };
}

function ensurePaneRuntime(pane: FramePane): PaneRuntime {
  const existing = paneRuntimes.get(pane.id);
  if (existing) {
    existing.pane = pane;
    const title = existing.host.querySelector<HTMLElement>(".pane-title");
    const cwd = existing.host.querySelector<HTMLElement>(".pane-cwd");
    if (title) {
      title.textContent = pane.session.shell;
    }
    if (cwd) {
      cwd.textContent = pane.session.cwd;
    }
    return existing;
  }
  const created = createPaneRuntime(pane);
  paneRuntimes.set(pane.id, created);
  return created;
}

function writeToPane(sessionId: string, chunk: Uint8Array): void {
  for (const runtime of paneRuntimes.values()) {
    if (runtime.pane.session.id === sessionId) {
      runtime.terminal.write(chunk);
      observeAgentOutput(sessionId, chunk);
      return;
    }
  }
}

function renderLayoutNode(node: LayoutNode, tab: FrameTab, parent: HTMLElement): void {
  if (node.kind === "leaf") {
    const pane = tab.panes.find((candidate) => candidate.id === node.paneId);
    if (!pane) {
      return;
    }
    const runtime = ensurePaneRuntime(pane);
    runtime.host.classList.toggle("is-focused", tab.focusedPaneId === pane.id);
    parent.append(runtime.host);
    return;
  }

  const split = makeElement("div", `frame-split split-${node.orientation}`) as HTMLDivElement;
  const ratio = Math.min(0.85, Math.max(0.15, node.ratio)) * 100;
  if (node.orientation === "vertical") {
    split.style.gridTemplateColumns = `${ratio}fr ${100 - ratio}fr`;
  } else {
    split.style.gridTemplateRows = `${ratio}fr ${100 - ratio}fr`;
  }
  renderLayoutNode(node.first, tab, split);
  renderLayoutNode(node.second, tab, split);
  parent.append(split);
}

function renderFrame(nextSnapshot: FrameSnapshot, focusActive = true): void {
  frameSnapshot = nextSnapshot;
  updateFocusedSession();
  scheduleWorkspaceSave();

  const visiblePaneIds = new Set(
    frameSnapshot.tabs.flatMap((tab) => tab.panes.map((pane) => pane.id)),
  );
  for (const [paneId, runtime] of paneRuntimes) {
    if (!visiblePaneIds.has(paneId)) {
      runtime.terminal.dispose();
      runtime.host.remove();
      paneRuntimes.delete(paneId);
    }
  }

  frameTabs.replaceChildren();
  for (const tab of frameSnapshot.tabs) {
    const button = makeElement("button", "frame-tab") as HTMLButtonElement;
    button.type = "button";
    button.role = "tab";
    button.ariaSelected = tab.id === frameSnapshot.activeTabId ? "true" : "false";
    button.classList.toggle("is-active", tab.id === frameSnapshot.activeTabId);
    button.dataset.tabId = tab.id;
    button.textContent = `${tab.title} · ${tab.panes.length}`;
    button.addEventListener("click", () => {
      void activateTab(tab.id);
    });
    frameTabs.append(button);
  }

  frameLayout.replaceChildren();
  const activeTab = frameSnapshot.tabs.find((tab) => tab.id === frameSnapshot.activeTabId);
  if (activeTab) {
    renderLayoutNode(activeTab.root, activeTab, frameLayout);
  } else {
    frameLayout.append(
      makeElement("div", "frame-empty", "No active session. Open the command palette to create one."),
    );
  }

  window.requestAnimationFrame(() => {
    sendResize();
    if (focusActive && frameSnapshot.focusedPaneId) {
      paneRuntimes.get(frameSnapshot.focusedPaneId)?.terminal.focus();
    }
  });
}

async function focusPaneFromUser(paneId: string): Promise<void> {
  try {
    renderFrame(await invoke<FrameSnapshot>("frame_focus_pane", { paneId }), false);
    paneRuntimes.get(paneId)?.terminal.focus();
  } catch (error) {
    showError(`Could not focus the pane: ${String(error)}`);
  }
}

async function activateTab(tabId: string): Promise<void> {
  try {
    renderFrame(await invoke<FrameSnapshot>("frame_activate_tab", { tabId }));
  } catch (error) {
    showError(`Could not activate the tab: ${String(error)}`);
  }
}

async function moveTab(offset: number): Promise<void> {
  if (frameSnapshot.tabs.length < 2) {
    showCommandMessage("There is only one open tab.");
    return;
  }
  const currentIndex = frameSnapshot.tabs.findIndex((tab) => tab.id === frameSnapshot.activeTabId);
  const nextIndex = (Math.max(0, currentIndex) + offset + frameSnapshot.tabs.length) % frameSnapshot.tabs.length;
  await activateTab(frameSnapshot.tabs[nextIndex].id);
}

type FrameCommand = {
  id: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
};

function normalizedLeader(value: string): string {
  const parts = value
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.at(-1);
  if (!key || (key !== "space" && !/^[a-z0-9]+$/.test(key))) {
    return "ctrl+space";
  }
  const modifiers = ["ctrl", "alt", "shift", "meta"].filter((modifier) =>
    parts.includes(modifier),
  );
  if (modifiers.length === 0) {
    return "ctrl+space";
  }
  return [...new Set([...modifiers, key])].join("+");
}

function leaderLabel(): string {
  return leaderChord
    .split("+")
    .map((part) => (part === "space" ? "Space" : part.length === 1 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join("+");
}

function eventMatchesLeader(event: KeyboardEvent): boolean {
  const parts = leaderChord.split("+");
  const key = parts.at(-1);
  const eventKey = event.key === " " ? "space" : event.key.toLowerCase();
  return (
    key === eventKey &&
    event.ctrlKey === parts.includes("ctrl") &&
    event.altKey === parts.includes("alt") &&
    event.shiftKey === parts.includes("shift") &&
    event.metaKey === parts.includes("meta")
  );
}

function showCommandMessage(message: string): void {
  commandMessage.replaceChildren(makeElement("span", undefined, message));
}

function showSettings(): void {
  commandMessage.replaceChildren();
  const title = makeElement("strong", "command-message-title", "Leader chord");
  const description = makeElement(
    "p",
    "command-message-description",
    "Choose the only chord Arkonad captures. Every other key stays with the focused session.",
  );
  const row = makeElement("div", "command-settings-row");
  const input = makeElement("input", "command-settings-input") as HTMLInputElement;
  input.type = "text";
  input.value = leaderChord;
  input.placeholder = "ctrl+space";
  input.setAttribute("aria-label", "Leader chord");
  const save = makeElement("button", "detail-action", "Save") as HTMLButtonElement;
  save.type = "button";
  save.addEventListener("click", () => {
    leaderChord = normalizedLeader(input.value);
    writeLocalPreference(leaderStorageKey, leaderChord);
    leaderHint.textContent = `Leader ${leaderLabel()}`;
    showCommandMessage(`Leader saved as ${leaderLabel()}.`);
    scheduleWorkspaceSave();
  });
  row.append(input, save);

  const startupTitle = makeElement(
    "strong",
    "command-message-title",
    "Startup behavior",
  );
  const startupDescription = makeElement(
    "p",
    "command-message-description",
    "Choose the surface Arkonad opens next time. Last Workspace uses the most recent saved Session location.",
  );
  const startupRow = makeElement("div", "command-settings-row");
  const startupLabel = makeElement("label", "command-settings-field");
  startupLabel.append(makeElement("span", undefined, "Open on startup"));
  const startupSelect = makeElement("select", "command-settings-input") as HTMLSelectElement;
  startupSelect.setAttribute("aria-label", "Startup behavior");
  for (const option of startupBehaviorOptions) {
    const element = makeElement("option") as HTMLOptionElement;
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === startupBehavior;
    startupSelect.append(element);
  }
  startupSelect.addEventListener("change", () => {
    startupBehavior = parseStartupBehavior(startupSelect.value);
    writeLocalPreference(startupBehaviorStorageKey, startupBehavior);
    showCommandMessage(`Startup behavior saved as ${startupBehaviorLabel(startupBehavior)}.`);
  });
  startupLabel.append(startupSelect);
  startupRow.append(startupLabel);

  commandMessage.append(title, description, row, startupTitle, startupDescription, startupRow);
  input.focus();
  input.select();
}

function frameCommands(): FrameCommand[] {
  return [
    {
      id: "store",
      label: "Store",
      description: "Browse and install Catalog Tools.",
      run: () => {
        closeCommandOverlay();
        openStore();
      },
    },
    {
      id: "my-apps",
      label: "My Apps",
      description: "Manage installed and detected tools.",
      run: () => {
        closeCommandOverlay();
        openMyApps();
      },
    },
    {
      id: "agents",
      label: "Coding Agents",
      description: "Choose an installed agent, start a task, or open General Chat.",
      run: () => {
        closeCommandOverlay();
        openAgentCockpit();
      },
    },
    {
      id: "agent-policy",
      label: "Agents · Workspace Policy",
      description: "Open permission and follow-up policy controls for the selected agent.",
      run: () => {
        closeCommandOverlay();
        openAgentCockpit();
      },
    },
    {
      id: "launch-app",
      label: "Launch App",
      description: "Open Launchpad and choose a Launchable Tool.",
      run: () => {
        closeCommandOverlay();
        openLaunchpad();
      },
    },
    {
      id: "save-workspace",
      label: "Workspace · Save",
      description: "Save the current layout and local Workspace metadata.",
      run: async () => {
        const requestedName = window.prompt("Workspace name", activeWorkspaceName);
        if (requestedName === null) {
          return;
        }
        activeWorkspaceName = requestedName.trim() || activeWorkspaceName;
        await saveWorkspaceNow();
        showCommandMessage(`Workspace saved as ${activeWorkspaceName}.`);
      },
    },
    {
      id: "restore-workspace",
      label: "Workspace · Restore",
      description: "Review the last saved Workspace before restarting sessions.",
      run: async () => {
        const result = await invoke<WorkspaceLoadResult>("workspace_load", {
          workspaceId: activeWorkspaceId,
        });
        if (result.status === "ready" && result.workspace) {
          closeCommandOverlay();
          openWorkspaceRecovery(result.workspace, result.message);
        } else {
          showCommandMessage(result.message);
        }
      },
    },
    {
      id: "new-session",
      label: "Session · New Tab",
      description: "Start another shell session in a new tab.",
      run: createFrameTab,
    },
    {
      id: "previous-tab",
      label: "Session · Previous Tab",
      description: "Focus the tab to the left of the active tab.",
      run: () => moveTab(-1),
    },
    {
      id: "next-tab",
      label: "Session · Next Tab",
      description: "Focus the tab to the right of the active tab.",
      run: () => moveTab(1),
    },
    {
      id: "split-right",
      label: "Split · Right",
      description: "Create a session beside the focused pane.",
      run: () => splitFrame("vertical"),
    },
    {
      id: "split-down",
      label: "Split · Down",
      description: "Create a session below the focused pane.",
      run: () => splitFrame("horizontal"),
    },
    {
      id: "focus-left",
      label: "Focus · Left",
      description: "Move focus to the nearest pane on the left.",
      run: () => moveFocusedPane("left"),
    },
    {
      id: "focus-right",
      label: "Focus · Right",
      description: "Move focus to the nearest pane on the right.",
      run: () => moveFocusedPane("right"),
    },
    {
      id: "focus-up",
      label: "Focus · Up",
      description: "Move focus to the nearest pane above.",
      run: () => moveFocusedPane("up"),
    },
    {
      id: "focus-down",
      label: "Focus · Down",
      description: "Move focus to the nearest pane below.",
      run: () => moveFocusedPane("down"),
    },
    {
      id: "resize-left",
      label: "Resize · Left",
      description: "Make the focused pane's split smaller.",
      run: () => resizeFocusedPane("left"),
    },
    {
      id: "resize-right",
      label: "Resize · Right",
      description: "Make the focused pane's split larger.",
      run: () => resizeFocusedPane("right"),
    },
    {
      id: "resize-up",
      label: "Resize · Up",
      description: "Make the focused pane's horizontal split smaller.",
      run: () => resizeFocusedPane("up"),
    },
    {
      id: "resize-down",
      label: "Resize · Down",
      description: "Make the focused pane's horizontal split larger.",
      run: () => resizeFocusedPane("down"),
    },
    {
      id: "close-pane",
      label: "Session · Close Focused Pane",
      description: "Close only the focused session after a running-process warning.",
      run: () => closeFocusedPane(pendingClose === "pane"),
    },
    {
      id: "close-tab",
      label: "Session · Close Active Tab",
      description: "Close every pane in the active tab after a running-process warning.",
      run: () => closeActiveTab(pendingClose === "tab"),
    },
    {
      id: "tasks",
      label: "Agents · Agent Tasks",
      description: "Review isolated Worktrees, active writers, and explicit handoffs.",
      run: () => {
        closeCommandOverlay();
        openAgentTasks();
      },
    },
    {
      id: "attention",
      label: "Agents · Attention Queue",
      description: "Review approvals, questions, failures, completion, and pending follow-ups.",
      run: () => {
        closeCommandOverlay();
        openAttentionQueue();
      },
    },
    {
      id: "repository",
      label: "Repository",
      description: "Open repository controls for the focused session.",
      run: () => showCommandMessage("Repository view will use the focused session's Repository Context."),
    },
    {
      id: "settings",
      label: "Settings",
      description: "Change the Leader chord and startup behavior.",
      run: showSettings,
    },
  ];
}

function visibleFrameCommands(): FrameCommand[] {
  const query = commandSearch.value.trim().toLowerCase();
  return frameCommands().filter(
    (command) =>
      !query || `${command.label} ${command.description}`.toLowerCase().includes(query),
  );
}

function renderCommandList(): void {
  const commands = visibleFrameCommands();
  if (!commands.some((command) => command.id === selectedCommandId)) {
    selectedCommandId = commands[0]?.id;
  }
  commandList.replaceChildren();
  if (commands.length === 0) {
    commandList.append(makeElement("p", "detail-empty", "No commands match this search."));
    return;
  }
  for (const command of commands) {
    const button = makeElement("button", "command-row") as HTMLButtonElement;
    button.type = "button";
    button.role = "option";
    button.ariaSelected = command.id === selectedCommandId ? "true" : "false";
    button.dataset.commandId = command.id;
    const label = makeElement("span", "command-row-label", command.label);
    const description = makeElement("span", "command-row-description", command.description);
    button.append(label, description);
    button.addEventListener("click", () => {
      selectedCommandId = command.id;
      void executeSelectedCommand();
    });
    commandList.append(button);
  }
}

async function executeSelectedCommand(): Promise<void> {
  const command = frameCommands().find((candidate) => candidate.id === selectedCommandId);
  if (!command) {
    return;
  }
  await command.run();
  if (command.id !== "close-pane" && command.id !== "close-tab" && command.id !== "settings") {
    pendingClose = undefined;
  }
  renderCommandList();
  if (commandOverlayOpen && command.id !== "settings") {
    commandSearch.focus();
  }
}

function moveCommandSelection(offset: number): void {
  const commands = visibleFrameCommands();
  if (commands.length === 0) {
    return;
  }
  const currentIndex = Math.max(
    0,
    commands.findIndex((command) => command.id === selectedCommandId),
  );
  selectedCommandId = commands[(currentIndex + offset + commands.length) % commands.length].id;
  renderCommandList();
  commandList.querySelector<HTMLButtonElement>(`[data-command-id="${selectedCommandId}"]`)?.focus();
}

function openCommandOverlay(): void {
  if (storeOpen) {
    closeSurface();
  }
  commandOverlayOpen = true;
  commandOverlay.hidden = false;
  selectedCommandId = undefined;
  commandMessage.replaceChildren();
  leaderHint.textContent = `Leader ${leaderLabel()}`;
  renderCommandList();
  commandSearch.value = "";
  window.requestAnimationFrame(() => commandSearch.focus());
}

function closeCommandOverlay(): void {
  commandOverlayOpen = false;
  commandOverlay.hidden = true;
  pendingClose = undefined;
  commandMessage.replaceChildren();
  renderTerminalStatus();
  paneRuntimes.get(frameSnapshot.focusedPaneId ?? "")?.terminal.focus();
}

function frameRequest(): { cols: number; rows: number; cwd: string | null; shell: string | null } {
  const runtime = frameSnapshot.focusedPaneId
    ? paneRuntimes.get(frameSnapshot.focusedPaneId)
    : undefined;
  const dimensions = runtime?.fitAddon.proposeDimensions();
  return {
    cols: dimensions?.cols ?? 120,
    rows: dimensions?.rows ?? 40,
    cwd: focusedPane()?.session.cwd ?? null,
    shell: null,
  };
}

function firstSavedLeafId(node: LayoutNode): string {
  return node.kind === "leaf" ? node.paneId : firstSavedLeafId(node.first);
}

function savedPaneById(document: WorkspaceDocument, paneId: string): FramePane | undefined {
  return document.frame.tabs
    .flatMap((tab) => tab.panes)
    .find((pane) => pane.id === paneId);
}

function recoveryPanes(document: WorkspaceDocument): RecoveryPane[] {
  return document.frame.tabs.flatMap((tab) =>
    tab.panes.map((pane) => ({
      tabId: tab.id,
      tabTitle: tab.title,
      pane,
    })),
  );
}

function savedSessionRequest(pane: FramePane): {
  cols: number;
  rows: number;
  cwd: string | null;
  shell: string | null;
} {
  return {
    cols: 120,
    rows: 40,
    cwd: pane.session.cwd,
    shell: pane.session.shellPath,
  };
}

function removePaneFromSavedLayout(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  const first = removePaneFromSavedLayout(node.first, paneId);
  if (!first) {
    return node.second;
  }
  const second = removePaneFromSavedLayout(node.second, paneId);
  if (!second) {
    return first;
  }
  return { ...node, first, second };
}

function dismissRecoveryPane(paneId: string): void {
  if (!pendingWorkspace) {
    return;
  }
  const tabs = pendingWorkspace.frame.tabs
    .map((tab) => {
      const root = removePaneFromSavedLayout(tab.root, paneId);
      if (!root) {
        return null;
      }
      const panes = tab.panes.filter((pane) => pane.id !== paneId);
      const focusedPaneId = panes.some((pane) => pane.id === tab.focusedPaneId)
        ? tab.focusedPaneId
        : firstSavedLeafId(root);
      return { ...tab, root, panes, focusedPaneId };
    })
    .filter((tab): tab is FrameTab => tab !== null);
  const activeTabId = tabs.some((tab) => tab.id === pendingWorkspace!.frame.activeTabId)
    ? pendingWorkspace.frame.activeTabId
    : tabs[0]?.id ?? null;
  const focusedPaneId = tabs
    .flatMap((tab) => tab.panes)
    .some((pane) => pane.id === pendingWorkspace!.frame.focusedPaneId)
    ? pendingWorkspace.frame.focusedPaneId
    : tabs[0]?.focusedPaneId ?? null;
  pendingWorkspace = {
    ...pendingWorkspace,
    frame: { ...pendingWorkspace.frame, tabs, activeTabId, focusedPaneId },
  };
  renderWorkspaceRecovery();
}

function renderWorkspaceRecovery(): void {
  workspaceRecoveryList.replaceChildren();
  const document = pendingWorkspace;
  if (!document) {
    return;
  }
  const panes = recoveryPanes(document);
  if (panes.length === 0) {
    workspaceRecoveryList.append(
      makeElement("p", "detail-empty", "No interrupted sessions remain. Open a blank shell to continue."),
    );
    workspaceRestartAllButton.disabled = true;
    return;
  }
  workspaceRestartAllButton.disabled = workspaceRestoring;
  for (const recovery of panes) {
    const row = makeElement("article", "workspace-recovery-row");
    row.dataset.recoveryPaneId = recovery.pane.id;
    row.classList.toggle("is-targeted", recovery.pane.id === targetRecoveryPaneId);
    const heading = makeElement("div", "workspace-recovery-row-heading");
    heading.append(
      makeElement("strong", undefined, `${recovery.tabTitle} · ${recovery.pane.session.shell}`),
      makeElement("span", "workspace-recovery-state", "Interrupted"),
    );
    row.append(heading);
    row.append(makeElement("p", "workspace-recovery-path", recovery.pane.session.cwd));
    const details = makeElement("p", "workspace-recovery-details");
    details.hidden = true;
    details.textContent = [
      `Saved pane: ${recovery.pane.id}`,
      `Saved session: ${recovery.pane.session.id}`,
      `Shell profile: ${recovery.pane.session.shellPath ?? "default shell"}`,
      `Tab: ${recovery.tabId}`,
    ].join(" · ");
    row.append(details);
    const actions = makeElement("div", "install-button-row");
    const restart = makeElement("button", "detail-action", "Restart") as HTMLButtonElement;
    restart.type = "button";
    restart.disabled = workspaceRestoring;
    restart.addEventListener("click", () => void restartRecoveryPane(recovery));
    const inspect = makeElement("button", "detail-action", "Inspect metadata") as HTMLButtonElement;
    inspect.type = "button";
    inspect.addEventListener("click", () => {
      details.hidden = !details.hidden;
      inspect.textContent = details.hidden ? "Inspect metadata" : "Hide metadata";
    });
    const dismiss = makeElement("button", "detail-action", "Dismiss") as HTMLButtonElement;
    dismiss.type = "button";
    dismiss.disabled = workspaceRestoring;
    dismiss.addEventListener("click", () => dismissRecoveryPane(recovery.pane.id));
    actions.append(restart, inspect, dismiss);
    row.append(actions);
    workspaceRecoveryList.append(row);
  }
  if (targetRecoveryPaneId) {
    window.requestAnimationFrame(() => {
      workspaceRecoveryList
        .querySelector<HTMLElement>(`[data-recovery-pane-id="${targetRecoveryPaneId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }
}

function openWorkspaceRecovery(document: WorkspaceDocument, message: string): void {
  if (activeWorkspaceId !== document.id) {
    sessionAgentOverrides.clear();
  }
  pendingWorkspace = document;
  activeWorkspaceId = document.id;
  activeWorkspaceName = document.name;
  workspaceAgentPolicies = normalizeAgentPolicies(document.settings?.agentPolicies);
  const savedLeaderChord = document.settings?.leaderChord;
  if (typeof savedLeaderChord === "string" && savedLeaderChord.trim()) {
    leaderChord = normalizedLeader(savedLeaderChord);
    localStorage.setItem(leaderStorageKey, leaderChord);
    leaderHint.textContent = `Leader ${leaderLabel()}`;
  }
  workspaceRecoveryOpen = true;
  workspaceRecovery.hidden = false;
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = true;
  commandOverlay.hidden = true;
  commandOverlayOpen = false;
  storeOpen = false;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  workspaceRecoveryMessage.textContent = message;
  renderWorkspaceRecovery();
  status.textContent = "workspace recovery";
  status.dataset.state = "ready";
  window.requestAnimationFrame(() => workspaceRestartAllButton.focus());
}

function closeWorkspaceRecovery(): void {
  workspaceRecoveryOpen = false;
  targetRecoveryPaneId = undefined;
  workspaceRecovery.hidden = true;
  terminalShell.hidden = false;
  renderTerminalStatus();
  paneRuntimes.get(frameSnapshot.focusedPaneId ?? "")?.terminal.focus();
}

async function discardWorkspaceAndOpenShell(): Promise<void> {
  const workspaceId = pendingWorkspace?.id ?? activeWorkspaceId;
  try {
    await invoke("workspace_delete", { workspaceId });
  } catch (error) {
    showError(`Could not dismiss the saved Workspace: ${String(error)}`);
  }
  pendingWorkspace = null;
  activeWorkspaceId = null;
  workspaceAgentPolicies = {};
  closeWorkspaceRecovery();
  if (frameSnapshot.tabs.length > 0) {
    try {
      renderFrame(await invoke<FrameSnapshot>("frame_reset"), false);
    } catch (error) {
      showError(`Could not clear the interrupted Workspace: ${String(error)}`);
    }
  }
  await startSession(lastWorkspacePath());
}

async function createFrameSessionWithRequest(
  request: { cols: number; rows: number; cwd: string | null; shell: string | null },
  split?: { orientation: SplitOrientation; ratio?: number },
): Promise<{ snapshot: FrameSnapshot; sessionId: string }> {
  const output = new Channel<Uint8Array>();
  const pendingOutput: Uint8Array[] = [];
  let outputSessionId: string | undefined;
  let accepted = false;
  output.onmessage = (chunk) => {
    if (accepted && outputSessionId) {
      writeToPane(outputSessionId, chunk);
    } else {
      pendingOutput.push(chunk);
    }
  };
  const nextSnapshot = split
    ? await invoke<FrameSnapshot>("frame_create_split", {
        request,
        orientation: split.orientation,
        ratio: split.ratio ?? null,
        onOutput: output,
      })
    : await invoke<FrameSnapshot>("frame_create_tab", {
        request,
        onOutput: output,
      });
  outputSessionId = nextSnapshot.focusedPaneId
    ? nextSnapshot.tabs
        .flatMap((tab) => tab.panes)
        .find((pane) => pane.id === nextSnapshot.focusedPaneId)?.session.id
    : undefined;
  if (!outputSessionId) {
    throw new Error("restored session did not produce a focused pane");
  }
  renderFrame(nextSnapshot, false);
  accepted = true;
  for (const chunk of pendingOutput) {
    writeToPane(outputSessionId, chunk);
  }
  return { snapshot: nextSnapshot, sessionId: outputSessionId };
}

async function createRecoverySession(
  request: { cols: number; rows: number; cwd: string | null; shell: string | null },
  split?: { orientation: SplitOrientation; ratio?: number },
): Promise<{ snapshot: FrameSnapshot; sessionId: string }> {
  try {
    return await createFrameSessionWithRequest(request, split);
  } catch (firstError) {
    if (!request.cwd && !request.shell) {
      throw firstError;
    }
    workspaceRecoveryMessage.textContent =
      `A saved shell or directory is unavailable (${String(firstError)}). Retrying with the current default shell and directory.`;
    return createFrameSessionWithRequest({ ...request, cwd: null, shell: null }, split);
  }
}

async function restartRecoveryPane(recovery: RecoveryPane): Promise<void> {
  if (workspaceRestoring) {
    return;
  }
  workspaceRestoring = true;
  renderWorkspaceRecovery();
  try {
    const result = await createRecoverySession(savedSessionRequest(recovery.pane));
    if (result.snapshot.activeTabId && recovery.tabTitle.trim()) {
      renderFrame(
        await invoke<FrameSnapshot>("frame_set_tab_title", {
          tabId: result.snapshot.activeTabId,
          title: recovery.tabTitle,
        }),
        false,
      );
    }
    pendingWorkspace = null;
    closeWorkspaceRecovery();
    setTerminalStatus("session restarted", "ready");
    scheduleWorkspaceSave();
  } catch (error) {
    workspaceRecoveryMessage.textContent = `Could not restart the saved session: ${String(error)}`;
    setTerminalStatus("workspace recovery", "error");
  } finally {
    workspaceRestoring = false;
    if (workspaceRecoveryOpen) {
      renderWorkspaceRecovery();
    }
  }
}

async function restoreSavedNode(
  node: LayoutNode,
  document: WorkspaceDocument,
  paneMap: Map<string, string>,
): Promise<void> {
  if (node.kind === "leaf") {
    return;
  }
  const firstAnchor = firstSavedLeafId(node.first);
  const secondAnchor = firstSavedLeafId(node.second);
  const firstPaneId = paneMap.get(firstAnchor);
  const secondPane = savedPaneById(document, secondAnchor);
  if (!firstPaneId || !secondPane) {
    throw new Error("saved split references a missing pane");
  }
  if (frameSnapshot.focusedPaneId !== firstPaneId) {
    renderFrame(await invoke<FrameSnapshot>("frame_focus_pane", { paneId: firstPaneId }), false);
  }
  const result = await createRecoverySession(savedSessionRequest(secondPane), {
    orientation: node.orientation,
    ratio: node.ratio,
  });
  const newPaneId = result.snapshot.focusedPaneId;
  if (!newPaneId) {
    throw new Error("saved split did not produce a focused pane");
  }
  paneMap.set(secondAnchor, newPaneId);
  await restoreSavedNode(node.first, document, paneMap);
  await restoreSavedNode(node.second, document, paneMap);
}

async function restoreWorkspace(): Promise<void> {
  const document = pendingWorkspace;
  if (!document || workspaceRestoring) {
    return;
  }
  if (document.frame.tabs.length === 0) {
    await discardWorkspaceAndOpenShell();
    return;
  }
  workspaceRestoring = true;
  workspaceSaveTimer && window.clearTimeout(workspaceSaveTimer);
  workspaceRecoveryMessage.textContent = `Restoring ${document.name} without replaying saved commands…`;
  renderWorkspaceRecovery();
  try {
    const paneMap = new Map<string, string>();
    const tabMap = new Map<string, string>();
    for (const tab of document.frame.tabs) {
      const firstPane = savedPaneById(document, firstSavedLeafId(tab.root));
      if (!firstPane) {
        throw new Error(`tab ${tab.id} has no first pane`);
      }
      const result = await createRecoverySession(savedSessionRequest(firstPane));
      const newTabId = result.snapshot.activeTabId;
      const newPaneId = result.snapshot.focusedPaneId;
      if (!newTabId || !newPaneId) {
        throw new Error(`tab ${tab.id} did not restore`);
      }
      tabMap.set(tab.id, newTabId);
      paneMap.set(firstPane.id, newPaneId);
      if (tab.title.trim()) {
        renderFrame(
          await invoke<FrameSnapshot>("frame_set_tab_title", {
            tabId: newTabId,
            title: tab.title,
          }),
          false,
        );
      }
      await restoreSavedNode(tab.root, document, paneMap);
    }
    const restoredActiveTabId = document.frame.activeTabId
      ? tabMap.get(document.frame.activeTabId)
      : undefined;
    if (restoredActiveTabId) {
      renderFrame(await invoke<FrameSnapshot>("frame_activate_tab", { tabId: restoredActiveTabId }), false);
    }
    const restoredFocusedPaneId = document.frame.focusedPaneId
      ? paneMap.get(document.frame.focusedPaneId)
      : undefined;
    if (restoredFocusedPaneId) {
      renderFrame(await invoke<FrameSnapshot>("frame_focus_pane", { paneId: restoredFocusedPaneId }), false);
    }
    pendingWorkspace = null;
    closeWorkspaceRecovery();
    setTerminalStatus("Workspace restored", "ready");
    scheduleWorkspaceSave();
  } catch (error) {
    workspaceRecoveryMessage.textContent = `Workspace restore stopped safely: ${String(error)}. Choose a session to restart or open a blank shell.`;
    setTerminalStatus("workspace recovery", "error");
  } finally {
    workspaceRestoring = false;
    if (workspaceRecoveryOpen) {
      renderWorkspaceRecovery();
    }
  }
}

async function saveWorkspaceNow(): Promise<void> {
  if (
    workspaceRestoring ||
    !workspaceMetadataReady ||
    frameSnapshot.tabs.length === 0 ||
    workspaceSaveInFlight
  ) {
    return workspaceSaveInFlight ?? Promise.resolve();
  }
  const root = focusedPane()?.session.cwd;
  if (!root) {
    return;
  }
  workspaceSaveInFlight = (async () => {
    const document = await invoke<WorkspaceDocument>("workspace_save", {
      request: {
        workspaceId: activeWorkspaceId,
        name: activeWorkspaceName,
        root,
        repositoryRoot: null,
        frame: frameSnapshot,
        appPins: launchpadEntries.filter((entry) => entry.pinned).map((entry) => entry.id),
        launchProfiles: customAppEntries,
        settings: {
          leaderChord,
          agentPolicies: workspaceAgentPolicies,
        },
      },
    });
    activeWorkspaceId = document.id;
    activeWorkspaceName = document.name;
    await bindSupervisedSessionsToWorkspace(document);
  })();
  try {
    await workspaceSaveInFlight;
  } catch (error) {
    showError(`Could not save Workspace metadata: ${String(error)}`);
  } finally {
    workspaceSaveInFlight = undefined;
  }
}

async function bindSupervisedSessionsToWorkspace(document: WorkspaceDocument): Promise<void> {
  const liveRecords = agentSupervision.sessions.filter((record) => paneForSession(record.sessionId));
  if (liveRecords.length === 0) {
    return;
  }
  const rebound = await Promise.allSettled(
    liveRecords.map((record) => {
      const pane = paneForSession(record.sessionId);
      const tab = pane
        ? frameSnapshot.tabs.find((candidate) =>
            candidate.panes.some((candidatePane) => candidatePane.id === pane.id),
          )
        : undefined;
      return invoke<AgentSessionRecord>("agent_supervision_bind_workspace", {
        request: {
          sessionId: record.sessionId,
          workspaceId: document.id,
          workspaceName: document.name,
          workspaceRoot: document.root,
          tabId: tab?.id ?? null,
          paneId: pane?.id ?? null,
        },
      });
    }),
  );
  for (const result of rebound) {
    if (result.status === "fulfilled") {
      replaceSupervisedSession(result.value);
    }
  }
}

function scheduleWorkspaceSave(): void {
  if (workspaceRestoring || !workspaceMetadataReady) {
    return;
  }
  if (workspaceSaveTimer !== undefined) {
    window.clearTimeout(workspaceSaveTimer);
  }
  workspaceSaveTimer = window.setTimeout(() => {
    workspaceSaveTimer = undefined;
    void saveWorkspaceNow();
  }, 220);
}

async function loadWorkspaceOnStartup(): Promise<void> {
  try {
    const result = await invoke<WorkspaceLoadResult>("workspace_load", { workspaceId: null });
    if (result.status === "ready" && result.workspace) {
      openWorkspaceRecovery(result.workspace, result.message);
      return;
    }
    if (result.status === "invalid") {
      showError(result.message);
    }
  } catch (error) {
    showError(`Could not read Workspace state: ${String(error)}. A blank shell is safe to use.`);
  }
  await startSession();
}

async function createFrameTab(): Promise<void> {
  const output = new Channel<Uint8Array>();
  const pendingOutput: Uint8Array[] = [];
  let outputSessionId: string | undefined;
  let accepted = false;
  output.onmessage = (chunk) => {
    if (accepted && outputSessionId) {
      writeToPane(outputSessionId, chunk);
    } else {
      pendingOutput.push(chunk);
    }
  };

  try {
    const nextSnapshot = await invoke<FrameSnapshot>("frame_create_tab", {
      request: frameRequest(),
      onOutput: output,
    });
    outputSessionId = nextSnapshot.focusedPaneId
      ? nextSnapshot.tabs
          .flatMap((tab) => tab.panes)
          .find((pane) => pane.id === nextSnapshot.focusedPaneId)?.session.id
      : undefined;
    renderFrame(nextSnapshot);
    accepted = true;
    if (outputSessionId) {
      for (const chunk of pendingOutput) {
        writeToPane(outputSessionId, chunk);
      }
    }
    setTerminalStatus("ready", "ready");
    closeCommandOverlay();
  } catch (error) {
    showError(`Could not create a tab: ${String(error)}`);
  }
}

async function splitFrame(orientation: SplitOrientation): Promise<void> {
  const output = new Channel<Uint8Array>();
  const pendingOutput: Uint8Array[] = [];
  let outputSessionId: string | undefined;
  let accepted = false;
  output.onmessage = (chunk) => {
    if (accepted && outputSessionId) {
      writeToPane(outputSessionId, chunk);
    } else {
      pendingOutput.push(chunk);
    }
  };

  try {
    const nextSnapshot = await invoke<FrameSnapshot>("frame_create_split", {
      request: frameRequest(),
      orientation,
      ratio: null,
      onOutput: output,
    });
    outputSessionId = nextSnapshot.focusedPaneId
      ? nextSnapshot.tabs
          .flatMap((tab) => tab.panes)
          .find((pane) => pane.id === nextSnapshot.focusedPaneId)?.session.id
      : undefined;
    renderFrame(nextSnapshot);
    accepted = true;
    if (outputSessionId) {
      for (const chunk of pendingOutput) {
        writeToPane(outputSessionId, chunk);
      }
    }
    setTerminalStatus("ready", "ready");
    closeCommandOverlay();
  } catch (error) {
    showError(`Could not split the focused pane: ${String(error)}`);
  }
}

async function moveFocusedPane(direction: FocusDirection): Promise<void> {
  try {
    renderFrame(await invoke<FrameSnapshot>("frame_focus_move", { direction }));
  } catch (error) {
    showError(`Could not move pane focus: ${String(error)}`);
  }
}

async function resizeFocusedPane(direction: FocusDirection): Promise<void> {
  try {
    renderFrame(
      await invoke<FrameSnapshot>("frame_resize_split", {
        direction,
        amount: 0.08,
      }),
      false,
    );
    closeCommandOverlay();
  } catch (error) {
    showError(`Could not resize the focused split: ${String(error)}`);
  }
}

async function closeFocusedPane(force: boolean): Promise<void> {
  try {
    const result = await invoke<FrameCloseResult>("frame_close_focused", { force });
    if (result.requiresConfirmation) {
      pendingClose = "pane";
      commandMessage.textContent = `${result.message} Choose Close Focused Pane again to confirm.`;
      return;
    }
    pendingClose = undefined;
    renderFrame(result.snapshot);
    commandMessage.textContent = result.message;
    setTerminalStatus("ready", "ready");
  } catch (error) {
    showError(`Could not close the focused pane: ${String(error)}`);
  }
}

async function closeActiveTab(force: boolean): Promise<void> {
  try {
    const result = await invoke<FrameCloseResult>("frame_close_tab", {
      tabId: frameSnapshot.activeTabId,
      force,
    });
    if (result.requiresConfirmation) {
      pendingClose = "tab";
      commandMessage.textContent = `${result.message} Choose Close Active Tab again to confirm.`;
      return;
    }
    pendingClose = undefined;
    renderFrame(result.snapshot);
    commandMessage.textContent = result.message;
    setTerminalStatus("ready", "ready");
  } catch (error) {
    showError(`Could not close the active tab: ${String(error)}`);
  }
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

const agentPermissionOptions: Array<{
  value: AgentPermissionMode;
  label: string;
  description: string;
}> = [
  {
    value: "ask",
    label: "Ask for Approval",
    description: "The agent should pause before changes, commands, or external tools.",
  },
  {
    value: "approve",
    label: "Approve for Me",
    description: "Routine requests can proceed without an extra Arkonad prompt; review the result.",
  },
  {
    value: "bypass",
    label: "Bypass Permissions",
    description: "No Arkonad approval gate is added; use only in a trusted or disposable workspace.",
  },
];

const agentFollowUpOptions: Array<{
  value: AgentFollowUpMode;
  label: string;
  description: string;
}> = [
  {
    value: "queue",
    label: "Queue",
    description: "Keep follow-up requests in order until the current turn finishes.",
  },
  {
    value: "steer",
    label: "Steer",
    description: "Send the next request toward the active turn when the provider supports it.",
  },
];

function agentSearchText(entry: AgentEntry): string {
  return `${entry.name} ${entry.publisher} ${entry.summary}`.toLowerCase();
}

function resetAgentDraft(agentId: string): void {
  const policy = effectiveAgentPolicy(agentId);
  agentDraftPermission = policy.permission;
  agentDraftFollowUp = policy.followUp;
  agentDraftScope = sessionAgentOverrides.has(agentId) ? "session" : "workspace";
  agentDraftTask = "";
  agentMode = "task";
  agentTaskPlan = undefined;
  taskDraftBaseBranch = "";
  taskDraftBranch = "";
  taskDraftWorktreeRoot = "";
  taskDraftEntryId = undefined;
}

function renderAgentPolicySummary(
  parent: HTMLElement,
  entry: AgentEntry,
  selectedPolicy: AgentPolicy,
  scope: AgentPolicyScope,
): void {
  const current = effectiveAgentPolicy(entry.id);
  const section = appendDetailSection(parent, "Effective policy");
  const summary = makeElement(
    "p",
    "agent-policy-summary",
    `${agentPolicySummary(current)} · ${sessionAgentOverrides.has(entry.id) ? "session override" : "Workspace Agent Policy"}`,
  );
  section.append(summary);
  section.append(
    makeElement(
      "p",
      "detail-note",
      `This launch: ${agentPolicySummary(selectedPolicy)} · ${scope === "workspace" ? "saved for this workspace and agent" : "temporary for this session"}.`,
    ),
  );
  section.append(
    makeElement(
      "p",
      "agent-policy-help",
      "Arkonad passes this policy as scoped context and keeps provider authentication and the provider's native TUI unchanged.",
    ),
  );
}

function renderAgentDetail(entry: AgentEntry | undefined): void {
  agentDetail.replaceChildren();
  if (!entry) {
    agentDetail.append(makeElement("div", "store-empty-detail", "Select an agent to choose a mode."));
    return;
  }

  const header = makeElement("header", "detail-header");
  header.append(makeElement("span", "detail-category", "coding agent"));
  header.append(makeElement("h2", "detail-title", entry.name));
  header.append(makeElement("p", "detail-summary", entry.summary));
  header.append(makeElement("p", "detail-meta", `${entry.publisher} · ${entry.installed ? entry.ownership ?? "installed" : "not installed"}`));
  agentDetail.append(header);

  const statusSection = appendDetailSection(agentDetail, "Availability");
  appendDetailLine(statusSection, "Installed", entry.installed ? "yes" : "no");
  appendDetailLine(statusSection, "Launchable", entry.launchable ? "yes" : "no");
  appendDetailLine(statusSection, "Executable", entry.executablePath ?? "not resolved");

  if (!entry.launchable) {
    agentDetail.append(
      makeElement(
        "p",
        "detail-note",
        "This agent is listed but is not installed and launchable in the current environment.",
      ),
    );
    agentDetail.append(
      createInstallButton("Browse Store page", () => openStore("agent", entry.storeEntryId)),
    );
    return;
  }

  const modeSection = appendDetailSection(agentDetail, "Start mode");
  const modeTabs = makeElement("div", "agent-mode-tabs");
  const taskButton = makeElement("button", "agent-mode-tab", "New Task") as HTMLButtonElement;
  taskButton.type = "button";
  taskButton.classList.toggle("is-active", agentMode === "task");
  taskButton.setAttribute("aria-pressed", String(agentMode === "task"));
  taskButton.addEventListener("click", () => {
    agentMode = "task";
    renderAgentDetail(entry);
  });
  const chatButton = makeElement("button", "agent-mode-tab", "General Chat") as HTMLButtonElement;
  chatButton.type = "button";
  chatButton.classList.toggle("is-active", agentMode === "chat");
  chatButton.setAttribute("aria-pressed", String(agentMode === "chat"));
  chatButton.addEventListener("click", () => {
    agentMode = "chat";
    renderAgentDetail(entry);
  });
  modeTabs.append(taskButton, chatButton);
  modeSection.append(modeTabs);

  const selectedPolicy: AgentPolicy = {
    permission: agentDraftPermission,
    followUp: agentDraftFollowUp,
  };
  renderAgentPolicySummary(agentDetail, entry, selectedPolicy, agentDraftScope);

  const form = makeElement("form", "agent-task-form") as HTMLFormElement;
  const taskLabel = makeElement("label", "agent-task-field");
  taskLabel.append(
    makeElement("span", undefined, agentMode === "task" ? "Short task" : "Question or context"),
  );
  const taskInput = makeElement("textarea") as HTMLTextAreaElement;
  taskInput.rows = 4;
  taskInput.required = agentMode === "task";
  taskInput.placeholder = agentMode === "task"
    ? "e.g. Add a dark-mode toggle to the settings screen"
    : "Ask a question or leave blank to open a read-only chat";
  taskInput.value = agentDraftTask;
  taskInput.setAttribute("aria-label", agentMode === "task" ? "Short task" : "General Chat question or context");
  taskInput.addEventListener("input", () => {
    agentDraftTask = taskInput.value;
  });
  taskLabel.append(taskInput);
  form.append(taskLabel);

  const policyGrid = makeElement("div", "agent-policy-grid");
  const permissionFieldset = makeElement("fieldset", "agent-policy-fieldset") as HTMLFieldSetElement;
  permissionFieldset.append(makeElement("legend", undefined, "Permission mode"));
  for (const option of agentPermissionOptions) {
    const label = makeElement("label", "agent-policy-option");
    const input = makeElement("input") as HTMLInputElement;
    input.type = "radio";
    input.name = `agent-permission-${entry.id}`;
    input.value = option.value;
    input.checked = agentDraftPermission === option.value;
    input.addEventListener("change", () => {
      if (input.checked) {
        agentDraftPermission = option.value;
      }
    });
    const copy = makeElement("span", "agent-policy-copy");
    copy.append(
      makeElement("strong", undefined, option.label),
      makeElement("span", "agent-policy-description", option.description),
    );
    label.append(input, copy);
    permissionFieldset.append(label);
  }

  const followUpFieldset = makeElement("fieldset", "agent-policy-fieldset") as HTMLFieldSetElement;
  followUpFieldset.append(makeElement("legend", undefined, "Follow-up behavior"));
  for (const option of agentFollowUpOptions) {
    const label = makeElement("label", "agent-policy-option");
    const input = makeElement("input") as HTMLInputElement;
    input.type = "radio";
    input.name = `agent-follow-up-${entry.id}`;
    input.value = option.value;
    input.checked = agentDraftFollowUp === option.value;
    input.addEventListener("change", () => {
      if (input.checked) {
        agentDraftFollowUp = option.value;
      }
    });
    const copy = makeElement("span", "agent-policy-copy");
    copy.append(
      makeElement("strong", undefined, option.label),
      makeElement("span", "agent-policy-description", option.description),
    );
    label.append(input, copy);
    followUpFieldset.append(label);
  }
  policyGrid.append(permissionFieldset, followUpFieldset);
  form.append(policyGrid);

  const scopeLabel = makeElement("label", "agent-scope-field");
  scopeLabel.append(makeElement("span", undefined, "Policy scope"));
  const scopeSelect = makeElement("select") as HTMLSelectElement;
  scopeSelect.className = "agent-scope-select";
  scopeSelect.setAttribute("aria-label", "Agent policy scope");
  scopeSelect.innerHTML = `
    <option value="workspace">Workspace Agent Policy</option>
    <option value="session">This session only</option>
  `;
  scopeSelect.value = agentDraftScope;
  scopeSelect.addEventListener("change", () => {
    agentDraftScope = scopeSelect.value === "session" ? "session" : "workspace";
  });
  scopeLabel.append(scopeSelect);
  form.append(scopeLabel);

  if (agentMode === "chat") {
    const chatNotice = makeElement(
      "p",
      "agent-chat-notice",
      "General Chat is non-writing by default. If you need a change, promote this setup to Agent Task before sending it.",
    );
    form.append(chatNotice);
    const promote = makeElement("button", "detail-action", "Promote to Agent Task") as HTMLButtonElement;
    promote.type = "button";
    promote.addEventListener("click", () => {
      agentMode = "task";
      renderAgentDetail(entry);
    });
    form.append(promote);
  } else {
    form.append(
      makeElement(
        "p",
        "agent-policy-help",
        "Starting is immediate after you choose the policy. The selected agent keeps its native terminal interface and authentication flow.",
      ),
    );
  }

  const actions = makeElement("div", "install-button-row");
  const start = makeElement(
    "button",
    "agent-start-button",
    agentMode === "task" ? "Start New Task" : "Start General Chat",
  ) as HTMLButtonElement;
  start.type = "submit";
  start.disabled = launchBusy;
  actions.append(start);
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (agentMode === "task" && !agentDraftTask.trim()) {
      agentNotice.textContent = "Add a short task before starting. General Chat can open without a task.";
      taskInput.focus();
      return;
    }
    void startAgent(entry);
  });
  agentDetail.append(form);
}

function renderAgentList(): void {
  const query = agentSearch.value.trim().toLowerCase();
  const visibleEntries = agentEntries.filter((entry) => !query || agentSearchText(entry).includes(query));
  agentList.replaceChildren();
  agentCount.textContent = `${visibleEntries.length} shown`;
  if (visibleEntries.length === 0) {
    agentList.append(makeElement("div", "store-empty-list", "No coding agents match this search."));
    renderAgentDetail(undefined);
    return;
  }
  if (!visibleEntries.some((entry) => entry.id === selectedAgentId)) {
    selectedAgentId = visibleEntries[0].id;
    resetAgentDraft(selectedAgentId);
  }
  for (const entry of visibleEntries) {
    const selected = entry.id === selectedAgentId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.agentId = entry.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    row.classList.toggle("is-selected", selected);
    const rowTop = makeElement("span", "store-row-top");
    rowTop.append(makeElement("strong", undefined, entry.name));
    rowTop.append(makeElement("span", "store-row-category", entry.launchable ? "ready" : entry.installed ? "installed" : "Store"));
    row.append(rowTop, makeElement("span", "store-row-summary", entry.summary));
    row.append(makeElement("span", `store-row-state ${entry.launchable ? "status-active" : "status-unknown"}`, entry.launchable ? "launchable" : entry.installed ? "installed" : "unavailable"));
    row.addEventListener("click", () => selectAgent(entry.id));
    agentList.append(row);
  }
  renderAgentDetail(visibleEntries.find((entry) => entry.id === selectedAgentId));
}

function selectAgent(id: string, focusRow = false): void {
  if (!agentEntries.some((entry) => entry.id === id)) {
    return;
  }
  if (selectedAgentId !== id) {
    selectedAgentId = id;
    resetAgentDraft(id);
  }
  renderAgentList();
  if (focusRow) {
    window.requestAnimationFrame(() => {
      agentList.querySelector<HTMLButtonElement>(`[data-agent-id="${id}"]`)?.focus();
    });
  }
}

function moveAgentSelection(offset: number): void {
  const query = agentSearch.value.trim().toLowerCase();
  const visibleEntries = agentEntries.filter((entry) => !query || agentSearchText(entry).includes(query));
  if (visibleEntries.length === 0) {
    return;
  }
  const currentIndex = visibleEntries.findIndex((entry) => entry.id === selectedAgentId);
  const nextIndex = (Math.max(currentIndex, 0) + offset + visibleEntries.length) % visibleEntries.length;
  selectAgent(visibleEntries[nextIndex].id, true);
}

async function refreshAgents(): Promise<void> {
  const requestId = ++agentRequestId;
  agentError.hidden = true;
  agentNotice.textContent = "Checking installed and launchable coding agents…";
  agentCount.textContent = "loading…";
  try {
    try {
      await invoke<CatalogDetection[]>("catalog_detect");
    } catch {
      // The catalog response remains useful when PATH detection is unavailable.
    }
    const [catalogEntries, appsSnapshot] = await Promise.all([
      invoke<CatalogEntry[]>("catalog_list", { query: null, category: "agent" }),
      invoke<MyAppsSnapshot>("my_apps_list"),
    ]);
    if (requestId !== agentRequestId) {
      return;
    }
    const appsById = new Map(
      appsSnapshot.entries
        .filter((entry) => entry.category === "agent")
        .map((entry) => [entry.manifestId, entry]),
    );
    agentEntries = catalogEntries
      .map((entry): AgentEntry => {
        const appEntry = appsById.get(entry.manifest.id);
        const launchable = Boolean(appEntry?.launchable || entry.detection);
        const installed = Boolean(appEntry || entry.detection);
        return {
          id: entry.manifest.id,
          name: entry.manifest.name,
          summary: entry.manifest.summary,
          publisher: entry.manifest.publisher,
          installed,
          launchable,
          executablePath: appEntry?.executablePath ?? entry.detection?.path ?? null,
          profileId: appEntry?.launchProfileId ?? entry.manifest.launchProfiles[0]?.id ?? null,
          ownership: appEntry?.ownership ?? (entry.detection ? "detected" : null),
          storeEntryId: entry.manifest.id,
        };
      })
      .sort((left, right) => {
        const rank = (entry: AgentEntry) => (entry.launchable ? 0 : entry.installed ? 1 : 2);
        return rank(left) - rank(right) || left.name.localeCompare(right.name);
      });
    agentNotice.textContent = "Installed and launchable agents appear first. Store links do not install anything by themselves.";
    renderAgentList();
    if (activeSurface === "tasks") {
      renderAgentTaskCenter();
    }
  } catch (error) {
    if (requestId !== agentRequestId) {
      return;
    }
    agentEntries = [];
    renderAgentList();
    agentError.hidden = false;
    agentError.textContent = `Could not read coding agents: ${String(error)}`;
  }
}

function scheduleAgentRefresh(): void {
  if (agentRefreshTimer !== undefined) {
    window.clearTimeout(agentRefreshTimer);
  }
  agentRefreshTimer = window.setTimeout(() => void refreshAgents(), 140);
}

function openAgentCockpit(): void {
  if (storeOpen && activeSurface === "agents") {
    agentSearch.focus();
    return;
  }
  storeOpen = true;
  activeSurface = "agents";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = false;
  tasksView.hidden = true;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "true");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "agent cockpit";
  status.textContent = "agents";
  status.dataset.state = "ready";
  refreshWorkspaceMetadata();
  void refreshAgents();
  window.requestAnimationFrame(() => agentSearch.focus());
}

async function startAgent(entry: AgentEntry): Promise<void> {
  const policy: AgentPolicy = {
    permission: agentDraftPermission,
    followUp: agentDraftFollowUp,
  };
  if (agentDraftScope === "workspace") {
    workspaceAgentPolicies[entry.id] = policy;
    sessionAgentOverrides.delete(entry.id);
    scheduleWorkspaceSave();
  } else {
    sessionAgentOverrides.set(entry.id, policy);
  }
  if (agentMode === "task") {
    await openAgentTaskPlan(entry);
    return;
  }
  const context: AgentLaunchContext = {
    mode: agentMode,
    task: agentDraftTask.trim(),
    policy,
    workspaceRoot: focusedPane()?.session.cwd ?? pendingWorkspace?.root ?? null,
  };
  await launchTarget(
    {
      id: entry.id,
      name: entry.name,
      profileId: entry.profileId,
      executablePath: entry.executablePath,
      supportsWorkingDirectory: true,
    },
    { kind: "currentDirectory" },
    context,
  );
}

function taskRepositoryContext(): string {
  return focusedPane()?.session.cwd
    ?? pendingWorkspace?.repositoryRoot
    ?? pendingWorkspace?.root
    ?? "";
}

function taskRequestFor(
  entry: AgentEntry,
  values: { baseBranch?: string; taskBranch?: string; worktreeRoot?: string } = {},
): Record<string, unknown> {
  return {
    repositoryRoot: taskRepositoryContext(),
    taskSummary: agentDraftTask.trim(),
    baseBranch: values.baseBranch?.trim() || taskDraftBaseBranch.trim() || null,
    taskBranch: values.taskBranch?.trim() || taskDraftBranch.trim() || null,
    worktreeRoot: values.worktreeRoot?.trim() || taskDraftWorktreeRoot.trim() || null,
    agentId: entry.id,
    agentName: entry.name,
    permissionMode: agentDraftPermission,
  };
}

async function openAgentTaskPlan(entry: AgentEntry): Promise<void> {
  if (!agentDraftTask.trim()) {
    agentNotice.textContent = "Add a short task before opening Agent Task setup.";
    return;
  }
  taskDraftEntryId = entry.id;
  agentTaskPlan = undefined;
  renderAgentTaskPlan(entry);
  await refreshAgentTaskPlan(entry);
}

async function refreshAgentTaskPlan(
  entry: AgentEntry,
  values: { baseBranch?: string; taskBranch?: string; worktreeRoot?: string } = {},
): Promise<void> {
  const requestId = ++taskPlanRequestId;
  tasksNotice.textContent = "Checking repository, branch, Worktree path, and free space…";
  try {
    const plan = await invoke<AgentTaskPlan>("agent_task_plan", {
      request: taskRequestFor(entry, values),
    });
    if (requestId !== taskPlanRequestId) {
      return;
    }
    agentTaskPlan = plan;
    taskDraftBaseBranch = plan.baseBranch ?? values.baseBranch ?? "";
    taskDraftBranch = plan.taskBranch ?? values.taskBranch ?? "";
    taskDraftWorktreeRoot = plan.worktreeRoot ?? values.worktreeRoot ?? "";
    renderAgentTaskPlan(entry);
  } catch (error) {
    if (requestId !== taskPlanRequestId) {
      return;
    }
    agentNotice.textContent = `Could not inspect the Agent Task setup: ${String(error)}`;
    renderAgentDetail(entry);
  }
}

function renderAgentTaskPlan(entry: AgentEntry): void {
  agentDetail.replaceChildren();
  const plan = agentTaskPlan;
  const header = makeElement("header", "detail-header");
  header.append(
    makeElement("span", "detail-category", "agent task setup"),
    makeElement("h2", "detail-title", entry.name),
    makeElement("p", "detail-summary", agentDraftTask.trim()),
    makeElement("p", "detail-meta", "Review the exact repository and Worktree before creation."),
  );
  agentDetail.append(header);

  if (!plan) {
    agentDetail.append(makeElement("p", "detail-note", "Reading the current Repository Context…"));
    return;
  }

  const details = appendDetailSection(agentDetail, "Creation preview");
  appendDetailLine(details, "Repository", plan.repositoryRoot ?? "unknown");
  appendDetailLine(details, "Repository status", plan.repositoryStatus);
  appendDetailLine(details, "Base branch", plan.baseBranch ?? "not resolved");
  appendDetailLine(details, "Task branch", plan.taskBranch ?? "not resolved");
  appendDetailLine(details, "Worktree root", plan.worktreeRoot ?? "not resolved");
  appendDetailLine(details, "Worktree path", plan.worktreePath ?? "not resolved");
  appendDetailLine(details, "Agent", `${entry.name} · ${agentPermissionLabel(agentDraftPermission)}`);
  if (plan.freeSpaceBytes !== null) {
    appendDetailLine(details, "Free space", `${formatTaskBytes(plan.freeSpaceBytes)}${plan.freeSpaceOk ? " · enough" : " · too low"}`);
  } else {
    appendDetailLine(details, "Free space", "not measured");
  }
  if (plan.repositoryStatusDetail) {
    details.append(makeElement("pre", "task-plan-evidence", plan.repositoryStatusDetail));
  }

  const fields = appendDetailSection(agentDetail, "Editable setup");
  const baseInput = taskPlanInput(fields, "Base branch", taskDraftBaseBranch, "main or another existing branch");
  const branchInput = taskPlanInput(fields, "Task branch", taskDraftBranch, "codex/arkonad/task-name");
  const rootInput = taskPlanInput(fields, "Worktree root", taskDraftWorktreeRoot, "absolute path outside the canonical checkout");
  baseInput.addEventListener("input", () => {
    taskDraftBaseBranch = baseInput.value;
  });
  branchInput.addEventListener("input", () => {
    taskDraftBranch = branchInput.value;
  });
  rootInput.addEventListener("input", () => {
    taskDraftWorktreeRoot = rootInput.value;
  });

  if (plan.blockers.length > 0) {
    const blockerSection = appendDetailSection(agentDetail, "Setup stopped");
    const list = makeElement("ul", "task-plan-list");
    for (const blocker of plan.blockers) {
      list.append(makeElement("li", undefined, blocker));
    }
    blockerSection.append(list);
    if (plan.recoveryOptions.length > 0) {
      blockerSection.append(makeElement("strong", undefined, "Recovery choices"));
      const recovery = makeElement("ul", "task-plan-list");
      for (const option of plan.recoveryOptions) {
        recovery.append(makeElement("li", undefined, option));
      }
      blockerSection.append(recovery);
    }
  }

  const actions = makeElement("div", "install-button-row");
  const back = makeElement("button", "detail-action", "Back to agent") as HTMLButtonElement;
  back.type = "button";
  back.addEventListener("click", () => renderAgentDetail(entry));
  const recheck = makeElement("button", "detail-action", "Recheck plan") as HTMLButtonElement;
  recheck.type = "button";
  recheck.addEventListener("click", () => {
    void refreshAgentTaskPlan(entry, {
      baseBranch: baseInput.value,
      taskBranch: branchInput.value,
      worktreeRoot: rootInput.value,
    });
  });
  actions.append(back, recheck);
  if (plan.canCreate) {
    const create = makeElement("button", "agent-start-button", "Create Worktree and Start") as HTMLButtonElement;
    create.type = "button";
    create.disabled = launchBusy;
    create.addEventListener("click", () => void createAndStartAgentTask(entry, {
      baseBranch: baseInput.value,
      taskBranch: branchInput.value,
      worktreeRoot: rootInput.value,
    }));
    actions.append(create);
  }
  agentDetail.append(actions);
}

function taskPlanInput(
  parent: HTMLElement,
  label: string,
  value: string,
  placeholder: string,
): HTMLInputElement {
  const wrapper = makeElement("label", "agent-scope-field");
  wrapper.append(makeElement("span", undefined, label));
  const input = makeElement("input", "task-plan-input") as HTMLInputElement;
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.required = true;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function formatTaskBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  }
  return `${Math.round(value / (1024 * 1024))} MiB`;
}

async function createAndStartAgentTask(
  entry: AgentEntry,
  values: { baseBranch: string; taskBranch: string; worktreeRoot: string },
): Promise<void> {
  try {
    const task = await invoke<AgentTask>("agent_task_create", {
      request: taskRequestFor(entry, values),
    });
    replaceAgentTask(task);
    await startAgentForTask(task, entry);
  } catch (error) {
    const message = `Agent Task setup stopped: ${String(error)}`;
    agentNotice.textContent = message;
    tasksNotice.textContent = message;
    await refreshAgentTasks();
    openAgentTasks();
  }
}

async function startAgentForTask(task: AgentTask, entry: AgentEntry): Promise<void> {
  const policy = effectiveAgentPolicy(entry.id);
  const context: AgentLaunchContext = {
    mode: "task",
    task: task.taskSummary,
    policy,
    workspaceRoot: task.worktreePath,
    agentTaskId: task.id,
    agentTaskWorktreePath: task.worktreePath,
  };
  await launchTarget(
    {
      id: entry.id,
      name: entry.name,
      profileId: entry.profileId,
      executablePath: entry.executablePath,
      supportsWorkingDirectory: true,
    },
    { kind: "directory", path: task.worktreePath },
    context,
  );
}

function agentStateLabel(state: AgentSessionState): string {
  return {
    starting: "Starting",
    working: "Working",
    waitingForInput: "Waiting for input",
    waitingForApproval: "Waiting for approval",
    done: "Done",
    failed: "Failed",
    stopped: "Stopped",
    interrupted: "Interrupted",
  }[state];
}

function agentStateSourceLabel(source: AgentStateSource): string {
  return {
    process: "process",
    providerEvent: "declared provider event",
    outputObservation: "uncertain output observation",
  }[source];
}

function attentionKindLabel(kind: AttentionKind): string {
  return {
    approval: "Approval",
    question: "Question",
    failure: "Failure",
    completion: "Completion",
  }[kind];
}

function pendingFollowUps(record: AgentSessionRecord): AgentFollowUp[] {
  return record.followUps.filter((followUp) => followUp.status !== "delivered");
}

function openAttentionItems(record: AgentSessionRecord): AgentAttentionItem[] {
  return record.attention.filter((item) => !item.acknowledged);
}

function attentionSearchText(record: AgentSessionRecord): string {
  return [
    record.agentName,
    record.agentId,
    record.workspaceName,
    record.workspaceRoot,
    agentStateLabel(record.state),
    record.stateDetail,
    ...openAttentionItems(record).map((item) => `${attentionKindLabel(item.kind)} ${item.message}`),
  ]
    .join(" ")
    .toLowerCase();
}

function prioritizedSupervisedSessions(): AgentSessionRecord[] {
  const query = attentionSearch.value.trim().toLowerCase();
  return agentSupervision.sessions
    .filter((record) => !query || attentionSearchText(record).includes(query))
    .sort((left, right) => {
      const rank = (record: AgentSessionRecord) => {
        if (openAttentionItems(record).length > 0) return 0;
        if (pendingFollowUps(record).length > 0) return 1;
        if (["starting", "working", "waitingForInput", "waitingForApproval"].includes(record.state)) return 2;
        return 3;
      };
      return rank(left) - rank(right) || Number(right.updatedAt) - Number(left.updatedAt);
    });
}

function updateAttentionBadge(): void {
  const count = agentSupervision.sessions.reduce(
    (total, record) => total + openAttentionItems(record).length,
    0,
  );
  attentionBadge.hidden = count === 0;
  attentionBadge.textContent = count === 0 ? "" : String(count);
  attentionOpenButton.setAttribute(
    "aria-label",
    count === 0 ? "Attention Queue" : `Attention Queue, ${count} items`,
  );
}

function replaceSupervisedSession(record: AgentSessionRecord): void {
  const index = agentSupervision.sessions.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    agentSupervision.sessions[index] = record;
  } else {
    agentSupervision.sessions.push(record);
  }
  updateAttentionBadge();
  if (activeSurface === "attention") {
    renderAttentionQueue();
  }
}

function renderAttentionDetail(record: AgentSessionRecord | undefined): void {
  attentionDetail.replaceChildren();
  if (!record) {
    attentionDetail.append(
      makeElement(
        "div",
        "store-empty-detail",
        "No supervised coding-agent session matches this view.",
      ),
    );
    return;
  }

  const header = makeElement("header", "detail-header");
  header.append(
    makeElement(
      "span",
      "detail-category",
      record.adapter.verified ? "enhanced adapter defined" : "native launch",
    ),
    makeElement("h2", "detail-title", record.agentName),
    makeElement("p", "detail-summary", `${agentStateLabel(record.state)} · ${agentStateSourceLabel(record.stateSource)}`),
    makeElement("p", "detail-meta", `${record.workspaceName} · ${record.workspaceRoot}`),
  );
  attentionDetail.append(header);

  const stateSection = appendDetailSection(attentionDetail, "Observed state");
  appendDetailLine(stateSection, "State", agentStateLabel(record.state));
  appendDetailLine(stateSection, "Evidence", agentStateSourceLabel(record.stateSource));
  appendDetailLine(stateSection, "Detail", record.stateDetail);
  stateSection.append(
    makeElement(
      "p",
      "agent-policy-help",
      "Arkonad does not calculate completion percentages or treat process silence as completed work.",
    ),
  );

  const contextSection = appendDetailSection(attentionDetail, "Exact session context");
  appendDetailLine(contextSection, "Workspace", record.workspaceName);
  appendDetailLine(contextSection, "Tab", record.tabId ?? "not recorded");
  appendDetailLine(contextSection, "Pane", record.paneId ?? "not recorded");
  appendDetailLine(contextSection, "Session", record.sessionId);
  const returnButton = makeElement("button", "detail-action", "Return to exact session") as HTMLButtonElement;
  returnButton.type = "button";
  returnButton.addEventListener("click", () => {
    void returnToSupervisedSession(record).catch((error: unknown) => {
      attentionNotice.textContent = `Could not return to the saved session: ${String(error)}`;
    });
  });
  contextSection.append(returnButton);

  const adapterSection = appendDetailSection(attentionDetail, "Provider limits");
  appendDetailLine(
    adapterSection,
    "Adapter definition",
    record.adapter.verified ? "included for the first integration" : "native launch only",
  );
  appendDetailLine(
    adapterSection,
    "Declared events",
    record.adapter.declaredEventSource ?? "not available",
  );
  appendDetailLine(
    adapterSection,
    "Steer",
    record.adapter.supportsSteer && record.enhancedEventsActive
      ? "active for this session"
      : record.adapter.supportsSteer
        ? "adapter supports it; this native session queues"
        : "queues instead",
  );
  adapterSection.append(makeElement("p", "detail-note", record.adapter.nativeTuiNote));

  const attentionSection = appendDetailSection(attentionDetail, "Needs attention");
  const items = openAttentionItems(record);
  if (items.length === 0) {
    attentionSection.append(makeElement("p", "detail-empty", "No unacknowledged attention items."));
  } else {
    for (const item of items) {
      const itemView = makeElement("div", `attention-item attention-${item.kind}`);
      itemView.append(
        makeElement("strong", undefined, attentionKindLabel(item.kind)),
        makeElement("span", "attention-item-source", agentStateSourceLabel(item.source)),
        makeElement("p", undefined, item.message),
      );
      const acknowledge = makeElement("button", "detail-action", "Acknowledge") as HTMLButtonElement;
      acknowledge.type = "button";
      acknowledge.addEventListener("click", () => void acknowledgeAttention(item.id));
      itemView.append(acknowledge);
      attentionSection.append(itemView);
    }
  }

  const followUpSection = appendDetailSection(attentionDetail, "Follow-ups");
  if (record.followUps.length === 0) {
    followUpSection.append(makeElement("p", "detail-empty", "No follow-ups have been submitted."));
  } else {
    for (const followUp of record.followUps) {
      const row = makeElement("div", "follow-up-item");
      row.append(
        makeElement("strong", undefined, `${agentFollowUpLabel(followUp.effectiveMode)} · ${followUp.status}`),
        makeElement("p", undefined, followUp.message),
        makeElement("span", "attention-item-source", followUp.statusMessage),
      );
      if (followUp.status === "queued") {
        const deliver = makeElement("button", "detail-action", "Deliver queued follow-up") as HTMLButtonElement;
        deliver.type = "button";
        deliver.addEventListener("click", () => void deliverAgentFollowUp(followUp.id));
        row.append(deliver);
      }
      followUpSection.append(row);
    }
  }

  const form = makeElement("form", "agent-task-form") as HTMLFormElement;
  const messageLabel = makeElement("label", "agent-task-field");
  messageLabel.append(makeElement("span", undefined, "Follow-up message"));
  const message = makeElement("textarea") as HTMLTextAreaElement;
  message.rows = 3;
  message.required = true;
  message.placeholder = "Add context or redirect the active task";
  messageLabel.append(message);
  const modeLabel = makeElement("label", "agent-scope-field");
  modeLabel.append(makeElement("span", undefined, "Delivery"));
  const mode = makeElement("select", "agent-scope-select") as HTMLSelectElement;
  mode.innerHTML = `
    <option value="queue">Queue after current turn</option>
    <option value="steer">Steer active turn when verified</option>
  `;
  mode.value = record.followUpMode;
  modeLabel.append(mode);
  const submit = makeElement("button", "agent-start-button", "Submit follow-up") as HTMLButtonElement;
  submit.type = "submit";
  form.append(messageLabel, modeLabel, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAgentFollowUp(record.id, message.value, mode.value === "steer" ? "steer" : "queue");
  });
  followUpSection.append(form);
}

function renderAttentionQueue(): void {
  const records = prioritizedSupervisedSessions();
  attentionList.replaceChildren();
  const openCount = agentSupervision.sessions.reduce(
    (total, record) => total + openAttentionItems(record).length,
    0,
  );
  attentionCount.textContent = `${openCount} attention · ${records.length} sessions`;
  updateAttentionBadge();
  if (records.length === 0) {
    selectedSupervisionId = undefined;
    attentionList.append(makeElement("div", "store-empty-list", "No supervised sessions match this search."));
    renderAttentionDetail(undefined);
    return;
  }
  if (!records.some((record) => record.id === selectedSupervisionId)) {
    selectedSupervisionId = records[0].id;
  }
  for (const record of records) {
    const selected = record.id === selectedSupervisionId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.supervisionId = record.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    row.classList.toggle("is-selected", selected);
    const top = makeElement("span", "store-row-top");
    top.append(
      makeElement("strong", undefined, record.agentName),
      makeElement("span", "store-row-category", record.workspaceName),
    );
    const openItems = openAttentionItems(record);
    const pending = pendingFollowUps(record);
    row.append(
      top,
      makeElement("span", "store-row-summary", `${agentStateLabel(record.state)} · ${agentStateSourceLabel(record.stateSource)}`),
      makeElement(
        "span",
        `store-row-state ${openItems.length > 0 ? "status-warning" : record.state === "failed" ? "status-error" : "status-active"}`,
        openItems.length > 0
          ? `${openItems.length} attention`
          : pending.length > 0
            ? `${pending.length} queued`
            : agentStateLabel(record.state),
      ),
    );
    row.addEventListener("click", () => selectSupervisedSession(record.id));
    attentionList.append(row);
  }
  renderAttentionDetail(records.find((record) => record.id === selectedSupervisionId));
}

function selectSupervisedSession(id: string, focusRow = false): void {
  if (!agentSupervision.sessions.some((record) => record.id === id)) {
    return;
  }
  selectedSupervisionId = id;
  renderAttentionQueue();
  if (focusRow) {
    window.requestAnimationFrame(() => {
      attentionList.querySelector<HTMLButtonElement>(`[data-supervision-id="${id}"]`)?.focus();
    });
  }
}

function moveAttentionSelection(offset: number): void {
  const records = prioritizedSupervisedSessions();
  if (records.length === 0) {
    return;
  }
  const currentIndex = Math.max(0, records.findIndex((record) => record.id === selectedSupervisionId));
  selectSupervisedSession(records[(currentIndex + offset + records.length) % records.length].id, true);
}

async function refreshAgentSupervision(): Promise<void> {
  const requestId = ++attentionRequestId;
  try {
    const snapshot = await invoke<AgentSupervisionSnapshot>("agent_supervision_snapshot");
    if (requestId !== attentionRequestId) {
      return;
    }
    agentSupervision = snapshot;
    supervisedSessionIds.clear();
    for (const record of snapshot.sessions) {
      if (paneForSession(record.sessionId)) {
        supervisedSessionIds.add(record.sessionId);
      }
    }
    attentionError.hidden = true;
    attentionNotice.textContent =
      "Every state names process, declared provider event, or uncertain output observation as its source.";
    renderAttentionQueue();
  } catch (error) {
    if (requestId !== attentionRequestId) {
      return;
    }
    attentionError.hidden = false;
    attentionError.textContent = `Could not read supervised agents: ${String(error)}`;
  }
}

function taskStatusLabel(status: AgentTaskStatus): string {
  return {
    preparing: "Preparing Worktree",
    ready: "Ready for writer",
    active: "Active writer",
    handoffReady: "Handoff ready",
    setupFailed: "Setup failed",
    cancelled: "Cancelled · Worktree removed",
    cancelledPreserved: "Cancelled · Worktree preserved",
  }[status];
}

function replaceAgentTask(task: AgentTask): void {
  const index = agentTasks.findIndex((item) => item.id === task.id);
  if (index >= 0) {
    agentTasks[index] = task;
  } else {
    agentTasks.push(task);
  }
  if (activeSurface === "tasks") {
    renderAgentTaskCenter();
  }
}

function taskSearchText(task: AgentTask): string {
  const handoff = task.handoffs.at(-1);
  return [
    task.id,
    task.taskSummary,
    task.repositoryRoot,
    task.baseBranch,
    task.taskBranch,
    task.worktreePath,
    task.agentName,
    task.agentId,
    taskStatusLabel(task.status),
    task.lease?.ownerId ?? "",
    handoff?.newOwnerName ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function visibleAgentTasks(): AgentTask[] {
  const query = tasksSearch.value.trim().toLowerCase();
  return agentTasks
    .filter((task) => !query || taskSearchText(task).includes(query))
    .sort((left, right) => {
      const rank = (task: AgentTask) => {
        if (task.status === "active") return 0;
        if (task.status === "handoffReady") return 1;
        if (task.status === "preparing" || task.status === "setupFailed") return 2;
        if (task.status === "ready") return 3;
        return 4;
      };
      return rank(left) - rank(right) || Number(right.updatedAt) - Number(left.updatedAt);
    });
}

async function refreshAgentTasks(): Promise<void> {
  const requestId = ++taskRequestId;
  tasksError.hidden = true;
  try {
    const tasks = await invoke<AgentTask[]>("agent_task_list");
    if (requestId !== taskRequestId) {
      return;
    }
    agentTasks = tasks;
    renderAgentTaskCenter();
  } catch (error) {
    if (requestId !== taskRequestId) {
      return;
    }
    tasksError.hidden = false;
    tasksError.textContent = `Could not read Agent Tasks: ${String(error)}`;
  }
}

function openAgentTasks(): void {
  if (storeOpen && activeSurface === "tasks") {
    tasksSearch.focus();
    return;
  }
  storeOpen = true;
  activeSurface = "tasks";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = false;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "true");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "agent tasks";
  status.textContent = "tasks";
  status.dataset.state = "ready";
  void refreshAgentTasks();
  void refreshAgents();
  window.requestAnimationFrame(() => tasksSearch.focus());
}

function renderAgentTaskCenter(): void {
  const tasks = visibleAgentTasks();
  tasksList.replaceChildren();
  tasksCount.textContent = `${tasks.length} shown · ${agentTasks.length} saved`;
  if (tasks.length === 0) {
    selectedTaskId = undefined;
    tasksList.append(makeElement("div", "store-empty-list", "No Agent Tasks match this search."));
    renderAgentTaskDetail(undefined);
    return;
  }
  if (!tasks.some((task) => task.id === selectedTaskId)) {
    selectedTaskId = tasks[0].id;
  }
  for (const task of tasks) {
    const selected = task.id === selectedTaskId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.taskId = task.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    row.classList.toggle("is-selected", selected);
    const top = makeElement("span", "store-row-top");
    top.append(
      makeElement("strong", undefined, task.taskSummary || "Untitled Agent Task"),
      makeElement("span", "store-row-category", task.agentName),
    );
    row.append(
      top,
      makeElement("span", "store-row-summary", `${task.taskBranch} · ${task.worktreePath}`),
      makeElement(
        "span",
        `store-row-state ${task.status === "active" ? "status-active" : task.status === "setupFailed" ? "status-error" : task.status === "handoffReady" ? "status-warning" : "status-unknown"}`,
        taskStatusLabel(task.status),
      ),
    );
    row.addEventListener("click", () => selectAgentTask(task.id));
    tasksList.append(row);
  }
  renderAgentTaskDetail(tasks.find((task) => task.id === selectedTaskId));
}

function renderAgentTaskDetail(task: AgentTask | undefined): void {
  tasksDetail.replaceChildren();
  if (!task) {
    tasksDetail.append(makeElement("div", "store-empty-detail", "Select an Agent Task to inspect its lease and recovery choices."));
    return;
  }
  const header = makeElement("header", "detail-header");
  header.append(
    makeElement("span", "detail-category", "agent task"),
    makeElement("h2", "detail-title", task.taskSummary || "Untitled Agent Task"),
    makeElement("p", "detail-summary", taskStatusLabel(task.status)),
    makeElement("p", "detail-meta", `${task.agentName} · ${task.permissionMode}`),
  );
  tasksDetail.append(header);

  const context = appendDetailSection(tasksDetail, "Task context");
  appendDetailLine(context, "Repository", task.repositoryRoot);
  appendDetailLine(context, "Base branch", task.baseBranch);
  appendDetailLine(context, "Task branch", task.taskBranch);
  appendDetailLine(context, "Worktree root", task.worktreeRoot);
  appendDetailLine(context, "Worktree path", task.worktreePath);
  appendDetailLine(context, "Permission mode", agentPermissionLabel(task.permissionMode));
  appendDetailLine(context, "Agent", task.agentName);

  const leaseSection = appendDetailSection(tasksDetail, "Worktree Lease");
  if (task.lease) {
    appendDetailLine(leaseSection, "Owner", task.lease.ownerId);
    appendDetailLine(leaseSection, "Lease state", task.lease.status);
    appendDetailLine(leaseSection, "Session", task.lease.sessionId ?? "reserved before launch");
    leaseSection.append(
      makeElement(
        "p",
        "detail-note",
        task.lease.status === "active"
          ? "Only this writer may edit the Agent Worktree. A second agent cannot silently take the lease."
          : "The Worktree is reserved while the selected agent launch is being completed.",
      ),
    );
    const release = makeElement("button", "detail-action", task.lease.status === "active" ? "Release writer lease" : "Release reservation") as HTMLButtonElement;
    release.type = "button";
    release.addEventListener("click", () => void releaseAgentTask(task));
    leaseSection.append(release);
  } else {
    leaseSection.append(makeElement("p", "detail-empty", task.status === "handoffReady" ? "No writer is active. The latest handoff names the only owner who may claim it." : "No writer currently holds this Worktree."));
  }

  if (task.status === "ready") {
    const retryAgent = agentEntries.find((entry) => entry.id === task.agentId && entry.launchable);
    if (retryAgent) {
      const retry = makeElement("button", "agent-start-button", `Start ${retryAgent.name} in Worktree`) as HTMLButtonElement;
      retry.type = "button";
      retry.addEventListener("click", () => void startAgentForTask(task, retryAgent));
      tasksDetail.append(retry);
    }
  }

  if (task.failureMessage) {
    const failure = appendDetailSection(tasksDetail, "Setup failure");
    failure.append(makeElement("p", "task-plan-evidence", task.failureMessage));
  }

  const latestHandoff = task.handoffs.at(-1);
  if (latestHandoff) {
    const handoffSection = appendDetailSection(tasksDetail, "Latest Control Handoff");
    appendDetailLine(handoffSection, "From", latestHandoff.previousOwner);
    appendDetailLine(handoffSection, "To", `${latestHandoff.newOwnerName} (${latestHandoff.newOwner})`);
    appendDetailLine(handoffSection, "Branch", latestHandoff.branch);
    appendDetailLine(handoffSection, "Worktree", latestHandoff.worktreePath);
    appendDetailLine(handoffSection, "Changes", latestHandoff.changes);
    appendDetailLine(handoffSection, "Checks", latestHandoff.checks);
    appendDetailLine(handoffSection, "Pending decisions", latestHandoff.pendingDecisions);
    const receiver = agentEntries.find((entry) => entry.id === latestHandoff.newOwner && entry.launchable);
    if (task.status === "handoffReady" && receiver) {
      const receive = makeElement("button", "agent-start-button", `Receive with ${receiver.name}`) as HTMLButtonElement;
      receive.type = "button";
      receive.addEventListener("click", () => void startAgentForTask(task, receiver));
      handoffSection.append(receive);
    }
  }

  if (task.lease?.status === "active") {
    const handoffSection = appendDetailSection(tasksDetail, "Record explicit handoff");
    const ownerOptions = agentEntries.filter((entry) => entry.launchable && entry.id !== task.agentId);
    const ownerSelect = makeElement("select", "agent-scope-select") as HTMLSelectElement;
    ownerSelect.setAttribute("aria-label", "New handoff owner");
    for (const entry of ownerOptions) {
      const option = makeElement("option", undefined, entry.name) as HTMLOptionElement;
      option.value = entry.id;
      ownerSelect.append(option);
    }
    if (ownerOptions.length === 0) {
      const option = makeElement("option", undefined, "No other launchable agent detected") as HTMLOptionElement;
      option.value = "";
      ownerSelect.append(option);
    }
    const ownerLabel = makeElement("label", "agent-scope-field");
    ownerLabel.append(makeElement("span", undefined, "New owner"), ownerSelect);
    const changes = taskHandoffTextarea(handoffSection, "Changes", "Files, commits, or unfinished work");
    const checks = taskHandoffTextarea(handoffSection, "Checks", "Tests or checks already run");
    const decisions = taskHandoffTextarea(handoffSection, "Pending decisions", "Choices the next owner must make");
    const submit = makeElement("button", "detail-action", "Record handoff") as HTMLButtonElement;
    submit.type = "button";
    submit.disabled = ownerOptions.length === 0;
    submit.addEventListener("click", () => void submitTaskHandoff(task, ownerSelect.value, ownerSelect.selectedOptions[0]?.textContent ?? ownerSelect.value, changes.value, checks.value, decisions.value));
    handoffSection.prepend(ownerLabel);
    handoffSection.append(submit);
    handoffSection.append(makeElement("p", "detail-note", "The active Session must be stopped first. Arkonad refuses to transfer a live writer."));
  }

  if (!task.status.toLowerCase().startsWith("cancelled")) {
    const cancel = makeElement("button", "detail-action", "Cancel Task") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => void cancelAgentTask(task));
    tasksDetail.append(cancel);
  }
}

function taskHandoffTextarea(parent: HTMLElement, label: string, placeholder: string): HTMLTextAreaElement {
  const wrapper = makeElement("label", "agent-task-field");
  wrapper.append(makeElement("span", undefined, label));
  const input = makeElement("textarea") as HTMLTextAreaElement;
  input.rows = 2;
  input.placeholder = placeholder;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function selectAgentTask(id: string, focusRow = false): void {
  if (!agentTasks.some((task) => task.id === id)) {
    return;
  }
  selectedTaskId = id;
  renderAgentTaskCenter();
  if (focusRow) {
    window.requestAnimationFrame(() => tasksList.querySelector<HTMLButtonElement>(`[data-task-id="${id}"]`)?.focus());
  }
}

function moveAgentTaskSelection(offset: number): void {
  const tasks = visibleAgentTasks();
  if (tasks.length === 0) {
    return;
  }
  const currentIndex = Math.max(0, tasks.findIndex((task) => task.id === selectedTaskId));
  selectAgentTask(tasks[(currentIndex + offset + tasks.length) % tasks.length].id, true);
}

async function releaseAgentTask(task: AgentTask): Promise<void> {
  if (!task.lease) {
    return;
  }
  try {
    replaceAgentTask(await invoke<AgentTask>("agent_task_release", {
      request: { taskId: task.id, ownerId: task.lease.ownerId },
    }));
    tasksNotice.textContent = "The Worktree Lease was released. No agent may write until a new explicit claim.";
  } catch (error) {
    tasksNotice.textContent = `Could not release the Worktree Lease: ${String(error)}`;
  }
}

async function submitTaskHandoff(
  task: AgentTask,
  newOwner: string,
  newOwnerName: string,
  changes: string,
  checks: string,
  pendingDecisions: string,
): Promise<void> {
  if (!task.lease) {
    return;
  }
  try {
    replaceAgentTask(await invoke<AgentTask>("agent_task_handoff", {
      request: {
        taskId: task.id,
        currentOwner: task.lease.ownerId,
        newOwner,
        newOwnerName,
        changes,
        checks,
        pendingDecisions,
      },
    }));
    tasksNotice.textContent = "Handoff recorded. The named owner must explicitly claim the Worktree before writing.";
  } catch (error) {
    tasksNotice.textContent = `Could not record the handoff: ${String(error)}`;
  }
}

async function cancelAgentTask(task: AgentTask): Promise<void> {
  try {
    const result = await invoke<AgentTaskCancelResult>("agent_task_cancel", {
      request: { taskId: task.id },
    });
    replaceAgentTask(result.task);
    tasksNotice.textContent = result.message;
  } catch (error) {
    tasksNotice.textContent = `Could not cancel the Agent Task: ${String(error)}`;
  }
}

function openAttentionQueue(): void {
  if (storeOpen && activeSurface === "attention") {
    attentionSearch.focus();
    return;
  }
  storeOpen = true;
  activeSurface = "attention";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = false;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "true");
  sessionMeta.textContent = "attention queue";
  status.textContent = "attention";
  status.dataset.state = "ready";
  void refreshAgentSupervision();
  window.requestAnimationFrame(() => attentionSearch.focus());
}

async function returnToSupervisedSession(record: AgentSessionRecord): Promise<void> {
  const currentPane = paneForSession(record.sessionId);
  if (currentPane) {
    const tab = frameSnapshot.tabs.find((candidate) =>
      candidate.panes.some((pane) => pane.id === currentPane.id),
    );
    if (tab && frameSnapshot.activeTabId !== tab.id) {
      renderFrame(await invoke<FrameSnapshot>("frame_activate_tab", { tabId: tab.id }), false);
    }
    if (frameSnapshot.focusedPaneId !== currentPane.id) {
      renderFrame(await invoke<FrameSnapshot>("frame_focus_pane", { paneId: currentPane.id }), false);
    }
    closeSurface();
    paneRuntimes.get(currentPane.id)?.terminal.focus();
    return;
  }
  if (!record.workspaceId) {
    attentionNotice.textContent =
      "The original live pane is unavailable and this session has no saved Workspace id.";
    return;
  }
  const result = await invoke<WorkspaceLoadResult>("workspace_load", { workspaceId: record.workspaceId });
  if (result.status === "ready" && result.workspace) {
    targetRecoveryPaneId = record.paneId ?? undefined;
    openWorkspaceRecovery(
      result.workspace,
      `Returning to ${record.agentName}. The provider process is Interrupted and will not be replayed; inspect the saved pane and restart the agent explicitly.`,
    );
    return;
  }
  attentionNotice.textContent = result.message;
}

async function acknowledgeAttention(attentionId: string): Promise<void> {
  try {
    agentSupervision = await invoke<AgentSupervisionSnapshot>("agent_attention_acknowledge", {
      attentionId,
    });
    renderAttentionQueue();
  } catch (error) {
    attentionNotice.textContent = `Could not acknowledge the item: ${String(error)}`;
  }
}

async function submitAgentFollowUp(
  supervisionId: string,
  message: string,
  mode: AgentFollowUpMode,
): Promise<void> {
  try {
    const result = await invoke<AgentFollowUpResult>("agent_follow_up_submit", {
      request: { supervisionId, message, mode },
    });
    replaceSupervisedSession(result.session);
    attentionNotice.textContent = result.followUp.statusMessage;
  } catch (error) {
    attentionNotice.textContent = `Could not submit the follow-up: ${String(error)}`;
  }
}

async function deliverAgentFollowUp(followUpId: string): Promise<void> {
  try {
    const result = await invoke<AgentFollowUpResult>("agent_follow_up_deliver", { followUpId });
    replaceSupervisedSession(result.session);
    attentionNotice.textContent = result.followUp.statusMessage;
  } catch (error) {
    attentionNotice.textContent = `Could not deliver the queued follow-up: ${String(error)}`;
  }
}

function observeAgentOutput(sessionId: string, chunk: Uint8Array): void {
  if (!supervisedSessionIds.has(sessionId)) {
    return;
  }
  const text = new TextDecoder().decode(chunk);
  agentObservationBuffers.set(
    sessionId,
    `${agentObservationBuffers.get(sessionId) ?? ""}${text}`.slice(-8_000),
  );
  const existing = agentObservationTimers.get(sessionId);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  agentObservationTimers.set(
    sessionId,
    window.setTimeout(() => {
      agentObservationTimers.delete(sessionId);
      const observation = agentObservationBuffers.get(sessionId) ?? "";
      agentObservationBuffers.delete(sessionId);
      void invoke<AgentSessionRecord | null>("agent_supervision_observe_output", {
        request: { sessionId, text: observation },
      })
        .then((record) => {
          if (record) {
            replaceSupervisedSession(record);
          }
        })
        .catch(() => {
          // Terminal output remains visible even if supervision metadata cannot be updated.
        });
    }, 180),
  );
}

type LaunchTarget = {
  id: string;
  name: string;
  profileId: string | null;
  executablePath: string | null;
  supportsWorkingDirectory: boolean;
  pinned?: boolean;
};

function createLaunchButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = makeElement("button", "detail-action", label) as HTMLButtonElement;
  button.type = "button";
  button.disabled = launchBusy;
  button.addEventListener("click", onClick);
  return button;
}

function launchLocationFromControls(
  select: HTMLSelectElement,
  directoryInput: HTMLInputElement,
  workspaceInput: HTMLInputElement,
): LaunchLocation {
  switch (select.value) {
    case "directory":
      return { kind: "directory", path: directoryInput.value.trim() };
    case "newWorkspace":
      return { kind: "newWorkspace", name: workspaceInput.value.trim() };
    default:
      return { kind: "currentDirectory" };
  }
}

function agentEnvironment(context: AgentLaunchContext): Record<string, string> {
  const environment: Record<string, string> = {
    ARKONAD_AGENT_MODE: context.mode,
    ARKONAD_AGENT_PERMISSION: context.policy.permission,
    ARKONAD_AGENT_FOLLOW_UP: context.policy.followUp,
    ARKONAD_AGENT_WRITE_ACCESS: context.mode === "chat" ? "disabled" : "enabled",
  };
  if (context.workspaceRoot) {
    environment.ARKONAD_WORKSPACE_ROOT = context.workspaceRoot;
  }
  if (context.agentTaskId) {
    environment.ARKONAD_AGENT_TASK_ID = context.agentTaskId;
  }
  if (context.agentTaskWorktreePath) {
    environment.ARKONAD_AGENT_WORKTREE = context.agentTaskWorktreePath;
  }
  return environment;
}

function agentInitialPrompt(context: AgentLaunchContext): string {
  if (context.mode === "chat") {
    const question = context.task || "Open a read-only General Chat session.";
    return `${question}\n\nGeneral Chat boundary: do not change files, run mutating commands, install tools, commit, or push. If a write is requested, ask the user to promote this session to Agent Task first.`;
  }
  return `${context.task}\n\nAgent Task boundary: work only in the assigned Agent Worktree. Do not edit another checkout or hand the Worktree to another writer without an explicit Arkonad handoff.`;
}

async function launchTarget(
  target: LaunchTarget,
  location: LaunchLocation,
  context?: AgentLaunchContext,
): Promise<void> {
  if (launchBusy) {
    return;
  }

  launchBusy = true;
  const output = new Channel<Uint8Array>();
  const pendingOutput: Uint8Array[] = [];
  let outputSessionId: string | undefined;
  let sessionAccepted = false;
  let taskClaimed = false;
  let launchedSessionId: string | undefined;
  output.onmessage = (chunk) => {
    if (sessionAccepted && outputSessionId) {
      writeToPane(outputSessionId, chunk);
    } else {
      pendingOutput.push(chunk);
    }
  };

  try {
    const nextSession = await invoke<SessionInfo>("launch_app", {
      request: {
        appId: target.id,
        profileId: target.profileId,
        location,
        currentDirectory: focusedPane()?.session.cwd ?? null,
        environment: context ? agentEnvironment(context) : {},
      },
      onOutput: output,
    });
    launchedSessionId = nextSession.id;
    outputSessionId = nextSession.id;
    const nextSnapshot = await invoke<FrameSnapshot>("frame_attach_session", {
      session: nextSession,
    });
    renderFrame(nextSnapshot);
    if (context?.agentTaskId) {
      const task = await invoke<AgentTask>("agent_task_claim", {
        request: {
          taskId: context.agentTaskId,
          agentId: target.id,
          agentName: target.name,
          permissionMode: context.policy.permission,
          sessionId: nextSession.id,
        },
      });
      replaceAgentTask(task);
      taskClaimed = true;
    }
    let supervisionWarning = "";
    if (context) {
      try {
        await saveWorkspaceNow();
        const pane = paneForSession(nextSession.id);
        const tab = pane
          ? frameSnapshot.tabs.find((candidate) =>
              candidate.panes.some((candidatePane) => candidatePane.id === pane.id),
            )
          : undefined;
        agentSupervision = await invoke<AgentSupervisionSnapshot>("agent_supervision_register", {
          request: {
            sessionId: nextSession.id,
            workspaceId: activeWorkspaceId,
            workspaceName: activeWorkspaceName,
            workspaceRoot: context.workspaceRoot ?? nextSession.cwd,
            tabId: tab?.id ?? null,
            paneId: pane?.id ?? null,
            agentId: target.id,
            agentName: target.name,
            followUpMode: context.policy.followUp,
          },
        });
        supervisedSessionIds.add(nextSession.id);
        updateAttentionBadge();
      } catch (error) {
        supervisionWarning = `Agent launched, but supervision is unavailable: ${String(error)}`;
      }
    }
    sessionAccepted = true;
    for (const chunk of pendingOutput) {
      writeToPane(nextSession.id, chunk);
    }
    if (context) {
      const initialPrompt = agentInitialPrompt(context);
      if (initialPrompt) {
        window.setTimeout(() => {
          void invoke("write_session", {
            id: nextSession.id,
            data: new TextEncoder().encode(`${initialPrompt}\r`),
          }).catch((error: unknown) => showError(`Could not send the agent context: ${String(error)}`));
        }, 450);
      }
    }
    cwdLabel.textContent = nextSession.cwd;
    launchBusy = false;
    closeSurface();
    sessionMeta.textContent = `${target.name} · ${nextSession.shell}`;
    setTerminalStatus(supervisionWarning || "ready", supervisionWarning ? "error" : "ready");
    sendResize();
    paneRuntimes.get(frameSnapshot.focusedPaneId ?? "")?.terminal.focus();
    void refreshLaunchpad();
    void refreshMyApps();
    if (context) {
      void refreshAgentSupervision();
    }
  } catch (error) {
    launchBusy = false;
    const message = `Could not launch ${target.name}: ${String(error)}`;
    if (activeSurface === "launchpad") {
      launchpadNotice.textContent = message;
    } else if (activeSurface === "apps") {
      appsNotice.textContent = message;
    } else if (activeSurface === "agents") {
      agentNotice.textContent = message;
    } else if (activeSurface === "tasks") {
      tasksNotice.textContent = message;
    }
    if (context?.agentTaskId && !taskClaimed) {
      if (launchedSessionId) {
        await invoke("close_session", { id: launchedSessionId }).catch(() => {
          // The launch failure remains visible in the task record for recovery.
        });
      }
      await invoke("agent_task_release", {
        request: { taskId: context.agentTaskId, ownerId: target.id },
      }).catch(() => {
        // The task remains reserved and visible for explicit recovery if release fails.
      });
    }
  }
}

function appendLaunchControls(parent: HTMLElement, target: LaunchTarget): void {
  const section = appendDetailSection(parent, "Launch");
  appendDetailLine(section, "Executable", target.executablePath ?? "resolved at launch");
  appendDetailLine(
    section,
    "Input",
    "After launch, the Native TUI owns keyboard input and authentication.",
  );

  const locationRow = makeElement("div", "launch-location-row");
  let locationSelect: HTMLSelectElement | undefined;
  let directoryInput: HTMLInputElement | undefined;
  let workspaceInput: HTMLInputElement | undefined;
  if (target.supportsWorkingDirectory) {
    const locationLabel = makeElement("label", "launch-control");
    locationLabel.append(makeElement("span", undefined, "Launch location"));
    locationSelect = makeElement("select", undefined) as HTMLSelectElement;
    locationSelect.innerHTML = `
      <option value="currentDirectory">Current directory</option>
      <option value="directory">Another directory</option>
      <option value="newWorkspace">New Workspace</option>
    `;
    locationLabel.append(locationSelect);
    locationRow.append(locationLabel);

    directoryInput = makeElement("input") as HTMLInputElement;
    directoryInput.type = "text";
    directoryInput.placeholder = "D:\\path\\to\\directory";
    directoryInput.className = "launch-location-input";
    directoryInput.hidden = true;
    directoryInput.setAttribute("aria-label", "Another directory");
    locationRow.append(directoryInput);

    workspaceInput = makeElement("input") as HTMLInputElement;
    workspaceInput.type = "text";
    workspaceInput.placeholder = "workspace name";
    workspaceInput.className = "launch-location-input";
    workspaceInput.hidden = true;
    workspaceInput.setAttribute("aria-label", "New Workspace name");
    locationRow.append(workspaceInput);

    locationSelect.addEventListener("change", () => {
      directoryInput!.hidden = locationSelect!.value !== "directory";
      workspaceInput!.hidden = locationSelect!.value !== "newWorkspace";
      if (locationSelect!.value === "directory") {
        directoryInput!.focus();
      } else if (locationSelect!.value === "newWorkspace") {
        workspaceInput!.focus();
      }
    });
  } else {
    locationRow.append(
      makeElement(
        "p",
        "detail-note",
        "This launch profile supplies its own working directory; location choices are not offered.",
      ),
    );
  }
  section.append(locationRow);

  const buttonRow = makeElement("div", "install-button-row");
  buttonRow.append(
    createLaunchButton(`Launch ${target.name}`, () => {
      const location = locationSelect && directoryInput && workspaceInput
        ? launchLocationFromControls(locationSelect, directoryInput, workspaceInput)
        : { kind: "currentDirectory" as const };
      void launchTarget(target, location);
    }),
  );
  const pinButton = createLaunchButton(target.pinned ? "Unpin" : "Pin first", () => {
    const current = launchpadEntries.find((entry) => entry.id === target.id);
    void invoke("launchpad_set_pinned", {
      id: target.id,
      pinned: !(current?.pinned ?? target.pinned ?? false),
    }).then(() => {
      void refreshLaunchpad();
    }).catch((error: unknown) => {
      launchpadNotice.textContent = `Could not update the pin: ${String(error)}`;
    });
  });
  buttonRow.append(pinButton);
  section.append(buttonRow);
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

function launchpadSearchText(entry: LaunchpadEntry): string {
  return `${entry.name} ${entry.summary} ${entry.category ?? ""} ${entry.publisher ?? ""}`
    .toLowerCase();
}

function renderLaunchpadDetail(entry: LaunchpadEntry | undefined): void {
  launchpadDetail.replaceChildren();
  if (!entry) {
    launchpadDetail.append(
      makeElement("div", "store-empty-detail", "Select a Launchable Tool to see its launch profile."),
    );
    return;
  }

  const header = makeElement("header", "detail-header");
  header.append(makeElement("span", "detail-category", entry.category ?? "custom tool"));
  header.append(makeElement("h2", "detail-title", entry.name));
  header.append(makeElement("p", "detail-summary", entry.summary));
  header.append(
    makeElement(
      "p",
      "detail-meta",
      [entry.publisher, entry.pinned ? "pinned" : "", entry.newlyInstalled ? "new" : ""]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  launchpadDetail.append(header);

  const stateSection = appendDetailSection(launchpadDetail, "Launchpad priority");
  appendDetailLine(stateSection, "Launchable", entry.launchable ? "yes" : "no");
  appendDetailLine(stateSection, "Pin", entry.pinned ? "first" : "not pinned");
  appendDetailLine(stateSection, "New install", entry.newlyInstalled ? "temporary priority" : "not new");
  appendDetailLine(
    stateSection,
    "Recent use",
    entry.lastLaunchedAt ? formatTimestamp(entry.lastLaunchedAt) : "not launched yet",
  );

  appendLaunchControls(launchpadDetail, {
    id: entry.id,
    name: entry.name,
    profileId: entry.profileId,
    executablePath: entry.executablePath,
    supportsWorkingDirectory: entry.supportsWorkingDirectory,
    pinned: entry.pinned,
  });
}

function renderLaunchpadList(): void {
  const query = launchpadSearch.value.trim().toLowerCase();
  const visibleEntries = launchpadEntries.filter((entry) => !query || launchpadSearchText(entry).includes(query));
  launchpadList.replaceChildren();
  launchpadCount.textContent = `${visibleEntries.length} shown`;
  if (visibleEntries.length === 0) {
    launchpadList.append(
      makeElement("div", "store-empty-list", "No Launchable Tools match this search. Install or enable one from My Apps."),
    );
    renderLaunchpadDetail(undefined);
    return;
  }
  if (!visibleEntries.some((entry) => entry.id === selectedLaunchpadId)) {
    selectedLaunchpadId = visibleEntries[0].id;
  }

  for (const entry of visibleEntries) {
    const selected = entry.id === selectedLaunchpadId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.launchpadId = entry.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    if (selected) {
      row.classList.add("is-selected");
    }
    const rowTop = makeElement("span", "store-row-top");
    rowTop.append(makeElement("strong", undefined, entry.name));
    rowTop.append(
      makeElement(
        "span",
        "store-row-category",
        entry.pinned ? "pinned" : entry.newlyInstalled ? "new" : entry.source,
      ),
    );
    row.append(rowTop);
    row.append(makeElement("span", "store-row-summary", entry.summary));
    const state = entry.lastLaunchedAt ? "recent" : "ready";
    row.append(makeElement("span", "store-row-state status-active", state));
    row.addEventListener("click", () => selectLaunchpadEntry(entry.id));
    launchpadList.append(row);
  }
  renderLaunchpadDetail(visibleEntries.find((entry) => entry.id === selectedLaunchpadId));
}

function selectLaunchpadEntry(id: string, focusRow = false): void {
  if (!launchpadEntries.some((entry) => entry.id === id)) {
    return;
  }
  selectedLaunchpadId = id;
  renderLaunchpadList();
  if (focusRow) {
    window.requestAnimationFrame(() => {
      const row = Array.from(
        launchpadList.querySelectorAll<HTMLButtonElement>("[data-launchpad-id]"),
      ).find((candidate) => candidate.dataset.launchpadId === id);
      row?.focus();
    });
  }
}

function moveLaunchpadSelection(offset: number): void {
  const query = launchpadSearch.value.trim().toLowerCase();
  const visibleEntries = launchpadEntries.filter((entry) => !query || launchpadSearchText(entry).includes(query));
  if (visibleEntries.length === 0) {
    return;
  }
  const currentIndex = visibleEntries.findIndex((entry) => entry.id === selectedLaunchpadId);
  const nextIndex = (Math.max(currentIndex, 0) + offset + visibleEntries.length) % visibleEntries.length;
  selectLaunchpadEntry(visibleEntries[nextIndex].id, true);
}

async function refreshLaunchpad(): Promise<void> {
  const requestId = ++launchpadRequestId;
  launchpadError.hidden = true;
  launchpadNotice.textContent = "Checking launch profiles and executable readiness…";
  launchpadCount.textContent = "loading…";
  try {
    launchpadEntries = await invoke<LaunchpadEntry[]>("launchpad_list");
    if (requestId !== launchpadRequestId) {
      return;
    }
    launchpadNotice.textContent =
      "Only Ready or Detected Installations appear. Pins, new installs, then recent tools lead the list.";
    renderLaunchpadList();
    launchpadMetadataReady = true;
    workspaceMetadataReady = launchpadMetadataReady && customAppMetadataReady;
    scheduleWorkspaceSave();
  } catch (error) {
    if (requestId !== launchpadRequestId) {
      return;
    }
    launchpadEntries = [];
    renderLaunchpadList();
    launchpadError.hidden = false;
    launchpadError.textContent = `Could not read Launchpad: ${String(error)}`;
  }
}

function scheduleLaunchpadRefresh(): void {
  if (launchpadRefreshTimer !== undefined) {
    window.clearTimeout(launchpadRefreshTimer);
  }
  launchpadRefreshTimer = window.setTimeout(() => void refreshLaunchpad(), 140);
}

function openLaunchpad(): void {
  if (storeOpen && activeSurface === "launchpad") {
    launchpadSearch.focus();
    return;
  }
  storeOpen = true;
  activeSurface = "launchpad";
  terminalShell.hidden = true;
  launchpadView.hidden = false;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "true");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "launchpad";
  status.textContent = "launchpad";
  status.dataset.state = "ready";
  void refreshLaunchpad();
  window.requestAnimationFrame(() => launchpadSearch.focus());
}

function customDraftFromForm(form: HTMLFormElement, id: string | undefined): CustomAppDraft {
  const name = form.querySelector<HTMLInputElement>("[data-custom-name]")!;
  const executable = form.querySelector<HTMLInputElement>("[data-custom-executable]")!;
  const argumentsInput = form.querySelector<HTMLTextAreaElement>("[data-custom-arguments]")!;
  const shell = form.querySelector<HTMLInputElement>("[data-custom-shell]")!;
  const workingDirectory = form.querySelector<HTMLInputElement>("[data-custom-working-directory]")!;
  const supportsWorkingDirectory = form.querySelector<HTMLInputElement>("[data-custom-supports-cwd]")!;
  const enabled = form.querySelector<HTMLInputElement>("[data-custom-enabled]")!;
  return {
    id: id ?? null,
    name: name.value,
    executable: executable.value,
    arguments: argumentsInput.value
      .split(/\r?\n/)
      .map((argument) => argument.trim())
      .filter(Boolean),
    shell: shell.value.trim() || null,
    workingDirectory: workingDirectory.value.trim() || null,
    supportsWorkingDirectory: supportsWorkingDirectory.checked,
    enabled: enabled.checked,
  };
}

function renderCustomAppsManager(parent: HTMLElement): void {
  const section = appendDetailSection(parent, "Custom Tool profiles");
  section.append(
    makeElement(
      "p",
      "detail-note",
      "Custom Tools are stored locally as launch profiles. They do not edit the reviewed Store catalog, and authentication remains inside the tool.",
    ),
  );

  const list = makeElement("div", "custom-app-list");
  for (const profile of customAppEntries) {
    const row = makeElement("div", "custom-app-row");
    const rowHeader = makeElement("div", "custom-app-row-header");
    rowHeader.append(makeElement("strong", undefined, profile.name));
    rowHeader.append(makeElement("span", "store-row-category", profile.enabled ? "enabled" : "disabled"));
    row.append(rowHeader);
    row.append(makeElement("code", "detail-code", [profile.executable, ...profile.arguments].join(" ")));
    const rowButtons = makeElement("div", "install-button-row");
    rowButtons.append(
      createInstallButton("Edit", () => {
        editingCustomAppId = profile.id;
        renderMyAppsDetail(myAppsEntries.find((entry) => entry.manifestId === selectedMyAppId));
      }),
    );
    rowButtons.append(
      createInstallButton(profile.enabled ? "Disable" : "Enable", () => {
        void invoke("custom_app_set_enabled", { id: profile.id, enabled: !profile.enabled })
          .then(() => refreshMyApps())
          .catch((error: unknown) => {
            appsNotice.textContent = `Could not change the Custom Tool state: ${String(error)}`;
          });
      }),
    );
    rowButtons.append(
      createInstallButton("Remove", () => {
        if (!window.confirm(`Remove the Custom Tool profile “${profile.name}”?`)) {
          return;
        }
        void invoke("custom_app_remove", { id: profile.id })
          .then(() => {
            if (editingCustomAppId === profile.id) {
              editingCustomAppId = undefined;
            }
            return refreshMyApps();
          })
          .catch((error: unknown) => {
            appsNotice.textContent = `Could not remove the Custom Tool profile: ${String(error)}`;
          });
      }),
    );
    row.append(rowButtons);
    list.append(row);
  }
  if (customAppEntries.length === 0) {
    list.append(makeElement("p", "detail-empty", "No Custom Tool profiles yet."));
  }
  section.append(list);

  const editing = customAppEntries.find((profile) => profile.id === editingCustomAppId);
  const form = makeElement("form", "custom-app-form") as HTMLFormElement;
  const formHeading = makeElement("div", "install-step-header");
  formHeading.append(makeElement("strong", undefined, editing ? `Edit ${editing.name}` : "Add a Custom Tool"));
  form.append(formHeading);

  const addField = (labelText: string, input: HTMLInputElement | HTMLTextAreaElement): void => {
    const label = makeElement("label", "custom-app-field");
    label.append(makeElement("span", undefined, labelText));
    label.append(input);
    form.append(label);
  };
  const nameInput = makeElement("input") as HTMLInputElement;
  nameInput.type = "text";
  nameInput.dataset.customName = "true";
  nameInput.value = editing?.name ?? "";
  nameInput.placeholder = "Tool name";
  addField("Name", nameInput);
  const executableInput = makeElement("input") as HTMLInputElement;
  executableInput.type = "text";
  executableInput.dataset.customExecutable = "true";
  executableInput.value = editing?.executable ?? "";
  executableInput.placeholder = "executable or full path";
  addField("Executable", executableInput);
  const argumentsInput = makeElement("textarea") as HTMLTextAreaElement;
  argumentsInput.dataset.customArguments = "true";
  argumentsInput.rows = 3;
  argumentsInput.placeholder = "one argument per line (optional)";
  argumentsInput.value = editing?.arguments.join("\n") ?? "";
  addField("Arguments", argumentsInput);
  const shellInput = makeElement("input") as HTMLInputElement;
  shellInput.type = "text";
  shellInput.dataset.customShell = "true";
  shellInput.value = editing?.shell ?? "";
  shellInput.placeholder = "optional shell executable";
  addField("Shell runtime", shellInput);
  const workingDirectoryInput = makeElement("input") as HTMLInputElement;
  workingDirectoryInput.type = "text";
  workingDirectoryInput.dataset.customWorkingDirectory = "true";
  workingDirectoryInput.value = editing?.workingDirectory ?? "";
  workingDirectoryInput.placeholder = "optional default directory";
  addField("Default directory", workingDirectoryInput);

  const supportsLabel = makeElement("label", "custom-app-check");
  const supportsInput = makeElement("input") as HTMLInputElement;
  supportsInput.type = "checkbox";
  supportsInput.dataset.customSupportsCwd = "true";
  supportsInput.checked = editing?.supportsWorkingDirectory ?? true;
  supportsLabel.append(supportsInput, makeElement("span", undefined, "Tool accepts a chosen working directory"));
  form.append(supportsLabel);
  const enabledLabel = makeElement("label", "custom-app-check");
  const enabledInput = makeElement("input") as HTMLInputElement;
  enabledInput.type = "checkbox";
  enabledInput.dataset.customEnabled = "true";
  enabledInput.checked = editing?.enabled ?? true;
  enabledLabel.append(enabledInput, makeElement("span", undefined, "Enabled in Launchpad"));
  form.append(enabledLabel);

  const validationMessage = makeElement("p", "detail-empty", "Validate before saving; nothing runs during validation.");
  form.append(validationMessage);
  const formButtons = makeElement("div", "install-button-row");
  const validate = createInstallButton("Validate profile", () => {
    const draft = customDraftFromForm(form, editing?.id);
    void invoke<CustomAppValidation>("custom_app_validate", { draft })
      .then((result) => {
        validationMessage.textContent = result.valid
          ? `Valid. Executable: ${result.executablePath ?? "resolved"}. ${result.warnings.join(" ")}`
          : result.errors.join(" ");
        validationMessage.className = result.valid ? "detail-note" : "install-manual";
      })
      .catch((error: unknown) => {
        validationMessage.textContent = `Validation failed: ${String(error)}`;
        validationMessage.className = "install-manual";
      });
  });
  formButtons.append(validate);
  const save = createInstallButton(editing ? "Save changes" : "Add Custom Tool", () => {
    const draft = customDraftFromForm(form, editing?.id);
    void invoke<CustomAppValidation>("custom_app_validate", { draft })
      .then((result) => {
        if (!result.valid) {
          validationMessage.textContent = result.errors.join(" ");
          validationMessage.className = "install-manual";
          return;
        }
        return invoke("custom_app_save", { draft }).then(() => {
          editingCustomAppId = undefined;
          return refreshMyApps();
        });
      })
      .catch((error: unknown) => {
        validationMessage.textContent = `Could not save the Custom Tool profile: ${String(error)}`;
        validationMessage.className = "install-manual";
      });
  });
  formButtons.append(save);
  if (editing) {
    formButtons.append(
      createInstallButton("New profile", () => {
        editingCustomAppId = undefined;
        renderMyAppsDetail(myAppsEntries.find((entry) => entry.manifestId === selectedMyAppId));
      }),
    );
  }
  form.append(formButtons);
  section.append(form);

  if (editing?.enabled) {
    appendLaunchControls(section, {
      id: `custom:${editing.id}`,
      name: editing.name,
      profileId: editing.id,
      executablePath: null,
      supportsWorkingDirectory: editing.supportsWorkingDirectory,
      pinned: launchpadEntries.find((candidate) => candidate.id === `custom:${editing.id}`)?.pinned,
    });
  }
}

function renderMyAppsDetail(entry: MyAppEntry | undefined): void {
  appsDetail.replaceChildren();
  if (!entry) {
    appsDetail.append(makeElement("div", "store-empty-detail", "No installed or detected tools match this search."));
  } else {
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

    if (entry.launchable) {
      appendLaunchControls(appsDetail, {
        id: entry.manifestId,
        name: entry.toolName,
        profileId: entry.launchProfileId,
        executablePath: entry.executablePath,
        supportsWorkingDirectory: entry.supportsWorkingDirectory,
        pinned: launchpadEntries.find((candidate) => candidate.id === entry.manifestId)?.pinned,
      });
    }

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
        ["uninstall", "Review uninstall"],
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
  renderCustomAppsManager(appsDetail);
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
    const [snapshot, customApps] = await Promise.all([
      invoke<MyAppsSnapshot>("my_apps_list"),
      invoke<CustomAppProfile[]>("custom_app_list"),
    ]);
    if (requestId !== myAppsRequestId) {
      return;
    }
    myAppsEntries = snapshot.entries;
    customAppEntries = customApps;
    customAppMetadataReady = true;
    workspaceMetadataReady = launchpadMetadataReady && customAppMetadataReady;
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
    scheduleWorkspaceSave();
  } catch (error) {
    if (requestId !== myAppsRequestId) {
      return;
    }
    myAppsEntries = [];
    customAppEntries = [];
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

function openStore(category?: CatalogCategory | "", focusId?: string): void {
  if (category !== undefined) {
    storeCategory.value = category;
  }
  if (focusId) {
    storeSearch.value = "";
    selectedStoreId = focusId;
  }

  if (storeOpen && activeSurface === "store") {
    if (category !== undefined) {
      void refreshStore();
    }
    storeSearch.focus();
    return;
  }

  storeOpen = true;
  activeSurface = "store";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  appsView.hidden = true;
  storeView.hidden = false;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "true");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
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
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = false;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "true");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "my apps";
  status.textContent = "my apps";
  status.dataset.state = "ready";
  void refreshMyApps();
  window.requestAnimationFrame(() => appsSearch.focus());
}

function closeSurface(): void {
  if (!storeOpen) {
    if (!terminalStarted && !terminalStartPromise) {
      void startSession();
    }
    paneRuntimes.get(frameSnapshot.focusedPaneId ?? "")?.terminal.focus();
    return;
  }

  storeOpen = false;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  attentionView.hidden = true;
  terminalShell.hidden = false;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  updateFocusedSession();
  renderTerminalStatus();
  sendResize();
  if (!terminalStarted && !terminalStartPromise) {
    void startSession();
  }
  paneRuntimes.get(frameSnapshot.focusedPaneId ?? "")?.terminal.focus();
}

function closeStore(): void {
  closeSurface();
}

launchpadOpenButton.addEventListener("click", openLaunchpad);
storeOpenButton.addEventListener("click", () => openStore());
appsOpenButton.addEventListener("click", openMyApps);
agentsOpenButton.addEventListener("click", openAgentCockpit);
tasksOpenButton.addEventListener("click", openAgentTasks);
attentionOpenButton.addEventListener("click", openAttentionQueue);
launchpadCloseButton.addEventListener("click", closeSurface);
storeCloseButton.addEventListener("click", closeSurface);
appsCloseButton.addEventListener("click", closeSurface);
agentsCloseButton.addEventListener("click", closeSurface);
tasksCloseButton.addEventListener("click", closeSurface);
attentionCloseButton.addEventListener("click", closeSurface);
commandCloseButton.addEventListener("click", closeCommandOverlay);
commandSearch.addEventListener("input", renderCommandList);
commandSearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveCommandSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveCommandSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    void executeSelectedCommand();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeCommandOverlay();
  }
});
commandList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveCommandSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveCommandSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    void executeSelectedCommand();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeCommandOverlay();
  }
});
launchpadSearch.addEventListener("input", scheduleLaunchpadRefresh);
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
agentSearch.addEventListener("input", scheduleAgentRefresh);
tasksSearch.addEventListener("input", renderAgentTaskCenter);
attentionSearch.addEventListener("input", renderAttentionQueue);
launchpadList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveLaunchpadSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveLaunchpadSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    const first = launchpadEntries.find((entry) =>
      launchpadSearchText(entry).includes(launchpadSearch.value.trim().toLowerCase()),
    );
    if (first) {
      selectLaunchpadEntry(first.id, true);
    }
  } else if (event.key === "End") {
    event.preventDefault();
    const query = launchpadSearch.value.trim().toLowerCase();
    const visible = launchpadEntries.filter((entry) => launchpadSearchText(entry).includes(query));
    const last = visible.at(-1);
    if (last) {
      selectLaunchpadEntry(last.id, true);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.launchpadId) {
      selectLaunchpadEntry(activeRow.dataset.launchpadId, true);
    }
  }
});
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
agentList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveAgentSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveAgentSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    const first = agentEntries.find((entry) => agentSearchText(entry).includes(agentSearch.value.trim().toLowerCase()));
    if (first) {
      selectAgent(first.id, true);
    }
  } else if (event.key === "End") {
    event.preventDefault();
    const query = agentSearch.value.trim().toLowerCase();
    const last = agentEntries.filter((entry) => agentSearchText(entry).includes(query)).at(-1);
    if (last) {
      selectAgent(last.id, true);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.agentId) {
      selectAgent(activeRow.dataset.agentId, true);
    }
  }
});
attentionList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveAttentionSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveAttentionSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    const first = prioritizedSupervisedSessions()[0];
    if (first) {
      selectSupervisedSession(first.id, true);
    }
  } else if (event.key === "End") {
    event.preventDefault();
    const last = prioritizedSupervisedSessions().at(-1);
    if (last) {
      selectSupervisedSession(last.id, true);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.supervisionId) {
      selectSupervisedSession(activeRow.dataset.supervisionId, true);
    }
  }
});
tasksList.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveAgentTaskSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveAgentTaskSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    const first = visibleAgentTasks()[0];
    if (first) {
      selectAgentTask(first.id, true);
    }
  } else if (event.key === "End") {
    event.preventDefault();
    const last = visibleAgentTasks().at(-1);
    if (last) {
      selectAgentTask(last.id, true);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.taskId) {
      selectAgentTask(activeRow.dataset.taskId, true);
    }
  }
});

workspaceRestartAllButton.addEventListener("click", () => void restoreWorkspace());
workspaceOpenShellButton.addEventListener("click", () => void discardWorkspaceAndOpenShell());
workspaceDismissButton.addEventListener("click", () => void discardWorkspaceAndOpenShell());

window.addEventListener("keydown", (event) => {
  if (onboardingOpen) {
    if (event.key === "Tab") {
      return;
    }
    if (
      event.target instanceof HTMLSelectElement &&
      ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      moveOnboardingSelection(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      moveOnboardingSelection(-1);
    } else if (event.key === "Home") {
      selectedOnboardingChoice = onboardingChoices[0].id;
      renderOnboardingChoices(true);
    } else if (event.key === "End") {
      selectedOnboardingChoice = onboardingChoices.at(-1)!.id;
      renderOnboardingChoices(true);
    } else if (event.key === "Enter") {
      completeOnboarding(selectedOnboardingChoice);
    } else if (event.key === "Escape") {
      completeOnboarding("terminal");
    }
    return;
  }

  if (workspaceRecoveryOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      void discardWorkspaceAndOpenShell();
    }
    return;
  }
  if (commandOverlayOpen) {
    if (event.key === "Escape" && event.target !== commandSearch) {
      event.preventDefault();
      closeCommandOverlay();
    }
    return;
  }

  if (eventMatchesLeader(event)) {
    event.preventDefault();
    event.stopPropagation();
    openCommandOverlay();
    return;
  }

  if (storeOpen && event.key === "Escape") {
    event.preventDefault();
    closeSurface();
  }
}, true);

window.addEventListener("resize", scheduleResize);
window.addEventListener("beforeunload", () => {
  void saveWorkspaceNow();
  const sessionIds = new Set(frameSnapshot.tabs.flatMap((tab) => tab.panes.map((pane) => pane.session.id)));
  for (const id of sessionIds) {
    void invoke("close_session", { id });
  }
});

void listen<SessionExited>("session-exited", (event) => {
  supervisedSessionIds.delete(event.payload.id);
  void invoke<AgentSessionRecord | null>("agent_supervision_process_exited", {
    sessionId: event.payload.id,
  })
    .then((record) => {
      if (record) {
        replaceSupervisedSession(record);
      }
    })
    .catch(() => {
      // The terminal exit remains visible even if supervision metadata cannot be updated.
    });
  if (!paneForSession(event.payload.id)) {
    return;
  }
  writeToPane(event.payload.id, new TextEncoder().encode("\r\n\u001b[90m[session stopped]\u001b[0m\r\n"));
  if (event.payload.id === session?.id) {
    setTerminalStatus("stopped", "stopped");
  }
});

async function createInitialSession(preferredCwd: string | null): Promise<void> {
  const output = new Channel<Uint8Array>();
  const pendingOutput: Uint8Array[] = [];
  let outputSessionId: string | undefined;
  let sessionAccepted = false;
  output.onmessage = (chunk) => {
    if (sessionAccepted && outputSessionId) {
      writeToPane(outputSessionId, chunk);
    } else {
      pendingOutput.push(chunk);
    }
  };

  const request = frameRequest();
  if (preferredCwd) {
    request.cwd = preferredCwd;
  }
  const nextSnapshot = await invoke<FrameSnapshot>("frame_create_tab", {
    request,
    onOutput: output,
  });
  outputSessionId = nextSnapshot.focusedPaneId
    ? nextSnapshot.tabs
        .flatMap((tab) => tab.panes)
        .find((pane) => pane.id === nextSnapshot.focusedPaneId)?.session.id
    : undefined;
  renderFrame(nextSnapshot);
  sessionAccepted = true;
  for (const chunk of pendingOutput) {
    if (outputSessionId) {
      writeToPane(outputSessionId, chunk);
    }
  }
  terminalStarted = true;
  setTerminalStatus("ready", "ready");
  sendResize();
}

async function startSession(preferredCwd: string | null = null): Promise<void> {
  if (terminalStarted) {
    return;
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }

  terminalStartPromise = (async () => {
    try {
      await createInitialSession(preferredCwd);
    } catch (error) {
      if (preferredCwd) {
        writeLocalPreference(lastWorkspaceStorageKey, null);
        try {
          await createInitialSession(null);
          setTerminalStatus("terminal · last Workspace unavailable", "error");
          return;
        } catch (fallbackError) {
          showError(
            `Could not restore the last Workspace or start a terminal session: ${String(fallbackError)}`,
          );
          return;
        }
      }
      showError(`Could not start the terminal session: ${String(error)}`);
    } finally {
      terminalStartPromise = undefined;
    }
  })();

  return terminalStartPromise;
}

leaderHint.textContent = `Leader ${leaderLabel()}`;
void refreshAgentSupervision();
if (readLocalPreference(onboardingCompletedStorageKey) === "true") {
  openStartupBehavior();
} else {
  openOnboarding();
}
