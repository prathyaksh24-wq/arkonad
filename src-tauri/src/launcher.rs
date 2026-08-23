use crate::catalog::{CatalogCategory, CatalogManifest, CatalogRuntime, Detection, LaunchProfile};
use crate::installer::{InstallReceipt, InstallRuntime, ReceiptOwnership};
use crate::pty::{LaunchProcessRequest, SessionInfo, SessionManager};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

const LAUNCHER_STATE_FILE_NAME: &str = "launcher-state.json";
const WORKSPACE_DIRECTORY_NAME: &str = "workspaces";
const NEW_INSTALL_PRIORITY_SECONDS: u64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchpadEntry {
    pub id: String,
    pub source: String,
    pub name: String,
    pub summary: String,
    pub category: Option<CatalogCategory>,
    pub publisher: Option<String>,
    pub launchable: bool,
    pub executable_path: Option<String>,
    pub profile_id: Option<String>,
    pub supports_working_directory: bool,
    pub pinned: bool,
    pub newly_installed: bool,
    pub last_launched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAppDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub executable: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default = "default_supports_working_directory")]
    pub supports_working_directory: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAppProfile {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub arguments: Vec<String>,
    pub shell: Option<String>,
    pub working_directory: Option<String>,
    pub supports_working_directory: bool,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAppValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub executable_path: Option<String>,
    pub shell_path: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LaunchLocation {
    #[serde(rename = "currentDirectory")]
    CurrentDirectory,
    #[serde(rename = "directory")]
    Directory { path: String },
    #[serde(rename = "newWorkspace")]
    NewWorkspace { name: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub app_id: String,
    #[serde(default)]
    pub profile_id: Option<String>,
    pub location: LaunchLocation,
    #[serde(default)]
    pub current_directory: Option<String>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LauncherState {
    #[serde(default)]
    preferences: Vec<LaunchPreference>,
    #[serde(default)]
    custom_apps: Vec<CustomAppProfile>,
    #[serde(default)]
    workspaces: Vec<WorkspaceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPreference {
    id: String,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    last_launched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceRecord {
    id: String,
    name: String,
    root: String,
    created_at: String,
}

#[derive(Debug, Default)]
pub struct LaunchRuntime {
    state_lock: Mutex<()>,
}

#[derive(Debug, Clone)]
struct ResolvedLaunchProfile {
    executable: String,
    arguments: Vec<String>,
    shell: Option<String>,
    default_working_directory: Option<String>,
    supports_working_directory: bool,
}

#[derive(Debug, Clone)]
struct ResolvedCustomProfile {
    profile: CustomAppProfile,
    executable_path: String,
    shell_path: Option<String>,
}

fn default_supports_working_directory() -> bool {
    true
}

fn default_enabled() -> bool {
    true
}

pub(crate) fn prioritize_launchpad_entries(
    mut entries: Vec<LaunchpadEntry>,
) -> Vec<LaunchpadEntry> {
    entries.retain(|entry| entry.launchable);
    entries.sort_by(|left, right| {
        right
            .pinned
            .cmp(&left.pinned)
            .then_with(|| right.newly_installed.cmp(&left.newly_installed))
            .then_with(|| compare_timestamps_desc(&left.last_launched_at, &right.last_launched_at))
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.id.cmp(&right.id))
    });
    entries
}

pub(crate) fn validate_custom_profile_fields(draft: &CustomAppDraft) -> Vec<String> {
    let mut errors = Vec::new();
    if draft.name.trim().is_empty() {
        errors.push("name is required".to_owned());
    } else if draft.name.chars().any(char::is_control) {
        errors.push("name contains control characters".to_owned());
    }

    if draft.executable.trim().is_empty() {
        errors.push("executable is required".to_owned());
    } else if draft.executable.chars().any(char::is_control) {
        errors.push("executable contains control characters".to_owned());
    }

    if draft
        .arguments
        .iter()
        .any(|argument| argument.chars().any(char::is_control))
    {
        errors.push("arguments contain control characters".to_owned());
    }

    if draft
        .shell
        .as_deref()
        .is_some_and(|shell| shell.trim().is_empty() || shell.chars().any(char::is_control))
    {
        errors.push("shell must be a non-empty executable without control characters".to_owned());
    }

    if draft.working_directory.as_deref().is_some_and(|directory| {
        directory.trim().is_empty() || directory.chars().any(char::is_control)
    }) {
        errors.push(
            "working directory must be a non-empty path without control characters".to_owned(),
        );
    }

    errors
}

fn compare_timestamps_desc(left: &Option<String>, right: &Option<String>) -> Ordering {
    timestamp_value(right).cmp(&timestamp_value(left))
}

fn timestamp_value(value: &Option<String>) -> u64 {
    value
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or_default()
}

impl LaunchRuntime {
    pub fn launchpad_list(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
        installer: &InstallRuntime,
    ) -> Result<Vec<LaunchpadEntry>, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        let state = read_state(app)?;
        let receipts = installer.receipts(app)?;
        let receipt_by_manifest = receipts
            .iter()
            .map(|receipt| (receipt.manifest_id.clone(), receipt))
            .collect::<HashMap<_, _>>();
        let detections = catalog
            .detect()?
            .into_iter()
            .map(|detection| (detection.manifest_id.clone(), detection))
            .collect::<HashMap<_, _>>();
        let preferences = state
            .preferences
            .iter()
            .map(|preference| (preference.id.clone(), preference))
            .collect::<HashMap<_, _>>();
        let now = timestamp_value_from_text(&timestamp());

        let mut entries = Vec::new();
        for entry in catalog.list(None, None)? {
            let manifest = &entry.manifest;
            let detection = detections.get(&manifest.id);
            let receipt = receipt_by_manifest.get(&manifest.id).copied();
            let Ok(profile) = resolve_catalog_profile(manifest, detection, receipt, None) else {
                continue;
            };
            let preference = preferences.get(&manifest.id).copied();
            entries.push(LaunchpadEntry {
                id: manifest.id.clone(),
                source: "catalog".to_owned(),
                name: manifest.name.clone(),
                summary: manifest.summary.clone(),
                category: Some(manifest.category.clone()),
                publisher: Some(manifest.publisher.clone()),
                launchable: true,
                executable_path: Some(profile.executable.clone()),
                profile_id: manifest
                    .launch_profiles
                    .first()
                    .map(|profile| profile.id.clone()),
                supports_working_directory: profile.supports_working_directory,
                pinned: preference.is_some_and(|preference| preference.pinned),
                newly_installed: receipt.is_some_and(|receipt| {
                    receipt.ownership == ReceiptOwnership::Managed
                        && is_recent_install(&receipt.installed_at, now)
                }),
                last_launched_at: preference
                    .and_then(|preference| preference.last_launched_at.clone()),
            });
        }

        for profile in state.custom_apps.iter().filter(|profile| profile.enabled) {
            let draft = profile_as_draft(profile);
            let validation = validate_custom_profile_now(&draft);
            let Some(executable_path) = validation.executable_path else {
                continue;
            };
            let preference = preferences.get(&custom_entry_id(&profile.id)).copied();
            entries.push(LaunchpadEntry {
                id: custom_entry_id(&profile.id),
                source: "custom".to_owned(),
                name: profile.name.clone(),
                summary: "User-added Custom Tool profile".to_owned(),
                category: None,
                publisher: None,
                launchable: validation.valid,
                executable_path: Some(executable_path),
                profile_id: Some(profile.id.clone()),
                supports_working_directory: profile.supports_working_directory,
                pinned: preference.is_some_and(|preference| preference.pinned),
                newly_installed: false,
                last_launched_at: preference
                    .and_then(|preference| preference.last_launched_at.clone()),
            });
        }

        Ok(prioritize_launchpad_entries(entries))
    }

    pub fn launch(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
        installer: &InstallRuntime,
        sessions: &SessionManager,
        request: LaunchRequest,
        output: Channel<Vec<u8>>,
    ) -> Result<SessionInfo, String> {
        validate_launch_environment(&request.environment)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let (profile, executable) = if let Some(custom_id) = request.app_id.strip_prefix("custom:")
        {
            let custom = state
                .custom_apps
                .iter()
                .find(|profile| profile.id == custom_id && profile.enabled)
                .cloned()
                .ok_or_else(|| format!("unknown or disabled Custom Tool profile: {custom_id}"))?;
            let resolved = resolve_custom_profile(&custom)?;
            (
                ResolvedLaunchProfile {
                    executable: resolved.executable_path.clone(),
                    arguments: resolved.profile.arguments.clone(),
                    shell: resolved.shell_path.clone(),
                    default_working_directory: resolved.profile.working_directory.clone(),
                    supports_working_directory: resolved.profile.supports_working_directory,
                },
                resolved.executable_path,
            )
        } else {
            let manifest = catalog
                .manifest(&request.app_id)
                .ok_or_else(|| format!("unknown catalog tool: {}", request.app_id))?;
            let detection = catalog
                .detect()?
                .into_iter()
                .find(|detection| detection.manifest_id == request.app_id);
            let receipt = installer
                .receipts(app)?
                .into_iter()
                .find(|receipt| receipt.manifest_id == request.app_id);
            let profile = resolve_catalog_profile(
                &manifest,
                detection.as_ref(),
                receipt.as_ref(),
                request.profile_id.as_deref(),
            )?;
            (profile.clone(), profile.executable)
        };

        let cwd = resolve_launch_location(
            app,
            &mut state,
            &request.location,
            request.current_directory.as_deref(),
            profile.supports_working_directory,
            profile.default_working_directory.as_deref(),
        )?;
        write_state(app, &state)?;
        let info = sessions.create_launch(
            LaunchProcessRequest {
                executable,
                arguments: profile.arguments,
                shell: profile.shell,
                cwd: cwd.to_string_lossy().into_owned(),
                environment: request.environment,
            },
            app.clone(),
            output,
        )?;

        let preference_id = request.app_id;
        let preference = state
            .preferences
            .iter_mut()
            .find(|preference| preference.id == preference_id);
        if let Some(preference) = preference {
            preference.last_launched_at = Some(timestamp());
        } else {
            state.preferences.push(LaunchPreference {
                id: preference_id,
                pinned: false,
                last_launched_at: Some(timestamp()),
            });
        }
        if let Err(error) = write_state(app, &state) {
            let _ = sessions.close(&info.id);
            return Err(error);
        }

        Ok(info)
    }

    pub fn set_pinned(&self, app: &AppHandle, id: &str, pinned: bool) -> Result<(), String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        if let Some(preference) = state
            .preferences
            .iter_mut()
            .find(|preference| preference.id == id)
        {
            preference.pinned = pinned;
        } else {
            state.preferences.push(LaunchPreference {
                id: id.to_owned(),
                pinned,
                last_launched_at: None,
            });
        }
        write_state(app, &state)
    }

    pub fn custom_apps(&self, app: &AppHandle) -> Result<Vec<CustomAppProfile>, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        Ok(read_state(app)?.custom_apps)
    }

    pub fn validate_custom_app(
        &self,
        draft: &CustomAppDraft,
    ) -> Result<CustomAppValidation, String> {
        Ok(validate_custom_profile_now(draft))
    }

    pub fn save_custom_app(
        &self,
        app: &AppHandle,
        draft: CustomAppDraft,
    ) -> Result<CustomAppProfile, String> {
        let validation = validate_custom_profile_now(&draft);
        if !validation.valid {
            return Err(validation.errors.join("; "));
        }

        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let profile = upsert_custom_profile(&mut state, draft, &timestamp());
        write_state(app, &state)?;
        Ok(profile)
    }

    pub fn set_custom_app_enabled(
        &self,
        app: &AppHandle,
        id: &str,
        enabled: bool,
    ) -> Result<CustomAppProfile, String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        let result = set_custom_profile_enabled(&mut state, id, enabled, &timestamp())?;
        write_state(app, &state)?;
        Ok(result)
    }

    pub fn remove_custom_app(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "launcher state is unavailable".to_owned())?;
        let mut state = read_state(app)?;
        remove_custom_profile(&mut state, id)?;
        write_state(app, &state)
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn launchpad_list(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
    catalog: State<'_, CatalogRuntime>,
    installer: State<'_, InstallRuntime>,
) -> Result<Vec<LaunchpadEntry>, String> {
    launcher.launchpad_list(&app, &catalog, &installer)
}

#[tauri::command(rename_all = "camelCase")]
pub fn launch_app(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
    catalog: State<'_, CatalogRuntime>,
    installer: State<'_, InstallRuntime>,
    sessions: State<'_, SessionManager>,
    request: LaunchRequest,
    on_output: Channel<Vec<u8>>,
) -> Result<SessionInfo, String> {
    launcher.launch(&app, &catalog, &installer, &sessions, request, on_output)
}

#[tauri::command(rename_all = "camelCase")]
pub fn launchpad_set_pinned(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    launcher.set_pinned(&app, &id, pinned)
}

#[tauri::command(rename_all = "camelCase")]
pub fn custom_app_list(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
) -> Result<Vec<CustomAppProfile>, String> {
    launcher.custom_apps(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn custom_app_validate(
    launcher: State<'_, LaunchRuntime>,
    draft: CustomAppDraft,
) -> Result<CustomAppValidation, String> {
    launcher.validate_custom_app(&draft)
}

#[tauri::command(rename_all = "camelCase")]
pub fn custom_app_save(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
    draft: CustomAppDraft,
) -> Result<CustomAppProfile, String> {
    launcher.save_custom_app(&app, draft)
}

#[tauri::command(rename_all = "camelCase")]
pub fn custom_app_set_enabled(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
    id: String,
    enabled: bool,
) -> Result<CustomAppProfile, String> {
    launcher.set_custom_app_enabled(&app, &id, enabled)
}

#[tauri::command(rename_all = "camelCase")]
pub fn custom_app_remove(
    app: AppHandle,
    launcher: State<'_, LaunchRuntime>,
    id: String,
) -> Result<(), String> {
    launcher.remove_custom_app(&app, &id)
}

fn validate_launch_environment(environment: &BTreeMap<String, String>) -> Result<(), String> {
    for (key, value) in environment {
        if key.trim().is_empty()
            || key
                .chars()
                .any(|character| character.is_control() || character == '=')
        {
            return Err("launch environment contains an invalid variable name".to_owned());
        }
        if value.chars().any(char::is_control) {
            return Err(format!(
                "launch environment value for {key} contains control characters"
            ));
        }
    }
    Ok(())
}

fn resolve_catalog_profile(
    manifest: &CatalogManifest,
    detection: Option<&Detection>,
    receipt: Option<&InstallReceipt>,
    requested_profile_id: Option<&str>,
) -> Result<ResolvedLaunchProfile, String> {
    let profile = match requested_profile_id {
        Some(id) => manifest
            .launch_profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| format!("unknown launch profile {id} for {}", manifest.name))?,
        None => manifest
            .launch_profiles
            .first()
            .ok_or_else(|| format!("catalog tool {} has no launch profile", manifest.id))?,
    };
    let executable = detection
        .map(|detection| detection.path.clone())
        .or_else(|| {
            receipt
                .map(|receipt| receipt.executable_path.clone())
                .filter(|path| Path::new(path).is_file())
        })
        .ok_or_else(|| format!("{} is not launchable on this machine", manifest.name))?;
    if let Some(detection) = detection {
        if !detection.command.eq_ignore_ascii_case(&profile.executable)
            || !manifest
                .executable_detection
                .commands
                .iter()
                .any(|command| command.eq_ignore_ascii_case(&profile.executable))
            || !manifest
                .executable_detection
                .commands
                .iter()
                .any(|command| command.eq_ignore_ascii_case(&detection.command))
        {
            return Err(format!(
                "{} has no declared launch profile for the detected executable",
                manifest.name
            ));
        }
    }
    resolved_profile(profile, executable)
}

fn resolved_profile(
    profile: &LaunchProfile,
    executable: String,
) -> Result<ResolvedLaunchProfile, String> {
    let shell = profile
        .shell
        .as_deref()
        .map(|shell| {
            resolve_executable(shell)
                .ok_or_else(|| format!("declared launch shell was not found: {shell}"))
        })
        .transpose()?;
    Ok(ResolvedLaunchProfile {
        executable,
        arguments: profile.arguments.clone(),
        shell,
        default_working_directory: profile.working_directory.clone(),
        supports_working_directory: profile.working_directory.is_none(),
    })
}

fn resolve_custom_profile(profile: &CustomAppProfile) -> Result<ResolvedCustomProfile, String> {
    let validation = validate_custom_profile_now(&profile_as_draft(profile));
    if !validation.valid {
        return Err(validation.errors.join("; "));
    }
    Ok(ResolvedCustomProfile {
        profile: profile.clone(),
        executable_path: validation
            .executable_path
            .ok_or_else(|| "custom executable could not be resolved".to_owned())?,
        shell_path: validation.shell_path,
    })
}

fn validate_custom_profile_now(draft: &CustomAppDraft) -> CustomAppValidation {
    let mut errors = validate_custom_profile_fields(draft);
    let mut warnings = Vec::new();
    let executable_path = if errors.iter().any(|error| error.contains("executable")) {
        None
    } else {
        match resolve_executable(&draft.executable) {
            Some(path) => Some(path),
            None => {
                errors.push(format!(
                    "executable was not found: {}",
                    draft.executable.trim()
                ));
                None
            }
        }
    };
    let shell_path = match draft.shell.as_deref().map(str::trim) {
        None => None,
        Some("") => None,
        Some(shell) => match resolve_executable(shell) {
            Some(path) => Some(path),
            None => {
                errors.push(format!("shell was not found: {shell}"));
                None
            }
        },
    };
    let working_directory = match draft.working_directory.as_deref().map(str::trim) {
        None => None,
        Some("") => None,
        Some(directory) if Path::new(directory).is_dir() => Some(directory.to_owned()),
        Some(directory) => {
            errors.push(format!("working directory was not found: {directory}"));
            None
        }
    };
    if draft.supports_working_directory && draft.working_directory.is_none() {
        warnings.push(
            "Launches inherit the focused directory unless you choose another location.".to_owned(),
        );
    }
    CustomAppValidation {
        valid: errors.is_empty(),
        errors,
        warnings,
        executable_path,
        shell_path,
        working_directory,
    }
}

fn resolve_launch_location(
    app: &AppHandle,
    state: &mut LauncherState,
    location: &LaunchLocation,
    current_directory: Option<&str>,
    supports_working_directory: bool,
    default_working_directory: Option<&str>,
) -> Result<PathBuf, String> {
    if let LaunchLocation::NewWorkspace { name } = location {
        if !supports_working_directory {
            return Err("this launch profile does not accept a working directory".to_owned());
        }
        return create_workspace(app, state, name);
    }
    resolve_existing_launch_location(
        location,
        current_directory,
        supports_working_directory,
        default_working_directory,
    )
}

fn resolve_existing_launch_location(
    location: &LaunchLocation,
    current_directory: Option<&str>,
    supports_working_directory: bool,
    default_working_directory: Option<&str>,
) -> Result<PathBuf, String> {
    if !supports_working_directory {
        return default_working_directory
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .or_else(|| current_directory.map(PathBuf::from))
            .or_else(|| env::current_dir().ok())
            .filter(|path| path.is_dir())
            .ok_or_else(|| "this launch profile does not accept a working directory".to_owned());
    }

    let requested = match location {
        LaunchLocation::CurrentDirectory => current_directory
            .map(PathBuf::from)
            .or_else(|| env::current_dir().ok())
            .or_else(|| default_working_directory.map(PathBuf::from))
            .ok_or_else(|| "could not determine the current directory".to_owned())?,
        LaunchLocation::Directory { path } => PathBuf::from(path.trim()),
        LaunchLocation::NewWorkspace { .. } => {
            return Err("new Workspace resolution requires the app data directory".to_owned());
        }
    };
    if !requested.is_dir() {
        return Err(format!(
            "working directory does not exist: {}",
            requested.display()
        ));
    }
    Ok(requested)
}

fn create_workspace(
    app: &AppHandle,
    state: &mut LauncherState,
    name: &str,
) -> Result<PathBuf, String> {
    let slug = workspace_slug(name)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve Arkonad app data directory: {error}"))?
        .join(WORKSPACE_DIRECTORY_NAME);
    fs::create_dir_all(&base)
        .map_err(|error| format!("could not create Arkonad workspace directory: {error}"))?;
    for suffix in 0..1000_u32 {
        let candidate_name = if suffix == 0 {
            slug.clone()
        } else {
            format!("{slug}-{suffix}")
        };
        let candidate = base.join(candidate_name);
        match fs::create_dir(&candidate) {
            Ok(()) => {
                state.workspaces.push(WorkspaceRecord {
                    id: format!("workspace-{}", timestamp_millis()),
                    name: name.trim().to_owned(),
                    root: candidate.to_string_lossy().into_owned(),
                    created_at: timestamp(),
                });
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "could not create new Workspace directory {}: {error}",
                    candidate.display()
                ));
            }
        }
    }
    Err("could not find a free Workspace directory name".to_owned())
}

