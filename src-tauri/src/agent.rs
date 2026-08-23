use crate::pty::SessionManager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const AGENT_SUPERVISION_FILE_NAME: &str = "agent-supervision.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;
const MAX_FOLLOW_UP_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionState {
    Starting,
    Working,
    WaitingForInput,
    WaitingForApproval,
    Done,
    Failed,
    Stopped,
    Interrupted,
}

impl AgentSessionState {
    fn needs_live_process(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Working | Self::WaitingForInput | Self::WaitingForApproval
        )
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStateSource {
    Process,
    ProviderEvent,
    OutputObservation,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AttentionKind {
    Approval,
    Question,
    Failure,
    Completion,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FollowUpMode {
    Queue,
    Steer,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FollowUpStatus {
    Queued,
    Delivering,
    Delivered,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAdapterCapability {
    pub agent_id: String,
    pub verified: bool,
    pub declared_event_source: Option<String>,
    pub supports_steer: bool,
    pub native_tui_note: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttentionItem {
    pub id: String,
    pub kind: AttentionKind,
    pub message: String,
    pub source: AgentStateSource,
    pub acknowledged: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowUp {
    pub id: String,
    pub message: String,
    pub requested_mode: FollowUpMode,
    pub effective_mode: FollowUpMode,
    pub status: FollowUpStatus,
    pub status_message: String,
    pub created_at: String,
    pub delivered_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub id: String,
    pub session_id: String,
    pub workspace_id: Option<String>,
    pub workspace_name: String,
    pub workspace_root: String,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub agent_id: String,
    pub agent_name: String,
    pub state: AgentSessionState,
    pub state_source: AgentStateSource,
    pub state_detail: String,
    pub follow_up_mode: FollowUpMode,
    pub adapter: AgentAdapterCapability,
    #[serde(default)]
    pub enhanced_events_active: bool,
    #[serde(default)]
    pub attention: Vec<AttentionItem>,
    #[serde(default)]
    pub follow_ups: Vec<AgentFollowUp>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSupervisionSnapshot {
    pub sessions: Vec<AgentSessionRecord>,
    pub adapters: Vec<AgentAdapterCapability>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAgentSessionRequest {
    pub session_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub workspace_name: String,
    pub workspace_root: String,
    #[serde(default)]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub pane_id: Option<String>,
    pub agent_id: String,
    pub agent_name: String,
    pub follow_up_mode: FollowUpMode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserveAgentOutputRequest {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindAgentSessionRequest {
    pub session_id: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub workspace_root: String,
    #[serde(default)]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub pane_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAgentEventRequest {
    pub session_id: String,
    pub state: AgentSessionState,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitFollowUpRequest {
    pub supervision_id: String,
    pub message: String,
    pub mode: FollowUpMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpResult {
    pub follow_up: AgentFollowUp,
    pub session: AgentSessionRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSupervisionFile {
    schema_version: u32,
    #[serde(default)]
    sessions: Vec<AgentSessionRecord>,
}

impl Default for AgentSupervisionFile {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            sessions: Vec::new(),
        }
    }
}

#[derive(Debug, Default)]
pub struct AgentSupervisorRuntime {
    state_lock: Mutex<()>,
}

impl AgentSupervisorRuntime {
    fn snapshot(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
    ) -> Result<AgentSupervisionSnapshot, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let now = timestamp();
        let mut changed = false;
        for record in &mut state.sessions {
            if record.state.needs_live_process() && !sessions.is_running(&record.session_id) {
                record.state = AgentSessionState::Interrupted;
                record.state_source = AgentStateSource::Process;
                record.state_detail =
                    "The saved provider process is not attached. Arkonad did not replay it."
                        .to_owned();
                record.updated_at = now.clone();
                changed = true;
            }
        }
        if changed {
            write_state(app, &state)?;
        }
        Ok(snapshot_from(state))
    }

    fn register(
        &self,
        app: &AppHandle,
        request: RegisterAgentSessionRequest,
    ) -> Result<AgentSupervisionSnapshot, String> {
        validate_register_request(&request)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        state
            .sessions
            .retain(|record| record.session_id != request.session_id);
        let now = timestamp();
        let supervision_id = format!(
            "agent-session-{}-{}",
            timestamp_millis(),
            state.sessions.len()
        );
        state.sessions.push(AgentSessionRecord {
            id: supervision_id,
            session_id: request.session_id,
            workspace_id: request
                .workspace_id
                .filter(|value| !value.trim().is_empty()),
            workspace_name: required_text(&request.workspace_name, "Workspace name")?,
            workspace_root: required_text(&request.workspace_root, "Workspace root")?,
            tab_id: request.tab_id.filter(|value| !value.trim().is_empty()),
            pane_id: request.pane_id.filter(|value| !value.trim().is_empty()),
            agent_id: required_text(&request.agent_id, "Agent id")?,
            agent_name: required_text(&request.agent_name, "Agent name")?,
            state: AgentSessionState::Starting,
            state_source: AgentStateSource::Process,
            state_detail: "Provider process started; no provider activity has been declared yet."
                .to_owned(),
            follow_up_mode: request.follow_up_mode,
            adapter: adapter_for(&request.agent_id),
            enhanced_events_active: false,
            attention: Vec::new(),
            follow_ups: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        });
        write_state(app, &state)?;
        Ok(snapshot_from(state))
    }

    fn observe_output(
        &self,
        app: &AppHandle,
        request: ObserveAgentOutputRequest,
    ) -> Result<Option<AgentSessionRecord>, String> {
        if request.text.trim().is_empty() {
            return Ok(None);
        }
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let Some(record) = state
            .sessions
            .iter_mut()
            .find(|record| record.session_id == request.session_id)
        else {
            return Ok(None);
        };
        let changed = apply_output_observation(record, &request.text);
        let result = changed.then(|| record.clone());
        if changed {
            write_state(app, &state)?;
        }
        Ok(result)
    }

    fn bind_workspace(
        &self,
        app: &AppHandle,
        request: BindAgentSessionRequest,
    ) -> Result<AgentSessionRecord, String> {
        let workspace_id = required_text(&request.workspace_id, "Workspace id")?;
        let workspace_name = required_text(&request.workspace_name, "Workspace name")?;
        let workspace_root = required_text(&request.workspace_root, "Workspace root")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let record = state
            .sessions
            .iter_mut()
            .find(|record| record.session_id == request.session_id)
            .ok_or_else(|| format!("unknown supervised session: {}", request.session_id))?;
        record.workspace_id = Some(workspace_id);
        record.workspace_name = workspace_name;
        record.workspace_root = workspace_root;
        record.tab_id = request.tab_id.filter(|value| !value.trim().is_empty());
        record.pane_id = request.pane_id.filter(|value| !value.trim().is_empty());
        record.updated_at = timestamp();
        let result = record.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    fn provider_event(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
        request: ProviderAgentEventRequest,
    ) -> Result<AgentSessionRecord, String> {
        let detail = required_text(&request.detail, "Provider event detail")?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let record = state
            .sessions
            .iter_mut()
            .find(|record| record.session_id == request.session_id)
            .ok_or_else(|| format!("unknown supervised session: {}", request.session_id))?;
        if !record.adapter.verified {
            return Err(format!(
                "{} has no verified enhanced-state adapter; native launch remains available",
                record.agent_name
            ));
        }
        record.enhanced_events_active = true;
        apply_provider_event(record, request.state, detail);
        deliver_ready_queued_follow_ups(record, sessions, app)?;
        let result = record.clone();
        write_state(app, &state)?;
        Ok(result)
    }

    fn submit_follow_up(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
        request: SubmitFollowUpRequest,
    ) -> Result<FollowUpResult, String> {
        let message = validate_follow_up(&request.message)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let record = state
            .sessions
            .iter_mut()
            .find(|record| record.id == request.supervision_id)
            .ok_or_else(|| {
                format!(
                    "unknown supervised agent session: {}",
                    request.supervision_id
                )
            })?;
        let effective_mode = effective_follow_up_mode(record, request.mode);
        let status_message =
            if request.mode == FollowUpMode::Steer && effective_mode == FollowUpMode::Queue {
                format!(
                    "Steer is not active for this {} session; the follow-up was queued.",
                    record.agent_name
                )
            } else {
                "The follow-up is queued until the current turn is ready.".to_owned()
            };
        let follow_up = AgentFollowUp {
            id: format!(
                "follow-up-{}-{}",
                timestamp_millis(),
                record.follow_ups.len()
            ),
            message,
            requested_mode: request.mode,
            effective_mode,
            status: FollowUpStatus::Queued,
            status_message,
            created_at: timestamp(),
            delivered_at: None,
        };
        record.follow_ups.push(follow_up);
        let index = record.follow_ups.len() - 1;
        let can_send_now =
            effective_mode == FollowUpMode::Steer || queue_can_deliver_from_declared_state(record);
        if can_send_now {
            deliver_follow_up_at(record, index, sessions, app)?;
        }
        record.updated_at = timestamp();
        let result = FollowUpResult {
            follow_up: record.follow_ups[index].clone(),
            session: record.clone(),
        };
        write_state(app, &state)?;
        Ok(result)
    }

    fn deliver_follow_up(
        &self,
        app: &AppHandle,
        sessions: &SessionManager,
        follow_up_id: &str,
    ) -> Result<FollowUpResult, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let (record_index, follow_up_index) = state
            .sessions
            .iter()
            .enumerate()
            .find_map(|(record_index, record)| {
                record
                    .follow_ups
                    .iter()
                    .position(|follow_up| follow_up.id == follow_up_id)
                    .map(|follow_up_index| (record_index, follow_up_index))
            })
            .ok_or_else(|| format!("unknown follow-up: {follow_up_id}"))?;
        if !is_delivery_candidate(&state.sessions[record_index].follow_ups[follow_up_index]) {
            return Err("the follow-up is not queued and will not be delivered again".to_owned());
        }
        deliver_follow_up_at(
            &mut state.sessions[record_index],
            follow_up_index,
            sessions,
            app,
        )?;
        let result = FollowUpResult {
            follow_up: state.sessions[record_index].follow_ups[follow_up_index].clone(),
            session: state.sessions[record_index].clone(),
        };
        write_state(app, &state)?;
        Ok(result)
    }

    fn acknowledge_attention(
        &self,
        app: &AppHandle,
        attention_id: &str,
    ) -> Result<AgentSupervisionSnapshot, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let attention = state
            .sessions
            .iter_mut()
            .flat_map(|record| record.attention.iter_mut())
            .find(|attention| attention.id == attention_id)
            .ok_or_else(|| format!("unknown attention item: {attention_id}"))?;
        attention.acknowledged = true;
        write_state(app, &state)?;
        Ok(snapshot_from(state))
    }

    fn process_exited(
        &self,
        app: &AppHandle,
        session_id: &str,
    ) -> Result<Option<AgentSessionRecord>, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "agent supervision state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let Some(record) = state
            .sessions
            .iter_mut()
            .find(|record| record.session_id == session_id)
        else {
            return Ok(None);
        };
        if !matches!(
            record.state,
            AgentSessionState::Done | AgentSessionState::Failed
        ) {
            record.state = AgentSessionState::Stopped;
            record.state_source = AgentStateSource::Process;
            record.state_detail =
                "The provider process exited. Process silence is not treated as completion."
                    .to_owned();
            record.updated_at = timestamp();
        }
        let result = record.clone();
        write_state(app, &state)?;
        Ok(Some(result))
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_supervision_snapshot(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    sessions: State<'_, SessionManager>,
) -> Result<AgentSupervisionSnapshot, String> {
    supervisor.snapshot(&app, &sessions)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_supervision_register(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    request: RegisterAgentSessionRequest,
) -> Result<AgentSupervisionSnapshot, String> {
    supervisor.register(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_supervision_observe_output(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    request: ObserveAgentOutputRequest,
) -> Result<Option<AgentSessionRecord>, String> {
    supervisor.observe_output(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_supervision_bind_workspace(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    request: BindAgentSessionRequest,
) -> Result<AgentSessionRecord, String> {
    supervisor.bind_workspace(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_supervision_provider_event(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    sessions: State<'_, SessionManager>,
    request: ProviderAgentEventRequest,
) -> Result<AgentSessionRecord, String> {
    supervisor.provider_event(&app, &sessions, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_follow_up_submit(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    sessions: State<'_, SessionManager>,
    request: SubmitFollowUpRequest,
) -> Result<FollowUpResult, String> {
    supervisor.submit_follow_up(&app, &sessions, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_follow_up_deliver(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    sessions: State<'_, SessionManager>,
    follow_up_id: String,
) -> Result<FollowUpResult, String> {
    supervisor.deliver_follow_up(&app, &sessions, &follow_up_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_attention_acknowledge(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    attention_id: String,
) -> Result<AgentSupervisionSnapshot, String> {
    supervisor.acknowledge_attention(&app, &attention_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_supervision_process_exited(
    app: AppHandle,
    supervisor: State<'_, AgentSupervisorRuntime>,
    session_id: String,
) -> Result<Option<AgentSessionRecord>, String> {
    supervisor.process_exited(&app, &session_id)
}

fn snapshot_from(state: AgentSupervisionFile) -> AgentSupervisionSnapshot {
    AgentSupervisionSnapshot {
        sessions: state.sessions,
        adapters: verified_adapters(),
    }
}

fn validate_register_request(request: &RegisterAgentSessionRequest) -> Result<(), String> {
    required_text(&request.session_id, "Session id")?;
    required_text(&request.workspace_name, "Workspace name")?;
    required_text(&request.workspace_root, "Workspace root")?;
    required_text(&request.agent_id, "Agent id")?;
    required_text(&request.agent_name, "Agent name")?;
    Ok(())
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

fn validate_follow_up(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Follow-up message is empty".to_owned());
    }
    if value.len() > MAX_FOLLOW_UP_BYTES {
        return Err(format!(
            "Follow-up message exceeds {MAX_FOLLOW_UP_BYTES} bytes"
        ));
    }
    Ok(value.to_owned())
}

fn apply_output_observation(record: &mut AgentSessionRecord, text: &str) -> bool {
    let observed = visible_observation(text);
    if observed.is_empty() {
        return false;
    }
    let lower = observed.to_lowercase();
    let observation = if contains_any(
        &lower,
        &[
            "waiting for approval",
            "approve?",
            "permission required",
            "allow this",
            "[y/n]",
        ],
    ) {
        Some((
            AgentSessionState::WaitingForApproval,
            AttentionKind::Approval,
            "Output may be asking for approval; verify in the native TUI.",
        ))
    } else if contains_any(
        &lower,
        &[
            "waiting for input",
            "need your input",
            "choose an option",
            "select an option",
            "press enter",
        ],
    ) {
        Some((
            AgentSessionState::WaitingForInput,
            AttentionKind::Question,
            "Output may be waiting for input; verify in the native TUI.",
        ))
    } else if contains_any(&lower, &["error:", "failed:", "fatal:", "panic:"]) {
        Some((
            AgentSessionState::Failed,
            AttentionKind::Failure,
            "Output may indicate a failure; verify in the native TUI.",
        ))
    } else {
        None
    };
    let now = timestamp();
    if let Some((state, kind, detail)) = observation {
        record.state = state;
        record.state_source = AgentStateSource::OutputObservation;
        record.state_detail = detail.to_owned();
        record.updated_at = now.clone();
        add_attention_once(
            record,
            kind,
            detail,
            AgentStateSource::OutputObservation,
            &now,
        );
        return true;
    }
    if record.state == AgentSessionState::Starting {
        record.state = AgentSessionState::Working;
        record.state_source = AgentStateSource::OutputObservation;
        record.state_detail =
            "Terminal output was observed; provider activity remains uncertain.".to_owned();
        record.updated_at = now;
        return true;
    }
    false
}

fn apply_provider_event(record: &mut AgentSessionRecord, state: AgentSessionState, detail: String) {
    record.state = state;
    record.state_source = AgentStateSource::ProviderEvent;
    record.state_detail = detail.clone();
    let now = timestamp();
    record.updated_at = now.clone();
    let attention_kind = match state {
        AgentSessionState::WaitingForApproval => Some(AttentionKind::Approval),
        AgentSessionState::WaitingForInput => Some(AttentionKind::Question),
        AgentSessionState::Failed => Some(AttentionKind::Failure),
        AgentSessionState::Done => Some(AttentionKind::Completion),
        _ => None,
    };
    if let Some(kind) = attention_kind {
        add_attention_once(record, kind, &detail, AgentStateSource::ProviderEvent, &now);
    }
}

fn add_attention_once(
    record: &mut AgentSessionRecord,
    kind: AttentionKind,
    message: &str,
    source: AgentStateSource,
    now: &str,
) {
    if record.attention.iter().any(|item| {
        !item.acknowledged && item.kind == kind && item.message == message && item.source == source
    }) {
        return;
    }
    record.attention.push(AttentionItem {
        id: format!(
            "attention-{}-{}",
            timestamp_millis(),
            record.attention.len()
        ),
        kind,
        message: message.to_owned(),
        source,
        acknowledged: false,
        created_at: now.to_owned(),
    });
}

fn queue_can_deliver_from_declared_state(record: &AgentSessionRecord) -> bool {
    record.state_source == AgentStateSource::ProviderEvent
        && matches!(
            record.state,
            AgentSessionState::WaitingForInput | AgentSessionState::Done
        )
}

fn deliver_ready_queued_follow_ups(
    record: &mut AgentSessionRecord,
    sessions: &SessionManager,
    app: &AppHandle,
) -> Result<(), String> {
    if !queue_can_deliver_from_declared_state(record) {
        return Ok(());
    }
    if let Some(index) = record.follow_ups.iter().position(is_delivery_candidate) {
        deliver_follow_up_at(record, index, sessions, app)?;
    }
    Ok(())
}

fn deliver_follow_up_at(
    record: &mut AgentSessionRecord,
    index: usize,
    sessions: &SessionManager,
    app: &AppHandle,
) -> Result<(), String> {
    if !is_delivery_candidate(&record.follow_ups[index]) {
        return Err("the follow-up has already entered delivery".to_owned());
    }
    record.follow_ups[index].status = FollowUpStatus::Delivering;
    record.follow_ups[index].status_message =
        "Delivery started; Arkonad will not retry this message automatically.".to_owned();
    write_single_record_state(app, record)?;
    let payload = format!("{}\r", record.follow_ups[index].message);
    match sessions.write(&record.session_id, payload.as_bytes()) {
        Ok(()) => {
            record.follow_ups[index].status = FollowUpStatus::Delivered;
            record.follow_ups[index].status_message = match record.follow_ups[index].effective_mode
            {
                FollowUpMode::Queue => {
                    "Queued follow-up delivered after the current turn became ready."
                }
                FollowUpMode::Steer => "Follow-up sent through the adapter's verified Steer path.",
            }
            .to_owned();
            record.follow_ups[index].delivered_at = Some(timestamp());
            record.state = AgentSessionState::Starting;
            record.state_source = AgentStateSource::Process;
            record.state_detail =
                "Follow-up bytes reached the provider terminal; provider activity is not yet declared."
                    .to_owned();
            record.updated_at = timestamp();
            Ok(())
        }
        Err(error) => {
            record.follow_ups[index].status_message = format!(
                "Delivery outcome is uncertain; automatic retry is disabled to prevent duplicate input: {error}"
            );
            write_single_record_state(app, record)?;
            Err(error)
        }
    }
}

fn write_single_record_state(app: &AppHandle, record: &AgentSessionRecord) -> Result<(), String> {
    let mut state = read_state(app)?;
    if let Some(existing) = state.sessions.iter_mut().find(|item| item.id == record.id) {
        *existing = record.clone();
    }
    write_state(app, &state)
}

fn visible_observation(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .collect::<String>()
        .trim()
        .chars()
        .take(2_000)
        .collect()
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn effective_follow_up_mode(record: &AgentSessionRecord, requested: FollowUpMode) -> FollowUpMode {
    if requested == FollowUpMode::Steer
        && (!record.adapter.supports_steer || !record.enhanced_events_active)
    {
        FollowUpMode::Queue
    } else {
        requested
    }
}

fn is_delivery_candidate(follow_up: &AgentFollowUp) -> bool {
    follow_up.status == FollowUpStatus::Queued
}

fn verified_adapters() -> Vec<AgentAdapterCapability> {
    vec![
        AgentAdapterCapability {
            agent_id: "codex".to_owned(),
            verified: true,
            declared_event_source: Some("codex exec --json JSONL".to_owned()),
            supports_steer: false,
            native_tui_note: "Native TUI stays attached; without declared JSONL events, state is an uncertain output observation.".to_owned(),
        },
        AgentAdapterCapability {
            agent_id: "claude-code".to_owned(),
            verified: true,
            declared_event_source: Some("claude --print --output-format stream-json".to_owned()),
            supports_steer: false,
            native_tui_note: "Native TUI stays attached; stream-json events are used only by an explicit enhanced session.".to_owned(),
        },
        AgentAdapterCapability {
            agent_id: "opencode".to_owned(),
            verified: true,
            declared_event_source: Some("OpenCode JSON events or server SSE".to_owned()),
            supports_steer: true,
            native_tui_note: "Native TUI stays attached; Steer is available only when the verified event adapter is active.".to_owned(),
        },
        AgentAdapterCapability {
            agent_id: "crush".to_owned(),
            verified: true,
            declared_event_source: Some("Crush server SSE with IsBusy".to_owned()),
            supports_steer: true,
            native_tui_note: "Native TUI stays attached; enhanced state requires the verified server event path.".to_owned(),
        },
    ]
}

fn adapter_for(agent_id: &str) -> AgentAdapterCapability {
    verified_adapters()
        .into_iter()
        .find(|adapter| adapter.agent_id == agent_id)
        .unwrap_or_else(|| AgentAdapterCapability {
            agent_id: agent_id.to_owned(),
            verified: false,
            declared_event_source: None,
            supports_steer: false,
            native_tui_note:
                "This app remains normally launchable. Enhanced state and Steer are not verified."
                    .to_owned(),
        })
}

fn supervision_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create app data directory: {error}"))?;
    Ok(directory.join(AGENT_SUPERVISION_FILE_NAME))
}

fn read_state(app: &AppHandle) -> Result<AgentSupervisionFile, String> {
    let path = supervision_path(app)?;
    if !path.exists() {
        return Ok(AgentSupervisionFile::default());
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("could not read agent supervision state: {error}"))?;
    let state: AgentSupervisionFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("agent supervision state is invalid: {error}"))?;
    if state.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "agent supervision state version {} is not supported",
            state.schema_version
        ));
    }
    Ok(state)
}

fn write_state(app: &AppHandle, state: &AgentSupervisionFile) -> Result<(), String> {
    let path = supervision_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("could not encode agent supervision state: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("could not write agent supervision state: {error}"))?;
    if let Err(rename_error) = fs::rename(&temporary, &path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("could not replace agent supervision state: {error}"))?;
            fs::rename(&temporary, &path)
                .map_err(|error| format!("could not replace agent supervision state: {error}"))?;
        } else {
            return Err(format!(
                "could not publish agent supervision state: {rename_error}"
            ));
        }
    }
    Ok(())
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
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

    fn record(agent_id: &str) -> AgentSessionRecord {
        AgentSessionRecord {
            id: "agent-session-test".to_owned(),
            session_id: "session-test".to_owned(),
            workspace_id: Some("workspace-test".to_owned()),
            workspace_name: "Test Workspace".to_owned(),
            workspace_root: "D:\\repo".to_owned(),
            tab_id: Some("tab-test".to_owned()),
            pane_id: Some("pane-test".to_owned()),
            agent_id: agent_id.to_owned(),
            agent_name: "Test Agent".to_owned(),
            state: AgentSessionState::Starting,
            state_source: AgentStateSource::Process,
            state_detail: "starting".to_owned(),
            follow_up_mode: FollowUpMode::Queue,
            adapter: adapter_for(agent_id),
            enhanced_events_active: false,
            attention: Vec::new(),
            follow_ups: Vec::new(),
            created_at: "1".to_owned(),
            updated_at: "1".to_owned(),
        }
    }

    #[test]
    fn state_vocabulary_is_fixed_and_records_evidence_source() {
        let states = [
            AgentSessionState::Starting,
            AgentSessionState::Working,
            AgentSessionState::WaitingForInput,
            AgentSessionState::WaitingForApproval,
            AgentSessionState::Done,
            AgentSessionState::Failed,
            AgentSessionState::Stopped,
            AgentSessionState::Interrupted,
        ];
        let encoded = states
            .iter()
            .map(|state| serde_json::to_string(state).expect("state should serialize"))
            .collect::<Vec<_>>();
        assert_eq!(
            encoded,
            vec![
                "\"starting\"",
                "\"working\"",
                "\"waitingForInput\"",
                "\"waitingForApproval\"",
                "\"done\"",
                "\"failed\"",
                "\"stopped\"",
                "\"interrupted\"",
            ]
        );
        let serialized = serde_json::to_value(record("codex")).expect("record should serialize");
        assert_eq!(serialized["stateSource"], "process");
        assert!(serialized.get("progress").is_none());
        assert!(serialized.get("percentage").is_none());
    }

    #[test]
    fn uncertain_output_never_claims_completion_or_fabricates_progress() {
        let mut record = record("codex");
        assert!(apply_output_observation(
            &mut record,
            "100% complete and done"
        ));
        assert_eq!(record.state, AgentSessionState::Working);
        assert_eq!(record.state_source, AgentStateSource::OutputObservation);
        assert!(record.attention.is_empty());
    }

    #[test]
    fn output_attention_is_uncertain_and_deduplicated() {
        let mut record = record("claude-code");
        assert!(apply_output_observation(
            &mut record,
            "Permission required. Approve? [y/n]"
        ));
        assert_eq!(record.state, AgentSessionState::WaitingForApproval);
        assert_eq!(record.attention.len(), 1);
        let _ = apply_output_observation(&mut record, "Permission required. Approve? [y/n]");
        assert_eq!(record.attention.len(), 1);
        assert_eq!(
            record.attention[0].source,
            AgentStateSource::OutputObservation
        );
    }

    #[test]
    fn declared_provider_completion_creates_completion_attention() {
        let mut record = record("opencode");
        apply_provider_event(
            &mut record,
            AgentSessionState::Done,
            "Turn completed".to_owned(),
        );
        assert_eq!(record.state, AgentSessionState::Done);
        assert_eq!(record.state_source, AgentStateSource::ProviderEvent);
        assert_eq!(record.attention[0].kind, AttentionKind::Completion);
    }

    #[test]
    fn first_verified_adapters_are_explicit_and_other_agents_fall_back() {
        let adapters = verified_adapters();
        assert_eq!(
            adapters
                .iter()
                .map(|adapter| adapter.agent_id.as_str())
                .collect::<Vec<_>>(),
            vec!["codex", "claude-code", "opencode", "crush"]
        );
        assert!(adapters.iter().all(|adapter| adapter.verified));
        assert!(!adapter_for("another-agent").verified);
        assert!(!adapter_for("another-agent").supports_steer);
    }

    #[test]
    fn queue_waits_for_declared_turn_boundary_and_steer_respects_adapter_support() {
        let mut codex = record("codex");
        codex.state = AgentSessionState::Done;
        codex.state_source = AgentStateSource::OutputObservation;
        assert!(!queue_can_deliver_from_declared_state(&codex));
        codex.state_source = AgentStateSource::ProviderEvent;
        assert!(queue_can_deliver_from_declared_state(&codex));
        assert!(!codex.adapter.supports_steer);
        assert_eq!(
            effective_follow_up_mode(&codex, FollowUpMode::Steer),
            FollowUpMode::Queue
        );
        let mut opencode = record("opencode");
        assert!(opencode.adapter.supports_steer);
        assert_eq!(
            effective_follow_up_mode(&opencode, FollowUpMode::Steer),
            FollowUpMode::Queue
        );
        opencode.enhanced_events_active = true;
        assert_eq!(
            effective_follow_up_mode(&opencode, FollowUpMode::Steer),
            FollowUpMode::Steer
        );
    }

    #[test]
    fn queued_follow_ups_round_trip_without_losing_delivery_identity() {
        let mut record = record("crush");
        record.follow_ups.push(AgentFollowUp {
            id: "follow-up-stable".to_owned(),
            message: "Check the failing test".to_owned(),
            requested_mode: FollowUpMode::Queue,
            effective_mode: FollowUpMode::Queue,
            status: FollowUpStatus::Queued,
            status_message: "queued".to_owned(),
            created_at: "2".to_owned(),
            delivered_at: None,
        });
        let encoded = serde_json::to_string(&record).expect("record should serialize");
        let decoded: AgentSessionRecord =
            serde_json::from_str(&encoded).expect("record should deserialize");
        assert_eq!(decoded.follow_ups[0].id, "follow-up-stable");
        assert_eq!(decoded.follow_ups[0].status, FollowUpStatus::Queued);
        assert!(is_delivery_candidate(&decoded.follow_ups[0]));
        let mut uncertain_delivery = decoded.follow_ups[0].clone();
        uncertain_delivery.status = FollowUpStatus::Delivering;
        assert!(!is_delivery_candidate(&uncertain_delivery));
    }
}
