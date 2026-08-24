use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::task::{AgentTask, AgentTaskRuntime, AgentTaskStatus};

const STATE_FILE_NAME: &str = "integrations.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;
const MAX_LOG_BYTES: usize = 64 * 1024;
const MAX_TEXT_BYTES: usize = 16 * 1024;
static NEXT_INTEGRATION_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationStrategy {
    MergeNoFf,
    CherryPick,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationStatus {
    Preparing,
    Ready,
    Conflicted,
    Previewing,
    Validated,
    ReworkRequested,
    SetupFailed,
    Published,
    Abandoned,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PreviewState {
    Starting,
    Healthy,
    Degraded,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HealthCheck {
    #[serde(rename = "none")]
    None,
    Tcp {
        host: String,
        port: u16,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
}

impl Default for HealthCheck {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProfileComponent {
    pub id: String,
    pub name: String,
    pub executable: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub health_check: HealthCheck,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub entry_point: Option<String>,
    pub components: Vec<RunProfileComponent>,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCheck {
    pub name: String,
    pub status: String,
    pub detail: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationWorkstream {
    pub task_id: String,
    pub task_summary: String,
    pub agent_name: String,
    pub repository_root: String,
    pub base_branch: String,
    pub task_branch: String,
    pub source_worktree_path: String,
    pub source_revision: String,
    pub source_dirty: bool,
    pub changed_paths: Vec<String>,
    pub commits: Vec<IntegrationCommit>,
    pub checks: Vec<IntegrationCheck>,
    pub eligible: bool,
    pub eligibility_detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConflict {
    pub path: String,
    pub workstream_ids: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedPreviewWorkstream {
    pub task_id: String,
    pub label: String,
    pub branch: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewComponentState {
    pub id: String,
    pub name: String,
    pub state: PreviewState,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub logs: String,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub health_detail: String,
    #[serde(default)]
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedPreview {
    pub state: PreviewState,
    #[serde(default)]
    pub entry_point: Option<String>,
    pub workstreams: Vec<ConnectedPreviewWorkstream>,
    pub components: Vec<PreviewComponentState>,
    #[serde(default)]
    pub last_checked_at: Option<String>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationEvidence {
    pub id: String,
    pub label: String,
    pub outcome: String,
    pub detail: String,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReworkDecision {
    pub id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    pub decision: String,
    pub detail: String,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MergeReadiness {
    #[serde(default)]
    pub user_decision: Option<bool>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCandidate {
    pub id: String,
    pub repository_root: String,
    pub target_branch: String,
    pub target_revision: String,
    pub integration_branch: String,
    pub integration_worktree_root: String,
    pub integration_worktree_path: String,
    pub strategy: IntegrationStrategy,
    pub status: IntegrationStatus,
    pub selected_workstreams: Vec<IntegrationWorkstream>,
    pub conflicts: Vec<IntegrationConflict>,
    pub run_profile: Option<RunProfile>,
    pub preview: ConnectedPreview,
    pub validation_evidence: Vec<ValidationEvidence>,
    pub rework_decisions: Vec<ReworkDecision>,
    pub merge_readiness: MergeReadiness,
    #[serde(default)]
    pub strategy_log: String,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub worktree_cleaned: bool,
    #[serde(default)]
    pub published_ref: Option<String>,
    #[serde(default)]
    pub cleanup_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationInspection {
    pub repository_root: String,
    pub target_branch: String,
    pub target_revision: String,
    pub integration_worktree_root: String,
    pub strategy: IntegrationStrategy,
    pub selected_workstreams: Vec<IntegrationWorkstream>,
    pub likely_conflicts: Vec<IntegrationConflict>,
    pub blockers: Vec<String>,
    pub can_create: bool,
    pub inspected_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationInspectRequest {
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub integration_worktree_root: Option<String>,
    #[serde(default)]
    pub strategy: Option<IntegrationStrategy>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCreateRequest {
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub integration_worktree_root: Option<String>,
    pub strategy: IntegrationStrategy,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRunProfileRequest {
    pub candidate_id: String,
    pub profile: RunProfile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPreviewRequest {
    pub candidate_id: String,
    #[serde(default)]
    pub component_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationValidationRequest {
    pub candidate_id: String,
    pub label: String,
    pub outcome: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationReworkRequest {
    pub candidate_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    pub decision: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationReadinessRequest {
    pub candidate_id: String,
    pub ready: bool,
    #[serde(default)]
    pub note: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPublicationRequest {
    pub candidate_id: String,
    #[serde(default)]
    pub publication_ref: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationLifecycleRequest {
    pub candidate_id: String,
    pub worktree_path: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCandidateRequest {
    pub candidate_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct IntegrationStateFile {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    candidates: Vec<IntegrationCandidate>,
}

#[derive(Debug)]
struct ManagedPreviewProcess {
    child: Child,
    logs: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct PreviewProcessKey {
    candidate_id: String,
    component_id: String,
}

#[derive(Debug, Default)]
pub struct IntegrationRuntime {
    state_lock: Mutex<()>,
    processes: Mutex<HashMap<PreviewProcessKey, ManagedPreviewProcess>>,
}

impl IntegrationRuntime {
    pub fn list(&self, app: &AppHandle) -> Result<Vec<IntegrationCandidate>, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        Ok(read_state(app)?.candidates)
    }

    pub fn inspect(
        &self,
        app: &AppHandle,
        tasks: &AgentTaskRuntime,
        request: IntegrationInspectRequest,
    ) -> Result<IntegrationInspection, String> {
        let task_list = tasks.list(app)?;
        inspect_tasks(&task_list, request)
    }

    pub fn create(
        &self,
        app: &AppHandle,
        tasks: &AgentTaskRuntime,
        request: IntegrationCreateRequest,
    ) -> Result<IntegrationCandidate, String> {
        let inspection = inspect_tasks(
            &tasks.list(app)?,
            IntegrationInspectRequest {
                task_ids: request.task_ids.clone(),
                target_branch: request.target_branch.clone(),
                integration_worktree_root: request.integration_worktree_root.clone(),
                strategy: Some(request.strategy),
            },
        )?;
        if !inspection.can_create {
            return Err(format_inspection_blockers(&inspection));
        }

        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate_id = next_integration_id();
        let integration_branch = format!("codex/arkonad/{candidate_id}");
        let worktree_root = PathBuf::from(&inspection.integration_worktree_root);
        let worktree_path = worktree_root.join(&candidate_id);
        validate_integration_root(Path::new(&inspection.repository_root), &worktree_root)?;
        if worktree_path.exists() {
            return Err(format!(
                "Integration Worktree path already exists: {}",
                worktree_path.display()
            ));
        }
        if inspection.selected_workstreams.iter().any(|workstream| {
            let source = Path::new(&workstream.source_worktree_path);
            path_is_inside(source, &worktree_path) || path_is_inside(&worktree_path, source)
        }) {
            return Err(
                "The Integration Worktree path overlaps a source Worktree; choose a separate root"
                    .to_owned(),
            );
        }
        if branch_exists(Path::new(&inspection.repository_root), &integration_branch)? {
            return Err(format!(
                "Integration branch already exists: {integration_branch}"
            ));
        }
        if state.candidates.iter().any(|candidate| {
            !candidate.worktree_cleaned
                && (candidate.integration_branch == integration_branch
                    || same_path(
                        Path::new(&candidate.integration_worktree_path),
                        &worktree_path,
                    ))
        }) {
            return Err(
                "An existing Integration candidate already owns this branch or path".to_owned(),
            );
        }

        fs::create_dir_all(&worktree_root).map_err(|error| {
            format!("could not create the configured Integration Worktree root: {error}")
        })?;

        let now = timestamp();
        let mut candidate = IntegrationCandidate {
            id: candidate_id,
            repository_root: inspection.repository_root.clone(),
            target_branch: inspection.target_branch.clone(),
            target_revision: inspection.target_revision.clone(),
            integration_branch,
            integration_worktree_root: inspection.integration_worktree_root.clone(),
            integration_worktree_path: worktree_path.to_string_lossy().into_owned(),
            strategy: inspection.strategy,
            status: IntegrationStatus::Preparing,
            selected_workstreams: inspection.selected_workstreams.clone(),
            conflicts: Vec::new(),
            run_profile: None,
            preview: ConnectedPreview {
                state: PreviewState::Stopped,
                entry_point: None,
                workstreams: inspection
                    .selected_workstreams
                    .iter()
                    .map(|workstream| ConnectedPreviewWorkstream {
                        task_id: workstream.task_id.clone(),
                        label: if workstream.task_summary.is_empty() {
                            workstream.task_branch.clone()
                        } else {
                            workstream.task_summary.clone()
                        },
                        branch: workstream.task_branch.clone(),
                        state: "present".to_owned(),
                    })
                    .collect(),
                components: Vec::new(),
                last_checked_at: None,
                note: "No Run Profile has been declared, so no processes can start yet.".to_owned(),
            },
            validation_evidence: Vec::new(),
            rework_decisions: Vec::new(),
            merge_readiness: MergeReadiness::default(),
            strategy_log: String::new(),
            error_message: None,
            worktree_cleaned: false,
            published_ref: None,
            cleanup_at: None,
            created_at: now.clone(),
            updated_at: now,
        };
        state.candidates.push(candidate.clone());
        write_state(app, &state)?;

        let repository = Path::new(&candidate.repository_root);
        if let Err(error) = run_git(
            repository,
            &[
                "worktree".to_owned(),
                "add".to_owned(),
                "-b".to_owned(),
                candidate.integration_branch.clone(),
                candidate.integration_worktree_path.clone(),
                candidate.target_branch.clone(),
            ],
        ) {
            candidate.status = IntegrationStatus::SetupFailed;
            candidate.error_message = Some(error.clone());
            candidate.updated_at = timestamp();
            replace_candidate(&mut state, &candidate)?;
            write_state(app, &state)?;
            return Ok(candidate);
        }

        let strategy_result = apply_strategy(&candidate, repository);
        match strategy_result {
            Ok(log) => {
                candidate.strategy_log = log;
                candidate.status = IntegrationStatus::Ready;
                candidate.error_message = None;
            }
            Err(error) => {
                candidate.strategy_log = error.clone();
                let unresolved =
                    git_unmerged_paths(Path::new(&candidate.integration_worktree_path));
                if unresolved.is_empty() {
                    candidate.status = IntegrationStatus::SetupFailed;
                    candidate.error_message = Some(error);
                } else {
                    candidate.conflicts =
                        conflicts_for_paths(&unresolved, &candidate.selected_workstreams);
                    candidate.status = IntegrationStatus::Conflicted;
                    candidate.error_message = Some(
                        "Integration paused with unresolved conflicts. Resolve them in the Integration Worktree, then refresh this candidate.".to_owned(),
                    );
                }
            }
        }
        candidate.updated_at = timestamp();
        replace_candidate(&mut state, &candidate)?;
        write_state(app, &state)?;
        Ok(candidate)
    }

    pub fn refresh(
        &self,
        app: &AppHandle,
        request: IntegrationCandidateRequest,
    ) -> Result<IntegrationCandidate, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        refresh_candidate_conflicts(candidate);
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn save_profile(
        &self,
        app: &AppHandle,
        request: IntegrationRunProfileRequest,
    ) -> Result<IntegrationCandidate, String> {
        validate_profile(&request.profile)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        if matches!(
            candidate.status,
            IntegrationStatus::Published | IntegrationStatus::Abandoned
        ) {
            return Err(
                "A published or abandoned candidate cannot be given a new Run Profile".to_owned(),
            );
        }
        stop_candidate_processes(&self.processes, &candidate.id);
        let mut profile = request.profile;
        if profile.id.trim().is_empty() {
            profile.id = format!("{}-profile", candidate.id);
        }
        profile.updated_at = timestamp();
        candidate.preview.entry_point = profile.entry_point.clone();
        candidate.preview.components = profile
            .components
            .iter()
            .map(|component| PreviewComponentState {
                id: component.id.clone(),
                name: component.name.clone(),
                state: PreviewState::Stopped,
                pid: None,
                port: component.port,
                logs: String::new(),
                exit_code: None,
                health_detail: "not started".to_owned(),
                started_at: None,
            })
            .collect();
        candidate.preview.state = PreviewState::Stopped;
        candidate.preview.note =
            "Run Profile saved. Start the selected processes when ready.".to_owned();
        candidate.run_profile = Some(profile);
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn start_preview(
        &self,
        app: &AppHandle,
        request: IntegrationPreviewRequest,
    ) -> Result<IntegrationCandidate, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        refresh_candidate_conflicts(candidate);
        if !candidate.conflicts.is_empty() || candidate.status == IntegrationStatus::Conflicted {
            return Err("Connected Preview is paused until the Integration Worktree has no unresolved conflicts".to_owned());
        }
        if matches!(
            candidate.status,
            IntegrationStatus::Published | IntegrationStatus::Abandoned
        ) {
            return Err(
                "A published or abandoned candidate cannot start a Connected Preview".to_owned(),
            );
        }
        let profile = candidate
            .run_profile
            .clone()
            .ok_or_else(|| "Declare a Run Profile before starting Connected Preview".to_owned())?;
        if !Path::new(&candidate.integration_worktree_path).is_dir() {
            return Err("The Integration Worktree is missing; inspect the candidate before starting preview".to_owned());
        }
        let components = ordered_components(&profile, &request.component_ids)?;
        let mut processes = self
            .processes
            .lock()
            .map_err(|_| "Connected Preview process state is unavailable".to_owned())?;
        let mut started = 0_usize;
        let mut failed = 0_usize;
        for component in components {
            let key = PreviewProcessKey {
                candidate_id: candidate.id.clone(),
                component_id: component.id.clone(),
            };
            let existing_running = if let Some(existing) = processes.get_mut(&key) {
                existing
                    .child
                    .try_wait()
                    .map_err(|error| format!("could not inspect {}: {error}", component.name))?
                    .is_none()
            } else {
                false
            };
            if existing_running {
                continue;
            }
            if processes.contains_key(&key) {
                processes.remove(&key);
            }

            let cwd = resolve_component_cwd(
                Path::new(&candidate.integration_worktree_path),
                &component.cwd,
            )?;
            let mut command = Command::new(&component.executable);
            command
                .args(&component.arguments)
                .current_dir(&cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            for (key, value) in &component.environment {
                command.env(key, value);
            }
            let logs = Arc::new(Mutex::new(VecDeque::new()));
            match command.spawn() {
                Ok(mut child) => {
                    let pid = child.id();
                    if let Some(stdout) = child.stdout.take() {
                        spawn_log_reader(
                            stdout,
                            format!("{} stdout", component.name),
                            Arc::clone(&logs),
                        );
                    }
                    if let Some(stderr) = child.stderr.take() {
                        spawn_log_reader(
                            stderr,
                            format!("{} stderr", component.name),
                            Arc::clone(&logs),
                        );
                    }
                    processes.insert(key, ManagedPreviewProcess { child, logs });
                    update_component_state(
                        candidate,
                        &component,
                        PreviewState::Starting,
                        Some(pid),
                        None,
                        "process started; waiting for its health check",
                        Some(timestamp()),
                    );
                    started += 1;
                }
                Err(error) => {
                    update_component_state(
                        candidate,
                        &component,
                        PreviewState::Failed,
                        None,
                        None,
                        &format!("could not start {}: {error}", component.executable),
                        None,
                    );
                    failed += 1;
                }
            }
        }
        candidate.status = if started > 0 {
            IntegrationStatus::Previewing
        } else if failed > 0 {
            IntegrationStatus::Ready
        } else {
            candidate.status
        };
        candidate.preview.note = if failed > 0 {
            format!("{failed} component(s) could not start; inspect their logs and status.")
        } else {
            "Processes started. Refresh status to run health checks and read logs.".to_owned()
        };
        candidate.preview.state = if failed > 0 && started == 0 {
            PreviewState::Failed
        } else if failed > 0 {
            PreviewState::Degraded
        } else {
            PreviewState::Starting
        };
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn preview_status(
        &self,
        app: &AppHandle,
        request: IntegrationCandidateRequest,
    ) -> Result<IntegrationCandidate, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        let profile = candidate.run_profile.clone();
        let mut processes = self
            .processes
            .lock()
            .map_err(|_| "Connected Preview process state is unavailable".to_owned())?;
        if let Some(profile) = profile {
            let mut finished = Vec::new();
            for component in &profile.components {
                let key = PreviewProcessKey {
                    candidate_id: candidate.id.clone(),
                    component_id: component.id.clone(),
                };
                if let Some(process) = processes.get_mut(&key) {
                    match process.child.try_wait() {
                        Ok(None) => {
                            let (healthy, detail) = check_health(&component.health_check);
                            let started_at = find_component(candidate, &component.id)
                                .and_then(|state| state.started_at.clone());
                            update_component_state(
                                candidate,
                                component,
                                if healthy {
                                    PreviewState::Healthy
                                } else {
                                    PreviewState::Degraded
                                },
                                Some(process.child.id()),
                                None,
                                &detail,
                                started_at,
                            );
                            if let Some(state) = find_component_mut(candidate, &component.id) {
                                state.logs = log_string(&process.logs);
                            }
                        }
                        Ok(Some(status)) => {
                            let detail =
                                format!("process exited with {}", exit_code_label(status.code()));
                            let code = status.code();
                            let started_at = find_component(candidate, &component.id)
                                .and_then(|state| state.started_at.clone());
                            update_component_state(
                                candidate,
                                component,
                                if code == Some(0) {
                                    PreviewState::Stopped
                                } else {
                                    PreviewState::Failed
                                },
                                None,
                                code,
                                &detail,
                                started_at,
                            );
                            if let Some(state) = find_component_mut(candidate, &component.id) {
                                state.logs = log_string(&process.logs);
                            }
                            finished.push(key);
                        }
                        Err(error) => {
                            update_component_state(
                                candidate,
                                component,
                                PreviewState::Failed,
                                None,
                                None,
                                &format!("could not inspect process: {error}"),
                                None,
                            );
                            finished.push(key);
                        }
                    }
                } else if let Some(state) = find_component_mut(candidate, &component.id) {
                    if matches!(
                        state.state,
                        PreviewState::Starting | PreviewState::Healthy | PreviewState::Degraded
                    ) {
                        state.state = PreviewState::Stopped;
                        state.pid = None;
                        state.health_detail =
                            "process is not attached to the current Arkonad runtime".to_owned();
                    }
                }
            }
            for key in finished {
                processes.remove(&key);
            }
        }
        refresh_candidate_conflicts(candidate);
        candidate.preview.state = derive_preview_state(&candidate.preview.components);
        candidate.preview.last_checked_at = Some(timestamp());
        candidate.preview.note = preview_note(&candidate.preview);
        if matches!(
            candidate.status,
            IntegrationStatus::Previewing | IntegrationStatus::Ready
        ) {
            if candidate.preview.state == PreviewState::Stopped {
                candidate.status = IntegrationStatus::Ready;
            } else {
                candidate.status = IntegrationStatus::Previewing;
            }
        }
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn stop_preview(
        &self,
        app: &AppHandle,
        request: IntegrationPreviewRequest,
    ) -> Result<IntegrationCandidate, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        let ids = if request.component_ids.is_empty() {
            candidate
                .preview
                .components
                .iter()
                .map(|component| component.id.clone())
                .collect::<Vec<_>>()
        } else {
            request.component_ids
        };
        let mut processes = self
            .processes
            .lock()
            .map_err(|_| "Connected Preview process state is unavailable".to_owned())?;
        for component_id in ids {
            let key = PreviewProcessKey {
                candidate_id: candidate.id.clone(),
                component_id: component_id.clone(),
            };
            if let Some(mut process) = processes.remove(&key) {
                stop_child(&mut process.child);
                let logs = log_string(&process.logs);
                if let Some(component) = find_component_mut(candidate, &component_id) {
                    component.state = PreviewState::Stopped;
                    component.pid = None;
                    component.exit_code = None;
                    component.logs = logs;
                    component.health_detail = "stopped by the user".to_owned();
                }
            }
        }
        candidate.preview.state = derive_preview_state(&candidate.preview.components);
        candidate.preview.note =
            "Selected preview processes are stopped. Nothing restarts automatically.".to_owned();
        if candidate.preview.state == PreviewState::Stopped {
            candidate.status = IntegrationStatus::Ready;
        }
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn record_validation(
        &self,
        app: &AppHandle,
        request: IntegrationValidationRequest,
    ) -> Result<IntegrationCandidate, String> {
        let outcome = normalized_choice(&request.outcome, &["passed", "failed", "observed"])?;
        let label = bounded_text(&request.label, "validation label")?;
        let detail = bounded_text(&request.detail, "validation detail")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        candidate.validation_evidence.push(ValidationEvidence {
            id: format!("evidence-{}", timestamp_millis()),
            label,
            outcome: outcome.clone(),
            detail,
            recorded_at: timestamp(),
        });
        if outcome == "failed" {
            candidate.status = IntegrationStatus::ReworkRequested;
            candidate.merge_readiness.user_decision = Some(false);
        } else if !candidate.validation_evidence.is_empty()
            && candidate
                .validation_evidence
                .iter()
                .all(|evidence| evidence.outcome == "passed")
            && candidate.conflicts.is_empty()
        {
            candidate.status = IntegrationStatus::Validated;
        }
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn record_rework(
        &self,
        app: &AppHandle,
        request: IntegrationReworkRequest,
    ) -> Result<IntegrationCandidate, String> {
        let decision = normalized_choice(&request.decision, &["accept", "rework", "exclude"])?;
        let detail = bounded_text(&request.detail, "rework decision")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        if let Some(task_id) = request.task_id.as_deref() {
            if !candidate
                .selected_workstreams
                .iter()
                .any(|workstream| workstream.task_id == task_id)
            {
                return Err(format!("Unknown workstream in rework decision: {task_id}"));
            }
        }
        candidate.rework_decisions.push(ReworkDecision {
            id: format!("rework-{}", timestamp_millis()),
            task_id: request.task_id,
            decision: decision.clone(),
            detail,
            recorded_at: timestamp(),
        });
        if decision == "rework" {
            candidate.status = IntegrationStatus::ReworkRequested;
            candidate.merge_readiness.user_decision = Some(false);
        }
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn set_readiness(
        &self,
        app: &AppHandle,
        request: IntegrationReadinessRequest,
    ) -> Result<IntegrationCandidate, String> {
        if !request.confirmed {
            return Err("Merge readiness requires an explicit confirmation".to_owned());
        }
        let note = bounded_text(&request.note, "merge readiness note")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        refresh_candidate_conflicts(candidate);
        if request.ready && !candidate.conflicts.is_empty() {
            return Err(
                "This candidate still has unresolved conflicts; it cannot be marked merge-ready"
                    .to_owned(),
            );
        }
        if request.ready
            && matches!(
                candidate.status,
                IntegrationStatus::SetupFailed
                    | IntegrationStatus::Published
                    | IntegrationStatus::Abandoned
            )
        {
            return Err(
                "This candidate is not in a state where it can be marked merge-ready".to_owned(),
            );
        }
        candidate.merge_readiness = MergeReadiness {
            user_decision: Some(request.ready),
            note,
            decided_at: Some(timestamp()),
        };
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn mark_published(
        &self,
        app: &AppHandle,
        request: IntegrationPublicationRequest,
    ) -> Result<IntegrationCandidate, String> {
        if !request.confirmed {
            return Err(
                "Publication must be confirmed after the user verifies the target".to_owned(),
            );
        }
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        refresh_candidate_conflicts(candidate);
        if !candidate.conflicts.is_empty() {
            return Err("The candidate still has unresolved conflicts".to_owned());
        }
        let publication_ref = bounded_text(&request.publication_ref, "publication reference")?;
        if publication_ref.is_empty() {
            return Err(
                "Record the PR, commit, or release reference before confirming publication"
                    .to_owned(),
            );
        }
        candidate.status = IntegrationStatus::Published;
        candidate.published_ref = Some(publication_ref);
        candidate.merge_readiness.user_decision = Some(true);
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn abandon(
        &self,
        app: &AppHandle,
        request: IntegrationLifecycleRequest,
    ) -> Result<IntegrationCandidate, String> {
        if !request.confirmed {
            return Err("Abandonment requires explicit confirmation".to_owned());
        }
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        verify_candidate_path(candidate, &request.worktree_path)?;
        stop_candidate_processes(&self.processes, &candidate.id);
        candidate.status = IntegrationStatus::Abandoned;
        candidate.merge_readiness.user_decision = Some(false);
        candidate.preview.state = PreviewState::Stopped;
        candidate.preview.note = "Candidate abandoned. The Integration Worktree remains until you explicitly clean it up.".to_owned();
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn cleanup(
        &self,
        app: &AppHandle,
        request: IntegrationLifecycleRequest,
    ) -> Result<IntegrationCandidate, String> {
        if !request.confirmed {
            return Err("Integration Worktree cleanup requires explicit confirmation".to_owned());
        }
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Integration state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let candidate = candidate_mut(&mut state, &request.candidate_id)?;
        verify_candidate_path(candidate, &request.worktree_path)?;
        if !matches!(
            candidate.status,
            IntegrationStatus::Published | IntegrationStatus::Abandoned
        ) {
            return Err(
                "Cleanup is allowed only after publication or explicit abandonment".to_owned(),
            );
        }
        stop_candidate_processes(&self.processes, &candidate.id);
        let path = Path::new(&candidate.integration_worktree_path);
        if path.exists() {
            if !registered_worktree(
                Path::new(&candidate.repository_root),
                path,
                &candidate.integration_branch,
            )? {
                return Err("Cleanup stopped because the saved Integration Worktree target is not the registered candidate".to_owned());
            }
            let force = candidate.status == IntegrationStatus::Abandoned;
            if !force && !git_status_lines(path)?.is_empty() {
                return Err("Cleanup stopped because the published Integration Worktree is dirty; inspect it before removing it".to_owned());
            }
            let mut args = vec!["worktree".to_owned(), "remove".to_owned()];
            if force {
                args.push("--force".to_owned());
            }
            args.push(candidate.integration_worktree_path.clone());
            run_git(Path::new(&candidate.repository_root), &args)?;
        }
        candidate.worktree_cleaned = true;
        candidate.cleanup_at = Some(timestamp());
        candidate.updated_at = timestamp();
        let result = candidate.clone();
        write_state(app, &state)?;
        Ok(result)
    }
}

impl Drop for IntegrationRuntime {
    fn drop(&mut self) {
        if let Ok(processes) = self.processes.get_mut() {
            for process in processes.values_mut() {
                stop_child(&mut process.child);
            }
            processes.clear();
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_list(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
) -> Result<Vec<IntegrationCandidate>, String> {
    state.list(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_inspect(
    state: State<'_, IntegrationRuntime>,
    tasks: State<'_, AgentTaskRuntime>,
    app: AppHandle,
    request: IntegrationInspectRequest,
) -> Result<IntegrationInspection, String> {
    state.inspect(&app, &tasks, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_create(
    state: State<'_, IntegrationRuntime>,
    tasks: State<'_, AgentTaskRuntime>,
    app: AppHandle,
    request: IntegrationCreateRequest,
) -> Result<IntegrationCandidate, String> {
    state.create(&app, &tasks, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_refresh(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationCandidateRequest,
) -> Result<IntegrationCandidate, String> {
    state.refresh(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_run_profile_save(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationRunProfileRequest,
) -> Result<IntegrationCandidate, String> {
    state.save_profile(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_preview_start(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationPreviewRequest,
) -> Result<IntegrationCandidate, String> {
    state.start_preview(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_preview_status(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationCandidateRequest,
) -> Result<IntegrationCandidate, String> {
    state.preview_status(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_preview_stop(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationPreviewRequest,
) -> Result<IntegrationCandidate, String> {
    state.stop_preview(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_validation_record(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationValidationRequest,
) -> Result<IntegrationCandidate, String> {
    state.record_validation(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_rework_record(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationReworkRequest,
) -> Result<IntegrationCandidate, String> {
    state.record_rework(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_readiness_set(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationReadinessRequest,
) -> Result<IntegrationCandidate, String> {
    state.set_readiness(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_mark_published(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationPublicationRequest,
) -> Result<IntegrationCandidate, String> {
    state.mark_published(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_abandon(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationLifecycleRequest,
) -> Result<IntegrationCandidate, String> {
    state.abandon(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn integration_cleanup(
    state: State<'_, IntegrationRuntime>,
    app: AppHandle,
    request: IntegrationLifecycleRequest,
) -> Result<IntegrationCandidate, String> {
    state.cleanup(&app, request)
}

fn inspect_tasks(
    tasks: &[AgentTask],
    request: IntegrationInspectRequest,
) -> Result<IntegrationInspection, String> {
    if request.task_ids.len() < 2 {
        return Err(
            "Select at least two completed workstreams before inspecting integration".to_owned(),
        );
    }
    let selected = request
        .task_ids
        .iter()
        .map(|id| {
            tasks
                .iter()
                .find(|task| task.id == *id)
                .ok_or_else(|| format!("Agent Task is no longer saved: {id}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let repository_root = canonicalize_existing(Path::new(&selected[0].repository_root))?;
    let target_branch = request
        .target_branch
        .as_deref()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| default_target_branch(&repository_root));
    if !valid_branch_name(&target_branch) {
        return Err(format!("Invalid target branch: {target_branch}"));
    }
    let target_revision = git_revision(&repository_root, &target_branch).unwrap_or_default();
    let integration_worktree_root = request
        .integration_worktree_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_integration_root(&repository_root))
        .to_string_lossy()
        .into_owned();

    let mut blockers = Vec::new();
    if target_revision.is_empty() {
        blockers.push(format!(
            "Target branch does not resolve locally: {target_branch}"
        ));
    }
    let mut workstreams = Vec::new();
    for task in &selected {
        let mut workstream = IntegrationWorkstream {
            task_id: task.id.clone(),
            task_summary: task.task_summary.clone(),
            agent_name: task.agent_name.clone(),
            repository_root: task.repository_root.clone(),
            base_branch: task.base_branch.clone(),
            task_branch: task.task_branch.clone(),
            source_worktree_path: task.worktree_path.clone(),
            source_revision: String::new(),
            source_dirty: false,
            changed_paths: Vec::new(),
            commits: Vec::new(),
            checks: Vec::new(),
            eligible: true,
            eligibility_detail: "Ready for integration review.".to_owned(),
        };
        if !matches!(
            task.status,
            AgentTaskStatus::Ready | AgentTaskStatus::HandoffReady
        ) {
            workstream.eligible = false;
            workstream.eligibility_detail =
                "The task must be Ready or Handoff ready; active writers stay outside integration."
                    .to_owned();
            blockers.push(format!(
                "{} is not complete for integration ({:?})",
                task.id, task.status
            ));
        }
        if task.lease.is_some() {
            workstream.eligible = false;
            workstream.eligibility_detail =
                "Release the Worktree Lease before integrating this workstream.".to_owned();
            blockers.push(format!(
                "{} still has an active or reserved Worktree Lease",
                task.id
            ));
        }
        let source_path = Path::new(&task.worktree_path);
        if !source_path.is_dir() {
            workstream.eligible = false;
            workstream.eligibility_detail = "The saved source Worktree path is missing.".to_owned();
            blockers.push(format!("{} source Worktree is missing", task.id));
        } else {
            match common_git_dir(source_path) {
                Ok(common_dir) => {
                    let expected = common_git_dir(&repository_root);
                    if expected.ok().as_ref() != Some(&common_dir) {
                        workstream.eligible = false;
                        blockers.push(format!("{} belongs to a different Git repository", task.id));
                    }
                }
                Err(error) => {
                    workstream.eligible = false;
                    blockers.push(format!(
                        "{} source Worktree is not a Git Worktree: {error}",
                        task.id
                    ));
                }
            }
            match git_status_lines(source_path) {
                Ok(lines) if !lines.is_empty() => {
                    workstream.source_dirty = true;
                    workstream.eligible = false;
                    workstream.eligibility_detail =
                        "Uncommitted source changes are not included; commit or discard them first.".to_owned();
                    blockers.push(format!("{} has uncommitted source changes", task.id));
                }
                Ok(_) => {}
                Err(error) => blockers.push(format!("Could not read {} status: {error}", task.id)),
            }
        }
        if !branch_exists(&repository_root, &task.task_branch).unwrap_or(false) {
            workstream.eligible = false;
            blockers.push(format!(
                "{} branch does not resolve locally: {}",
                task.id, task.task_branch
            ));
        } else {
            workstream.source_revision =
                git_revision(&repository_root, &task.task_branch).unwrap_or_default();
            match diff_paths(&repository_root, &task.base_branch, &task.task_branch) {
                Ok(paths) => workstream.changed_paths = paths,
                Err(error) => {
                    blockers.push(format!("Could not read {} changed paths: {error}", task.id))
                }
            }
            match commit_list(&repository_root, &task.base_branch, &task.task_branch) {
                Ok(commits) => workstream.commits = commits,
                Err(error) => blockers.push(format!("Could not read {} commits: {error}", task.id)),
            }
        }
        workstream.checks =
            collect_checks(source_path, &task.task_branch, &workstream.source_revision);
        workstreams.push(workstream);
    }
    if workstreams
        .iter()
        .any(|workstream| workstream.repository_root != selected[0].repository_root)
    {
        blockers.push("All selected Agent Tasks must belong to the same repository".to_owned());
    }
    let likely_conflicts = conflicts_for_workstreams(&workstreams);
    if !likely_conflicts.is_empty() {
        blockers.push(format!(
            "{} path overlap(s) may conflict; the Integration Worktree will confirm the result",
            likely_conflicts.len()
        ));
    }
    let can_create = blockers
        .iter()
        .all(|blocker| !blocker.contains("may conflict"))
        && workstreams.iter().all(|workstream| workstream.eligible)
        && !target_revision.is_empty();
    Ok(IntegrationInspection {
        repository_root: repository_root.to_string_lossy().into_owned(),
        target_branch,
        target_revision,
        integration_worktree_root,
        strategy: request.strategy.unwrap_or(IntegrationStrategy::MergeNoFf),
        selected_workstreams: workstreams,
        likely_conflicts,
        blockers,
        can_create,
        inspected_at: timestamp(),
    })
}

fn apply_strategy(candidate: &IntegrationCandidate, repository: &Path) -> Result<String, String> {
    let mut log = format!(
        "Target: {} at {}\nStrategy: {:?}\n",
        candidate.target_branch, candidate.target_revision, candidate.strategy
    );
    for workstream in &candidate.selected_workstreams {
        let args = match candidate.strategy {
            IntegrationStrategy::MergeNoFf => vec![
                "merge".to_owned(),
                "--no-edit".to_owned(),
                "--no-ff".to_owned(),
                workstream.task_branch.clone(),
            ],
            IntegrationStrategy::CherryPick => {
                let commits =
                    commit_hashes(repository, &workstream.base_branch, &workstream.task_branch)?;
                if commits.is_empty() {
                    return Err(format!(
                        "{} has no commits to cherry-pick",
                        workstream.task_id
                    ));
                }
                let mut commands = String::new();
                for commit in commits {
                    let result = run_git(
                        Path::new(&candidate.integration_worktree_path),
                        &["cherry-pick".to_owned(), commit.clone()],
                    )?;
                    commands.push_str(&format_process_result(&result));
                    if !result.success {
                        return Err(format!(
                            "Cherry-pick paused for {} at {}\n{}",
                            workstream.task_id, commit, commands
                        ));
                    }
                }
                log.push_str(&format!(
                    "Cherry-picked {}\n{}",
                    workstream.task_branch, commands
                ));
                continue;
            }
        };
        let result = run_git(Path::new(&candidate.integration_worktree_path), &args)?;
        log.push_str(&format!(
            "Integrated {}\n{}",
            workstream.task_branch,
            format_process_result(&result)
        ));
        if !result.success {
            return Err(log);
        }
    }
    Ok(log)
}

fn validate_profile(profile: &RunProfile) -> Result<(), String> {
    if profile.name.trim().is_empty() {
        return Err("Run Profile name is required".to_owned());
    }
    if profile.components.is_empty() {
        return Err("Run Profile needs at least one component".to_owned());
    }
    let mut ids = HashSet::new();
    for component in &profile.components {
        if component.id.trim().is_empty() || !ids.insert(component.id.clone()) {
            return Err("Run Profile component IDs must be non-empty and unique".to_owned());
        }
        if component.name.trim().is_empty() || component.executable.trim().is_empty() {
            return Err(format!(
                "Run Profile component {} needs a name and executable",
                component.id
            ));
        }
        validate_text(&component.executable, "component executable")?;
        for argument in &component.arguments {
            validate_text(argument, "component argument")?;
        }
        for (key, value) in &component.environment {
            validate_text(key, "environment key")?;
            validate_text(value, "environment value")?;
        }
        if let HealthCheck::Tcp { host, .. } = &component.health_check {
            validate_text(host, "health check host")?;
        }
    }
    for component in &profile.components {
        for dependency in &component.depends_on {
            if !ids.contains(dependency) {
                return Err(format!(
                    "Run Profile component {} depends on unknown component {}",
                    component.id, dependency
                ));
            }
        }
    }
    let _ = ordered_components(profile, &[])?;
    Ok(())
}

fn ordered_components(
    profile: &RunProfile,
    selected_ids: &[String],
) -> Result<Vec<RunProfileComponent>, String> {
    let by_id = profile
        .components
        .iter()
        .map(|component| (component.id.clone(), component.clone()))
        .collect::<HashMap<_, _>>();
    let roots = if selected_ids.is_empty() {
        profile
            .components
            .iter()
            .map(|component| component.id.clone())
            .collect::<Vec<_>>()
    } else {
        selected_ids.to_vec()
    };
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let mut order = Vec::new();
    for root in roots {
        visit_component(&root, &by_id, &mut visiting, &mut visited, &mut order)?;
    }
    Ok(order
        .into_iter()
        .filter_map(|id| by_id.get(&id).cloned())
        .collect())
}

fn visit_component(
    id: &str,
    by_id: &HashMap<String, RunProfileComponent>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    order: &mut Vec<String>,
) -> Result<(), String> {
    if visited.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id.to_owned()) {
        return Err(format!("Run Profile dependency cycle includes {id}"));
    }
    let component = by_id
        .get(id)
        .ok_or_else(|| format!("Run Profile component not found: {id}"))?;
    for dependency in &component.depends_on {
        visit_component(dependency, by_id, visiting, visited, order)?;
    }
    visiting.remove(id);
    visited.insert(id.to_owned());
    order.push(id.to_owned());
    Ok(())
}

fn resolve_component_cwd(root: &Path, requested: &Option<String>) -> Result<PathBuf, String> {
    let path = requested
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let resolved = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    let canonical = canonicalize_existing(&resolved)?;
    if !path_is_inside(root, &canonical) {
        return Err(format!(
            "Run Profile cwd escapes the Integration Worktree: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn update_component_state(
    candidate: &mut IntegrationCandidate,
    component: &RunProfileComponent,
    state: PreviewState,
    pid: Option<u32>,
    exit_code: Option<i32>,
    detail: &str,
    started_at: Option<String>,
) {
    if let Some(existing) = find_component_mut(candidate, &component.id) {
        existing.state = state;
        existing.pid = pid;
        existing.port = component.port;
        existing.exit_code = exit_code;
        existing.health_detail = bounded_text_lossy(detail);
        if started_at.is_some() {
            existing.started_at = started_at;
        }
    } else {
        candidate.preview.components.push(PreviewComponentState {
            id: component.id.clone(),
            name: component.name.clone(),
            state,
            pid,
            port: component.port,
            logs: String::new(),
            exit_code,
            health_detail: bounded_text_lossy(detail),
            started_at,
        });
    }
}

fn find_component<'a>(
    candidate: &'a IntegrationCandidate,
    id: &str,
) -> Option<&'a PreviewComponentState> {
    candidate
        .preview
        .components
        .iter()
        .find(|component| component.id == id)
}

fn find_component_mut<'a>(
    candidate: &'a mut IntegrationCandidate,
    id: &str,
) -> Option<&'a mut PreviewComponentState> {
    candidate
        .preview
        .components
        .iter_mut()
        .find(|component| component.id == id)
}

fn derive_preview_state(components: &[PreviewComponentState]) -> PreviewState {
    if components.is_empty() {
        return PreviewState::Stopped;
    }
    if components
        .iter()
        .any(|component| component.state == PreviewState::Failed)
    {
        return PreviewState::Failed;
    }
    if components
        .iter()
        .any(|component| component.state == PreviewState::Starting)
    {
        return PreviewState::Starting;
    }
    if components
        .iter()
        .any(|component| component.state == PreviewState::Degraded)
    {
        return PreviewState::Degraded;
    }
    if components
        .iter()
        .all(|component| component.state == PreviewState::Stopped)
    {
        PreviewState::Stopped
    } else {
        PreviewState::Healthy
    }
}

fn preview_note(preview: &ConnectedPreview) -> String {
    match preview.state {
        PreviewState::Healthy => {
            "All started components passed their declared health checks.".to_owned()
        }
        PreviewState::Degraded => {
            "Processes are running, but at least one declared health check is not passing."
                .to_owned()
        }
        PreviewState::Failed => {
            "At least one component failed to start or exited with an error; inspect its logs."
                .to_owned()
        }
        PreviewState::Starting => {
            "Processes are starting; refresh again for health results.".to_owned()
        }
        PreviewState::Stopped => "All preview processes are stopped.".to_owned(),
    }
}

fn check_health(check: &HealthCheck) -> (bool, String) {
    match check {
        HealthCheck::None => (
            true,
            "process is running; no health probe declared".to_owned(),
        ),
        HealthCheck::Tcp {
            host,
            port,
            timeout_ms,
        } => {
            let timeout = Duration::from_millis(timeout_ms.unwrap_or(750).clamp(100, 5_000));
            let address = match (host.as_str(), *port)
                .to_socket_addrs()
                .ok()
                .and_then(|mut addresses| addresses.next())
            {
                Some(address) => address,
                None => return (false, format!("could not resolve {host}:{port}")),
            };
            match TcpStream::connect_timeout(&address, timeout) {
                Ok(_) => (true, format!("TCP health check passed on {host}:{port}")),
                Err(error) => (
                    false,
                    format!("TCP health check failed on {host}:{port}: {error}"),
                ),
            }
        }
    }
}

fn spawn_log_reader<R>(stream: R, label: String, logs: Arc<Mutex<VecDeque<String>>>)
where
    R: Read + Send + 'static,
{
    let _ = thread::Builder::new()
        .name("arkonad-preview-log".to_owned())
        .spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => append_log(&logs, format!("[{label}] {}", line.trim_end())),
                    Err(error) => {
                        append_log(&logs, format!("[{label}] log read failed: {error}"));
                        break;
                    }
                }
            }
        });
}

fn append_log(logs: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut logs) = logs.lock() {
        logs.push_back(line);
        let mut size = logs.iter().map(|line| line.len() + 1).sum::<usize>();
        while size > MAX_LOG_BYTES {
            if let Some(removed) = logs.pop_front() {
                size = size.saturating_sub(removed.len() + 1);
            } else {
                break;
            }
        }
    }
}

fn log_string(logs: &Arc<Mutex<VecDeque<String>>>) -> String {
    logs.lock()
        .map(|logs| logs.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_else(|_| "Preview log is unavailable".to_owned())
}

fn stop_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn stop_candidate_processes(
    processes: &Mutex<HashMap<PreviewProcessKey, ManagedPreviewProcess>>,
    candidate_id: &str,
) {
    if let Ok(mut processes) = processes.lock() {
        let keys = processes
            .keys()
            .filter(|key| key.candidate_id == candidate_id)
            .cloned()
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(mut process) = processes.remove(&key) {
                stop_child(&mut process.child);
            }
        }
    }
}

fn refresh_candidate_conflicts(candidate: &mut IntegrationCandidate) {
    if candidate.worktree_cleaned || !Path::new(&candidate.integration_worktree_path).exists() {
        return;
    }
    let unresolved = git_unmerged_paths(Path::new(&candidate.integration_worktree_path));
    candidate.conflicts = conflicts_for_paths(&unresolved, &candidate.selected_workstreams);
    if candidate.conflicts.is_empty() && candidate.status == IntegrationStatus::Conflicted {
        candidate.status = IntegrationStatus::Ready;
        candidate.error_message = None;
    } else if !candidate.conflicts.is_empty() {
        candidate.status = IntegrationStatus::Conflicted;
    }
}

fn conflicts_for_workstreams(workstreams: &[IntegrationWorkstream]) -> Vec<IntegrationConflict> {
    let mut owners: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for workstream in workstreams {
        for path in &workstream.changed_paths {
            owners
                .entry(path.clone())
                .or_default()
                .push(workstream.task_id.clone());
        }
    }
    owners
        .into_iter()
        .filter(|(_, workstream_ids)| workstream_ids.len() > 1)
        .map(|(path, workstream_ids)| IntegrationConflict {
            path,
            workstream_ids,
            reason: "The selected workstreams changed the same path; this is a likely conflict, not a merge result.".to_owned(),
        })
        .collect()
}

fn conflicts_for_paths(
    paths: &[String],
    workstreams: &[IntegrationWorkstream],
) -> Vec<IntegrationConflict> {
    paths
        .iter()
        .map(|path| {
            let workstream_ids = workstreams
                .iter()
                .filter(|workstream| {
                    workstream
                        .changed_paths
                        .iter()
                        .any(|changed| changed == path)
                })
                .map(|workstream| workstream.task_id.clone())
                .collect::<Vec<_>>();
            IntegrationConflict {
                path: path.clone(),
                workstream_ids: if workstream_ids.is_empty() {
                    vec!["unknown".to_owned()]
                } else {
                    workstream_ids
                },
                reason: "Git left this path unresolved in the Integration Worktree.".to_owned(),
            }
        })
        .collect()
}

fn collect_checks(worktree: &Path, branch: &str, revision: &str) -> Vec<IntegrationCheck> {
    let args = vec![
        "pr".to_owned(),
        "list".to_owned(),
        "--head".to_owned(),
        branch.to_owned(),
        "--state".to_owned(),
        "all".to_owned(),
        "--json".to_owned(),
        "number,title,url,state,isDraft,headRefOid".to_owned(),
    ];
    let result = match run_program("gh", worktree, &args) {
        Ok(result) if result.success => result,
        Ok(result) => {
            return vec![IntegrationCheck {
                name: "GitHub checks".to_owned(),
                status: "unavailable".to_owned(),
                detail: bounded_text_lossy(&format_process_result(&result)),
                url: None,
            }]
        }
        Err(error) => {
            return vec![IntegrationCheck {
                name: "GitHub checks".to_owned(),
                status: "unavailable".to_owned(),
                detail: error,
                url: None,
            }]
        }
    };
    let pull_requests =
        serde_json::from_str::<Vec<serde_json::Value>>(&result.stdout).unwrap_or_default();
    let selected = pull_requests.iter().find(|pull_request| {
        revision.is_empty()
            || pull_request
                .get("headRefOid")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|head| head == revision)
    });
    let Some(pull_request) = selected.or_else(|| pull_requests.first()) else {
        return vec![IntegrationCheck {
            name: "GitHub checks".to_owned(),
            status: "not available".to_owned(),
            detail: format!("No pull request was found for branch {branch}."),
            url: None,
        }];
    };
    let number = pull_request
        .get("number")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    let title =
        json_string(pull_request, "title").unwrap_or_else(|| "untitled pull request".to_owned());
    let url = json_string(pull_request, "url");
    let state = json_string(pull_request, "state").unwrap_or_else(|| "unknown".to_owned());
    let mut checks = vec![IntegrationCheck {
        name: format!("PR #{number} · {title}"),
        status: state,
        detail: "Pull request metadata found for this workstream.".to_owned(),
        url,
    }];
    if number == 0 {
        return checks;
    }
    let check_result = run_program(
        "gh",
        worktree,
        &[
            "pr".to_owned(),
            "checks".to_owned(),
            number.to_string(),
            "--json".to_owned(),
            "name,state,link,workflow".to_owned(),
        ],
    );
    match check_result {
        Ok(result) if result.success => {
            let values =
                serde_json::from_str::<Vec<serde_json::Value>>(&result.stdout).unwrap_or_default();
            if values.is_empty() {
                checks.push(IntegrationCheck {
                    name: "PR checks".to_owned(),
                    status: "not reported".to_owned(),
                    detail: "The pull request has no reported checks yet.".to_owned(),
                    url: None,
                });
            } else {
                for value in values {
                    checks.push(IntegrationCheck {
                        name: json_string(&value, "name")
                            .unwrap_or_else(|| "unnamed check".to_owned()),
                        status: json_string(&value, "state")
                            .unwrap_or_else(|| "unknown".to_owned()),
                        detail: json_string(&value, "workflow").unwrap_or_default(),
                        url: json_string(&value, "link"),
                    });
                }
            }
        }
        Ok(result) => checks.push(IntegrationCheck {
            name: "PR checks".to_owned(),
            status: "unavailable".to_owned(),
            detail: bounded_text_lossy(&format_process_result(&result)),
            url: None,
        }),
        Err(error) => checks.push(IntegrationCheck {
            name: "PR checks".to_owned(),
            status: "unavailable".to_owned(),
            detail: error,
            url: None,
        }),
    }
    checks
}

fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

fn read_state(app: &AppHandle) -> Result<IntegrationStateFile, String> {
    let path = state_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => {
            let state = serde_json::from_str::<IntegrationStateFile>(&contents)
                .map_err(|error| format!("Integration state is corrupt: {error}"))?;
            if state.schema_version != CURRENT_SCHEMA_VERSION {
                return Err(format!(
                    "Integration state version {} is not supported",
                    state.schema_version
                ));
            }
            Ok(state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(IntegrationStateFile {
            schema_version: CURRENT_SCHEMA_VERSION,
            ..IntegrationStateFile::default()
        }),
        Err(error) => Err(format!("could not read Integration state: {error}")),
    }
}

fn write_state(app: &AppHandle, state: &IntegrationStateFile) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create Integration state directory: {error}"))?;
    }
    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("could not encode Integration state: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents)
        .map_err(|error| format!("could not write Integration state: {error}"))?;
    if let Err(rename_error) = fs::rename(&temporary, &path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("could not replace Integration state: {error}"))?;
            fs::rename(&temporary, &path)
                .map_err(|error| format!("could not replace Integration state: {error}"))?;
        } else {
            return Err(format!(
                "could not publish Integration state: {rename_error}"
            ));
        }
    }
    Ok(())
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(STATE_FILE_NAME))
        .map_err(|error| format!("could not resolve Integration state directory: {error}"))
}

fn candidate_mut<'a>(
    state: &'a mut IntegrationStateFile,
    id: &str,
) -> Result<&'a mut IntegrationCandidate, String> {
    state
        .candidates
        .iter_mut()
        .find(|candidate| candidate.id == id)
        .ok_or_else(|| format!("Unknown Integration candidate: {id}"))
}

fn replace_candidate(
    state: &mut IntegrationStateFile,
    candidate: &IntegrationCandidate,
) -> Result<(), String> {
    let saved = state
        .candidates
        .iter_mut()
        .find(|saved| saved.id == candidate.id)
        .ok_or_else(|| format!("Unknown Integration candidate: {}", candidate.id))?;
    *saved = candidate.clone();
    Ok(())
}

fn verify_candidate_path(candidate: &IntegrationCandidate, requested: &str) -> Result<(), String> {
    if requested.trim().is_empty()
        || !same_path(
            Path::new(requested),
            Path::new(&candidate.integration_worktree_path),
        )
    {
        return Err(
            "The requested cleanup target does not match the saved Integration Worktree path"
                .to_owned(),
        );
    }
    Ok(())
}

fn git_status_lines(path: &Path) -> Result<Vec<String>, String> {
    let result = run_git(path, &["status".to_owned(), "--porcelain=v1".to_owned()])?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    Ok(result
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

fn git_unmerged_paths(path: &Path) -> Vec<String> {
    run_git(
        path,
        &[
            "diff".to_owned(),
            "--name-only".to_owned(),
            "--diff-filter=U".to_owned(),
        ],
    )
    .ok()
    .filter(|result| result.success)
    .map(|result| {
        result
            .stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect()
    })
    .unwrap_or_default()
}

fn diff_paths(repository: &Path, base: &str, branch: &str) -> Result<Vec<String>, String> {
    let result = run_git(
        repository,
        &[
            "diff".to_owned(),
            "--name-only".to_owned(),
            format!("{base}...{branch}"),
        ],
    )?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    Ok(result
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

fn commit_list(
    repository: &Path,
    base: &str,
    branch: &str,
) -> Result<Vec<IntegrationCommit>, String> {
    let result = run_git(
        repository,
        &[
            "log".to_owned(),
            "--format=%H%x09%h%x09%s".to_owned(),
            "--max-count=100".to_owned(),
            format!("{base}..{branch}"),
        ],
    )?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    Ok(result
        .stdout
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(3, '\t');
            Some(IntegrationCommit {
                hash: fields.next()?.to_owned(),
                short_hash: fields.next()?.to_owned(),
                subject: fields.next()?.to_owned(),
            })
        })
        .collect())
}

fn commit_hashes(repository: &Path, base: &str, branch: &str) -> Result<Vec<String>, String> {
    let result = run_git(
        repository,
        &[
            "log".to_owned(),
            "--format=%H".to_owned(),
            "--reverse".to_owned(),
            format!("{base}..{branch}"),
        ],
    )?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    Ok(result
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

fn branch_exists(repository: &Path, branch: &str) -> Result<bool, String> {
    if !valid_branch_name(branch) {
        return Ok(false);
    }
    let result = run_git(
        repository,
        &[
            "show-ref".to_owned(),
            "--verify".to_owned(),
            format!("refs/heads/{branch}"),
        ],
    )?;
    Ok(result.success)
}

fn git_revision(repository: &Path, revision: &str) -> Result<String, String> {
    let result = run_git(
        repository,
        &[
            "rev-parse".to_owned(),
            "--verify".to_owned(),
            format!("{revision}^{{commit}}"),
        ],
    )?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    Ok(result.stdout.trim().to_owned())
}

fn common_git_dir(path: &Path) -> Result<PathBuf, String> {
    let result = run_git(
        path,
        &[
            "rev-parse".to_owned(),
            "--path-format=absolute".to_owned(),
            "--git-common-dir".to_owned(),
        ],
    )?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    canonicalize_existing(Path::new(result.stdout.trim()))
}

fn registered_worktree(repository: &Path, path: &Path, branch: &str) -> Result<bool, String> {
    let result = run_git(
        repository,
        &[
            "worktree".to_owned(),
            "list".to_owned(),
            "--porcelain".to_owned(),
        ],
    )?;
    if !result.success {
        return Err(format_process_result(&result));
    }
    let expected = canonicalize_with_missing(path)?;
    let expected_branch = format!("refs/heads/{branch}");
    let mut current_path = None;
    let mut current_branch = None;
    for line in result.stdout.lines().chain(std::iter::once("")) {
        if let Some(value) = line.strip_prefix("worktree ") {
            current_path = Some(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("branch ") {
            current_branch = Some(value.trim().to_owned());
        } else if line.is_empty() {
            if let Some(value) = current_path.take() {
                let matches_path = canonicalize_with_missing(Path::new(&value))
                    .map(|actual| actual == expected)
                    .unwrap_or(false);
                if matches_path && current_branch.as_deref() == Some(expected_branch.as_str()) {
                    return Ok(true);
                }
            }
            current_branch = None;
        }
    }
    Ok(false)
}

fn run_git(path: &Path, args: &[String]) -> Result<ProcessResult, String> {
    run_program("git", path, args)
}

fn run_program(program: &str, path: &Path, args: &[String]) -> Result<ProcessResult, String> {
    if !path.is_dir() {
        return Err(format!(
            "working directory does not exist: {}",
            path.display()
        ));
    }
    let output = Command::new(program)
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|error| format!("could not start {program}: {error}"))?;
    Ok(ProcessResult {
        success: output.status.success(),
        code: output.status.code(),
        stdout: bounded_text_lossy(&String::from_utf8_lossy(&output.stdout)),
        stderr: bounded_text_lossy(&String::from_utf8_lossy(&output.stderr)),
    })
}

#[derive(Debug)]
struct ProcessResult {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn format_process_result(result: &ProcessResult) -> String {
    let mut output = String::new();
    if !result.stdout.trim().is_empty() {
        output.push_str(result.stdout.trim());
    }
    if !result.stderr.trim().is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(result.stderr.trim());
    }
    if output.is_empty() {
        format!("process exited with {}", exit_code_label(result.code))
    } else {
        output
    }
}

fn exit_code_label(code: Option<i32>) -> String {
    code.map(|code| code.to_string())
        .unwrap_or_else(|| "no exit code".to_owned())
}

fn default_target_branch(repository: &Path) -> String {
    let remote_head = run_git(
        repository,
        &[
            "symbolic-ref".to_owned(),
            "--short".to_owned(),
            "refs/remotes/origin/HEAD".to_owned(),
        ],
    )
    .ok()
    .filter(|result| result.success)
    .and_then(|result| {
        result
            .stdout
            .trim()
            .strip_prefix("origin/")
            .map(str::to_owned)
    });
    if let Some(branch) = remote_head {
        return branch;
    }
    for branch in ["main", "master", "develop"] {
        if branch_exists(repository, branch).unwrap_or(false) {
            return branch.to_owned();
        }
    }
    "main".to_owned()
}

fn default_integration_root(repository: &Path) -> PathBuf {
    repository
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("arkonad-integrations")
}

fn validate_integration_root(repository: &Path, root: &Path) -> Result<(), String> {
    let repository = canonicalize_existing(repository)?;
    let root = canonicalize_with_missing(root)?;
    if root == repository || path_is_inside(&repository, &root) {
        return Err("Integration Worktrees must be outside the repository checkout".to_owned());
    }
    Ok(())
}

fn valid_branch_name(branch: &str) -> bool {
    !branch.trim().is_empty()
        && run_program(
            "git",
            Path::new("."),
            &[
                "check-ref-format".to_owned(),
                "--branch".to_owned(),
                branch.to_owned(),
            ],
        )
        .map(|result| result.success)
        .unwrap_or(false)
}

fn format_inspection_blockers(inspection: &IntegrationInspection) -> String {
    if inspection.blockers.is_empty() {
        "Integration inspection did not produce a usable candidate".to_owned()
    } else {
        format!(
            "Integration stopped before creating a Worktree:\n- {}",
            inspection.blockers.join("\n- ")
        )
    }
}

fn bounded_text(value: &str, label: &str) -> Result<String, String> {
    validate_text(value, label)?;
    if value.len() > MAX_TEXT_BYTES {
        return Err(format!("{label} is too long"));
    }
    Ok(value.trim().to_owned())
}

fn bounded_text_lossy(value: &str) -> String {
    if value.len() <= MAX_TEXT_BYTES {
        value.to_owned()
    } else {
        let mut end = MAX_TEXT_BYTES;
        while end > 0 && !value.is_char_boundary(end) {
            end -= 1;
        }
        value[..end].to_owned()
    }
}

fn validate_text(value: &str, label: &str) -> Result<(), String> {
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains control characters"));
    }
    Ok(())
}

fn normalized_choice(value: &str, allowed: &[&str]) -> Result<String, String> {
    let value = value.trim().to_lowercase();
    if allowed.iter().any(|allowed| *allowed == value) {
        Ok(value)
    } else {
        Err(format!("Expected one of: {}", allowed.join(", ")))
    }
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|error| format!("could not resolve {}: {error}", path.display()))
}

fn canonicalize_with_missing(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return canonicalize_existing(path);
    }
    let mut missing = Vec::new();
    let mut current = path;
    while !current.exists() {
        missing.push(
            current
                .file_name()
                .ok_or_else(|| "path has no file name".to_owned())?
                .to_owned(),
        );
        current = current
            .parent()
            .ok_or_else(|| "path has no existing ancestor".to_owned())?;
    }
    let mut resolved = canonicalize_existing(current)?;
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn path_is_inside(parent: &Path, child: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (
        canonicalize_with_missing(left),
        canonicalize_with_missing(right),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn next_integration_id() -> String {
    format!(
        "integration-{}-{}",
        timestamp_millis(),
        NEXT_INTEGRATION_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn timestamp() -> String {
    timestamp_millis().to_string()
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn component(id: &str, depends_on: &[&str]) -> RunProfileComponent {
        RunProfileComponent {
            id: id.to_owned(),
            name: id.to_owned(),
            executable: "test".to_owned(),
            arguments: Vec::new(),
            cwd: None,
            environment: BTreeMap::new(),
            port: None,
            health_check: HealthCheck::None,
            depends_on: depends_on.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    #[test]
    fn overlapping_workstreams_are_named_without_claiming_a_merge_conflict() {
        let first = IntegrationWorkstream {
            task_id: "task-a".to_owned(),
            task_summary: String::new(),
            agent_name: "A".to_owned(),
            repository_root: "repo".to_owned(),
            base_branch: "main".to_owned(),
            task_branch: "a".to_owned(),
            source_worktree_path: "a".to_owned(),
            source_revision: "1".to_owned(),
            source_dirty: false,
            changed_paths: vec!["src/shared.ts".to_owned()],
            commits: Vec::new(),
            checks: Vec::new(),
            eligible: true,
            eligibility_detail: String::new(),
        };
        let mut second = first.clone();
        second.task_id = "task-b".to_owned();
        assert_eq!(conflicts_for_workstreams(&[first, second]).len(), 1);
        assert!(conflicts_for_workstreams(&[]).is_empty());
    }

    #[test]
    fn run_profile_dependencies_are_started_before_dependents() {
        let profile = RunProfile {
            id: "profile".to_owned(),
            name: "Preview".to_owned(),
            entry_point: None,
            components: vec![
                component("frontend", &["backend"]),
                component("backend", &[]),
            ],
            updated_at: String::new(),
        };
        let ordered = ordered_components(&profile, &["frontend".to_owned()]).expect("ordered");
        assert_eq!(
            ordered
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["backend", "frontend"]
        );
    }

    #[test]
    fn run_profile_cycles_are_rejected() {
        let profile = RunProfile {
            id: "profile".to_owned(),
            name: "Preview".to_owned(),
            entry_point: None,
            components: vec![component("a", &["b"]), component("b", &["a"])],
            updated_at: String::new(),
        };
        assert!(ordered_components(&profile, &[]).is_err());
    }

    #[test]
    fn preview_state_is_degraded_when_a_health_probe_fails() {
        let components = vec![PreviewComponentState {
            id: "backend".to_owned(),
            name: "Backend".to_owned(),
            state: PreviewState::Degraded,
            pid: Some(7),
            port: Some(4000),
            logs: String::new(),
            exit_code: None,
            health_detail: "not listening".to_owned(),
            started_at: None,
        }];
        assert_eq!(derive_preview_state(&components), PreviewState::Degraded);
    }
}
