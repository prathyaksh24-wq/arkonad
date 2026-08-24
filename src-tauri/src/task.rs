use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::pty::SessionManager;

const TASK_STATE_FILE_NAME: &str = "agent-tasks.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;
const MIN_FREE_SPACE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_HANDOFF_FIELD_BYTES: usize = 12 * 1024;
static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentTaskStatus {
    Preparing,
    Ready,
    Active,
    HandoffReady,
    SetupFailed,
    Cancelled,
    CancelledPreserved,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeLeaseStatus {
    Reserved,
    Active,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeLease {
    pub owner_id: String,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub status: WorktreeLeaseStatus,
    pub acquired_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlHandoff {
    pub id: String,
    pub previous_owner: String,
    pub new_owner: String,
    pub new_owner_name: String,
    pub branch: String,
    pub worktree_path: String,
    pub changes: String,
    pub checks: String,
    pub pending_decisions: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub status: AgentTaskStatus,
    pub repository_root: String,
    pub base_branch: String,
    pub task_branch: String,
    pub worktree_root: String,
    pub worktree_path: String,
    pub task_summary: String,
    pub agent_id: String,
    pub agent_name: String,
    pub permission_mode: String,
    pub lease: Option<WorktreeLease>,
    #[serde(default)]
    pub handoffs: Vec<ControlHandoff>,
    #[serde(default)]
    pub failure_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskPlanRequest {
    pub repository_root: String,
    #[serde(default)]
    pub task_summary: String,
    #[serde(default)]
    pub base_branch: Option<String>,
    #[serde(default)]
    pub task_branch: Option<String>,
    #[serde(default)]
    pub worktree_root: Option<String>,
    pub agent_id: String,
    pub agent_name: String,
    pub permission_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskPlan {
    pub repository_root: Option<String>,
    pub repository_name: Option<String>,
    pub base_branch: Option<String>,
    pub task_branch: Option<String>,
    pub worktree_root: Option<String>,
    pub worktree_path: Option<String>,
    pub task_summary: String,
    pub agent_id: String,
    pub agent_name: String,
    pub permission_mode: String,
    pub repository_status: String,
    pub repository_status_detail: String,
    pub free_space_bytes: Option<u64>,
    pub free_space_ok: bool,
    pub can_create: bool,
    pub blockers: Vec<String>,
    pub recovery_options: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskClaimRequest {
    pub task_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub permission_mode: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskReleaseRequest {
    pub task_id: String,
    pub owner_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskHandoffRequest {
    pub task_id: String,
    pub current_owner: String,
    pub new_owner: String,
    #[serde(default)]
    pub new_owner_name: Option<String>,
    #[serde(default)]
    pub changes: String,
    #[serde(default)]
    pub checks: String,
    #[serde(default)]
    pub pending_decisions: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskCancelRequest {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskCancelResult {
    pub task: AgentTask,
    pub action: String,
    pub removed_worktree: bool,
    pub preserved_worktree: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentTaskStateFile {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    tasks: Vec<AgentTask>,
}

#[derive(Debug, Default)]
pub struct AgentTaskRuntime {
    state_lock: Mutex<()>,
}

impl AgentTaskRuntime {
    pub fn list(&self, app: &AppHandle) -> Result<Vec<AgentTask>, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Agent Task state is unavailable".to_owned())?;
        Ok(read_state(app)?.tasks)
    }

    pub fn plan(&self, request: AgentTaskPlanRequest) -> AgentTaskPlan {
        build_plan(request)
    }

    pub fn create(
        &self,
        app: &AppHandle,
        request: AgentTaskPlanRequest,
    ) -> Result<AgentTask, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Agent Task state is unavailable".to_owned())?;
        let plan = build_plan(request.clone());
        if !plan.can_create {
            return Err(plan_error(&plan));
        }
        let repository_root = PathBuf::from(required_plan_value(
            plan.repository_root.as_deref(),
            "repository",
        )?);
        let base_branch = required_plan_value(plan.base_branch.as_deref(), "base branch")?;
        let task_branch = required_plan_value(plan.task_branch.as_deref(), "task branch")?;
        let worktree_root = PathBuf::from(required_plan_value(
            plan.worktree_root.as_deref(),
            "Worktree root",
        )?);
        let worktree_path = PathBuf::from(required_plan_value(
            plan.worktree_path.as_deref(),
            "worktree path",
        )?);

        let mut state = read_state(app)?;
        if state.tasks.iter().any(|task| {
            !matches!(
                task.status,
                AgentTaskStatus::Cancelled | AgentTaskStatus::CancelledPreserved
            ) && (same_path(Path::new(&task.worktree_path), &worktree_path)
                || task.task_branch == task_branch)
        }) {
            return Err(
                "Agent Task creation stopped because another saved task owns this branch or Worktree path. Choose a different branch or inspect the existing task.".to_owned(),
            );
        }

        fs::create_dir_all(&worktree_root)
            .map_err(|error| format!("could not create the configured Worktree root: {error}"))?;
        let task = AgentTask {
            id: next_task_id(),
            status: AgentTaskStatus::Preparing,
            repository_root: repository_root.to_string_lossy().into_owned(),
            base_branch: base_branch.to_owned(),
            task_branch: task_branch.to_owned(),
            worktree_root: worktree_root.to_string_lossy().into_owned(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            task_summary: request.task_summary.trim().to_owned(),
            agent_id: request.agent_id.trim().to_owned(),
            agent_name: request.agent_name.trim().to_owned(),
            permission_mode: request.permission_mode.trim().to_owned(),
            lease: Some(WorktreeLease {
                owner_id: request.agent_id.trim().to_owned(),
                agent_id: request.agent_id.trim().to_owned(),
                session_id: None,
                status: WorktreeLeaseStatus::Reserved,
                acquired_at: timestamp(),
            }),
            handoffs: Vec::new(),
            failure_message: None,
            created_at: timestamp(),
            updated_at: timestamp(),
        };
        state.tasks.push(task.clone());
        write_state(app, &state)?;

        let command = run_git(
            &repository_root,
            vec![
                "worktree".to_owned(),
                "add".to_owned(),
                "-b".to_owned(),
                task_branch.to_owned(),
                worktree_path.to_string_lossy().into_owned(),
                base_branch.to_owned(),
            ],
        );
        if let Err(error) = command.and_then(|result| {
            if result.success {
                Ok(())
            } else {
                Err(git_failure("could not create the Agent Worktree", &result))
            }
        }) {
            let mut failed_state = read_state(app)?;
            if let Some(saved) = failed_state
                .tasks
                .iter_mut()
                .find(|item| item.id == task.id)
            {
                saved.status = AgentTaskStatus::SetupFailed;
                saved.lease = None;
                saved.failure_message = Some(error.clone());
                saved.updated_at = timestamp();
            }
            write_state(app, &failed_state)?;
            return Err(error);
        }

        let mut completed_state = read_state(app)?;
        let saved = completed_state
            .tasks
            .iter_mut()
            .find(|item| item.id == task.id)
            .ok_or_else(|| "new Agent Task disappeared during setup".to_owned())?;
        saved.updated_at = timestamp();
        let result = saved.clone();
        write_state(app, &completed_state)?;
        Ok(result)
    }

    pub fn claim(
        &self,
        app: &AppHandle,
        request: AgentTaskClaimRequest,
    ) -> Result<AgentTask, String> {
        validate_agent_identity(&request.agent_id, &request.agent_name)?;
        validate_permission_mode(&request.permission_mode)?;
        let session_id = required_text(&request.session_id, "Session id")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Agent Task state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let task = state
            .tasks
            .iter_mut()
            .find(|task| task.id == request.task_id)
            .ok_or_else(|| format!("unknown Agent Task: {}", request.task_id))?;

        if let Some(lease) = &task.lease {
            if lease.status == WorktreeLeaseStatus::Active {
                return Err(format!(
                    "Agent Task already has an active writer: {}. A second agent cannot silently edit this Worktree.",
                    lease.owner_id
                ));
            }
            if lease.owner_id != request.agent_id {
                return Err(format!(
                    "Agent Task is reserved for {} until that setup is released.",
                    lease.owner_id
                ));
            }
        } else if task.status == AgentTaskStatus::HandoffReady {
            let handoff = task
                .handoffs
                .last()
                .ok_or_else(|| "Agent Task has no handoff record to claim".to_owned())?;
            if handoff.new_owner != request.agent_id {
                return Err(format!(
                    "This handoff is explicitly assigned to {}, not {}.",
                    handoff.new_owner, request.agent_id
                ));
            }
        } else if task.status == AgentTaskStatus::Ready && task.agent_id == request.agent_id {
            // A failed launch or an explicit release leaves the original task owner able to retry.
        } else {
            return Err(
                "Agent Task has no available Worktree Lease. Create a task or complete an explicit handoff first.".to_owned(),
            );
        }

        task.agent_id = request.agent_id.trim().to_owned();
        task.agent_name = request.agent_name.trim().to_owned();
        task.permission_mode = request.permission_mode.trim().to_owned();
        task.lease = Some(WorktreeLease {
            owner_id: request.agent_id.trim().to_owned(),
            agent_id: request.agent_id.trim().to_owned(),
            session_id: Some(session_id),
            status: WorktreeLeaseStatus::Active,
            acquired_at: timestamp(),
        });
        task.status = AgentTaskStatus::Active;
        task.failure_message = None;
        task.updated_at = timestamp();
        let result = task.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn release(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
        request: AgentTaskReleaseRequest,
    ) -> Result<AgentTask, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Agent Task state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let task = state
            .tasks
            .iter_mut()
            .find(|task| task.id == request.task_id)
            .ok_or_else(|| format!("unknown Agent Task: {}", request.task_id))?;
        let Some(lease) = &task.lease else {
            return Err("Agent Task has no Worktree Lease to release.".to_owned());
        };
        if lease.owner_id != request.owner_id {
            return Err(format!(
                "Only the active Worktree Lease owner {} can release this task.",
                lease.owner_id
            ));
        }
        if let Some(session_id) = lease.session_id.as_deref() {
            if sessions.is_running(session_id) {
                return Err(
                    "Stop the active agent Session before releasing its Worktree Lease. The writer remains protected.".to_owned(),
                );
            }
        }
        task.lease = None;
        if task.status == AgentTaskStatus::Active || task.status == AgentTaskStatus::Preparing {
            task.status = AgentTaskStatus::Ready;
        }
        task.updated_at = timestamp();
        let result = task.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn handoff(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
        request: AgentTaskHandoffRequest,
    ) -> Result<AgentTask, String> {
        let new_owner = required_text(&request.new_owner, "New owner")?;
        let new_owner_name = request
            .new_owner_name
            .as_deref()
            .map(|value| required_text(value, "New owner name"))
            .transpose()?
            .unwrap_or_else(|| new_owner.clone());
        let changes = optional_handoff_text(&request.changes, "changes")?;
        let checks = optional_handoff_text(&request.checks, "checks")?;
        let pending_decisions =
            optional_handoff_text(&request.pending_decisions, "pending decisions")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Agent Task state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let task = state
            .tasks
            .iter_mut()
            .find(|task| task.id == request.task_id)
            .ok_or_else(|| format!("unknown Agent Task: {}", request.task_id))?;
        let Some(lease) = &task.lease else {
            return Err("Handoff requires an active Worktree Lease.".to_owned());
        };
        if lease.status != WorktreeLeaseStatus::Active || lease.owner_id != request.current_owner {
            return Err(
                "Handoff stopped because the requested owner does not hold the active Worktree Lease.".to_owned(),
            );
        }
        if let Some(session_id) = lease.session_id.as_deref() {
            if sessions.is_running(session_id) {
                return Err(
                    "Stop the active agent Session before recording a handoff. The current writer remains protected.".to_owned(),
                );
            }
        }

        let evidence = collect_worktree_evidence(Path::new(&task.worktree_path));
        let handoff = ControlHandoff {
            id: format!("handoff-{}", timestamp_millis()),
            previous_owner: request.current_owner,
            new_owner,
            new_owner_name,
            branch: task.task_branch.clone(),
            worktree_path: task.worktree_path.clone(),
            changes: changes.unwrap_or(evidence.changes),
            checks: checks
                .unwrap_or_else(|| "Checks were not reported by the handoff owner.".to_owned()),
            pending_decisions: pending_decisions
                .unwrap_or_else(|| "No pending decisions were reported.".to_owned()),
            created_at: timestamp(),
        };
        task.handoffs.push(handoff);
        task.lease = None;
        task.status = AgentTaskStatus::HandoffReady;
        task.updated_at = timestamp();
        let result = task.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn cancel(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
        request: AgentTaskCancelRequest,
    ) -> Result<AgentTaskCancelResult, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "Agent Task state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let task = state
            .tasks
            .iter_mut()
            .find(|task| task.id == request.task_id)
            .ok_or_else(|| format!("unknown Agent Task: {}", request.task_id))?;
        if let Some(lease) = &task.lease {
            if let Some(session_id) = lease.session_id.as_deref() {
                if sessions.is_running(session_id) {
                    return Err(
                        "Task cancellation stopped because its agent Session is still running. Stop the writer first; Arkonad will not remove an active Worktree.".to_owned(),
                    );
                }
            }
            task.lease = None;
        }
        let worktree_path = task.worktree_path.clone();
        let repository_root = task.repository_root.clone();
        let path = PathBuf::from(&worktree_path);
        if !path.exists() {
            task.status = AgentTaskStatus::Cancelled;
            task.updated_at = timestamp();
            let result = task.clone();
            write_state(app, &state)?;
            return Ok(AgentTaskCancelResult {
                task: result,
                action: "alreadyRemoved".to_owned(),
                removed_worktree: false,
                preserved_worktree: false,
                message: "The Agent Worktree was already absent; the task record was cancelled."
                    .to_owned(),
            });
        }

        validate_saved_worktree_target(task)?;
        let evidence = collect_worktree_evidence(&path);
        if evidence.dirty {
            task.status = AgentTaskStatus::CancelledPreserved;
            task.updated_at = timestamp();
            let result = task.clone();
            write_state(app, &state)?;
            return Ok(AgentTaskCancelResult {
                task: result,
                action: "preservedChanges".to_owned(),
                removed_worktree: false,
                preserved_worktree: true,
                message: format!(
                    "The Worktree contains changes, so Arkonad preserved it at {} instead of removing user work.",
                    worktree_path
                ),
            });
        }

        let command = run_git(
            Path::new(&repository_root),
            vec!["worktree".to_owned(), "remove".to_owned(), worktree_path],
        )?;
        if !command.success {
            return Err(git_failure(
                "Task cancellation could not remove the empty Agent Worktree",
                &command,
            ));
        }
        task.status = AgentTaskStatus::Cancelled;
        task.updated_at = timestamp();
        let result = task.clone();
        write_state(app, &state)?;
        Ok(AgentTaskCancelResult {
            task: result,
            action: "removedEmptyWorktree".to_owned(),
            removed_worktree: true,
            preserved_worktree: false,
            message: "The empty Agent Worktree was removed and the task record was cancelled."
                .to_owned(),
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_list(
    app: AppHandle,
    runtime: State<'_, AgentTaskRuntime>,
) -> Result<Vec<AgentTask>, String> {
    runtime.list(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_plan(
    runtime: State<'_, AgentTaskRuntime>,
    request: AgentTaskPlanRequest,
) -> AgentTaskPlan {
    runtime.plan(request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_create(
    app: AppHandle,
    runtime: State<'_, AgentTaskRuntime>,
    request: AgentTaskPlanRequest,
) -> Result<AgentTask, String> {
    runtime.create(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_claim(
    app: AppHandle,
    runtime: State<'_, AgentTaskRuntime>,
    request: AgentTaskClaimRequest,
) -> Result<AgentTask, String> {
    runtime.claim(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_release(
    app: AppHandle,
    runtime: State<'_, AgentTaskRuntime>,
    sessions: State<'_, SessionManager>,
    request: AgentTaskReleaseRequest,
) -> Result<AgentTask, String> {
    runtime.release(&app, &sessions, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_handoff(
    app: AppHandle,
    runtime: State<'_, AgentTaskRuntime>,
    sessions: State<'_, SessionManager>,
    request: AgentTaskHandoffRequest,
) -> Result<AgentTask, String> {
    runtime.handoff(&app, &sessions, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_task_cancel(
    app: AppHandle,
    runtime: State<'_, AgentTaskRuntime>,
    sessions: State<'_, SessionManager>,
    request: AgentTaskCancelRequest,
) -> Result<AgentTaskCancelResult, String> {
    runtime.cancel(&app, &sessions, request)
}

fn build_plan(request: AgentTaskPlanRequest) -> AgentTaskPlan {
    let task_summary = request.task_summary.trim().to_owned();
    let mut blockers = Vec::new();
    let mut recovery_options = Vec::new();
    let mut repository_root = None;
    let mut repository_name = None;
    let mut base_branch = request
        .base_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let mut task_branch = request
        .task_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let mut worktree_root = request
        .worktree_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let mut worktree_path = None;
    let mut repository_status = "unknown".to_owned();
    let mut repository_status_detail = String::new();
    let mut free_space_bytes = None;

    if let Err(error) = validate_agent_identity(&request.agent_id, &request.agent_name) {
        blockers.push(error);
        recovery_options
            .push("Choose a valid installed agent before creating the task.".to_owned());
    }
    if let Err(error) = validate_permission_mode(&request.permission_mode) {
        blockers.push(error);
        recovery_options
            .push("Choose Ask for Approval, Approve for Me, or Bypass Permissions.".to_owned());
    }

    let requested_repository = Path::new(request.repository_root.trim());
    let resolved_repository = match resolve_repository_root(requested_repository) {
        Ok(root) => {
            let display = root.to_string_lossy().into_owned();
            repository_root = Some(display);
            repository_name = root
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_owned);
            Some(root)
        }
        Err(error) => {
            blockers.push(format!("Repository context is unknown: {error}"));
            recovery_options.push(
                "Focus a directory inside a Git repository or choose a repository path explicitly."
                    .to_owned(),
            );
            None
        }
    };

    if let Some(repository) = resolved_repository.as_ref() {
        repository_status_detail = match repository_is_clean(repository) {
            Ok(detail) if detail.is_empty() => {
                repository_status = "clean".to_owned();
                "No tracked or untracked changes were found in the canonical checkout.".to_owned()
            }
            Ok(detail) => {
                repository_status = "dirty".to_owned();
                blockers.push(
                    "The canonical checkout has uncommitted or untracked changes; Arkonad will not copy that uncertainty into an Agent Worktree.".to_owned(),
                );
                recovery_options.push(
                    "Review, commit, stash, or move the changes outside Arkonad, then recheck the plan.".to_owned(),
                );
                format!("Existing changes:\n{detail}")
            }
            Err(error) => {
                blockers.push(format!(
                    "Could not inspect canonical checkout status: {error}"
                ));
                recovery_options.push(
                    "Verify that Git is installed and the repository is readable.".to_owned(),
                );
                error
            }
        };
        if base_branch.is_none() {
            base_branch = discover_base_branch(repository);
        }
        if base_branch.is_none() {
            blockers.push("No base branch could be resolved for this repository.".to_owned());
            recovery_options.push("Enter an existing local or remote base branch.".to_owned());
        }
        if let Some(base) = base_branch.as_deref() {
            if !branch_name_is_valid(repository, base) {
                blockers.push(format!("Base branch name is invalid or unsafe: {base}"));
                recovery_options.push(
                    "Choose an existing Git branch without control characters or leading dashes."
                        .to_owned(),
                );
            } else if !branch_revision_exists(repository, base) {
                blockers.push(format!("Base branch is not available: {base}"));
                recovery_options.push(
                    "Choose an existing base branch or fetch it through the normal Git workflow."
                        .to_owned(),
                );
            }
        }
        if task_branch.is_none() {
            task_branch = Some(format!(
                "codex/arkonad/{}-{}",
                slugify(if task_summary.is_empty() {
                    "agent-task"
                } else {
                    &task_summary
                }),
                timestamp_millis()
            ));
        }
        if let Some(branch) = task_branch.as_deref() {
            if !branch_name_is_valid(repository, branch) {
                blockers.push(format!("Task branch name is invalid or unsafe: {branch}"));
                recovery_options.push(
                    "Use a Git branch name without control characters, .., or leading dashes."
                        .to_owned(),
                );
            } else if local_branch_exists(repository, branch)
                || worktree_branch_exists(repository, branch)
            {
                blockers.push(format!(
                    "Task branch already exists or is checked out: {branch}"
                ));
                recovery_options.push(
                    "Choose a new task branch or inspect the existing Agent Task.".to_owned(),
                );
            }
        }
        if worktree_root.is_none() {
            worktree_root = Some(default_worktree_root(repository));
        }
        if let Some(root) = worktree_root.as_ref() {
            if !root.is_absolute() {
                blockers.push("Worktree root must be an absolute configured path.".to_owned());
                recovery_options
                    .push("Choose a Worktree root on a local writable drive.".to_owned());
            } else if path_is_inside(root, repository) {
                blockers.push("Worktree root is inside the canonical checkout.".to_owned());
                recovery_options.push(
                    "Choose a sibling or dedicated Worktree directory outside the repository."
                        .to_owned(),
                );
            }
            if let Some(branch) = task_branch.as_deref() {
                let repo_name = repository_name.as_deref().unwrap_or("repository");
                let path = root.join(format!("{}-{}", repo_name, branch_slug(branch)));
                worktree_path = Some(path.to_string_lossy().into_owned());
                if path_is_inside(&path, repository) {
                    blockers.push(
                        "The planned Agent Worktree path is inside the canonical checkout."
                            .to_owned(),
                    );
                    recovery_options
                        .push("Choose a Worktree root outside the canonical checkout.".to_owned());
                }
                if path.exists() {
                    blockers.push(format!(
                        "The planned Worktree path already exists: {}",
                        path.display()
                    ));
                    recovery_options
                        .push("Choose another Worktree root or task branch.".to_owned());
                }
                free_space_bytes = disk_free_bytes(root);
                match free_space_bytes {
                    Some(bytes) if bytes >= MIN_FREE_SPACE_BYTES => {}
                    Some(bytes) => {
                        blockers.push(format!(
                            "The configured Worktree drive has only {} free; at least {} is required.",
                            format_bytes(bytes),
                            format_bytes(MIN_FREE_SPACE_BYTES)
                        ));
                        recovery_options.push(
                            "Choose another drive or free space before creating the Worktree."
                                .to_owned(),
                        );
                    }
                    None => {
                        blockers.push("Arkonad could not measure free space for the configured Worktree drive.".to_owned());
                        recovery_options.push(
                            "Choose an existing local drive and recheck its available space."
                                .to_owned(),
                        );
                    }
                }
            }
        }
    }

    unique_strings(&mut recovery_options);
    AgentTaskPlan {
        repository_root,
        repository_name,
        base_branch,
        task_branch,
        worktree_root: worktree_root.map(|path| path.to_string_lossy().into_owned()),
        worktree_path,
        task_summary,
        agent_id: request.agent_id,
        agent_name: request.agent_name,
        permission_mode: request.permission_mode,
        repository_status,
        repository_status_detail,
        free_space_bytes,
        free_space_ok: free_space_bytes.is_some_and(|bytes| bytes >= MIN_FREE_SPACE_BYTES),
        can_create: blockers.is_empty(),
        blockers,
        recovery_options,
    }
}

fn plan_error(plan: &AgentTaskPlan) -> String {
    let blockers = if plan.blockers.is_empty() {
        "the plan is no longer valid".to_owned()
    } else {
        plan.blockers.join(" ")
    };
    let recovery = if plan.recovery_options.is_empty() {
        String::new()
    } else {
        format!(" Recovery: {}", plan.recovery_options.join(" "))
    };
    format!("Agent Task setup stopped: {blockers}.{recovery}")
}

fn resolve_repository_root(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return Err(format!("directory does not exist: {}", path.display()));
    }
    let result = run_git(
        path,
        vec!["rev-parse".to_owned(), "--show-toplevel".to_owned()],
    )?;
    if !result.success {
        return Err(git_failure("directory is not a Git repository", &result));
    }
    let root = PathBuf::from(result.stdout.trim());
    root.canonicalize()
        .map_err(|error| format!("repository root could not be resolved: {error}"))
}

fn repository_is_clean(repository: &Path) -> Result<String, String> {
    let result = run_git(
        repository,
        vec![
            "status".to_owned(),
            "--porcelain=v1".to_owned(),
            "--untracked-files=all".to_owned(),
        ],
    )?;
    if !result.success {
        return Err(git_failure("Git status failed", &result));
    }
    Ok(result.stdout.trim().to_owned())
}

fn discover_base_branch(repository: &Path) -> Option<String> {
    let current = run_git(
        repository,
        vec!["branch".to_owned(), "--show-current".to_owned()],
    )
    .ok()
    .filter(|result| result.success)
    .map(|result| result.stdout.trim().to_owned())
    .filter(|branch| !branch.is_empty());
    if current.is_some() {
        return current;
    }
    ["main", "master"]
        .iter()
        .find(|branch| branch_revision_exists(repository, branch))
        .map(|branch| (*branch).to_owned())
}

fn branch_revision_exists(repository: &Path, branch: &str) -> bool {
    run_git(
        repository,
        vec![
            "rev-parse".to_owned(),
            "--verify".to_owned(),
            format!("{branch}^{{commit}}"),
        ],
    )
    .map(|result| result.success)
    .unwrap_or(false)
}

fn branch_name_is_valid(repository: &Path, branch: &str) -> bool {
    if branch.trim().is_empty() || branch.chars().any(char::is_control) || branch.starts_with('-') {
        return false;
    }
    run_git(
        repository,
        vec![
            "check-ref-format".to_owned(),
            "--branch".to_owned(),
            branch.to_owned(),
        ],
    )
    .map(|result| result.success)
    .unwrap_or(false)
}

fn local_branch_exists(repository: &Path, branch: &str) -> bool {
    run_git(
        repository,
        vec![
            "show-ref".to_owned(),
            "--verify".to_owned(),
            format!("refs/heads/{branch}"),
        ],
    )
    .map(|result| result.success)
    .unwrap_or(false)
}

fn worktree_branch_exists(repository: &Path, branch: &str) -> bool {
    let Ok(result) = run_git(
        repository,
        vec![
            "worktree".to_owned(),
            "list".to_owned(),
            "--porcelain".to_owned(),
        ],
    ) else {
        return false;
    };
    result.stdout.lines().any(|line| {
        line.trim()
            .strip_prefix("branch refs/heads/")
            .is_some_and(|value| value == branch)
    })
}

fn default_worktree_root(repository: &Path) -> PathBuf {
    if let Ok(configured) = env::var("ARKONAD_WORKTREE_ROOT") {
        let configured = PathBuf::from(configured.trim());
        if configured.is_absolute() {
            return configured;
        }
    }
    let name = repository
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("repository");
    repository
        .parent()
        .unwrap_or(repository)
        .join(format!("{name}-worktrees"))
}

fn path_is_inside(path: &Path, repository: &Path) -> bool {
    let Ok(path) = canonicalize_with_missing(path) else {
        return false;
    };
    let Ok(repository) = repository.canonicalize() else {
        return false;
    };
    same_path(&path, &repository) || path.starts_with(repository)
}

fn canonicalize_with_missing(path: &Path) -> Result<PathBuf, String> {
    let mut missing = Vec::new();
    let mut existing = path;
    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            return Err(format!("could not resolve path: {}", path.display()));
        };
        missing.push(name.to_owned());
        existing = existing
            .parent()
            .ok_or_else(|| format!("could not resolve path: {}", path.display()))?;
    }
    let mut resolved = existing
        .canonicalize()
        .map_err(|error| format!("could not resolve path {}: {error}", path.display()))?;
    for name in missing.iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}

fn collect_worktree_evidence(path: &Path) -> WorktreeEvidence {
    match repository_is_clean(path) {
        Ok(changes) if changes.is_empty() => WorktreeEvidence {
            dirty: false,
            changes: "Working tree is clean.".to_owned(),
        },
        Ok(changes) => WorktreeEvidence {
            dirty: true,
            changes,
        },
        Err(error) => WorktreeEvidence {
            dirty: true,
            changes: format!("Could not inspect Worktree changes: {error}"),
        },
    }
}

fn validate_saved_worktree_target(task: &AgentTask) -> Result<(), String> {
    let repository = Path::new(&task.repository_root);
    let worktree_root = Path::new(&task.worktree_root);
    let worktree_path = Path::new(&task.worktree_path);
    if path_is_inside(worktree_path, repository) {
        return Err(
            "Task cancellation stopped because the saved Worktree path is inside the canonical checkout. No path was removed."
                .to_owned(),
        );
    }
    if !path_is_inside(worktree_path, worktree_root) {
        return Err(
            "Task cancellation stopped because the saved Worktree path is outside its configured Worktree root. No path was removed."
                .to_owned(),
        );
    }
    let result = run_git(
        repository,
        vec![
            "worktree".to_owned(),
            "list".to_owned(),
            "--porcelain".to_owned(),
        ],
    )?;
    if !result.success {
        return Err(git_failure(
            "Task cancellation could not verify the saved Worktree",
            &result,
        ));
    }
    let canonical_target = canonicalize_with_missing(worktree_path)?;
    let mut listed_target = false;
    let mut listed_branch = false;
    for line in result.stdout.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            listed_target = same_path(Path::new(value.trim()), &canonical_target);
            continue;
        }
        if listed_target {
            if let Some(value) = line.strip_prefix("branch refs/heads/") {
                listed_branch = value.trim() == task.task_branch;
                break;
            }
        }
    }
    if !listed_target || !listed_branch {
        return Err(
            "Task cancellation stopped because Git no longer maps the saved path to the saved task branch. No path was removed."
                .to_owned(),
        );
    }
    Ok(())
}

struct WorktreeEvidence {
    dirty: bool,
    changes: String,
}

struct GitResult {
    success: bool,
    stdout: String,
    stderr: String,
}

fn run_git(repository: &Path, arguments: Vec<String>) -> Result<GitResult, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(arguments)
        .output()
        .map_err(|error| format!("could not run Git: {error}"))?;
    Ok(GitResult {
        success: output.status.success(),
        stdout: bounded_output(&output.stdout),
        stderr: bounded_output(&output.stderr),
    })
}

fn git_failure(prefix: &str, result: &GitResult) -> String {
    let detail = if result.stderr.is_empty() {
        result.stdout.as_str()
    } else {
        result.stderr.as_str()
    };
    if detail.is_empty() {
        prefix.to_owned()
    } else {
        format!("{prefix}: {detail}")
    }
}

fn bounded_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .take(8_000)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn validate_agent_identity(agent_id: &str, agent_name: &str) -> Result<(), String> {
    required_text(agent_id, "Agent id")?;
    required_text(agent_name, "Agent name")?;
    Ok(())
}

fn validate_permission_mode(value: &str) -> Result<(), String> {
    match value.trim() {
        "ask" | "approve" | "bypass" => Ok(()),
        _ => Err(format!("unknown permission mode: {value}")),
    }
}

fn required_text(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is empty"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains control characters"));
    }
    Ok(value.to_owned())
}

fn optional_handoff_text(value: &str, label: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > MAX_HANDOFF_FIELD_BYTES {
        return Err(format!(
            "handoff {label} exceeds {MAX_HANDOFF_FIELD_BYTES} bytes"
        ));
    }
    if value.chars().any(char::is_control) && !value.contains(['\n', '\r', '\t']) {
        return Err(format!(
            "handoff {label} contains unsupported control characters"
        ));
    }
    Ok(Some(value.to_owned()))
}

fn required_plan_value<'a>(value: Option<&'a str>, label: &str) -> Result<&'a str, String> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Agent Task plan did not provide {label}"))
}

fn unique_strings(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    values.retain(|value| seen.insert(value.clone()));
}

fn slugify(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            result.push(character.to_ascii_lowercase());
        } else if !result.ends_with('-') {
            result.push('-');
        }
        if result.len() >= 42 {
            break;
        }
    }
    let result = result.trim_matches('-').to_owned();
    if result.is_empty() {
        "task".to_owned()
    } else {
        result
    }
}

fn branch_slug(branch: &str) -> String {
    slugify(branch.rsplit('/').next().unwrap_or(branch))
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn disk_free_bytes(path: &Path) -> Option<u64> {
    let probe = existing_ancestor(path)?;
    #[cfg(windows)]
    {
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let wide = probe
            .as_os_str()
            .encode_wide()
            .chain(once(0))
            .collect::<Vec<_>>();
        let mut available = 0_u64;
        let success = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if success == 0 {
            None
        } else {
            Some(available)
        }
    }
    #[cfg(unix)]
    {
        let path = std::ffi::CString::new(probe.to_string_lossy().as_bytes()).ok()?;
        let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        let result = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
        if result != 0 {
            return None;
        }
        let stats = unsafe { stats.assume_init() };
        Some(stats.f_bavail as u64 * stats.f_frsize as u64)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = probe;
        None
    }
}

fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path;
    while !current.exists() {
        current = current.parent()?;
    }
    Some(current.to_path_buf())
}

fn format_bytes(value: u64) -> String {
    if value >= 1024 * 1024 * 1024 {
        format!("{:.1} GiB", value as f64 / (1024_f64 * 1024_f64 * 1024_f64))
    } else {
        format!("{:.0} MiB", value as f64 / (1024_f64 * 1024_f64))
    }
}

fn read_state(app: &AppHandle) -> Result<AgentTaskStateFile, String> {
    let path = state_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => {
            let state: AgentTaskStateFile = serde_json::from_str(&contents)
                .map_err(|error| format!("Agent Task state is corrupt: {error}"))?;
            if state.schema_version != CURRENT_SCHEMA_VERSION {
                return Err(format!(
                    "Agent Task state version {} is not supported",
                    state.schema_version
                ));
            }
            Ok(state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AgentTaskStateFile {
            schema_version: CURRENT_SCHEMA_VERSION,
            ..AgentTaskStateFile::default()
        }),
        Err(error) => Err(format!("could not read Agent Task state: {error}")),
    }
}

fn write_state(app: &AppHandle, state: &AgentTaskStateFile) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create Agent Task state directory: {error}"))?;
    }
    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("could not encode Agent Task state: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents)
        .map_err(|error| format!("could not write Agent Task state: {error}"))?;
    if let Err(rename_error) = fs::rename(&temporary, &path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("could not replace Agent Task state: {error}"))?;
            fs::rename(&temporary, &path)
                .map_err(|error| format!("could not replace Agent Task state: {error}"))?;
        } else {
            return Err(format!(
                "could not publish Agent Task state: {rename_error}"
            ));
        }
    }
    Ok(())
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(TASK_STATE_FILE_NAME))
        .map_err(|error| format!("could not resolve Agent Task state directory: {error}"))
}

fn next_task_id() -> String {
    format!(
        "task-{}-{}",
        timestamp_millis(),
        NEXT_TASK_ID.fetch_add(1, Ordering::Relaxed)
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

    fn request(repository_root: &str) -> AgentTaskPlanRequest {
        AgentTaskPlanRequest {
            repository_root: repository_root.to_owned(),
            task_summary: "Add a settings panel".to_owned(),
            base_branch: Some("main".to_owned()),
            task_branch: Some("codex/settings-panel".to_owned()),
            worktree_root: Some(
                std::env::temp_dir()
                    .join("arkonad-agent-task-worktrees")
                    .to_string_lossy()
                    .into_owned(),
            ),
            agent_id: "codex".to_owned(),
            agent_name: "Codex".to_owned(),
            permission_mode: "ask".to_owned(),
        }
    }

    #[test]
    fn task_state_vocabulary_and_lease_are_explicit() {
        assert_eq!(
            serde_json::to_string(&AgentTaskStatus::HandoffReady).unwrap(),
            "\"handoffReady\""
        );
        assert_eq!(
            serde_json::to_string(&WorktreeLeaseStatus::Reserved).unwrap(),
            "\"reserved\""
        );
    }

    #[test]
    fn branch_and_path_helpers_are_safe() {
        assert!(slugify("Add dark mode / settings!").starts_with("add-dark-mode-settings"));
        assert_eq!(branch_slug("codex/arkonad/task-123"), "task-123");
        assert!(!branch_name_is_valid(Path::new("."), "-unsafe"));
    }

    #[test]
    fn invalid_repository_plan_stops_with_recovery_options() {
        let plan = build_plan(request(r"C:\path\that\does\not\exist"));
        assert!(!plan.can_create);
        assert_eq!(plan.repository_status, "unknown");
        assert!(!plan.recovery_options.is_empty());
    }

    #[test]
    fn dirty_repository_is_a_creation_blocker() {
        let repository = std::env::current_dir().expect("test repository should be available");
        let plan = build_plan(request(&repository.to_string_lossy()));
        if plan.repository_status == "dirty" {
            assert!(!plan.can_create);
            assert!(plan
                .blockers
                .iter()
                .any(|blocker| blocker.contains("canonical checkout")));
        }
    }

    #[test]
    fn handoff_text_rejects_unbounded_input() {
        let value = "x".repeat(MAX_HANDOFF_FIELD_BYTES + 1);
        assert!(optional_handoff_text(&value, "changes").is_err());
    }
}