fn workspace_slug(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().any(char::is_control) || name.contains(['/', '\\', ':']) {
        return Err("Workspace name must be a non-empty path-safe name".to_owned());
    }
    let slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    if slug.is_empty() {
        return Err("Workspace name must contain a letter or number".to_owned());
    }
    Ok(slug)
}

fn resolve_executable(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if Path::new(value).components().count() > 1 {
        return Path::new(value).is_file().then(|| value.to_owned());
    }
    let resolver = if cfg!(windows) { "where.exe" } else { "which" };
    let output = Command::new(resolver).arg(value).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("INFO:"))
        .map(ToOwned::to_owned)
}

fn read_state(app: &AppHandle) -> Result<LauncherState, String> {
    let path = state_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("invalid launcher state file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(LauncherState::default()),
        Err(error) => Err(format!("could not read launcher state: {error}")),
    }
}

fn write_state(app: &AppHandle, state: &LauncherState) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create Arkonad app data directory: {error}"))?;
    }
    let contents = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("could not encode launcher state: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("could not write launcher state: {error}"))
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LAUNCHER_STATE_FILE_NAME))
        .map_err(|error| format!("could not resolve Arkonad app data directory: {error}"))
}

fn upsert_custom_profile(
    state: &mut LauncherState,
    draft: CustomAppDraft,
    now: &str,
) -> CustomAppProfile {
    let existing = draft
        .id
        .as_deref()
        .and_then(|id| state.custom_apps.iter().find(|profile| profile.id == id));
    let profile = CustomAppProfile {
        id: draft
            .id
            .clone()
            .unwrap_or_else(|| custom_profile_id(&draft.name)),
        name: draft.name.trim().to_owned(),
        executable: draft.executable.trim().to_owned(),
        arguments: draft.arguments,
        shell: normalize_optional_text(draft.shell),
        working_directory: normalize_optional_text(draft.working_directory),
        supports_working_directory: draft.supports_working_directory,
        enabled: draft.enabled,
        created_at: existing
            .map(|profile| profile.created_at.clone())
            .unwrap_or_else(|| now.to_owned()),
        updated_at: now.to_owned(),
    };
    if let Some(existing) = state
        .custom_apps
        .iter_mut()
        .find(|existing| existing.id == profile.id)
    {
        *existing = profile.clone();
    } else {
        state.custom_apps.push(profile.clone());
    }
    profile
}

