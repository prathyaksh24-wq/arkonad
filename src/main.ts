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
  leaderChord?: string;
  agentPolicies?: Record<string, AgentPolicy>;
  overrides?: WorkspaceSettingsOverrides;
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

type IntegrationStrategy = "mergeNoFf" | "cherryPick";
type IntegrationStatus =
  | "preparing"
  | "ready"
  | "conflicted"
  | "previewing"
  | "validated"
  | "reworkRequested"
  | "setupFailed"
  | "published"
  | "abandoned";
type PreviewState = "starting" | "healthy" | "degraded" | "failed" | "stopped";

type IntegrationCommit = {
  hash: string;
  shortHash: string;
  subject: string;
};

type IntegrationCheck = {
  name: string;
  status: string;
  detail: string;
  url: string | null;
};

type IntegrationWorkstream = {
  taskId: string;
  taskSummary: string;
  agentName: string;
  repositoryRoot: string;
  baseBranch: string;
  taskBranch: string;
  sourceWorktreePath: string;
  sourceRevision: string;
  sourceDirty: boolean;
  changedPaths: string[];
  commits: IntegrationCommit[];
  checks: IntegrationCheck[];
  eligible: boolean;
  eligibilityDetail: string;
};

type IntegrationConflict = {
  path: string;
  workstreamIds: string[];
  reason: string;
};

type HealthCheck =
  | { kind: "none" }
  | { kind: "tcp"; host: string; port: number; timeoutMs?: number | null };

type RunProfileComponent = {
  id: string;
  name: string;
  executable: string;
  arguments: string[];
  cwd?: string | null;
  environment: Record<string, string>;
  port?: number | null;
  healthCheck: HealthCheck;
  dependsOn: string[];
};

type RunProfile = {
  id: string;
  name: string;
  entryPoint?: string | null;
  components: RunProfileComponent[];
  updatedAt?: string;
};

type ConnectedPreviewWorkstream = {
  taskId: string;
  label: string;
  branch: string;
  state: string;
};

type PreviewComponentState = {
  id: string;
  name: string;
  state: PreviewState;
  pid: number | null;
  port: number | null;
  logs: string;
  exitCode: number | null;
  healthDetail: string;
  startedAt: string | null;
};

type ConnectedPreview = {
  state: PreviewState;
  entryPoint: string | null;
  workstreams: ConnectedPreviewWorkstream[];
  components: PreviewComponentState[];
  lastCheckedAt: string | null;
  note: string;
};

type ValidationEvidence = {
  id: string;
  label: string;
  outcome: string;
  detail: string;
  recordedAt: string;
};

type ReworkDecision = {
  id: string;
  taskId: string | null;
  decision: string;
  detail: string;
  recordedAt: string;
};

type MergeReadiness = {
  userDecision: boolean | null;
  note: string;
  decidedAt: string | null;
};

type IntegrationCandidate = {
  id: string;
  repositoryRoot: string;
  targetBranch: string;
  targetRevision: string;
  integrationBranch: string;
  integrationWorktreeRoot: string;
  integrationWorktreePath: string;
  strategy: IntegrationStrategy;
  status: IntegrationStatus;
  selectedWorkstreams: IntegrationWorkstream[];
  conflicts: IntegrationConflict[];
  runProfile: RunProfile | null;
  preview: ConnectedPreview;
  validationEvidence: ValidationEvidence[];
  reworkDecisions: ReworkDecision[];
  mergeReadiness: MergeReadiness;
  strategyLog: string;
  errorMessage: string | null;
  worktreeCleaned: boolean;
  publishedRef: string | null;
  cleanupAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type IntegrationInspection = {
  repositoryRoot: string;
  targetBranch: string;
  targetRevision: string;
  integrationWorktreeRoot: string;
  strategy: IntegrationStrategy;
  selectedWorkstreams: IntegrationWorkstream[];
  likelyConflicts: IntegrationConflict[];
  blockers: string[];
  canCreate: boolean;
  inspectedAt: string;
};

type RepositoryStatus = "ready" | "unknown";
type RepositorySection =
  | "summary"
  | "changedFiles"
  | "commits"
  | "branches"
  | "worktrees"
  | "reviews"
  | "conflicts"
  | "cleanup";

type RepositoryChangedFile = {
  path: string;
  status: string;
  staged: boolean;
  changedInWorktree: boolean;
  untracked: boolean;
};

type RepositoryCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
};

type RepositoryBranch = {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
};

type RepositoryWorktree = {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  dirty: boolean;
  cleanupEligible: boolean;
  cleanupReason: string;
};

type RepositoryReview = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  headBranch: string;
  baseBranch: string;
  headSha: string | null;
};

type RepositoryCleanupCandidate = {
  id: string;
  kind: string;
  target: string;
  branch: string | null;
  dirty: boolean;
  allowed: boolean;
  reason: string;
};

type RepositoryRemote = {
  name: string;
  url: string;
};

type GitHubStatus = {
  available: boolean;
  authenticated: boolean;
  repository: string | null;
  message: string;
};

type RepositorySnapshot = {
  status: RepositoryStatus;
  repositoryRoot: string | null;
  repositoryName: string | null;
  branch: string | null;
  suggestedBaseBranch: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  attention: string[];
  changedFiles: RepositoryChangedFile[];
  commits: RepositoryCommit[];
  branches: RepositoryBranch[];
  worktrees: RepositoryWorktree[];
  reviews: RepositoryReview[];
  conflicts: string[];
  cleanupCandidates: RepositoryCleanupCandidate[];
  remotes: RepositoryRemote[];
  github: GitHubStatus;
  statusDetail: string;
  refreshedAt: string;
};

