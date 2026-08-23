use crate::frame::{FrameSnapshot, LayoutNode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const WORKSPACE_STATE_FILE_NAME: &str = "workspaces.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;
const MIN_SPLIT_RATIO: f32 = 0.15;
const MAX_SPLIT_RATIO: f32 = 0.85;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSaveRequest {
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub name: String,
    pub root: String,
    #[serde(default)]
    pub repository_root: Option<String>,
    pub frame: FrameSnapshot,
    #[serde(default)]
    pub app_pins: Vec<String>,
    #[serde(default)]
    pub launch_profiles: Vec<Value>,
    #[serde(default)]
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub root: String,
    pub repository_root: Option<String>,
    pub frame: FrameSnapshot,
    pub app_pins: Vec<String>,
    pub launch_profiles: Vec<Value>,
    pub settings: Value,
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLoadResult {
    pub status: String,
    pub message: String,
    pub workspace: Option<WorkspaceDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStoreFile {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    workspaces: Vec<WorkspaceDocument>,
    #[serde(default)]
    last_workspace_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct WorkspaceRuntime {
    state_lock: Mutex<()>,
}

impl WorkspaceRuntime {
    pub fn save(
        &self,
        app: &AppHandle,
        request: WorkspaceSaveRequest,
    ) -> Result<WorkspaceDocument, String> {
        validate_save_request(&request)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "workspace state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let id = request
            .workspace_id
            .filter(|id| !id.trim().is_empty())
            .or_else(|| {
                state
                    .workspaces
                    .iter()
                    .find(|workspace| workspace.root == request.root)
                    .map(|workspace| workspace.id.clone())
            })
            .unwrap_or_else(|| format!("workspace-{}", timestamp_millis()));
        let document = WorkspaceDocument {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: id.clone(),
            name: workspace_name(&request.name, &request.root),
            root: request.root.trim().to_owned(),
            repository_root: request
                .repository_root
                .filter(|root| !root.trim().is_empty())
                .or_else(|| detect_repository_root(&request.root)),
            frame: request.frame,
            app_pins: unique_strings(request.app_pins),
            launch_profiles: request.launch_profiles,
            settings: request.settings,
            saved_at: timestamp(),
        };
        if let Some(existing) = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == id)
        {
            *existing = document.clone();
        } else {
            state.workspaces.push(document.clone());
        }
        state.last_workspace_id = Some(id);
        write_state(app, &state)?;
        Ok(document)
    }

    pub fn load(&self, app: &AppHandle, workspace_id: Option<String>) -> WorkspaceLoadResult {
        let _guard = match self.state_lock.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return WorkspaceLoadResult {
                    status: "invalid".to_owned(),
                    message: "Workspace state is unavailable. A blank shell is safe to use."
                        .to_owned(),
                    workspace: None,
                };
            }
        };
        let state = match read_state(app) {
            Ok(state) => state,
            Err(error) => {
                return WorkspaceLoadResult {
                    status: "invalid".to_owned(),
                    message: format!("{error}. A blank shell is safe to use."),
                    workspace: None,
                };
            }
        };
        let selected_id = workspace_id
            .filter(|id| !id.trim().is_empty())
            .or(state.last_workspace_id.clone());
        let workspace =
            selected_id.and_then(|id| state.workspaces.into_iter().find(|item| item.id == id));
        let Some(workspace) = workspace else {
            return WorkspaceLoadResult {
                status: "empty".to_owned(),
                message: "No saved Workspace was found. Arkonad will open a blank shell."
                    .to_owned(),
                workspace: None,
            };
        };
        if let Err(error) = validate_document(&workspace) {
            return WorkspaceLoadResult {
                status: "invalid".to_owned(),
                message: format!(
                    "Workspace “{}” could not be restored: {error}. A blank shell is safe to use.",
                    workspace.name
                ),
                workspace: None,
            };
        }
        WorkspaceLoadResult {
            status: "ready".to_owned(),
            message: format!(
                "Workspace “{}” is ready for review. Saved processes are marked Interrupted until you choose what to restart.",
                workspace.name
            ),
            workspace: Some(workspace),
        }
    }

    pub fn delete(&self, app: &AppHandle, workspace_id: Option<String>) -> Result<(), String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "workspace state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let selected_id = workspace_id
            .filter(|id| !id.trim().is_empty())
            .or(state.last_workspace_id.clone());
        if let Some(selected_id) = selected_id {
            state
                .workspaces
                .retain(|workspace| workspace.id != selected_id);
            if state.last_workspace_id.as_deref() == Some(selected_id.as_str()) {
                state.last_workspace_id = state
                    .workspaces
                    .last()
                    .map(|workspace| workspace.id.clone());
            }
            write_state(app, &state)?;
        }
        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn workspace_save(
    app: AppHandle,
    state: State<'_, WorkspaceRuntime>,
    request: WorkspaceSaveRequest,
) -> Result<WorkspaceDocument, String> {
    state.save(&app, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn workspace_load(
    app: AppHandle,
    state: State<'_, WorkspaceRuntime>,
    workspace_id: Option<String>,
) -> WorkspaceLoadResult {
    state.load(&app, workspace_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn workspace_delete(
    app: AppHandle,
    state: State<'_, WorkspaceRuntime>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    state.delete(&app, workspace_id)
}

fn validate_save_request(request: &WorkspaceSaveRequest) -> Result<(), String> {
    let root = request.root.trim();
    if root.is_empty() {
        return Err("Workspace root is empty".to_owned());
    }
    if !Path::new(root).is_dir() {
        return Err(format!("Workspace root does not exist: {root}"));
    }
    validate_frame(&request.frame)
}

fn validate_document(document: &WorkspaceDocument) -> Result<(), String> {
    if document.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "saved state version {} is not supported",
            document.schema_version
        ));
    }
    if document.id.trim().is_empty() || document.root.trim().is_empty() {
        return Err("saved Workspace metadata is incomplete".to_owned());
    }
    validate_frame(&document.frame)
}

fn validate_frame(frame: &FrameSnapshot) -> Result<(), String> {
    let mut tab_ids = HashSet::new();
    let mut pane_ids = HashSet::new();
    for tab in &frame.tabs {
        if !tab_ids.insert(tab.id.clone()) {
            return Err(format!("duplicate tab id: {}", tab.id));
        }
        if tab.panes.is_empty() {
            return Err(format!("tab {} has no panes", tab.id));
        }
        let mut leaves = Vec::new();
        validate_layout(&tab.root, &mut leaves)?;
        if leaves.len() != tab.panes.len() {
            return Err(format!("tab {} has an invalid layout", tab.id));
        }
        let leaf_ids = leaves.iter().collect::<HashSet<_>>();
        if leaf_ids.len() != leaves.len()
            || !tab.panes.iter().all(|pane| leaf_ids.contains(&pane.id))
        {
            return Err(format!("tab {} references an unknown pane", tab.id));
        }
        if !tab.root.contains(&tab.focused_pane_id) {
            return Err(format!("tab {} focuses an unknown pane", tab.id));
        }
        for pane in &tab.panes {
            if !pane_ids.insert(pane.id.clone()) {
                return Err(format!("duplicate pane id: {}", pane.id));
            }
            if pane.session.cwd.trim().is_empty() || pane.session.shell.trim().is_empty() {
                return Err(format!("pane {} has incomplete session metadata", pane.id));
            }
        }
    }
    match &frame.active_tab_id {
        Some(active_tab_id) if tab_ids.contains(active_tab_id) => {}
        Some(active_tab_id) => return Err(format!("active tab is missing: {active_tab_id}")),
        None if frame.tabs.is_empty() => {}
        None => return Err("non-empty Workspace has no active tab".to_owned()),
    }
    if let Some(focused_pane_id) = &frame.focused_pane_id {
        if !pane_ids.contains(focused_pane_id) {
            return Err(format!("focused pane is missing: {focused_pane_id}"));
        }
    }
    Ok(())
}

fn validate_layout(node: &LayoutNode, leaves: &mut Vec<String>) -> Result<(), String> {
    match node {
        LayoutNode::Leaf { pane_id } => {
            if pane_id.trim().is_empty() {
                return Err("layout contains an empty pane id".to_owned());
            }
            leaves.push(pane_id.clone());
        }
        LayoutNode::Split {
            ratio,
            first,
            second,
            ..
        } => {
            if !ratio.is_finite() || !(MIN_SPLIT_RATIO..=MAX_SPLIT_RATIO).contains(ratio) {
                return Err(format!("split ratio is outside bounds: {ratio}"));
            }
            validate_layout(first, leaves)?;
            validate_layout(second, leaves)?;
        }
    }
    Ok(())
}

fn workspace_name(requested: &str, root: &str) -> String {
    let requested = requested.trim();
    if !requested.is_empty() && !requested.chars().any(char::is_control) {
        return requested.to_owned();
    }
    Path::new(root)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Arkonad Workspace")
        .to_owned()
}

fn unique_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn detect_repository_root(root: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", root, "rev-parse", "--show-toplevel"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let repository_root = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!repository_root.is_empty() && Path::new(&repository_root).is_dir()).then_some(repository_root)
}

fn read_state(app: &AppHandle) -> Result<WorkspaceStoreFile, String> {
    let path = state_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => {
            let state: WorkspaceStoreFile = serde_json::from_str(&contents)
                .map_err(|error| format!("Workspace state is corrupt: {error}"))?;
            if state.schema_version != CURRENT_SCHEMA_VERSION {
                return Err(format!(
                    "Workspace state version {} is not supported",
                    state.schema_version
                ));
            }
            Ok(state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(WorkspaceStoreFile {
            schema_version: CURRENT_SCHEMA_VERSION,
            ..WorkspaceStoreFile::default()
        }),
        Err(error) => Err(format!("could not read Workspace state: {error}")),
    }
}

fn write_state(app: &AppHandle, state: &WorkspaceStoreFile) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create Arkonad app data directory: {error}"))?;
    }
    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("could not encode Workspace state: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("could not write Workspace state: {error}"))?;
    if let Err(rename_error) = fs::rename(&temporary_path, &path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("could not replace Workspace state: {error}"))?;
            fs::rename(&temporary_path, &path)
                .map_err(|error| format!("could not replace Workspace state: {error}"))?;
        } else {
            return Err(format!("could not publish Workspace state: {rename_error}"));
        }
    }
    Ok(())
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(WORKSPACE_STATE_FILE_NAME))
        .map_err(|error| format!("could not resolve Arkonad app data directory: {error}"))
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{FramePane, FrameTab};
    use crate::pty::SessionInfo;

    fn sample_frame() -> FrameSnapshot {
        FrameSnapshot {
            tabs: vec![FrameTab {
                id: "tab-1".to_owned(),
                title: "PowerShell 7".to_owned(),
                root: LayoutNode::Leaf {
                    pane_id: "pane-1".to_owned(),
                },
                panes: vec![FramePane {
                    id: "pane-1".to_owned(),
                    session: SessionInfo {
                        id: "session-1".to_owned(),
                        shell: "PowerShell 7".to_owned(),
                        shell_path: Some("pwsh.exe".to_owned()),
                        cwd: r"C:\workspace".to_owned(),
                    },
                }],
                focused_pane_id: "pane-1".to_owned(),
            }],
            active_tab_id: Some("tab-1".to_owned()),
            focused_pane_id: Some("pane-1".to_owned()),
        }
    }

    #[test]
    fn workspace_frame_can_exist_without_a_repository() {
        validate_frame(&sample_frame()).expect("a shell-only Workspace should be valid");
        assert!(detect_repository_root(r"C:\path\that\does\not\exist").is_none());
    }

    #[test]
    fn invalid_frame_metadata_is_rejected_before_persisting() {
        let mut frame = sample_frame();
        frame.tabs[0].root = LayoutNode::Leaf {
            pane_id: "missing-pane".to_owned(),
        };
        let error = validate_frame(&frame).expect_err("unknown pane should be rejected");
        assert!(error.contains("invalid layout") || error.contains("unknown pane"));
    }
}