fn set_custom_profile_enabled(
    state: &mut LauncherState,
    id: &str,
    enabled: bool,
    now: &str,
) -> Result<CustomAppProfile, String> {
    let profile = state
        .custom_apps
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| format!("unknown Custom Tool profile: {id}"))?;
    profile.enabled = enabled;
    profile.updated_at = now.to_owned();
    Ok(profile.clone())
}

fn remove_custom_profile(state: &mut LauncherState, id: &str) -> Result<(), String> {
    let original_len = state.custom_apps.len();
    state.custom_apps.retain(|profile| profile.id != id);
    if state.custom_apps.len() == original_len {
        return Err(format!("unknown Custom Tool profile: {id}"));
    }
    state
        .preferences
        .retain(|preference| preference.id != custom_entry_id(id));
    Ok(())
}

fn profile_as_draft(profile: &CustomAppProfile) -> CustomAppDraft {
    CustomAppDraft {
        id: Some(profile.id.clone()),
        name: profile.name.clone(),
        executable: profile.executable.clone(),
        arguments: profile.arguments.clone(),
        shell: profile.shell.clone(),
        working_directory: profile.working_directory.clone(),
        supports_working_directory: profile.supports_working_directory,
        enabled: profile.enabled,
    }
}

fn custom_profile_id(name: &str) -> String {
    let slug = workspace_slug(name).unwrap_or_else(|_| "tool".to_owned());
    format!("{slug}-{}", timestamp_millis())
}