type RepositoryActionResult = {
  action: string;
  success: boolean;
  message: string;
  target: string;
  logs: string;
  snapshot: RepositorySnapshot | null;
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
type ThemeId = "ember" | "midnight" | "carbon" | "amber" | "phosphor" | "gruvbox" | "dracula" | "google84";
type PetId = "none" | "gengar" | "snorlax";
type MotionPreference = "system" | "reduced" | "full";
type TransparencyPreference = "solid" | "subtle" | "glass";
type AppUpdatePolicy = "review" | "notify" | "never";

type ShellProfile = {
  id: string;
  label: string;
  executable: string | null;
};

type SettingsDocument = {
  schemaVersion: number;
  leaderChord: string;
  startupSurface: StartupBehavior;
  defaultShellProfileId: string;
  shellProfiles: ShellProfile[];
  theme: ThemeId;
  pet: PetId;
  motion: MotionPreference;
  transparency: TransparencyPreference;
  fontScale: number;
  highContrast: boolean;
  screenReaderLabels: boolean;
  appUpdatePolicy: AppUpdatePolicy;
};

type WorkspaceSettingsOverrides = {
  leaderChord?: string;
  shellProfileId?: string;
  theme?: ThemeId;
  motion?: MotionPreference;
  transparency?: TransparencyPreference;
  fontScale?: number;
  highContrast?: boolean;
  screenReaderLabels?: boolean;
  appUpdatePolicy?: AppUpdatePolicy;
};

type SettingsLoadResult = {
  status: "ready" | "default" | "invalid";
  message: string;
  settings: SettingsDocument;
};

type SettingsValidationResult = {
  valid: boolean;
  message: string;
  settings: SettingsDocument | null;
};

type SettingsSection = "general" | "appearance" | "accessibility" | "shells" | "advanced";
type SettingsScope = "global" | "workspace";

type OnboardingChoiceId = "quick" | "custom" | "plain";

type OnboardingChoice = {
  id: OnboardingChoiceId;
  label: string;
  description: string;
  detail: string;
};

const onboardingChoices: OnboardingChoice[] = [
  {
    id: "quick",
    label: "Quick start",
    description: "Open the launcher and use tools Arkonad can already find.",
    detail: "Best default. Nothing is installed or connected automatically.",
  },
  {
    id: "custom",
    label: "Choose tools",
    description: "Browse all 32 Awesome TUI AI projects and Arkonad's extra tools.",
    detail: "Every install remains an explicit review and confirmation.",
  },
  {
    id: "plain",
    label: "Just the terminal",
    description: "Start a normal shell with no launcher in the way.",
    detail: "Open the launcher or Store later with the command palette.",
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
      return "launchpad";
  }
}

function startupBehaviorLabel(value: StartupBehavior): string {
  return startupBehaviorOptions.find((option) => option.value === value)?.label ?? "Terminal";
}

const defaultShellProfiles: ShellProfile[] = [
  { id: "auto", label: "System default", executable: null },
  { id: "powershell-7", label: "PowerShell 7", executable: "pwsh.exe" },
  { id: "windows-powershell", label: "Windows PowerShell", executable: "powershell.exe" },
  { id: "command-prompt", label: "Command Prompt", executable: "cmd.exe" },
  { id: "wsl", label: "WSL", executable: "wsl.exe" },
];

const themeOptions: Array<{ value: ThemeId; label: string; description: string }> = [
  { value: "ember", label: "Ember", description: "Near-black surfaces with a warm ember focus accent." },
  { value: "midnight", label: "Midnight", description: "Near-black surfaces with a cooler blue focus accent." },
  { value: "carbon", label: "Carbon", description: "Neutral graphite surfaces with a quiet green focus accent." },
  { value: "amber", label: "Amber", description: "Classic amber terminal text on black." },
  { value: "phosphor", label: "Phosphor", description: "Green phosphor terminal palette." },
  { value: "gruvbox", label: "Gruvbox", description: "Warm, muted retro terminal colors." },
  { value: "dracula", label: "Dracula", description: "Purple and cyan on charcoal." },
  { value: "google84", label: "Google 84", description: "Black terminal with primary-color accents." },
];

const motionOptions: Array<{ value: MotionPreference; label: string }> = [
  { value: "system", label: "Follow system preference" },
  { value: "reduced", label: "Reduce motion" },
  { value: "full", label: "Allow motion" },
];

const transparencyOptions: Array<{ value: TransparencyPreference; label: string }> = [
  { value: "solid", label: "Solid surfaces" },
  { value: "subtle", label: "Subtle transparency" },
  { value: "glass", label: "More transparency" },
];

const updatePolicyOptions: Array<{ value: AppUpdatePolicy; label: string; description: string }> = [
  { value: "review", label: "Review before update", description: "Show updates and require an explicit review before a command runs." },
  { value: "notify", label: "Notify only", description: "Show that an update exists without starting an update flow." },
  { value: "never", label: "Do not check automatically", description: "Only check for updates when you open My Apps." },
];

const settingsSectionMeta: Array<{ id: SettingsSection; label: string; summary: string }> = [
  { id: "general", label: "General", summary: "Leader, startup, and update policy" },
  { id: "appearance", label: "Appearance", summary: "Theme, motion, and transparency" },
  { id: "accessibility", label: "Accessibility", summary: "Contrast, text scale, and labels" },
  { id: "shells", label: "Shell profiles", summary: "Choose and edit launchable shells" },
  { id: "advanced", label: "Advanced config", summary: "Inspect, validate, import, or export JSON" },
];

function defaultSettings(): SettingsDocument {
  return {
    schemaVersion: 1,
    leaderChord: "ctrl+space",
    startupSurface: "launchpad",
    defaultShellProfileId: "auto",
    shellProfiles: defaultShellProfiles.map((profile) => ({ ...profile })),
    theme: "ember",
    pet: "none",
    motion: "system",
    transparency: "solid",
    fontScale: 1,
    highContrast: false,
    screenReaderLabels: true,
    appUpdatePolicy: "review",
  };
}

function normalizeTheme(value: unknown): ThemeId {
  return value === "midnight" || value === "carbon" || value === "amber"
    || value === "phosphor" || value === "gruvbox" || value === "dracula"
    || value === "google84" ? value : "ember";
}

function normalizePet(value: unknown): PetId {
  return value === "gengar" || value === "snorlax" ? value : "none";
}

function normalizeMotion(value: unknown): MotionPreference {
  return value === "reduced" || value === "full" ? value : "system";
}

function normalizeTransparency(value: unknown): TransparencyPreference {
  return value === "subtle" || value === "glass" ? value : "solid";
}

function normalizeUpdatePolicy(value: unknown): AppUpdatePolicy {
  return value === "notify" || value === "never" ? value : "review";
}

function normalizeShellProfiles(value: unknown): ShellProfile[] {
  if (!Array.isArray(value)) {
    return defaultShellProfiles.map((profile) => ({ ...profile }));
  }
  const profiles = value
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object"))
    .map((candidate) => ({
      id: typeof candidate.id === "string" ? candidate.id.trim() : "",
      label: typeof candidate.label === "string" ? candidate.label.trim() : "",
      executable: typeof candidate.executable === "string" && candidate.executable.trim()
        ? candidate.executable.trim()
        : null,
    }))
    .filter((profile) => profile.id.length > 0 && profile.label.length > 0)
    .filter((profile, index, all) => all.findIndex((candidate) => candidate.id === profile.id) === index);
  return profiles.length > 0 ? profiles : defaultShellProfiles.map((profile) => ({ ...profile }));
}

function normalizeSettings(value: unknown): SettingsDocument {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const candidate = value as Partial<SettingsDocument>;
  const shellProfiles = normalizeShellProfiles(candidate.shellProfiles);
  const defaultShellProfileId = typeof candidate.defaultShellProfileId === "string"
    && shellProfiles.some((profile) => profile.id === candidate.defaultShellProfileId)
    ? candidate.defaultShellProfileId
    : shellProfiles[0].id;
  const fontScale = typeof candidate.fontScale === "number" && Number.isFinite(candidate.fontScale)
    ? Math.min(1.5, Math.max(0.8, candidate.fontScale))
    : defaults.fontScale;
  return {
    schemaVersion: 1,
    leaderChord: typeof candidate.leaderChord === "string" && candidate.leaderChord.trim()
      ? normalizedLeader(candidate.leaderChord)
      : defaults.leaderChord,
    startupSurface: startupBehaviorOptions.some((option) => option.value === candidate.startupSurface)
      ? candidate.startupSurface as StartupBehavior
      : defaults.startupSurface,
    defaultShellProfileId,
    shellProfiles,
    theme: normalizeTheme(candidate.theme),
    pet: normalizePet(candidate.pet),
    motion: normalizeMotion(candidate.motion),
    transparency: normalizeTransparency(candidate.transparency),
    fontScale,
    highContrast: candidate.highContrast === true,
    screenReaderLabels: candidate.screenReaderLabels !== false,
    appUpdatePolicy: normalizeUpdatePolicy(candidate.appUpdatePolicy),
  };
}

function normalizeWorkspaceOverrides(value: unknown): WorkspaceSettingsOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const candidate = value as WorkspaceSettingsOverrides;
  const overrides: WorkspaceSettingsOverrides = {};
  if (typeof candidate.leaderChord === "string" && candidate.leaderChord.trim()) {
    overrides.leaderChord = normalizedLeader(candidate.leaderChord);
  }
  if (typeof candidate.shellProfileId === "string" && candidate.shellProfileId.trim()) {
    overrides.shellProfileId = candidate.shellProfileId.trim();
  }
  if (candidate.theme === "ember" || candidate.theme === "midnight" || candidate.theme === "carbon") {
    overrides.theme = candidate.theme;
  }
  if (candidate.motion === "system" || candidate.motion === "reduced" || candidate.motion === "full") {
    overrides.motion = candidate.motion;
  }
  if (candidate.transparency === "solid" || candidate.transparency === "subtle" || candidate.transparency === "glass") {
    overrides.transparency = candidate.transparency;
  }
  if (typeof candidate.fontScale === "number" && Number.isFinite(candidate.fontScale)) {
    overrides.fontScale = Math.min(1.5, Math.max(0.8, candidate.fontScale));
  }
  if (typeof candidate.highContrast === "boolean") overrides.highContrast = candidate.highContrast;
  if (typeof candidate.screenReaderLabels === "boolean") overrides.screenReaderLabels = candidate.screenReaderLabels;
  if (candidate.appUpdatePolicy === "review" || candidate.appUpdatePolicy === "notify" || candidate.appUpdatePolicy === "never") {
    overrides.appUpdatePolicy = candidate.appUpdatePolicy;
  }
  return overrides;
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
      <button class="topbar-action repository-indicator" type="button" data-repository-open aria-label="Repository controls" aria-expanded="false">
        Repo <span class="repository-indicator-value" data-repository-indicator>no repository</span>
        <span class="attention-badge" data-repository-attention hidden aria-live="polite"></span>
      </button>
      <button class="topbar-action" type="button" data-launchpad-open aria-label="Launchpad" aria-expanded="false">
        Launchpad <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-store-open aria-label="Terminal App Store" aria-expanded="false">
        Store <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-apps-open aria-label="My Apps" aria-expanded="false">
        My Apps <span class="apps-update-badge" data-apps-update-badge hidden aria-live="polite"></span>
        <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-agents-open aria-label="Coding agents" aria-expanded="false">
        Agents <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-tasks-open aria-label="Agent Tasks" aria-expanded="false">
        Tasks <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-integration-open aria-label="Connected Preview" aria-expanded="false">
        Preview <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-attention-open aria-label="Attention Queue" aria-expanded="false">
        Attention <span class="attention-badge" data-attention-badge hidden aria-live="polite"></span>
        <span class="key-hint">palette</span>
      </button>
      <button class="topbar-action" type="button" data-settings-open aria-expanded="false" aria-label="Settings">
        Settings <span class="key-hint">palette</span>
      </button>
      <div class="status" data-status role="status" aria-live="polite">connecting</div>
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
            <span class="store-eyebrow">ARKONAD // FIRST RUN</span>
            <h1 id="onboarding-title">Your terminal, with more doors.</h1>
            <p id="onboarding-description">
              Use ↑↓ and Enter. Arkonad runs shells and third-party TUIs in real terminal sessions; this step changes no files and connects no accounts.
            </p>
          </header>
          <div class="onboarding-content">
            <section class="onboarding-choice-panel" aria-labelledby="onboarding-choice-heading">
              <div class="onboarding-panel-heading">
                <span id="onboarding-choice-heading">How should we begin?</span>
                <span class="onboarding-panel-hint">↑↓ move // Enter select</span>
              </div>
              <div
                class="onboarding-options"
                data-onboarding-options
                role="listbox"
                aria-label="First-run choices"
              ></div>
            </section>
            <section class="onboarding-preferences" aria-labelledby="onboarding-preferences-heading" hidden>
              <span class="store-eyebrow" id="onboarding-preferences-heading">STARTUP</span>
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
            <span>↑↓ move</span>
            <span>Enter select</span>
            <span>Esc plain terminal</span>
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
            <span class="store-eyebrow">ARKONAD // STORE</span>
            <span class="store-title">32 Awesome TUI AI projects + Arkonad tools</span>
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
      <section class="store-shell integration-view" data-integration-view hidden aria-label="Connected Preview">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">CONNECTED PREVIEW</span>
            <span class="store-title">Combine workstreams before merge</span>
          </div>
          <button class="detail-action" type="button" data-integration-refresh>Refresh</button>
          <button class="store-close" type="button" data-integration-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-integration-notice>
          Select completed Agent Tasks, inspect their bases and checks, then create a separate Integration Worktree.
        </div>
        <div class="store-content integration-content">
          <section class="store-list-panel" aria-label="Integration workstreams and candidates">
            <div class="store-list-header">
              <span>Workstreams</span>
              <span data-integration-count>loading…</span>
            </div>
            <div class="store-list integration-workstreams" data-integration-workstreams role="listbox" aria-label="Integration workstreams"></div>
            <div class="store-list-header integration-candidates-heading">
              <span>Integration candidates</span>
              <span data-integration-candidate-count>0</span>
            </div>
            <div class="store-list integration-candidates" data-integration-candidates role="listbox" aria-label="Integration candidates"></div>
          </section>
          <article class="store-detail integration-detail" data-integration-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ choose</span>
          <span>Enter select or inspect</span>
          <span>Processes never start implicitly</span>
          <span>Esc · terminal</span>
        </div>
      </section>
      <section class="store-shell settings-view" data-settings-view hidden aria-label="Settings">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">ARKONAD SETTINGS</span>
            <span class="store-title">Keep the Frame simple; leave hosted tools native</span>
          </div>
          <label class="store-control settings-scope-control">
            <span>Apply to</span>
            <select data-settings-scope aria-label="Settings scope">
              <option value="global">All Workspaces</option>
              <option value="workspace">This Workspace</option>
            </select>
          </label>
          <button class="store-close" type="button" data-settings-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-settings-notice role="status" aria-live="polite">Settings load before a new Session starts.</div>
        <div class="store-content settings-content">
          <section class="store-list-panel" aria-label="Settings sections">
            <div class="store-list-header">
              <span>Settings</span>
              <span data-settings-count>5 sections</span>
            </div>
            <div class="store-list settings-sections" data-settings-sections role="listbox" aria-label="Settings sections"></div>
          </section>
          <article class="store-detail settings-detail" data-settings-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ choose section</span>
          <span>Enter inspect</span>
          <span>Changes save explicitly</span>
          <span>Esc terminal</span>
        </div>
      </section>
      <section class="store-shell repository-view" data-repository-view hidden aria-label="Repository View">
        <div class="store-toolbar">
          <div class="store-heading">
            <span class="store-eyebrow">REPOSITORY VIEW</span>
            <span class="store-title" data-repository-title>Repository status</span>
          </div>
          <button class="detail-action" type="button" data-repository-refresh>Refresh</button>
          <button class="store-close" type="button" data-repository-close>Esc · terminal</button>
        </div>
        <div class="store-notice" data-repository-notice>
          Git status is read-only until you choose an exact action.
        </div>
        <div class="store-content repository-content">
          <section class="store-list-panel" aria-label="Repository sections">
            <div class="store-list-header">
              <span>Repository</span>
              <span data-repository-count>loading…</span>
            </div>
            <div class="store-list repository-sections" data-repository-sections role="listbox" aria-label="Repository sections"></div>
          </section>
          <article class="store-detail repository-detail" data-repository-detail aria-live="polite"></article>
        </div>
        <div class="store-footer">
          <span>↑↓ choose section</span>
          <span>Enter inspect</span>
          <span>GitHub actions are explicit</span>
          <span>Esc terminal</span>
        </div>
      </section>
      <section class="repository-quick-menu" data-repository-quick hidden role="dialog" aria-modal="true" aria-labelledby="repository-quick-title">
        <div class="repository-quick-card">
          <div class="command-heading">
            <div>
              <span class="store-eyebrow">REPOSITORY</span>
              <span class="store-title" id="repository-quick-title">Focused checkout</span>
            </div>
            <button class="store-close" type="button" data-repository-quick-close>Esc · close</button>
          </div>
          <div data-repository-quick-content></div>
        </div>
      </section>
    </main>
    <footer class="bottombar">
      <span>Leader opens commands</span>
      <span>Palette: Launch App</span>
      <span>Palette: Store</span>
      <span>Palette: My Apps</span>
      <span>Palette: Agent Tasks</span>
      <span>Palette: Connected Preview</span>
      <span>Palette: Repository</span>
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
const repositoryOpenButton = app.querySelector<HTMLButtonElement>("[data-repository-open]")!;
const repositoryIndicator = app.querySelector<HTMLSpanElement>("[data-repository-indicator]")!;
const repositoryAttention = app.querySelector<HTMLSpanElement>("[data-repository-attention]")!;
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
const integrationOpenButton = app.querySelector<HTMLButtonElement>("[data-integration-open]")!;
const attentionOpenButton = app.querySelector<HTMLButtonElement>("[data-attention-open]")!;
const settingsOpenButton = app.querySelector<HTMLButtonElement>("[data-settings-open]")!;
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
const integrationView = app.querySelector<HTMLElement>("[data-integration-view]")!;
const integrationRefreshButton = app.querySelector<HTMLButtonElement>("[data-integration-refresh]")!;
const integrationCloseButton = app.querySelector<HTMLButtonElement>("[data-integration-close]")!;
const integrationNotice = app.querySelector<HTMLDivElement>("[data-integration-notice]")!;
const integrationCount = app.querySelector<HTMLSpanElement>("[data-integration-count]")!;
const integrationWorkstreams = app.querySelector<HTMLDivElement>("[data-integration-workstreams]")!;
const integrationCandidateCount = app.querySelector<HTMLSpanElement>("[data-integration-candidate-count]")!;
const integrationCandidates = app.querySelector<HTMLDivElement>("[data-integration-candidates]")!;
const integrationDetail = app.querySelector<HTMLElement>("[data-integration-detail]")!;
const repositoryView = app.querySelector<HTMLElement>("[data-repository-view]")!;
const repositoryTitle = app.querySelector<HTMLSpanElement>("[data-repository-title]")!;
const repositoryRefreshButton = app.querySelector<HTMLButtonElement>("[data-repository-refresh]")!;
const repositoryCloseButton = app.querySelector<HTMLButtonElement>("[data-repository-close]")!;
const repositoryNotice = app.querySelector<HTMLDivElement>("[data-repository-notice]")!;
const repositoryCount = app.querySelector<HTMLSpanElement>("[data-repository-count]")!;
const repositorySections = app.querySelector<HTMLDivElement>("[data-repository-sections]")!;
const repositoryDetail = app.querySelector<HTMLElement>("[data-repository-detail]")!;
const repositoryQuick = app.querySelector<HTMLElement>("[data-repository-quick]")!;
const repositoryQuickCloseButton = app.querySelector<HTMLButtonElement>("[data-repository-quick-close]")!;
const repositoryQuickContent = app.querySelector<HTMLElement>("[data-repository-quick-content]")!;
const attentionView = app.querySelector<HTMLElement>("[data-attention-view]")!;
const attentionCloseButton = app.querySelector<HTMLButtonElement>("[data-attention-close]")!;
const attentionSearch = app.querySelector<HTMLInputElement>("[data-attention-search]")!;
const attentionNotice = app.querySelector<HTMLDivElement>("[data-attention-notice]")!;
const attentionCount = app.querySelector<HTMLSpanElement>("[data-attention-count]")!;
const attentionList = app.querySelector<HTMLDivElement>("[data-attention-list]")!;
const attentionError = app.querySelector<HTMLDivElement>("[data-attention-error]")!;
const attentionDetail = app.querySelector<HTMLElement>("[data-attention-detail]")!;
const settingsView = app.querySelector<HTMLElement>("[data-settings-view]")!;
const settingsCloseButton = app.querySelector<HTMLButtonElement>("[data-settings-close]")!;
const settingsScope = app.querySelector<HTMLSelectElement>("[data-settings-scope]")!;
const settingsNotice = app.querySelector<HTMLDivElement>("[data-settings-notice]")!;
const settingsSections = app.querySelector<HTMLDivElement>("[data-settings-sections]")!;
const settingsDetail = app.querySelector<HTMLElement>("[data-settings-detail]")!;
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
  !repositoryOpenButton ||
  !repositoryIndicator ||
  !repositoryAttention ||
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
  !integrationOpenButton ||
  !attentionOpenButton ||
  !settingsOpenButton ||
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
  !integrationView ||
  !integrationRefreshButton ||
  !integrationCloseButton ||
  !integrationNotice ||
  !integrationCount ||
  !integrationWorkstreams ||
  !integrationCandidateCount ||
  !integrationCandidates ||
  !integrationDetail ||
  !repositoryView ||
  !repositoryTitle ||
  !repositoryRefreshButton ||
  !repositoryCloseButton ||
  !repositoryNotice ||
  !repositoryCount ||
  !repositorySections ||
  !repositoryDetail ||
  !repositoryQuick ||
  !repositoryQuickCloseButton ||
  !repositoryQuickContent ||
  !attentionView ||
  !attentionCloseButton ||
  !attentionSearch ||
  !attentionNotice ||
  !attentionCount ||
  !attentionList ||
  !attentionError ||
  !attentionDetail ||
  !settingsView ||
  !settingsCloseButton ||
  !settingsScope ||
  !settingsNotice ||
  !settingsSections ||
  !settingsDetail ||
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
let activeSurface: "launchpad" | "store" | "apps" | "agents" | "tasks" | "integration" | "repository" | "attention" | "settings" = "launchpad";
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
let integrationTasks: AgentTask[] = [];
let integrationCandidatesState: IntegrationCandidate[] = [];
let selectedIntegrationTaskIds = new Set<string>();
let selectedIntegrationCandidateId: string | undefined;
let integrationInspection: IntegrationInspection | undefined;
let integrationRequestId = 0;
let integrationBusy = false;
let integrationTargetBranch = "";
let integrationWorktreeRoot = "";
let integrationStrategy: IntegrationStrategy = "mergeNoFf";
let repositorySnapshot: RepositorySnapshot | undefined;
let selectedRepositorySection: RepositorySection = "summary";
let repositoryRequestId = 0;
let repositoryRefreshTimer: number | undefined;
let repositoryQuickOpen = false;
let repositoryActionBusy = false;
let repositoryNoticeOverride = "";
let lastRepositoryPath = "";
let agentSupervision: AgentSupervisionSnapshot = { sessions: [], adapters: [] };
let selectedSupervisionId: string | undefined;
let attentionRequestId = 0;
const supervisedSessionIds = new Set<string>();
const agentObservationBuffers = new Map<string, string>();
const agentObservationTimers = new Map<string, number>();
const launchedReturnTabs = new Map<string, string | null>();
let commandOverlayOpen = false;
let selectedCommandId: string | undefined;
let pendingClose: "pane" | "tab" | undefined;
let onboardingOpen = false;
let selectedOnboardingChoice: OnboardingChoiceId = "quick";
let globalSettings: SettingsDocument = defaultSettings();
let workspaceSettingsOverrides: WorkspaceSettingsOverrides = {};
let settingsLoaded = false;
let settingsLoading = false;
let settingsSection: SettingsSection = "general";
let settingsScopeValue: SettingsScope = "global";
let settingsConfigText = "";
let settingsImportInput: HTMLInputElement | undefined;
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

function effectiveSettings(): SettingsDocument {
  const overrides = workspaceSettingsOverrides;
  const settings = {
    ...globalSettings,
    leaderChord: overrides.leaderChord ?? globalSettings.leaderChord,
    defaultShellProfileId: overrides.shellProfileId ?? globalSettings.defaultShellProfileId,
    theme: overrides.theme ?? globalSettings.theme,
    motion: overrides.motion ?? globalSettings.motion,
    transparency: overrides.transparency ?? globalSettings.transparency,
    fontScale: overrides.fontScale ?? globalSettings.fontScale,
    highContrast: overrides.highContrast ?? globalSettings.highContrast,
    screenReaderLabels: overrides.screenReaderLabels ?? globalSettings.screenReaderLabels,
    appUpdatePolicy: overrides.appUpdatePolicy ?? globalSettings.appUpdatePolicy,
  };
  if (!settings.shellProfiles.some((profile) => profile.id === settings.defaultShellProfileId)) {
    settings.defaultShellProfileId = globalSettings.defaultShellProfileId;
  }
  return settings;
}

function effectiveShellProfile(): ShellProfile | undefined {
  const settings = effectiveSettings();
  return settings.shellProfiles.find((profile) => profile.id === settings.defaultShellProfileId)
    ?? settings.shellProfiles[0];
}

function applySettingsToFrame(): void {
  const settings = effectiveSettings();
  leaderChord = normalizedLeader(settings.leaderChord);
  startupBehavior = settings.startupSurface;
  leaderHint.textContent = `Leader ${leaderLabel()}`;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.motion = settings.motion;
  document.documentElement.dataset.transparency = settings.transparency;
  document.documentElement.dataset.highContrast = String(settings.highContrast);
  document.documentElement.dataset.screenReaderLabels = String(settings.screenReaderLabels);
  document.documentElement.style.setProperty("--arkonad-font-scale", String(settings.fontScale));
  for (const runtime of paneRuntimes.values()) {
    runtime.terminal.options.fontSize = Math.round(14 * settings.fontScale);
    runtime.terminal.options.theme = terminalTheme(settings);
    const label = settings.screenReaderLabels
      ? `${runtime.pane.session.shell} terminal session in ${runtime.pane.session.cwd}`
      : `${runtime.pane.session.shell} terminal`;
    runtime.host.setAttribute("aria-label", label);
    runtime.terminalHost.setAttribute("aria-label", label);
  }
  scheduleResize();
}

function terminalTheme(settings: SettingsDocument): Record<string, string> {
  const palettes: Partial<Record<ThemeId, Record<string, string>>> = {
    ember: {
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
    midnight: {
      background: "#080d14",
      foreground: "#e1e9f3",
      cursor: "#83b8ff",
      cursorAccent: "#080d14",
      selectionBackground: "#263b52",
      black: "#080d14",
      red: "#ff8e8e",
      green: "#9ed6b0",
      yellow: "#f5d58b",
      blue: "#83b8ff",
      magenta: "#d0b7ff",
      cyan: "#7bd7d1",
      white: "#e1e9f3",
      brightBlack: "#718197",
      brightWhite: "#ffffff",
    },
    carbon: {
      background: "#0b0d0c",
      foreground: "#e5ebe5",
      cursor: "#9ed67a",
      cursorAccent: "#0b0d0c",
      selectionBackground: "#334439",
      black: "#0b0d0c",
      red: "#ff8b7f",
      green: "#9ed67a",
      yellow: "#d8d58b",
      blue: "#9eb8d6",
      magenta: "#d2b7d6",
      cyan: "#9bd1c3",
      white: "#e5ebe5",
      brightBlack: "#748078",
      brightWhite: "#ffffff",
    },
  };
  return palettes[settings.theme] ?? palettes.ember!;
}

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
  scheduleRepositoryRefresh();
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
  repositoryOpenButton.disabled = disabled;
  launchpadOpenButton.disabled = disabled;
  storeOpenButton.disabled = disabled;
  appsOpenButton.disabled = disabled;
  agentsOpenButton.disabled = disabled;
  tasksOpenButton.disabled = disabled;
  integrationOpenButton.disabled = disabled;
  attentionOpenButton.disabled = disabled;
  settingsOpenButton.disabled = disabled;
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
  globalSettings.startupSurface = startupBehavior;
  writeLocalPreference(startupBehaviorStorageKey, startupBehavior);
  writeLocalPreference(onboardingCompletedStorageKey, "true");
  if (settingsLoaded) {
    void invoke("settings_save", { request: { settings: globalSettings } }).catch(() => {
      // The legacy local preference keeps startup behavior available if persistence is unavailable.
    });
  }
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
  onboardingStartup.value = choiceId === "plain" ? "terminal" : "launchpad";
  saveOnboardingPreferences();
  closeOnboarding();
  refreshWorkspaceMetadata();

  switch (choiceId) {
    case "custom":
      openStore("");
      break;
    case "quick":
      openLaunchpad();
      break;
    default:
      void startSession();
      break;
  }
}

function openOnboarding(): void {
  hideSettingsSurface();
  onboardingOpen = true;
  onboardingScreen.hidden = false;
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  integrationView.hidden = true;
  hideSettingsSurface();
  repositoryView.hidden = true;
  attentionView.hidden = true;
  closeRepositoryQuickMenu();
  storeOpen = false;
  setTopbarActionsDisabled(true);
  sessionMeta.textContent = "first run";
  status.textContent = "onboarding";
  status.dataset.state = "ready";
  onboardingStartup.value = startupBehavior;
  selectedOnboardingChoice = "quick";
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
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", `${pane.session.shell} terminal session`);

  const header = makeElement("div", "pane-header");
  header.append(makeElement("span", "pane-title", pane.session.shell));
  header.append(makeElement("span", "pane-cwd", pane.session.cwd));

  const terminalHost = makeElement("div", "terminal") as HTMLDivElement;
  terminalHost.setAttribute("role", "application");
  terminalHost.setAttribute("aria-label", `Terminal session in ${pane.session.cwd}`);
  host.append(header, terminalHost);

  const settings = effectiveSettings();
  const terminal = new Terminal({
    allowProposedApi: false,
    convertEol: false,
    cursorBlink: true,
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: Math.round(14 * settings.fontScale),
    scrollback: 10_000,
    theme: terminalTheme(settings),
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
  closeCommandOverlay();
  openSettings();
}

function settingsDraftForScope(): SettingsDocument {
  return normalizeSettings(settingsScopeValue === "workspace" ? effectiveSettings() : globalSettings);
}

function settingsFieldLabel(label: string, control: HTMLElement, className = "settings-field"): HTMLLabelElement {
  const field = makeElement("label", className) as HTMLLabelElement;
  field.append(makeElement("span", undefined, label), control);
  return field;
}

function settingsSelect(
  label: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  disabled = false,
): HTMLLabelElement {
  const select = makeElement("select") as HTMLSelectElement;
  select.setAttribute("aria-label", label);
  select.disabled = disabled;
  for (const option of options) {
    const element = makeElement("option") as HTMLOptionElement;
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === value;
    select.append(element);
  }
  const field = settingsFieldLabel(label, select);
  field.dataset.settingsField = label;
  return field;
}

function settingsDescription(parent: HTMLElement, title: string, description: string): void {
  parent.append(makeElement("h2", "settings-detail-title", title));
  parent.append(makeElement("p", "settings-detail-description", description));
}

async function commitSettingsDraft(draft: SettingsDocument): Promise<void> {
  if (settingsScopeValue === "workspace") {
    if (!activeWorkspaceId) {
      settingsNotice.textContent = "Open or save a Workspace before storing a Workspace override.";
      return;
    }
    workspaceSettingsOverrides = {
      leaderChord: normalizedLeader(draft.leaderChord),
      shellProfileId: draft.defaultShellProfileId,
      theme: draft.theme,
      motion: draft.motion,
      transparency: draft.transparency,
      fontScale: draft.fontScale,
      highContrast: draft.highContrast,
      screenReaderLabels: draft.screenReaderLabels,
      appUpdatePolicy: draft.appUpdatePolicy,
    };
    applySettingsToFrame();
    scheduleWorkspaceSave();
    settingsNotice.textContent = `Saved overrides for ${activeWorkspaceName}. Global settings were not changed.`;
    renderSettingsSection();
    return;
  }

  try {
    const saved = await invoke<SettingsDocument>("settings_save", { request: { settings: draft } });
    globalSettings = normalizeSettings(saved);
    settingsConfigText = JSON.stringify(globalSettings, null, 2);
    writeLocalPreference(leaderStorageKey, globalSettings.leaderChord);
    writeLocalPreference(startupBehaviorStorageKey, globalSettings.startupSurface);
    applySettingsToFrame();
    settingsNotice.textContent = "Global settings saved. Existing Sessions keep their launch snapshot.";
    renderSettingsSection();
  } catch (error) {
    settingsNotice.textContent = `Settings were not saved: ${String(error)}`;
  }
}

function renderSettingsGeneral(): void {
  const draft = settingsDraftForScope();
  settingsDescription(
    settingsDetail,
    "General",
    settingsScopeValue === "workspace"
      ? "These values apply only while the active Workspace is open. Startup surface remains a global choice."
      : "Set the small group of choices that control how Arkonad opens and how it asks before app updates.",
  );
  const form = makeElement("div", "settings-form");
  const leader = makeElement("input") as HTMLInputElement;
  leader.type = "text";
  leader.value = draft.leaderChord;
  leader.placeholder = "ctrl+space";
  leader.setAttribute("aria-label", "Arkonad Leader chord");
  form.append(settingsFieldLabel("Arkonad Leader chord", leader));

  const startup = settingsSelect(
    "Startup surface",
    draft.startupSurface,
    startupBehaviorOptions,
    settingsScopeValue === "workspace",
  );
  form.append(startup);
  const update = settingsSelect("App update policy", draft.appUpdatePolicy, updatePolicyOptions);
  form.append(update);
  form.append(makeElement(
    "p",
    "settings-help",
    "Arkonad never installs or updates a Catalog Tool silently. Hosted tools keep their own sign-in and update behavior.",
  ));
  form.append(createInstallButton("Save General settings", () => {
    const next = { ...draft };
    next.leaderChord = normalizedLeader(leader.value);
    next.startupSurface = parseStartupBehavior((startup.querySelector("select") as HTMLSelectElement).value);
    next.appUpdatePolicy = normalizeUpdatePolicy((update.querySelector("select") as HTMLSelectElement).value);
    void commitSettingsDraft(next);
  }));
  settingsDetail.append(form);
}

function renderSettingsAppearance(): void {
  const draft = settingsDraftForScope();
  settingsDescription(
    settingsDetail,
    "Appearance",
    "Themes apply to the Arkonad Frame, status controls, dialogs, and terminal renderer. Hosted Catalog Tools retain their native appearance.",
  );
  const form = makeElement("div", "settings-form");
  const theme = settingsSelect("Theme", draft.theme, themeOptions);
  const motion = settingsSelect("Motion", draft.motion, motionOptions);
  const transparency = settingsSelect("Transparency", draft.transparency, transparencyOptions);
  form.append(theme, motion, transparency);
  form.append(createInstallButton("Save Appearance settings", () => {
    const next = { ...draft };
    next.theme = normalizeTheme((theme.querySelector("select") as HTMLSelectElement).value);
    next.motion = normalizeMotion((motion.querySelector("select") as HTMLSelectElement).value);
    next.transparency = normalizeTransparency((transparency.querySelector("select") as HTMLSelectElement).value);
    void commitSettingsDraft(next);
  }));
  settingsDetail.append(form);
}

function renderSettingsAccessibility(): void {
  const draft = settingsDraftForScope();
  settingsDescription(
    settingsDetail,
    "Accessibility",
    "These controls change Arkonad-owned surfaces and host labels. Native tool output is not rewritten or restyled by Arkonad.",
  );
  const form = makeElement("div", "settings-form");
  const scale = settingsSelect(
    "Font scale",
    String(draft.fontScale),
    [0.8, 0.9, 1, 1.1, 1.25, 1.5].map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` })),
  );
  form.append(scale);
  const contrast = makeElement("input") as HTMLInputElement;
  contrast.type = "checkbox";
  contrast.checked = draft.highContrast;
  contrast.setAttribute("aria-label", "High contrast mode");
  const contrastLabel = makeElement("label", "settings-check") as HTMLLabelElement;
  contrastLabel.append(contrast, makeElement("span", undefined, "High contrast host controls"));
  form.append(contrastLabel);
  const labels = makeElement("input") as HTMLInputElement;
  labels.type = "checkbox";
  labels.checked = draft.screenReaderLabels;
  labels.setAttribute("aria-label", "Verbose screen-reader labels");
  const labelsLabel = makeElement("label", "settings-check") as HTMLLabelElement;
  labelsLabel.append(labels, makeElement("span", undefined, "Use descriptive labels for host controls"));
  form.append(labelsLabel);
  form.append(makeElement(
    "p",
    "settings-help",
    "Visible focus remains on keyboard controls in every mode. Reduced motion also follows the operating system when Motion is set to System.",
  ));
  form.append(createInstallButton("Save Accessibility settings", () => {
    const next = { ...draft };
    next.fontScale = Number((scale.querySelector("select") as HTMLSelectElement).value);
    next.highContrast = contrast.checked;
    next.screenReaderLabels = labels.checked;
    void commitSettingsDraft(next);
  }));
  settingsDetail.append(form);
}

function renderSettingsShells(): void {
  const draft = settingsDraftForScope();
  settingsDescription(
    settingsDetail,
    "Shell profiles",
    settingsScopeValue === "workspace"
      ? "Choose a different shell for this Workspace. Profile definitions remain global so a Workspace cannot silently invent a command."
      : "Choose the shell for new Sessions and keep explicit profiles for PowerShell, CMD, WSL, or another declared executable.",
  );
  const form = makeElement("div", "settings-form");
  const defaultShell = settingsSelect(
    "Default shell",
    draft.defaultShellProfileId,
    draft.shellProfiles.map((profile) => ({ value: profile.id, label: `${profile.label} · ${profile.executable ?? "auto-detect"}` })),
  );
  form.append(defaultShell);
  const profileList = makeElement("div", "settings-profile-list");
  const profileInputs: Array<{ label: HTMLInputElement; executable: HTMLInputElement }> = [];
  for (const profile of draft.shellProfiles) {
    const row = makeElement("div", "settings-profile-row");
    const id = makeElement("input") as HTMLInputElement;
    id.value = profile.id;
    id.disabled = true;
    id.setAttribute("aria-label", `${profile.label} profile id`);
    const label = makeElement("input") as HTMLInputElement;
    label.value = profile.label;
    label.disabled = settingsScopeValue === "workspace";
    label.setAttribute("aria-label", `${profile.label} display name`);
    const executable = makeElement("input") as HTMLInputElement;
    executable.value = profile.executable ?? "";
    executable.placeholder = "auto-detect when empty";
    executable.disabled = settingsScopeValue === "workspace";
    executable.setAttribute("aria-label", `${profile.label} executable`);
    row.append(
      settingsFieldLabel("ID", id, "settings-profile-field"),
      settingsFieldLabel("Label", label, "settings-profile-field"),
      settingsFieldLabel("Executable", executable, "settings-profile-field"),
    );
    profileList.append(row);
    profileInputs.push({ label, executable });
  }
  form.append(profileList);
  if (settingsScopeValue === "global") {
    form.append(createInstallButton("Add shell profile", () => {
      draft.shellProfiles.push({ id: `shell-${Date.now()}`, label: "Custom shell", executable: "" });
      renderSettingsSection();
    }));
  } else {
    form.append(makeElement("p", "settings-help", "Edit profile definitions from the All Workspaces scope or Advanced config."));
  }
  form.append(createInstallButton("Save Shell settings", () => {
    const next = {
      ...draft,
      shellProfiles: draft.shellProfiles.map((profile, index) => ({
        ...profile,
        label: profileInputs[index].label.value.trim() || profile.label,
        executable: profileInputs[index].executable.value.trim() || null,
      })),
      defaultShellProfileId: (defaultShell.querySelector("select") as HTMLSelectElement).value,
    };
    void commitSettingsDraft(next);
  }));
  settingsDetail.append(form);
}

function downloadSettings(contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "arkonad-settings.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderSettingsAdvanced(): void {
  settingsDescription(
    settingsDetail,
    "Advanced config",
    "This is the human-readable global settings file. Validate changes before applying them; invalid imports leave the saved file and current settings unchanged.",
  );
  const editor = makeElement("textarea", "settings-config-editor") as HTMLTextAreaElement;
  editor.rows = 24;
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Arkonad settings JSON");
  editor.value = settingsConfigText || JSON.stringify(globalSettings, null, 2);
  editor.addEventListener("input", () => {
    settingsConfigText = editor.value;
  });
  settingsDetail.append(editor);
  const actions = makeElement("div", "install-button-row");
  actions.append(
    createInstallButton("Validate JSON", () => {
      void invoke<SettingsValidationResult>("settings_validate", { contents: editor.value })
        .then((result) => {
          settingsNotice.textContent = result.valid ? result.message : `Config not applied: ${result.message}`;
        })
        .catch((error: unknown) => {
          settingsNotice.textContent = `Could not validate config: ${String(error)}`;
        });
    }),
    createInstallButton("Apply valid config", () => {
      void invoke<SettingsDocument>("settings_import", { request: { contents: editor.value } })
        .then((saved) => {
          globalSettings = normalizeSettings(saved);
          settingsConfigText = JSON.stringify(globalSettings, null, 2);
          writeLocalPreference(leaderStorageKey, globalSettings.leaderChord);
          writeLocalPreference(startupBehaviorStorageKey, globalSettings.startupSurface);
          applySettingsToFrame();
          settingsNotice.textContent = "Config applied. Invalid or unsafe values were not accepted.";
          renderSettingsSection();
        })
        .catch((error: unknown) => {
          settingsNotice.textContent = `Config was not applied: ${String(error)}`;
        });
    }),
    createInstallButton("Export JSON", () => {
      void invoke<string>("settings_export")
        .then((contents) => downloadSettings(contents))
        .catch((error: unknown) => {
          settingsNotice.textContent = `Could not export config: ${String(error)}`;
        });
    }),
    createInstallButton("Import file", () => settingsImportInput?.click()),
    createInstallButton("Copy JSON", () => {
      const copy = navigator.clipboard?.writeText(editor.value);
      if (!copy) {
        settingsNotice.textContent = "Clipboard access is unavailable; use Export JSON instead.";
        return;
      }
      void copy.then(() => {
        settingsNotice.textContent = "Config copied to the clipboard.";
      }).catch(() => {
        settingsNotice.textContent = "Clipboard access is unavailable; use Export JSON instead.";
      });
    }),
  );
  settingsDetail.append(actions);
  settingsImportInput = makeElement("input") as HTMLInputElement;
  settingsImportInput.type = "file";
  settingsImportInput.accept = ".json,application/json";
  settingsImportInput.hidden = true;
  settingsImportInput.setAttribute("aria-label", "Import Arkonad settings JSON file");
  settingsImportInput.addEventListener("change", () => {
    const file = settingsImportInput?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      settingsConfigText = typeof reader.result === "string" ? reader.result : "";
      renderSettingsSection();
      settingsNotice.textContent = "Config loaded into the editor. Validate it before applying.";
    };
    reader.readAsText(file);
  });
  settingsDetail.append(settingsImportInput);
}

function renderSettingsSection(): void {
  settingsDetail.replaceChildren();
  if (!settingsLoaded) {
    settingsDetail.append(makeElement("p", "detail-empty", "Loading validated settings…"));
    return;
  }
  switch (settingsSection) {
    case "appearance":
      renderSettingsAppearance();
      break;
    case "accessibility":
      renderSettingsAccessibility();
      break;
    case "shells":
      renderSettingsShells();
      break;
    case "advanced":
      renderSettingsAdvanced();
      break;
    default:
      renderSettingsGeneral();
      break;
  }
}

function renderSettingsSections(focusSelected = false): void {
  settingsSections.replaceChildren();
  for (const item of settingsSectionMeta) {
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.role = "option";
    row.dataset.settingsSection = item.id;
    row.setAttribute("aria-selected", String(item.id === settingsSection));
    row.classList.toggle("is-selected", item.id === settingsSection);
    row.append(
      makeElement("div", "store-row-top", item.label),
      makeElement("div", "store-row-summary", item.summary),
    );
    row.addEventListener("click", () => selectSettingsSection(item.id));
    settingsSections.append(row);
  }
  if (focusSelected) {
    window.requestAnimationFrame(() => {
      settingsSections.querySelector<HTMLButtonElement>(`[data-settings-section="${settingsSection}"]`)?.focus();
    });
  }
}

function selectSettingsSection(section: SettingsSection, focusRow = false): void {
  settingsSection = section;
  renderSettingsSections(focusRow);
  renderSettingsSection();
}

function moveSettingsSelection(offset: number): void {
  const index = settingsSectionMeta.findIndex((item) => item.id === settingsSection);
  const next = settingsSectionMeta[(Math.max(0, index) + offset + settingsSectionMeta.length) % settingsSectionMeta.length];
  selectSettingsSection(next.id, true);
}

function hideSettingsSurface(): void {
  settingsView.hidden = true;
  settingsOpenButton.setAttribute("aria-expanded", "false");
}

async function loadSettingsDocument(): Promise<void> {
  if (settingsLoaded || settingsLoading) return;
  settingsLoading = true;
  try {
    const result = await invoke<SettingsLoadResult>("settings_load");
    globalSettings = normalizeSettings(result.settings);
    const legacyLeader = readLocalPreference(leaderStorageKey);
    const legacyStartup = readLocalPreference(startupBehaviorStorageKey);
    if (result.status === "default" && legacyLeader) globalSettings.leaderChord = normalizedLeader(legacyLeader);
    if (result.status === "default" && legacyStartup) globalSettings.startupSurface = parseStartupBehavior(legacyStartup);
    settingsConfigText = JSON.stringify(globalSettings, null, 2);
    settingsLoaded = true;
    applySettingsToFrame();
    writeLocalPreference(leaderStorageKey, globalSettings.leaderChord);
    writeLocalPreference(startupBehaviorStorageKey, globalSettings.startupSurface);
    if (result.status === "default" && (legacyLeader || legacyStartup)) {
      void invoke("settings_save", { request: { settings: globalSettings } }).catch(() => {
        // Local preferences remain a safe fallback if the first migration cannot be saved.
      });
    }
    settingsNotice.textContent = result.message;
  } catch (error) {
    globalSettings = defaultSettings();
    settingsLoaded = true;
    applySettingsToFrame();
    settingsNotice.textContent = `Could not read saved settings: ${String(error)} Safe defaults are active.`;
  } finally {
    settingsLoading = false;
    if (activeSurface === "settings") {
      renderSettingsSections();
      renderSettingsSection();
    }
  }
}

function openSettings(): void {
  closeRepositoryQuickMenu();
  if (!settingsLoaded) void loadSettingsDocument();
  storeOpen = true;
  activeSurface = "settings";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  integrationView.hidden = true;
  settingsView.hidden = false;
  repositoryView.hidden = true;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  integrationOpenButton.setAttribute("aria-expanded", "false");
  settingsOpenButton.setAttribute("aria-expanded", "true");
  repositoryOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  settingsScope.disabled = !activeWorkspaceId;
  if (!activeWorkspaceId && settingsScopeValue === "workspace") settingsScopeValue = "global";
  settingsScope.value = settingsScopeValue;
  sessionMeta.textContent = "settings";
  status.textContent = "settings";
  status.dataset.state = "ready";
  renderSettingsSections();
  renderSettingsSection();
  window.requestAnimationFrame(() => {
    settingsSections.querySelector<HTMLButtonElement>(`[data-settings-section="${settingsSection}"]`)?.focus();
  });
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
      id: "integration",
      label: "Repository · Connected Preview",
      description: "Combine selected Agent Task workstreams in a separate Worktree before merge.",
      run: () => {
        closeCommandOverlay();
        openIntegrationView();
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
      description: "Open repository status, Git actions, reviews, and safe cleanup.",
      run: () => {
        closeCommandOverlay();
        openRepositoryView();
      },
    },
    {
      id: "settings",
      label: "Settings",
      description: "Configure the Leader, startup, shell profiles, theme, accessibility, and app update policy.",
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
    shell: effectiveShellProfile()?.executable ?? null,
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
  hideSettingsSurface();
  if (activeWorkspaceId !== document.id) {
    sessionAgentOverrides.clear();
  }
  pendingWorkspace = document;
  activeWorkspaceId = document.id;
  activeWorkspaceName = document.name;
  workspaceAgentPolicies = normalizeAgentPolicies(document.settings?.agentPolicies);
  workspaceSettingsOverrides = normalizeWorkspaceOverrides(document.settings?.overrides);
  if (!workspaceSettingsOverrides.leaderChord && document.settings?.leaderChord) {
    workspaceSettingsOverrides.leaderChord = normalizedLeader(document.settings.leaderChord);
  }
  applySettingsToFrame();
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
  workspaceSettingsOverrides = {};
  applySettingsToFrame();
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
          agentPolicies: workspaceAgentPolicies,
          overrides: workspaceSettingsOverrides,
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
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  repositoryView.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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
  repositoryView.hidden = true;
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
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  repositoryView.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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
  repositoryView.hidden = true;
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

function integrationStatusLabel(status: IntegrationStatus): string {
  return {
    preparing: "Preparing Worktree",
    ready: "Ready for preview",
    conflicted: "Conflicts paused",
    previewing: "Preview running",
    validated: "Validation recorded",
    reworkRequested: "Rework requested",
    setupFailed: "Setup failed",
    published: "Published · cleanup allowed",
    abandoned: "Abandoned · cleanup allowed",
  }[status];
}

function previewStateLabel(state: PreviewState): string {
  return {
    starting: "starting",
    healthy: "healthy",
    degraded: "degraded",
    failed: "failed",
    stopped: "stopped",
  }[state];
}

function integrationEligibleTasks(): AgentTask[] {
  return integrationTasks
    .filter((task) => !task.status.toLowerCase().startsWith("cancelled"))
    .sort((left, right) => {
      const rank = (task: AgentTask) => {
        if (task.status === "handoffReady") return 0;
        if (task.status === "ready") return 1;
        if (task.status === "active") return 2;
        return 3;
      };
      return rank(left) - rank(right) || Number(right.updatedAt) - Number(left.updatedAt);
    });
}

function integrationTaskCanSelect(task: AgentTask): boolean {
  return (task.status === "ready" || task.status === "handoffReady") && !task.lease;
}

function integrationDefaultWorktreeRoot(repository: string): string {
  const separator = Math.max(repository.lastIndexOf("\\"), repository.lastIndexOf("/"));
  return `${separator >= 0 ? repository.slice(0, separator) : repository}\\arkonad-integrations`;
}

function integrationRepositoryRoot(): string {
  return (
    integrationTasks.find((task) => selectedIntegrationTaskIds.has(task.id))?.repositoryRoot ??
    integrationTasks[0]?.repositoryRoot ??
    repositoryPath()
  );
}

function integrationTaskLabel(task: AgentTask): string {
  return task.taskSummary || task.taskBranch || "Untitled workstream";
}

function replaceIntegrationCandidate(candidate: IntegrationCandidate): void {
  const index = integrationCandidatesState.findIndex((item) => item.id === candidate.id);
  if (index >= 0) {
    integrationCandidatesState[index] = candidate;
  } else {
    integrationCandidatesState.unshift(candidate);
  }
  selectedIntegrationCandidateId = candidate.id;
  renderIntegrationView();
}

function selectIntegrationTask(id: string, focusRow = false): void {
  const task = integrationTasks.find((item) => item.id === id);
  if (!task || !integrationTaskCanSelect(task)) {
    return;
  }
  if (selectedIntegrationTaskIds.has(id)) {
    selectedIntegrationTaskIds.delete(id);
  } else {
    selectedIntegrationTaskIds.add(id);
  }
  integrationInspection = undefined;
  renderIntegrationView();
  if (focusRow) {
    window.requestAnimationFrame(() =>
      integrationWorkstreams.querySelector<HTMLButtonElement>(`[data-integration-task-id="${id}"]`)?.focus(),
    );
  }
}

function selectIntegrationCandidate(id: string, focusRow = false): void {
  if (!integrationCandidatesState.some((candidate) => candidate.id === id)) {
    return;
  }
  selectedIntegrationCandidateId = id;
  integrationInspection = undefined;
  renderIntegrationView();
  if (focusRow) {
    window.requestAnimationFrame(() =>
      integrationCandidates.querySelector<HTMLButtonElement>(`[data-integration-candidate-id="${id}"]`)?.focus(),
    );
  }
}

function moveIntegrationWorkstreamSelection(offset: number): void {
  const tasks = integrationEligibleTasks();
  if (tasks.length === 0) return;
  const current = tasks.findIndex((task) => selectedIntegrationTaskIds.has(task.id));
  const next = tasks[(Math.max(current, 0) + offset + tasks.length) % tasks.length];
  selectIntegrationTask(next.id, true);
}

function moveIntegrationCandidateSelection(offset: number): void {
  if (integrationCandidatesState.length === 0) return;
  const current = Math.max(
    0,
    integrationCandidatesState.findIndex((candidate) => candidate.id === selectedIntegrationCandidateId),
  );
  const next = integrationCandidatesState[(current + offset + integrationCandidatesState.length) % integrationCandidatesState.length];
  selectIntegrationCandidate(next.id, true);
}

function integrationFormField(
  parent: HTMLElement,
  label: string,
  value: string,
  placeholder: string,
): HTMLInputElement {
  const wrapper = makeElement("label", "agent-task-field");
  wrapper.append(makeElement("span", undefined, label));
  const input = makeElement("input") as HTMLInputElement;
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function integrationTextarea(
  parent: HTMLElement,
  label: string,
  value: string,
  placeholder: string,
  rows = 3,
): HTMLTextAreaElement {
  const wrapper = makeElement("label", "agent-task-field");
  wrapper.append(makeElement("span", undefined, label));
  const input = makeElement("textarea") as HTMLTextAreaElement;
  input.rows = rows;
  input.value = value;
  input.placeholder = placeholder;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function integrationButton(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = makeElement("button", "detail-action", label) as HTMLButtonElement;
  button.type = "button";
  button.disabled = disabled || integrationBusy;
  button.addEventListener("click", onClick);
  return button;
}

function renderIntegrationWorkstreams(): void {
  const tasks = integrationEligibleTasks();
  integrationWorkstreams.replaceChildren();
  integrationCount.textContent = `${tasks.filter(integrationTaskCanSelect).length} selectable`;
  if (tasks.length === 0) {
    integrationWorkstreams.append(makeElement("div", "store-empty-list", "No saved Agent Tasks are ready for integration."));
    return;
  }
  for (const task of tasks) {
    const selectable = integrationTaskCanSelect(task);
    const selected = selectedIntegrationTaskIds.has(task.id);
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.integrationTaskId = task.id;
    row.disabled = !selectable;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    row.classList.toggle("is-selected", selected);
    const top = makeElement("span", "store-row-top");
    top.append(
      makeElement("strong", undefined, `${selected ? "[x] " : "[ ] "}${integrationTaskLabel(task)}`),
      makeElement("span", "store-row-category", task.agentName),
    );
    row.append(
      top,
      makeElement("span", "store-row-summary", `${task.baseBranch} → ${task.taskBranch}`),
      makeElement(
        "span",
        `store-row-state ${selectable ? "status-active" : "status-unknown"}`,
        selectable ? taskStatusLabel(task.status) : `${taskStatusLabel(task.status)} · release lease`,
      ),
    );
    if (selectable) {
      row.addEventListener("click", () => selectIntegrationTask(task.id));
    }
    integrationWorkstreams.append(row);
  }
}

function renderIntegrationCandidates(): void {
  integrationCandidates.replaceChildren();
  integrationCandidateCount.textContent = String(integrationCandidatesState.length);
  if (integrationCandidatesState.length === 0) {
    integrationCandidates.append(makeElement("div", "store-empty-list", "No Integration Worktree exists yet."));
    return;
  }
  for (const candidate of integrationCandidatesState) {
    const selected = candidate.id === selectedIntegrationCandidateId;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.integrationCandidateId = candidate.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    row.classList.toggle("is-selected", selected);
    row.append(
      makeElement("span", "store-row-top", candidate.targetBranch),
      makeElement("span", "store-row-summary", `${candidate.id} · ${candidate.selectedWorkstreams.length} workstreams`),
      makeElement(
        "span",
        `store-row-state ${candidate.status === "conflicted" || candidate.status === "setupFailed" ? "status-error" : candidate.status === "previewing" ? "status-active" : "status-warning"}`,
        integrationStatusLabel(candidate.status),
      ),
    );
    row.addEventListener("click", () => selectIntegrationCandidate(candidate.id));
    integrationCandidates.append(row);
  }
}

function renderIntegrationSetup(): void {
  integrationDetail.replaceChildren();
  const header = makeElement("header", "detail-header");
  header.append(
    makeElement("span", "detail-category", "integration plan"),
    makeElement("h2", "detail-title", "Choose workstreams"),
    makeElement("p", "detail-summary", `${selectedIntegrationTaskIds.size} selected · source Worktrees remain unchanged`),
  );
  integrationDetail.append(header);

  const form = appendDetailSection(integrationDetail, "Integration target");
  const repository = integrationRepositoryRoot();
  if (!integrationTargetBranch) {
    integrationTargetBranch = repositorySnapshot?.suggestedBaseBranch ?? "main";
  }
  if (!integrationWorktreeRoot) {
    integrationWorktreeRoot = integrationDefaultWorktreeRoot(repository);
  }
  appendDetailLine(form, "Repository", repository || "not detected");
  const targetBranch = integrationFormField(form, "Target branch", integrationTargetBranch, "main");
  targetBranch.addEventListener("input", () => {
    integrationTargetBranch = targetBranch.value;
    integrationInspection = undefined;
  });
  const worktreeRoot = integrationFormField(form, "Integration Worktree root", integrationWorktreeRoot, "D:\\Worktrees\\arkonad");
  worktreeRoot.addEventListener("input", () => {
    integrationWorktreeRoot = worktreeRoot.value;
    integrationInspection = undefined;
  });
  const strategyLabel = makeElement("label", "agent-task-field");
  strategyLabel.append(makeElement("span", undefined, "Combination strategy"));
  const strategy = makeElement("select") as HTMLSelectElement;
  strategy.innerHTML = `
    <option value="mergeNoFf">Merge each branch · no fast-forward</option>
    <option value="cherryPick">Cherry-pick source commits in order</option>
  `;
  strategy.value = integrationStrategy;
  strategy.addEventListener("change", () => {
    integrationStrategy = strategy.value as IntegrationStrategy;
    integrationInspection = undefined;
  });
  strategyLabel.append(strategy);
  form.append(strategyLabel);
  form.append(
    makeElement(
      "p",
      "detail-note",
      "Inspection reads bases, commits, GitHub checks when available, changed paths, and likely overlaps. It does not combine anything.",
    ),
  );
  form.append(
    integrationButton(
      "Inspect selected workstreams",
      () => void inspectIntegrationSelection(),
      selectedIntegrationTaskIds.size < 2,
    ),
  );

  if (integrationInspection) {
    renderIntegrationInspection(form, integrationInspection);
  }
}

function renderIntegrationInspection(parent: HTMLElement, inspection: IntegrationInspection): void {
  const section = appendDetailSection(parent.parentElement ?? parent, "Preflight evidence");
  appendDetailLine(section, "Target", `${inspection.targetBranch} · ${inspection.targetRevision || "unresolved"}`);
  appendDetailLine(section, "Strategy", inspection.strategy === "mergeNoFf" ? "merge · no fast-forward" : "cherry-pick");
  appendDetailLine(section, "Worktree root", inspection.integrationWorktreeRoot);
  if (inspection.blockers.length > 0) {
    const blockers = makeElement("div", "install-plan-warning");
    blockers.append(makeElement("strong", undefined, "Review before create"));
    for (const blocker of inspection.blockers) {
      blockers.append(makeElement("p", undefined, blocker));
    }
    section.append(blockers);
  }
  for (const workstream of inspection.selectedWorkstreams) {
    const source = appendDetailSection(section, `${workstream.taskSummary || workstream.taskBranch} · ${workstream.agentName}`);
    appendDetailLine(source, "Task", workstream.taskId);
    appendDetailLine(source, "Base", workstream.baseBranch);
    appendDetailLine(source, "Branch", workstream.taskBranch);
    appendDetailLine(source, "Revision", workstream.sourceRevision || "unresolved");
    appendDetailLine(source, "Source Worktree", workstream.sourceWorktreePath);
    appendDetailLine(source, "Changed paths", workstream.changedPaths.length ? workstream.changedPaths.join(", ") : "none found");
    appendDetailLine(source, "Eligibility", workstream.eligible ? "eligible" : workstream.eligibilityDetail);
    const commits = makeElement("pre", "task-plan-evidence", workstream.commits.length
      ? workstream.commits.map((commit) => `${commit.shortHash} ${commit.subject}`).join("\n")
      : "No committed changes found");
    source.append(makeElement("span", "detail-label", "Commits"), commits);
    const checks = makeElement("pre", "task-plan-evidence", workstream.checks.length
      ? workstream.checks.map((check) => `${check.status} · ${check.name}\n${check.detail}`).join("\n")
      : "Checks unavailable");
    source.append(makeElement("span", "detail-label", "Checks"), checks);
  }
  if (inspection.likelyConflicts.length > 0) {
    const conflicts = appendDetailSection(section, "Likely overlaps");
    conflicts.append(makeElement("p", "detail-note", "These are path overlaps detected before integration, not confirmed merge conflicts."));
    for (const conflict of inspection.likelyConflicts) {
      appendDetailLine(conflicts, conflict.path, conflict.workstreamIds.join(", "));
    }
  }
  const actions = makeElement("div", "install-button-row");
  actions.append(
    integrationButton(
      "Create Integration Worktree",
      () => void createIntegrationCandidate(inspection),
      !inspection.canCreate,
    ),
  );
  section.append(actions);
}

async function inspectIntegrationSelection(): Promise<void> {
  if (selectedIntegrationTaskIds.size < 2 || integrationBusy) return;
  integrationBusy = true;
  integrationNotice.textContent = "Reading workstream bases, commits, checks, and likely overlaps…";
  renderIntegrationView();
  try {
    integrationInspection = await invoke<IntegrationInspection>("integration_inspect", {
      request: {
        taskIds: [...selectedIntegrationTaskIds],
        targetBranch: integrationTargetBranch,
        integrationWorktreeRoot: integrationWorktreeRoot,
        strategy: integrationStrategy,
      },
    });
    integrationNotice.textContent = integrationInspection.canCreate
      ? "Preflight complete. Creating the candidate will use a separate Integration Worktree."
      : "Preflight found blockers. Source Worktrees were not changed.";
  } catch (error) {
    integrationInspection = undefined;
    integrationNotice.textContent = `Could not inspect workstreams: ${String(error)}`;
  } finally {
    integrationBusy = false;
    renderIntegrationView();
  }
}

async function createIntegrationCandidate(inspection: IntegrationInspection): Promise<void> {
  if (integrationBusy) return;
  if (inspection.likelyConflicts.length > 0 && !window.confirm("Likely path overlaps were found. Create the Integration Worktree and let Git confirm the result?")) {
    return;
  }
  integrationBusy = true;
  integrationNotice.textContent = "Creating the separate Integration Worktree and applying the recorded strategy…";
  renderIntegrationView();
  try {
    const candidate = await invoke<IntegrationCandidate>("integration_create", {
      request: {
        taskIds: [...selectedIntegrationTaskIds],
        targetBranch: inspection.targetBranch,
        integrationWorktreeRoot: inspection.integrationWorktreeRoot,
        strategy: inspection.strategy,
      },
    });
    replaceIntegrationCandidate(candidate);
    integrationNotice.textContent = candidate.status === "conflicted"
      ? "Integration paused. The candidate names the responsible workstreams and paths; source Worktrees remain unchanged."
      : candidate.status === "setupFailed"
        ? "Integration setup failed. The saved candidate keeps the error for recovery."
        : "Integration candidate created. Declare a Run Profile before starting Connected Preview.";
  } catch (error) {
    integrationNotice.textContent = `Could not create the Integration Worktree: ${String(error)}`;
  } finally {
    integrationBusy = false;
    renderIntegrationView();
  }
}

function runProfileExample(): string {
  return JSON.stringify({
    id: "local-preview",
    name: "Frontend + backend",
    entryPoint: "http://127.0.0.1:5173",
    components: [
      {
        id: "backend",
        name: "Backend",
        executable: "npm.cmd",
        arguments: ["run", "dev"],
        cwd: ".",
        environment: {},
        port: 3000,
        healthCheck: { kind: "tcp", host: "127.0.0.1", port: 3000 },
        dependsOn: [],
      },
      {
        id: "frontend",
        name: "Frontend",
        executable: "npm.cmd",
        arguments: ["run", "dev"],
        cwd: ".",
        environment: {},
        port: 5173,
        healthCheck: { kind: "tcp", host: "127.0.0.1", port: 5173 },
        dependsOn: ["backend"],
      },
    ],
  }, null, 2);
}

async function integrationCandidateAction(
  command: string,
  request: Record<string, unknown>,
  successMessage: string,
): Promise<void> {
  if (integrationBusy) return;
  integrationBusy = true;
  integrationNotice.textContent = "Updating the saved Integration candidate…";
  renderIntegrationView();
  try {
    const candidate = await invoke<IntegrationCandidate>(command, { request });
    replaceIntegrationCandidate(candidate);
    integrationNotice.textContent = successMessage;
  } catch (error) {
    integrationNotice.textContent = `Integration action stopped: ${String(error)}`;
  } finally {
    integrationBusy = false;
    renderIntegrationView();
  }
}

function renderIntegrationCandidate(candidate: IntegrationCandidate): void {
  integrationDetail.replaceChildren();
  const header = makeElement("header", "detail-header");
  header.append(
    makeElement("span", "detail-category", "connected preview"),
    makeElement("h2", "detail-title", candidate.targetBranch),
    makeElement("p", "detail-summary", `${integrationStatusLabel(candidate.status)} · preview ${previewStateLabel(candidate.preview.state)}`),
    makeElement("p", "detail-meta", candidate.id),
  );
  integrationDetail.append(header);

  const context = appendDetailSection(integrationDetail, "Integration candidate");
  appendDetailLine(context, "Target", `${candidate.targetBranch} · ${candidate.targetRevision}`);
  appendDetailLine(context, "Integration branch", candidate.integrationBranch);
  appendDetailLine(context, "Integration Worktree", candidate.integrationWorktreePath);
  appendDetailLine(context, "Strategy", candidate.strategy === "mergeNoFf" ? "merge · no fast-forward" : "cherry-pick");
  appendDetailLine(context, "Merge readiness", candidate.mergeReadiness.userDecision === null ? "not decided" : candidate.mergeReadiness.userDecision ? "user marked ready" : "user marked not ready");
  if (candidate.errorMessage) context.append(makeElement("p", "install-plan-warning", candidate.errorMessage));

  const workstreams = appendDetailSection(integrationDetail, "Workstreams present");
  for (const workstream of candidate.selectedWorkstreams) {
    const source = makeElement("div", "detail-item");
    source.append(
      makeElement("strong", undefined, workstream.taskSummary || workstream.taskBranch),
      makeElement("span", "detail-note", `${workstream.agentName} · ${workstream.baseBranch} → ${workstream.taskBranch}`),
      makeElement("span", "detail-note", `${workstream.commits.length} commits · ${workstream.changedPaths.length} changed paths`),
    );
    workstreams.append(source);
  }

  if (candidate.conflicts.length > 0) {
    const conflictSection = appendDetailSection(integrationDetail, "Conflicts paused");
    conflictSection.append(makeElement("p", "install-plan-warning", "Git left these paths unresolved. Resolve only in the Integration Worktree, then refresh this candidate."));
    for (const conflict of candidate.conflicts) {
      appendDetailLine(conflictSection, conflict.path, conflict.workstreamIds.join(", "));
      conflictSection.append(makeElement("p", "detail-note", conflict.reason));
    }
    conflictSection.append(integrationButton("Refresh conflict state", () => void integrationCandidateAction("integration_refresh", { candidateId: candidate.id }, "Conflict state refreshed.")));
  }
  if (candidate.strategyLog) {
    const strategyLog = appendDetailSection(integrationDetail, "Recorded integration strategy");
    strategyLog.append(makeElement("pre", "install-log", candidate.strategyLog));
  }

  const profileSection = appendDetailSection(integrationDetail, "Run Profile");
  profileSection.append(makeElement("p", "detail-note", "Declare executable arguments, working directories, ports, health probes, and dependencies. Processes start only after you save the profile and press Start."));
  const profileInput = integrationTextarea(profileSection, "Profile JSON", candidate.runProfile ? JSON.stringify(candidate.runProfile, null, 2) : runProfileExample(), "Run Profile JSON", 12);
  const profileActions = makeElement("div", "install-button-row");
  profileActions.append(integrationButton("Save Run Profile", () => {
    try {
      const profile = JSON.parse(profileInput.value) as RunProfile;
      void integrationCandidateAction("integration_run_profile_save", { candidateId: candidate.id, profile }, "Run Profile saved. Preview processes remain stopped until you start them.");
    } catch (error) {
      integrationNotice.textContent = `Run Profile JSON is invalid: ${String(error)}`;
    }
  }));
  profileSection.append(profileActions);

  const previewSection = appendDetailSection(integrationDetail, "Connected Preview");
  appendDetailLine(previewSection, "Overall state", previewStateLabel(candidate.preview.state));
  appendDetailLine(previewSection, "Entry point", candidate.preview.entryPoint ?? "not declared");
  appendDetailLine(previewSection, "Last checked", candidate.preview.lastCheckedAt ? formatTimestamp(candidate.preview.lastCheckedAt) : "not checked");
  previewSection.append(makeElement("p", "detail-note", candidate.preview.note));
  const previewActions = makeElement("div", "install-button-row");
  previewActions.append(
    integrationButton("Start all components", () => void integrationCandidateAction("integration_preview_start", { candidateId: candidate.id, componentIds: [] }, "Preview start requested."), !candidate.runProfile || candidate.status === "conflicted"),
    integrationButton("Refresh health and logs", () => void integrationCandidateAction("integration_preview_status", { candidateId: candidate.id }, "Preview status refreshed.")),
    integrationButton("Stop all components", () => void integrationCandidateAction("integration_preview_stop", { candidateId: candidate.id, componentIds: [] }, "Preview processes stopped.")),
  );
  previewSection.append(previewActions);
  for (const component of candidate.preview.components) {
    const componentSection = appendDetailSection(previewSection, `${component.name} · ${previewStateLabel(component.state)}`);
    appendDetailLine(componentSection, "Port", component.port ? String(component.port) : "not declared");
    appendDetailLine(componentSection, "PID", component.pid ? String(component.pid) : "none");
    appendDetailLine(componentSection, "Health", component.healthDetail || "not checked");
    if (component.logs) componentSection.append(makeElement("pre", "install-log", component.logs));
  }

  const evidence = appendDetailSection(integrationDetail, "Validation evidence");
  if (candidate.validationEvidence.length === 0) {
    evidence.append(makeElement("p", "detail-empty", "No validation evidence recorded yet."));
  } else {
    for (const item of candidate.validationEvidence) {
      evidence.append(makeElement("p", "detail-note", `${item.outcome} · ${item.label}: ${item.detail}`));
    }
  }
  const evidenceLabel = integrationFormField(evidence, "Evidence label", "", "Frontend ↔ backend smoke test");
  const evidenceOutcome = makeElement("select") as HTMLSelectElement;
  evidenceOutcome.innerHTML = `<option value="passed">Passed</option><option value="failed">Failed</option><option value="observed">Observed</option>`;
  const evidenceOutcomeLabel = makeElement("label", "agent-task-field");
  evidenceOutcomeLabel.append(makeElement("span", undefined, "Outcome"), evidenceOutcome);
  evidence.append(evidenceOutcomeLabel);
  const evidenceDetail = integrationTextarea(evidence, "Evidence detail", "", "What you ran, what responded, and what remains uncertain", 2);
  evidence.append(integrationButton("Record validation", () => void integrationCandidateAction("integration_validation_record", { candidateId: candidate.id, label: evidenceLabel.value, outcome: evidenceOutcome.value, detail: evidenceDetail.value }, "Validation evidence attached to the candidate.")));

  const rework = appendDetailSection(integrationDetail, "Rework decision");
  const reworkTask = makeElement("select") as HTMLSelectElement;
  reworkTask.innerHTML = `<option value="">All workstreams</option>${candidate.selectedWorkstreams.map((item) => `<option value="${item.taskId}">${item.taskSummary || item.taskBranch}</option>`).join("")}`;
  const reworkTaskLabel = makeElement("label", "agent-task-field");
  reworkTaskLabel.append(makeElement("span", undefined, "Workstream"), reworkTask);
  rework.append(reworkTaskLabel);
  const reworkDecision = makeElement("select") as HTMLSelectElement;
  reworkDecision.innerHTML = `<option value="accept">Accept current result</option><option value="rework">Request rework</option><option value="exclude">Exclude from next publication</option>`;
  const reworkDecisionLabel = makeElement("label", "agent-task-field");
  reworkDecisionLabel.append(makeElement("span", undefined, "Decision"), reworkDecision);
  rework.append(reworkDecisionLabel);
  const reworkDetail = integrationTextarea(rework, "Decision detail", "", "Why this workstream should be accepted, reworked, or excluded", 2);
  rework.append(integrationButton("Record rework decision", () => void integrationCandidateAction("integration_rework_record", { candidateId: candidate.id, taskId: reworkTask.value || null, decision: reworkDecision.value, detail: reworkDetail.value }, "Rework decision attached to the candidate.")));
  for (const item of candidate.reworkDecisions) {
    rework.append(makeElement("p", "detail-note", `${item.decision} · ${item.taskId ?? "all workstreams"}: ${item.detail}`));
  }

  const lifecycle = appendDetailSection(integrationDetail, "Merge readiness and cleanup");
  const readinessNote = integrationTextarea(lifecycle, "Decision note", candidate.mergeReadiness.note, "The user decides when this candidate is ready for publication", 2);
  const readinessActions = makeElement("div", "install-button-row");
  readinessActions.append(
    integrationButton("Mark ready for user merge", () => {
      if (window.confirm("Mark this candidate ready for the user’s separate merge or publication decision?")) {
        void integrationCandidateAction("integration_readiness_set", { candidateId: candidate.id, ready: true, note: readinessNote.value, confirmed: true }, "Merge readiness recorded as a user decision.");
      }
    }, candidate.conflicts.length > 0),
    integrationButton("Mark not ready", () => void integrationCandidateAction("integration_readiness_set", { candidateId: candidate.id, ready: false, note: readinessNote.value, confirmed: true }, "Candidate remains not ready for merge.")),
  );
  lifecycle.append(readinessActions);
  const publicationRef = integrationFormField(lifecycle, "Publication reference", candidate.publishedRef ?? "", "PR URL, commit, or release reference");
  const lifecycleActions = makeElement("div", "install-button-row");
  lifecycleActions.append(
    integrationButton("Mark publication confirmed", () => {
      if (window.confirm("Confirm that this integration candidate was published through the intended user-controlled Git flow?")) {
        void integrationCandidateAction("integration_mark_published", { candidateId: candidate.id, publicationRef: publicationRef.value, confirmed: true }, "Publication recorded. Cleanup is now available after inspection.");
      }
    }, candidate.status === "published" || candidate.status === "abandoned"),
    integrationButton("Abandon candidate", () => {
      if (window.confirm("Abandon this integration candidate? The Worktree will remain until you explicitly clean it up.")) {
        void integrationCandidateAction("integration_abandon", { candidateId: candidate.id, worktreePath: candidate.integrationWorktreePath, confirmed: true }, "Candidate abandoned. Its Worktree is preserved until cleanup.");
      }
    }, candidate.status === "published" || candidate.status === "abandoned"),
    integrationButton("Clean up Integration Worktree", () => {
      if (window.confirm("Remove this exact Integration Worktree? Source Worktrees and branches remain unchanged.")) {
        void integrationCandidateAction("integration_cleanup", { candidateId: candidate.id, worktreePath: candidate.integrationWorktreePath, confirmed: true }, "Integration Worktree cleaned up after the required lifecycle decision.");
      }
    }, !candidate.worktreeCleaned && candidate.status !== "published" && candidate.status !== "abandoned"),
  );
  lifecycle.append(lifecycleActions);
  if (candidate.worktreeCleaned) lifecycle.append(makeElement("p", "detail-note", `Worktree cleaned at ${candidate.cleanupAt ? formatTimestamp(candidate.cleanupAt) : "recorded time"}.`));
}

function renderIntegrationView(): void {
  renderIntegrationWorkstreams();
  renderIntegrationCandidates();
  const candidate = integrationCandidatesState.find((item) => item.id === selectedIntegrationCandidateId);
  if (candidate) {
    renderIntegrationCandidate(candidate);
  } else {
    renderIntegrationSetup();
  }
}

async function refreshIntegrationState(): Promise<void> {
  const requestId = ++integrationRequestId;
  try {
    const [tasks, candidates] = await Promise.all([
      invoke<AgentTask[]>("agent_task_list"),
      invoke<IntegrationCandidate[]>("integration_list"),
    ]);
    if (requestId !== integrationRequestId) return;
    integrationTasks = tasks;
    selectedIntegrationTaskIds = new Set(
      [...selectedIntegrationTaskIds].filter((id) => tasks.some((task) => task.id === id)),
    );
    integrationCandidatesState = candidates;
    if (selectedIntegrationCandidateId && !candidates.some((candidate) => candidate.id === selectedIntegrationCandidateId)) {
      selectedIntegrationCandidateId = candidates[0]?.id;
    }
    integrationNotice.textContent = "Select completed workstreams to inspect their bases, commits, checks, and likely conflicts.";
    renderIntegrationView();
  } catch (error) {
    integrationNotice.textContent = `Could not read integration state: ${String(error)}`;
    renderIntegrationView();
  }
}

function openIntegrationView(): void {
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  storeOpen = true;
  activeSurface = "integration";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  integrationView.hidden = false;
  repositoryView.hidden = true;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  integrationOpenButton.setAttribute("aria-expanded", "true");
  repositoryOpenButton.setAttribute("aria-expanded", "false");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "connected preview";
  status.textContent = "preview";
  status.dataset.state = "ready";
  void refreshIntegrationState();
  window.requestAnimationFrame(() => integrationWorkstreams.querySelector<HTMLButtonElement>("button")?.focus());
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

const repositorySectionMeta: Array<{ id: RepositorySection; label: string }> = [
  { id: "summary", label: "Status" },
  { id: "changedFiles", label: "Changed files" },
  { id: "commits", label: "Commits" },
  { id: "branches", label: "Branches" },
  { id: "worktrees", label: "Worktrees" },
  { id: "reviews", label: "Reviews" },
  { id: "conflicts", label: "Conflicts" },
  { id: "cleanup", label: "Cleanup" },
];

function repositoryPath(): string {
  return (
    focusedPane()?.session.cwd ??
    pendingWorkspace?.repositoryRoot ??
    pendingWorkspace?.root ??
    lastWorkspacePath() ??
    ""
  );
}

function repositorySectionCount(snapshot: RepositorySnapshot, section: RepositorySection): string {
  switch (section) {
    case "changedFiles":
      return String(snapshot.changedFiles.length);
    case "commits":
      return String(snapshot.commits.length);
    case "branches":
      return String(snapshot.branches.length);
    case "worktrees":
      return String(snapshot.worktrees.length);
    case "reviews":
      return String(snapshot.reviews.length);
    case "conflicts":
      return String(snapshot.conflicts.length);
    case "cleanup":
      return String(snapshot.cleanupCandidates.length);
    default:
      return "";
  }
}

function repositoryStatusLabel(snapshot: RepositorySnapshot): string {
  if (snapshot.status === "unknown") {
    return "not a Git repository";
  }
  const branch = snapshot.branch ?? "detached HEAD";
  const dirty = snapshot.dirty ? " · dirty" : " · clean";
  const tracking =
    snapshot.ahead !== null || snapshot.behind !== null
      ? ` · ↑${snapshot.ahead ?? 0} ↓${snapshot.behind ?? 0}`
      : "";
  return `${branch}${dirty}${tracking}`;
}

function renderRepositoryIndicator(): void {
  const snapshot = repositorySnapshot;
  if (!snapshot || snapshot.status === "unknown") {
    repositoryIndicator.textContent = "no repository";
    repositoryAttention.hidden = true;
    repositoryOpenButton.title = snapshot?.statusDetail ?? "Focus a directory inside a Git repository.";
    return;
  }
  const name = snapshot.repositoryName ?? "repository";
  const tracking = snapshot.ahead !== null || snapshot.behind !== null
    ? ` · ↑${snapshot.ahead ?? 0} ↓${snapshot.behind ?? 0}`
    : "";
  repositoryIndicator.textContent = `${name} · ${snapshot.branch ?? "detached"}${snapshot.dirty ? " *" : ""}${tracking}`;
  repositoryAttention.hidden = snapshot.attention.length === 0;
  repositoryAttention.textContent = snapshot.attention.length > 0 ? String(snapshot.attention.length) : "";
  repositoryOpenButton.title = snapshot.attention.length > 0
    ? snapshot.attention.join(" ")
    : "Repository is ready for review.";
}

function scheduleRepositoryRefresh(): void {
  const path = repositoryPath();
  if (path === lastRepositoryPath && repositorySnapshot) {
    return;
  }
  lastRepositoryPath = path;
  if (repositoryRefreshTimer !== undefined) {
    window.clearTimeout(repositoryRefreshTimer);
  }
  repositoryRefreshTimer = window.setTimeout(() => {
    repositoryRefreshTimer = undefined;
    void refreshRepository();
  }, 150);
}

async function refreshRepository(): Promise<void> {
  const requestId = ++repositoryRequestId;
  const path = repositoryPath();
  lastRepositoryPath = path;
  repositoryNoticeOverride = "";
  repositoryNotice.textContent = "Reading Git status, branches, Worktrees, reviews, and cleanup candidates…";
  try {
    const snapshot = await invoke<RepositorySnapshot>("repository_snapshot", {
      request: { path },
    });
    if (requestId !== repositoryRequestId) {
      return;
    }
    repositorySnapshot = snapshot;
    renderRepositoryIndicator();
    if (activeSurface === "repository") {
      renderRepositoryView();
    }
    if (repositoryQuickOpen) {
      renderRepositoryQuickMenu();
    }
  } catch (error) {
    if (requestId !== repositoryRequestId) {
      return;
    }
    repositorySnapshot = undefined;
    repositoryIndicator.textContent = "status unavailable";
    repositoryAttention.hidden = false;
    repositoryAttention.textContent = "!";
    repositoryOpenButton.title = String(error);
    repositoryNotice.textContent = `Could not read repository status: ${String(error)}`;
    if (activeSurface === "repository") {
      repositoryDetail.replaceChildren(makeElement("p", "detail-empty", repositoryNotice.textContent));
    }
  }
}

function repositoryActionButton(
  label: string,
  action: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = makeElement("button", "detail-action", label) as HTMLButtonElement;
  button.type = "button";
  button.disabled = disabled || repositoryActionBusy;
  button.addEventListener("click", action);
  return button;
}

function repositoryFormField(
  parent: HTMLElement,
  label: string,
  value: string,
  kind: "input" | "textarea" = "input",
): HTMLInputElement | HTMLTextAreaElement {
  const wrapper = makeElement("label", "repository-form-field");
  wrapper.append(makeElement("span", undefined, label));
  const control = makeElement(kind, "repository-form-input") as HTMLInputElement | HTMLTextAreaElement;
  control.value = value;
  if (kind === "textarea") {
    (control as HTMLTextAreaElement).rows = 4;
  }
  wrapper.append(control);
  parent.append(wrapper);
  return control;
}

function repositoryConfirmation(message: string): boolean {
  return window.confirm(`${message}\n\nArkonad will not perform this action unless you confirm it.`);
}

async function executeRepositoryAction(
  command: string,
  request: Record<string, unknown>,
): Promise<void> {
  if (repositoryActionBusy) {
    return;
  }
  repositoryActionBusy = true;
  repositoryNotice.textContent = "Running the explicitly confirmed repository action…";
  try {
    const result = await invoke<RepositoryActionResult>(command, { request: { ...request, confirmed: true } });
    repositoryActionBusy = false;
    if (result.snapshot) {
      repositorySnapshot = result.snapshot;
      renderRepositoryIndicator();
    }
    repositoryNoticeOverride = result.message;
    renderRepositoryView();
    repositoryNotice.textContent = `${result.message} Target: ${result.target}`;
    if (result.logs.trim()) {
      repositoryDetail.append(makeElement("pre", "repository-action-log", result.logs));
    }
  } catch (error) {
    repositoryActionBusy = false;
    repositoryNoticeOverride = `Repository action stopped: ${String(error)}`;
    renderRepositoryView();
    repositoryNotice.textContent = repositoryNoticeOverride;
  }
}

function renderRepositoryCommitForm(parent: HTMLElement, snapshot: RepositorySnapshot): void {
  const form = makeElement("form", "repository-action-form");
  form.append(makeElement("strong", "repository-form-title", "Commit changes"));
  appendDetailLine(
    form,
    "Exact target",
    `${snapshot.repositoryRoot ?? "unknown"} · ${snapshot.branch ?? "detached HEAD"} · all ${snapshot.changedFiles.length} visible path(s)`,
  );
  const message = repositoryFormField(form, "Commit message", "");
  message.setAttribute("placeholder", "Describe why these repository changes belong together");
  const submit = makeElement("button", "detail-action", "Commit all visible changes") as HTMLButtonElement;
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = message.value.trim();
    if (!value) {
      repositoryNotice.textContent = "Enter a commit message before committing.";
      return;
    }
    const paths = snapshot.changedFiles.map((file) => file.path).join("\n");
    if (!repositoryConfirmation(`Commit on ${snapshot.branch ?? "detached HEAD"} in ${snapshot.repositoryRoot}?\n\n${paths}`)) {
      return;
    }
    void executeRepositoryAction("repository_commit", {
      path: snapshot.repositoryRoot ?? repositoryPath(),
      message: value,
      files: [],
      includeAll: true,
    });
  });
  parent.append(form);
}

function renderRepositoryPushForm(parent: HTMLElement, snapshot: RepositorySnapshot): void {
  const form = makeElement("form", "repository-action-form");
  form.append(makeElement("strong", "repository-form-title", "Push branch"));
  const remote = makeElement("select", "repository-form-input") as HTMLSelectElement;
  remote.setAttribute("aria-label", "Push remote");
  for (const candidate of snapshot.remotes) {
    const option = makeElement("option", undefined, `${candidate.name} · ${candidate.url}`) as HTMLOptionElement;
    option.value = candidate.name;
    remote.append(option);
  }
  const remoteLabel = makeElement("label", "repository-form-field");
  remoteLabel.append(makeElement("span", undefined, "Remote"), remote);
  form.append(remoteLabel);
  const targetLine = makeElement("div", "detail-line");
  targetLine.append(makeElement("span", "detail-label", "Exact target"));
  const targetValue = makeElement("span", "detail-value");
  targetLine.append(targetValue);
  form.append(targetLine);
  const updateTarget = (): void => {
    targetValue.textContent = `${remote.value || "remote"}/${snapshot.branch ?? "detached HEAD"}`;
  };
  remote.addEventListener("change", updateTarget);
  updateTarget();
  const tracking = makeElement("label", "repository-form-check");
  const setUpstream = makeElement("input") as HTMLInputElement;
  setUpstream.type = "checkbox";
  setUpstream.checked = true;
  tracking.append(setUpstream, makeElement("span", undefined, "Set upstream if this branch has none"));
  form.append(tracking);
  const submit = makeElement("button", "detail-action", "Push exact branch") as HTMLButtonElement;
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = snapshot.remotes.find((candidate) => candidate.name === remote.value);
    if (!selected || !snapshot.branch) {
      repositoryNotice.textContent = "A remote and current branch are required before pushing.";
      return;
    }
    if (!repositoryConfirmation(`Push ${snapshot.branch} to ${selected.name} (${selected.url})?`)) {
      return;
    }
    void executeRepositoryAction("repository_push", {
      path: snapshot.repositoryRoot ?? repositoryPath(),
      remote: selected.name,
      branch: snapshot.branch,
      setUpstream: setUpstream.checked,
    });
  });
  parent.append(form);
}

function renderRepositoryDraftPrForm(parent: HTMLElement, snapshot: RepositorySnapshot): void {
  const form = makeElement("form", "repository-action-form");
  form.append(makeElement("strong", "repository-form-title", "Create draft PR"));
  const targetLine = makeElement("div", "detail-line");
  targetLine.append(makeElement("span", "detail-label", "Exact target"));
  const targetValue = makeElement("span", "detail-value");
  targetLine.append(targetValue);
  form.append(targetLine);
  appendDetailLine(form, "GitHub", snapshot.github.repository ?? "GitHub remote not detected");
  const base = repositoryFormField(form, "Base branch", snapshot.suggestedBaseBranch ?? "main") as HTMLInputElement;
  const title = repositoryFormField(form, "Title", snapshot.branch ? `Changes from ${snapshot.branch}` : "Repository changes") as HTMLInputElement;
  const body = repositoryFormField(form, "Description", "Explain what changed and why.", "textarea") as HTMLTextAreaElement;
  const updateTarget = (): void => {
    targetValue.textContent = `${snapshot.branch ?? "detached HEAD"} → ${base.value.trim() || "main"}`;
  };
  base.addEventListener("input", updateTarget);
  updateTarget();
  const submit = makeElement("button", "detail-action", "Create draft PR") as HTMLButtonElement;
  submit.type = "submit";
  submit.disabled = !snapshot.github.available || !snapshot.github.authenticated || !snapshot.branch;
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!snapshot.branch || !snapshot.github.authenticated) {
      repositoryNotice.textContent = snapshot.github.message;
      return;
    }
    if (!repositoryConfirmation(`Create a draft PR from ${snapshot.branch} into ${base.value.trim() || "main"} on ${snapshot.github.repository ?? "the GitHub remote"}?`)) {
      return;
    }
    void executeRepositoryAction("repository_create_draft_pr", {
      path: snapshot.repositoryRoot ?? repositoryPath(),
      baseBranch: base.value.trim() || snapshot.suggestedBaseBranch || "main",
      headBranch: snapshot.branch,
      title: title.value.trim(),
      body: body.value,
    });
  });
  parent.append(form);
}

function renderRepositoryMergeForm(parent: HTMLElement, snapshot: RepositorySnapshot, review: RepositoryReview): void {
  const form = makeElement("form", "repository-action-form");
  form.append(makeElement("strong", "repository-form-title", `Merge PR #${review.number}`));
  appendDetailLine(form, "Exact target", `PR #${review.number} · ${review.headBranch} → ${review.baseBranch}`);
  const method = makeElement("select", "repository-form-input") as HTMLSelectElement;
  for (const value of ["squash", "merge", "rebase"]) {
    const option = makeElement("option", undefined, value) as HTMLOptionElement;
    option.value = value;
    method.append(option);
  }
  const methodLabel = makeElement("label", "repository-form-field");
  methodLabel.append(makeElement("span", undefined, "Merge method"), method);
  form.append(methodLabel);
  const submit = makeElement("button", "detail-action", "Merge only after confirmation") as HTMLButtonElement;
  submit.type = "submit";
  submit.disabled = !snapshot.github.available || !snapshot.github.authenticated || review.state !== "OPEN";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!repositoryConfirmation(`Merge PR #${review.number}: ${review.title}\n\n${review.headBranch} → ${review.baseBranch}\nMethod: ${method.value}`)) {
      return;
    }
    void executeRepositoryAction("repository_merge_pr", {
      path: snapshot.repositoryRoot ?? repositoryPath(),
      pullRequestNumber: review.number,
      method: method.value,
    });
  });
  parent.append(form);
}

function renderRepositoryCleanupSection(parent: HTMLElement, snapshot: RepositorySnapshot): void {
  if (snapshot.cleanupCandidates.length === 0) {
    parent.append(makeElement("p", "detail-empty", "No secondary Worktrees are registered for cleanup."));
    return;
  }
  for (const candidate of snapshot.cleanupCandidates) {
    const item = makeElement("div", "repository-item");
    item.append(makeElement("strong", undefined, candidate.branch ?? candidate.target));
    appendDetailLine(item, "Target", candidate.target);
    appendDetailLine(item, "Changes", candidate.dirty ? "present or unverified" : "none detected");
    item.append(makeElement("p", "detail-note", candidate.reason));
    if (candidate.allowed) {
      item.append(
        repositoryActionButton("Review and remove empty Worktree", () => {
          if (!repositoryConfirmation(`Remove this empty Worktree?\n\n${candidate.target}`)) {
            return;
          }
          void executeRepositoryAction("repository_cleanup_worktree", {
            path: snapshot.repositoryRoot ?? repositoryPath(),
            target: candidate.target,
          });
        }),
      );
    }
    parent.append(item);
  }
}

function renderRepositoryView(): void {
  const snapshot = repositorySnapshot;
  repositorySections.replaceChildren();
  if (!snapshot) {
    repositoryCount.textContent = "waiting";
    repositoryDetail.replaceChildren(makeElement("p", "detail-empty", "Reading repository status…"));
    return;
  }
  repositoryTitle.textContent = snapshot.repositoryRoot ?? "Repository status";
  repositoryCount.textContent = snapshot.status === "ready" ? repositoryStatusLabel(snapshot) : "unknown";
  repositoryNotice.textContent = repositoryNoticeOverride || (
    snapshot.status === "ready"
      ? `${snapshot.statusDetail} ${snapshot.github.message}`
      : snapshot.statusDetail
  );
  for (const section of repositorySectionMeta) {
    const selected = section.id === selectedRepositorySection;
    const row = makeElement("button", "store-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.repositorySection = section.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    row.classList.toggle("is-selected", selected);
    row.append(
      makeElement("span", "store-row-top", section.label),
      makeElement("span", "store-row-summary", section.id === "summary" ? repositoryStatusLabel(snapshot) : "Inspect exact repository evidence"),
      makeElement("span", "store-row-state status-unknown", repositorySectionCount(snapshot, section.id)),
    );
    row.addEventListener("click", () => selectRepositorySection(section.id));
    repositorySections.append(row);
  }
  renderRepositoryDetail(snapshot);
}

function renderRepositoryDetail(snapshot: RepositorySnapshot): void {
  repositoryDetail.replaceChildren();
  const header = makeElement("header", "detail-header");
  header.append(
    makeElement("span", "detail-category", "repository"),
    makeElement("h2", "detail-title", snapshot.repositoryName ?? "No repository"),
    makeElement("p", "detail-summary", repositoryStatusLabel(snapshot)),
    makeElement("p", "detail-meta", snapshot.repositoryRoot ?? snapshot.statusDetail),
  );
  repositoryDetail.append(header);
  if (snapshot.status === "unknown") {
    repositoryDetail.append(
      makeElement("p", "detail-note", "The terminal remains available. Focus a Git repository to use Repository View actions."),
    );
    return;
  }

  const section = appendDetailSection(
    repositoryDetail,
    repositorySectionMeta.find((candidate) => candidate.id === selectedRepositorySection)?.label ?? "Status",
  );
  switch (selectedRepositorySection) {
    case "summary":
      appendDetailLine(section, "Branch", snapshot.branch ?? "detached HEAD");
      appendDetailLine(section, "Working tree", snapshot.dirty ? "dirty" : "clean");
      appendDetailLine(section, "Ahead / behind", `${snapshot.ahead ?? "?"} / ${snapshot.behind ?? "?"}`);
      appendDetailLine(section, "Upstream", snapshot.upstream ?? "not configured");
      appendDetailLine(section, "GitHub", snapshot.github.message);
      if (snapshot.attention.length > 0) {
        const attention = appendDetailSection(repositoryDetail, "Items needing attention");
        appendDetailList(attention, snapshot.attention, "No attention items");
      }
      renderRepositorySummaryActions(repositoryDetail, snapshot);
      break;
    case "changedFiles":
      appendDetailList(
        section,
        snapshot.changedFiles.map((file) => `${file.status} · ${file.path}${file.untracked ? " · untracked" : file.staged ? " · staged" : ""}`),
        "Working tree is clean.",
      );
      if (snapshot.changedFiles.length > 0) {
        renderRepositoryCommitForm(repositoryDetail, snapshot);
      }
      break;
    case "commits":
      if (snapshot.commits.length === 0) {
        section.append(makeElement("p", "detail-empty", "No commits were returned by Git."));
      } else {
        const list = makeElement("div", "repository-item-list");
        for (const commit of snapshot.commits) {
          const item = makeElement("div", "repository-item");
          item.append(makeElement("strong", undefined, `${commit.shortHash} · ${commit.subject}`));
          appendDetailLine(item, "Author", `${commit.author} · ${commit.authoredAt}`);
          list.append(item);
        }
        section.append(list);
      }
      break;
    case "branches":
      if (snapshot.branches.length === 0) {
        section.append(makeElement("p", "detail-empty", "No local branches were returned by Git."));
      } else {
        for (const branch of snapshot.branches) {
          const item = makeElement("div", "repository-item");
          item.append(makeElement("strong", undefined, `${branch.current ? "● " : ""}${branch.name}`));
          appendDetailLine(item, "Upstream", branch.upstream ?? "not configured");
          appendDetailLine(item, "Ahead / behind", `${branch.ahead ?? "?"} / ${branch.behind ?? "?"}`);
          section.append(item);
        }
      }
      break;
    case "worktrees":
      if (snapshot.worktrees.length === 0) {
        section.append(makeElement("p", "detail-empty", "Git returned no Worktrees."));
      } else {
        for (const worktree of snapshot.worktrees) {
          const item = makeElement("div", "repository-item");
          item.append(makeElement("strong", undefined, worktree.branch ?? (worktree.bare ? "bare repository" : "detached HEAD")));
          appendDetailLine(item, "Path", worktree.path);
          appendDetailLine(item, "Changes", worktree.dirty ? "present or unverified" : "none detected");
          item.append(makeElement("p", "detail-note", worktree.cleanupReason));
          section.append(item);
        }
      }
      break;
    case "reviews":
      if (snapshot.reviews.length === 0) {
        section.append(makeElement("p", "detail-empty", snapshot.github.authenticated ? "No pull requests were found for the focused branch." : snapshot.github.message));
      } else {
        for (const review of snapshot.reviews) {
          const item = makeElement("div", "repository-item");
          const link = makeElement("a", "repository-review-link", `PR #${review.number} · ${review.title}`) as HTMLAnchorElement;
          link.href = review.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          item.append(link);
          appendDetailLine(item, "State", `${review.state}${review.isDraft ? " · draft" : ""}`);
          appendDetailLine(item, "Review", review.reviewDecision ?? "not reported");
          appendDetailLine(item, "Target", `${review.headBranch} → ${review.baseBranch}`);
          renderRepositoryMergeForm(item, snapshot, review);
          section.append(item);
        }
      }
      if (snapshot.branch) {
        renderRepositoryDraftPrForm(repositoryDetail, snapshot);
      }
      break;
    case "conflicts":
      appendDetailList(section, snapshot.conflicts, "No unmerged conflict paths reported by Git.");
      break;
    case "cleanup":
      renderRepositoryCleanupSection(section, snapshot);
      break;
  }
}

function renderRepositorySummaryActions(parent: HTMLElement, snapshot: RepositorySnapshot): void {
  const actions = appendDetailSection(parent, "Explicit actions");
  actions.append(makeElement("p", "detail-note", "Each action shows its exact target and waits for a second confirmation."));
  if (snapshot.dirty) {
    renderRepositoryCommitForm(actions, snapshot);
  } else {
    actions.append(makeElement("p", "detail-empty", "Commit is unavailable because the working tree is clean."));
  }
  if (snapshot.branch && snapshot.remotes.length > 0) {
    renderRepositoryPushForm(actions, snapshot);
  } else {
    actions.append(makeElement("p", "detail-empty", "Push needs a current branch and a configured remote."));
  }
  if (snapshot.branch && snapshot.github.available && snapshot.github.authenticated) {
    renderRepositoryDraftPrForm(actions, snapshot);
  } else {
    actions.append(makeElement("p", "detail-empty", snapshot.github.message));
  }
}

function selectRepositorySection(section: RepositorySection, focusRow = false): void {
  selectedRepositorySection = section;
  renderRepositoryView();
  if (focusRow) {
    window.requestAnimationFrame(() => repositorySections.querySelector<HTMLButtonElement>(`[data-repository-section="${section}"]`)?.focus());
  }
}

function moveRepositorySelection(offset: number): void {
  const currentIndex = repositorySectionMeta.findIndex((section) => section.id === selectedRepositorySection);
  const next = repositorySectionMeta[(Math.max(currentIndex, 0) + offset + repositorySectionMeta.length) % repositorySectionMeta.length];
  selectRepositorySection(next.id, true);
}

function renderRepositoryQuickMenu(): void {
  repositoryQuickContent.replaceChildren();
  const snapshot = repositorySnapshot;
  if (!snapshot) {
    repositoryQuickContent.append(makeElement("p", "detail-empty", "Reading repository status…"));
    return;
  }
  const facts = makeElement("div", "repository-quick-facts");
  appendDetailLine(facts, "Repository", snapshot.repositoryRoot ?? "unknown");
  appendDetailLine(facts, "Status", repositoryStatusLabel(snapshot));
  appendDetailLine(facts, "Attention", snapshot.attention.length > 0 ? `${snapshot.attention.length} item(s)` : "none");
  repositoryQuickContent.append(facts);
  if (snapshot.attention.length > 0) {
    appendDetailList(repositoryQuickContent, snapshot.attention, "No attention items");
  }
  const actions = makeElement("div", "repository-quick-actions");
  actions.append(
    repositoryActionButton("Open status", () => openRepositoryView("summary")),
    repositoryActionButton("Commit changes", () => openRepositoryView("changedFiles"), !snapshot.dirty),
    repositoryActionButton("Push branch", () => openRepositoryView("summary"), !snapshot.branch || snapshot.remotes.length === 0),
    repositoryActionButton("Create draft PR", () => openRepositoryView("reviews"), !snapshot.branch || !snapshot.github.authenticated),
    repositoryActionButton("Full Repository View", () => openRepositoryView("summary")),
  );
  repositoryQuickContent.append(actions);
  repositoryQuickContent.append(makeElement("p", "detail-note", "GitHub absence or failed authentication only disables GitHub actions. Local Git remains available."));
}

function closeRepositoryQuickMenu(): void {
  repositoryQuickOpen = false;
  repositoryQuick.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
}

function openRepositoryQuickMenu(): void {
  if (storeOpen) {
    closeSurface();
  }
  repositoryQuickOpen = true;
  repositoryQuick.hidden = false;
  repositoryOpenButton.setAttribute("aria-expanded", "true");
  renderRepositoryQuickMenu();
  void refreshRepository();
}

function openRepositoryView(section: RepositorySection = "summary"): void {
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  selectedRepositorySection = section;
  storeOpen = true;
  activeSurface = "repository";
  terminalShell.hidden = true;
  launchpadView.hidden = true;
  storeView.hidden = true;
  appsView.hidden = true;
  agentsView.hidden = true;
  tasksView.hidden = true;
  repositoryView.hidden = false;
  attentionView.hidden = true;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  repositoryOpenButton.setAttribute("aria-expanded", "true");
  attentionOpenButton.setAttribute("aria-expanded", "false");
  sessionMeta.textContent = "repository view";
  status.textContent = "repository";
  status.dataset.state = "ready";
  void refreshRepository();
}

function openAttentionQueue(): void {
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  repositoryView.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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
  integrationView.hidden = true;
  settingsView.hidden = true;
  repositoryView.hidden = true;
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
  const returnTabId = frameSnapshot.activeTabId;
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
    launchedReturnTabs.set(nextSession.id, returnTabId);
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
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  repositoryView.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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
  integrationView.hidden = true;
  repositoryView.hidden = true;
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
    const updatePolicy = effectiveSettings().appUpdatePolicy;
    appsNotice.textContent = snapshot.updatesAvailable === 0
      ? updatePolicy === "never"
        ? "Update checks run only when you open My Apps. No reviewed updates are currently listed."
        : "Detected installations stay external; managed actions use their recorded method."
      : updatePolicy === "notify"
        ? `${updateLabel}. Notify-only policy is active; no update flow was started.`
        : updatePolicy === "never"
          ? `${updateLabel}. This check was started by opening My Apps; no update flow was started.`
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
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  repositoryView.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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
  repositoryView.hidden = true;
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
  hideSettingsSurface();
  closeRepositoryQuickMenu();
  integrationView.hidden = true;
  integrationOpenButton.setAttribute("aria-expanded", "false");
  repositoryView.hidden = true;
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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
  repositoryView.hidden = true;
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
  closeRepositoryQuickMenu();
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
  integrationView.hidden = true;
  settingsView.hidden = true;
  repositoryView.hidden = true;
  attentionView.hidden = true;
  terminalShell.hidden = false;
  launchpadOpenButton.setAttribute("aria-expanded", "false");
  storeOpenButton.setAttribute("aria-expanded", "false");
  appsOpenButton.setAttribute("aria-expanded", "false");
  agentsOpenButton.setAttribute("aria-expanded", "false");
  tasksOpenButton.setAttribute("aria-expanded", "false");
  integrationOpenButton.setAttribute("aria-expanded", "false");
  settingsOpenButton.setAttribute("aria-expanded", "false");
  repositoryOpenButton.setAttribute("aria-expanded", "false");
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

repositoryOpenButton.addEventListener("click", openRepositoryQuickMenu);
repositoryRefreshButton.addEventListener("click", () => void refreshRepository());
repositoryCloseButton.addEventListener("click", closeSurface);
repositoryQuickCloseButton.addEventListener("click", closeRepositoryQuickMenu);
launchpadOpenButton.addEventListener("click", openLaunchpad);
storeOpenButton.addEventListener("click", () => openStore());
appsOpenButton.addEventListener("click", openMyApps);
agentsOpenButton.addEventListener("click", openAgentCockpit);
tasksOpenButton.addEventListener("click", openAgentTasks);
integrationOpenButton.addEventListener("click", openIntegrationView);
attentionOpenButton.addEventListener("click", openAttentionQueue);
settingsOpenButton.addEventListener("click", openSettings);
launchpadCloseButton.addEventListener("click", closeSurface);
storeCloseButton.addEventListener("click", closeSurface);
appsCloseButton.addEventListener("click", closeSurface);
agentsCloseButton.addEventListener("click", closeSurface);
tasksCloseButton.addEventListener("click", closeSurface);
integrationCloseButton.addEventListener("click", closeSurface);
settingsCloseButton.addEventListener("click", closeSurface);
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
settingsScope.addEventListener("change", () => {
  settingsScopeValue = settingsScope.value === "workspace" ? "workspace" : "global";
  renderSettingsSection();
});
settingsSections.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSettingsSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSettingsSelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    selectSettingsSection(settingsSectionMeta[0].id, true);
  } else if (event.key === "End") {
    event.preventDefault();
    selectSettingsSection(settingsSectionMeta.at(-1)!.id, true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    const section = activeRow?.dataset.settingsSection as SettingsSection | undefined;
    if (section) selectSettingsSection(section, true);
  }
});
integrationRefreshButton.addEventListener("click", () => void refreshIntegrationState());
integrationWorkstreams.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveIntegrationWorkstreamSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveIntegrationWorkstreamSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.integrationTaskId) selectIntegrationTask(activeRow.dataset.integrationTaskId, true);
  }
});
integrationCandidates.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveIntegrationCandidateSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveIntegrationCandidateSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    if (activeRow?.dataset.integrationCandidateId) selectIntegrationCandidate(activeRow.dataset.integrationCandidateId, true);
  }
});
repositorySections.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveRepositorySelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveRepositorySelection(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    selectRepositorySection("summary", true);
  } else if (event.key === "End") {
    event.preventDefault();
    selectRepositorySection("cleanup", true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const activeRow = event.target instanceof HTMLButtonElement ? event.target : undefined;
    const section = activeRow?.dataset.repositorySection as RepositorySection | undefined;
    if (section) {
      selectRepositorySection(section, true);
    }
  }
});
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
      completeOnboarding("plain");
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

  if (repositoryQuickOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRepositoryQuickMenu();
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
  if (launchedReturnTabs.has(event.payload.id)) {
    const returnTabId = launchedReturnTabs.get(event.payload.id) ?? null;
    launchedReturnTabs.delete(event.payload.id);
    const launchedTab = frameSnapshot.tabs.find((tab) =>
      tab.panes.some((pane) => pane.session.id === event.payload.id),
    );
    if (launchedTab) {
      void invoke<FrameCloseResult>("frame_close_tab", {
        tabId: launchedTab.id,
        force: true,
      }).then(async (result) => {
        let nextSnapshot = result.snapshot;
        if (returnTabId && nextSnapshot.tabs.some((tab) => tab.id === returnTabId)) {
          nextSnapshot = await invoke<FrameSnapshot>("frame_activate_tab", { tabId: returnTabId });
        }
        renderFrame(nextSnapshot);
        closeSurface();
        if (nextSnapshot.tabs.length === 0) {
          terminalStarted = false;
          await startSession();
        }
      }).catch(() => {
        writeToPane(
          event.payload.id,
          new TextEncoder().encode("\r\n\u001b[90m[tool exited; press Leader to switch sessions]\u001b[0m\r\n"),
        );
      });
    }
    return;
  }
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
void (async () => {
  await loadSettingsDocument();
  void refreshAgentSupervision();
  if (readLocalPreference(onboardingCompletedStorageKey) === "true") {
    openStartupBehavior();
  } else {
    openOnboarding();
  }
})();