fn custom_entry_id(id: &str) -> String {
    format!("custom:{id}")
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn timestamp_value_from_text(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or_default()
}

fn timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn is_recent_install(value: &str, now: u64) -> bool {
    let installed_at = timestamp_value_from_text(value);
    installed_at > 0 && now.saturating_sub(installed_at) <= NEW_INSTALL_PRIORITY_SECONDS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        id: &str,
        pinned: bool,
        newly_installed: bool,
        last_launched_at: Option<&str>,
        launchable: bool,
    ) -> LaunchpadEntry {
        LaunchpadEntry {
            id: id.to_owned(),
            source: "catalog".to_owned(),
            name: id.to_owned(),
            summary: String::new(),
            category: None,
            publisher: None,
            launchable,
            executable_path: None,
            profile_id: None,
            supports_working_directory: true,
            pinned,
            newly_installed,
            last_launched_at: last_launched_at.map(str::to_owned),
        }
    }

    #[test]
    fn launchpad_shows_only_launchable_entries_and_prioritizes_pins_then_new_then_recent() {
        let entries = prioritize_launchpad_entries(vec![
            entry("unavailable", false, false, Some("99"), false),
            entry("recent", false, false, Some("30"), true),
            entry("new", false, true, Some("1"), true),
            entry("pinned", true, false, None, true),
        ]);

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["pinned", "new", "recent"]
        );
    }

    #[test]
    fn launch_environment_accepts_scoped_context_and_rejects_control_data() {
        let valid = BTreeMap::from([
            ("ARKONAD_AGENT_MODE".to_owned(), "task".to_owned()),
            ("ARKONAD_AGENT_PERMISSION".to_owned(), "ask".to_owned()),
        ]);
        assert!(validate_launch_environment(&valid).is_ok());

        let invalid_name = BTreeMap::from([("BAD=NAME".to_owned(), "value".to_owned())]);
        assert!(validate_launch_environment(&invalid_name).is_err());

        let invalid_value = BTreeMap::from([("VALID_NAME".to_owned(), "bad\nvalue".to_owned())]);
        assert!(validate_launch_environment(&invalid_value).is_err());
    }

    #[test]
    fn custom_profile_validation_rejects_empty_name_and_executable() {
        let errors = validate_custom_profile_fields(&CustomAppDraft {
            id: None,
            name: " ".to_owned(),
            executable: " ".to_owned(),
            arguments: Vec::new(),
            shell: None,
            working_directory: None,
            supports_working_directory: true,
            enabled: true,
        });

        assert!(errors.iter().any(|error| error.contains("name")));
        assert!(errors.iter().any(|error| error.contains("executable")));
    }

    #[test]
    fn workspace_names_are_path_safe_and_stable() {
        assert_eq!(
            workspace_slug(" My Demo Workspace ").unwrap(),
            "my-demo-workspace"
        );
        assert!(workspace_slug("../outside").is_err());
        assert!(workspace_slug(" ").is_err());
    }

    #[test]
    fn recent_install_priority_expires_after_the_temporary_window() {
        assert!(is_recent_install("100", 100 + NEW_INSTALL_PRIORITY_SECONDS));
        assert!(!is_recent_install(
            "100",
            101 + NEW_INSTALL_PRIORITY_SECONDS
        ));
    }

    #[test]
    fn catalog_launch_uses_the_detected_executable_and_declared_profile() {
        let path = std::env::temp_dir().join(format!("arkonad-launch-{}.exe", timestamp()));
        fs::write(&path, b"test executable").expect("test executable should be writable");
        let manifest: CatalogManifest = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "test-tool",
            "name": "Test Tool",
            "summary": "test",
            "category": "productivity",
            "publisher": "Arkonad test",
            "license": "test",
            "platforms": ["windows"],
            "source": {"kind": "repository", "url": "https://example.com/tool"},
            "lastMetadataRefresh": "2026-08-22",
            "executableDetection": {"commands": ["test-tool.exe"]},
            "versions": {"latest": null, "supported": [], "verified": []},
            "installMethods": [{
                "id": "manual",
                "label": "manual",
                "kind": "manual",
                "source": "https://example.com/tool",
                "command": null
            }],
            "prerequisites": [],
            "launchProfiles": [{
                "id": "default",
                "label": "Start test tool",
                "executable": "test-tool.exe",
                "arguments": ["--native"],
                "shell": null,
                "workingDirectory": null
            }],
            "dataLocations": [],
            "networkExpectations": {"required": false, "summary": "test", "endpoints": []},
            "optionalEnhancements": [],
            "declaredCapabilities": [],
            "verifiedCompatibility": [],
            "managedByArkonad": false
        }))
        .expect("test manifest should parse");
        let detection = Detection {
            manifest_id: manifest.id.clone(),
            command: "test-tool.exe".to_owned(),
            path: path.to_string_lossy().into_owned(),
            source: "PATH".to_owned(),
            version: None,
        };

        let resolved = resolve_catalog_profile(&manifest, Some(&detection), None, Some("default"))
            .expect("declared profile should resolve");

        assert_eq!(resolved.executable, path.to_string_lossy());
        assert_eq!(resolved.arguments, vec!["--native"]);
        assert!(resolved.supports_working_directory);
        fs::remove_file(path).expect("test executable should be removable");
    }

    #[test]
    fn launch_location_uses_current_or_explicit_directory_and_rejects_missing_paths() {
        let current = std::env::temp_dir().join(format!("arkonad-current-{}", timestamp()));
        let another = std::env::temp_dir().join(format!("arkonad-another-{}", timestamp()));
        fs::create_dir_all(&current).expect("current directory should be writable");
        fs::create_dir_all(&another).expect("another directory should be writable");

        let current_result = resolve_existing_launch_location(
            &LaunchLocation::CurrentDirectory,
            Some(current.to_string_lossy().as_ref()),
            true,
            None,
        )
        .expect("current directory should resolve");
        let another_result = resolve_existing_launch_location(
            &LaunchLocation::Directory {
                path: another.to_string_lossy().into_owned(),
            },
            None,
            true,
            None,
        )
        .expect("another directory should resolve");
        let missing_result = resolve_existing_launch_location(
            &LaunchLocation::Directory {
                path: another.join("missing").to_string_lossy().into_owned(),
            },
            None,
            true,
            None,
        );

        assert_eq!(current_result, current);
        assert_eq!(another_result, another);
        assert!(missing_result.is_err());
        fs::remove_dir_all(current).expect("test current directory should be removable");
        fs::remove_dir_all(another).expect("test another directory should be removable");
    }

    #[test]
    fn custom_profile_state_supports_add_edit_disable_and_remove() {
        let mut state = LauncherState::default();
        let added = upsert_custom_profile(
            &mut state,
            CustomAppDraft {
                id: Some("custom-one".to_owned()),
                name: "One".to_owned(),
                executable: "tool.exe".to_owned(),
                arguments: vec!["--first".to_owned()],
                shell: None,
                working_directory: None,
                supports_working_directory: true,
                enabled: true,
            },
            "1",
        );
        assert_eq!(state.custom_apps.len(), 1);
        assert!(added.enabled);

        let edited = upsert_custom_profile(
            &mut state,
            CustomAppDraft {
                id: Some("custom-one".to_owned()),
                name: "Edited".to_owned(),
                executable: "tool.exe".to_owned(),
                arguments: vec!["--second".to_owned()],
                shell: None,
                working_directory: None,
                supports_working_directory: true,
                enabled: true,
            },
            "2",
        );
        assert_eq!(state.custom_apps.len(), 1);
        assert_eq!(edited.name, "Edited");
        assert_eq!(edited.arguments, vec!["--second"]);

        let disabled = set_custom_profile_enabled(&mut state, "custom-one", false, "3")
            .expect("existing profile should be disableable");
        assert!(!disabled.enabled);
        remove_custom_profile(&mut state, "custom-one").expect("profile should be removable");
        assert!(state.custom_apps.is_empty());
    }
}
