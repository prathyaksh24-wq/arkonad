use crate::storage::AppData;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
#[cfg(feature = "desktop")]
use tauri::{AppHandle, State};

const SETTINGS_FILE_NAME: &str = "settings.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub label: String,
    pub executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDocument {
    #[serde(default = "current_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_leader_chord")]
    pub leader_chord: String,
    #[serde(default = "default_startup_surface")]
    pub startup_surface: String,
    #[serde(default = "default_shell_profile_id")]
    pub default_shell_profile_id: String,
    #[serde(default = "default_shell_profiles")]
    pub shell_profiles: Vec<ShellProfile>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_pet")]
    pub pet: String,
    #[serde(default = "default_motion")]
    pub motion: String,
    #[serde(default = "default_transparency")]
    pub transparency: String,
    #[serde(default = "default_font_scale")]
    pub font_scale: f32,
    #[serde(default)]
    pub high_contrast: bool,
    #[serde(default = "default_screen_reader_labels")]
    pub screen_reader_labels: bool,
    #[serde(default = "default_app_update_policy")]
    pub app_update_policy: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadResult {
    pub status: String,
    pub message: String,
    pub settings: SettingsDocument,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValidationResult {
    pub valid: bool,
    pub message: String,
    pub settings: Option<SettingsDocument>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSaveRequest {
    pub settings: SettingsDocument,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsImportRequest {
    pub contents: String,
}

#[derive(Debug, Default)]
pub struct SettingsRuntime {
    state_lock: Mutex<()>,
}

impl SettingsRuntime {
    pub fn load(&self, app: &dyn AppData) -> SettingsLoadResult {
        let _guard = match self.state_lock.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return fallback_result(
                    "Settings are unavailable. Arkonad is using safe defaults for this run.",
                );
            }
        };

        match read_settings(app) {
            Ok(Some(settings)) => SettingsLoadResult {
                status: "ready".to_owned(),
                message: "Saved Arkonad settings loaded.".to_owned(),
                settings,
            },
            Ok(None) => SettingsLoadResult {
                status: "default".to_owned(),
                message: "No saved settings were found. Arkonad is using safe defaults.".to_owned(),
                settings: default_settings(),
            },
            Err(error) => fallback_result(&format!(
                "Saved settings could not be used: {error}. The file was left unchanged and safe defaults are active."
            )),
        }
    }

    pub fn save(
        &self,
        app: &dyn AppData,
        request: SettingsSaveRequest,
    ) -> Result<SettingsDocument, String> {
        validate_settings(&request.settings)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "settings state is unavailable".to_owned())?;
        write_settings(app, &request.settings)?;
        Ok(request.settings)
    }

    pub fn validate(&self, contents: String) -> SettingsValidationResult {
        match parse_settings(&contents) {
            Ok(settings) => match validate_settings(&settings) {
                Ok(()) => SettingsValidationResult {
                    valid: true,
                    message: "The configuration is valid and can be applied.".to_owned(),
                    settings: Some(settings),
                },
                Err(error) => SettingsValidationResult {
                    valid: false,
                    message: error,
                    settings: None,
                },
            },
            Err(error) => SettingsValidationResult {
                valid: false,
                message: format!("The configuration is not valid JSON: {error}"),
                settings: None,
            },
        }
    }

    pub fn import(
        &self,
        app: &dyn AppData,
        request: SettingsImportRequest,
    ) -> Result<SettingsDocument, String> {
        let settings = parse_settings(&request.contents)
            .map_err(|error| format!("The configuration is not valid JSON: {error}"))?;
        validate_settings(&settings)?;
        let _guard = self
            .state_lock
            .lock()
            .map_err(|_| "settings state is unavailable".to_owned())?;
        write_settings(app, &settings)?;
        Ok(settings)
    }

    pub fn export(&self, app: &dyn AppData) -> Result<String, String> {
        let result = self.load(app);
        serde_json::to_string_pretty(&result.settings)
            .map_err(|error| format!("could not encode settings: {error}"))
    }
}

#[cfg(feature = "desktop")]
#[tauri::command(rename_all = "camelCase")]
pub fn settings_load(app: AppHandle, state: State<'_, SettingsRuntime>) -> SettingsLoadResult {
    state.load(&app)
}

#[cfg(feature = "desktop")]
#[tauri::command(rename_all = "camelCase")]
pub fn settings_save(
    app: AppHandle,
    state: State<'_, SettingsRuntime>,
    request: SettingsSaveRequest,
) -> Result<SettingsDocument, String> {
    state.save(&app, request)
}

#[cfg(feature = "desktop")]
#[tauri::command(rename_all = "camelCase")]
pub fn settings_validate(
    state: State<'_, SettingsRuntime>,
    contents: String,
) -> SettingsValidationResult {
    state.validate(contents)
}

#[cfg(feature = "desktop")]
#[tauri::command(rename_all = "camelCase")]
pub fn settings_import(
    app: AppHandle,
    state: State<'_, SettingsRuntime>,
    request: SettingsImportRequest,
) -> Result<SettingsDocument, String> {
    state.import(&app, request)
}

#[cfg(feature = "desktop")]
#[tauri::command(rename_all = "camelCase")]
pub fn settings_export(
    app: AppHandle,
    state: State<'_, SettingsRuntime>,
) -> Result<String, String> {
    state.export(&app)
}

fn parse_settings(contents: &str) -> Result<SettingsDocument, serde_json::Error> {
    serde_json::from_str(contents)
}

fn validate_settings(settings: &SettingsDocument) -> Result<(), String> {
    if settings.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "settings schema version {} is not supported; expected {}",
            settings.schema_version, CURRENT_SCHEMA_VERSION
        ));
    }
    if settings.leader_chord.trim().is_empty()
        || settings.leader_chord.chars().any(char::is_control)
    {
        return Err("leaderChord must be a non-empty key chord".to_owned());
    }
    if !matches!(
        settings.startup_surface.as_str(),
        "terminal" | "store" | "apps" | "launchpad" | "lastWorkspace"
    ) {
        return Err(format!(
            "startupSurface is not supported: {}",
            settings.startup_surface
        ));
    }
    if !matches!(
        settings.theme.as_str(),
        "ember" | "midnight" | "carbon" | "amber" | "phosphor" | "gruvbox" | "dracula" | "google84"
    ) {
        return Err(format!("theme is not supported: {}", settings.theme));
    }
    if !matches!(settings.pet.as_str(), "none" | "gengar" | "snorlax") {
        return Err(format!("pet is not supported: {}", settings.pet));
    }
    if !matches!(settings.motion.as_str(), "system" | "reduced" | "full") {
        return Err(format!("motion is not supported: {}", settings.motion));
    }
    if !matches!(settings.transparency.as_str(), "solid" | "subtle" | "glass") {
        return Err(format!(
            "transparency is not supported: {}",
            settings.transparency
        ));
    }
    if !settings.font_scale.is_finite() || !(0.8..=1.5).contains(&settings.font_scale) {
        return Err("fontScale must be between 0.8 and 1.5".to_owned());
    }
    if !matches!(
        settings.app_update_policy.as_str(),
        "review" | "notify" | "never"
    ) {
        return Err(format!(
            "appUpdatePolicy is not supported: {}",
            settings.app_update_policy
        ));
    }
    if settings.shell_profiles.is_empty() {
        return Err("shellProfiles must contain at least one profile".to_owned());
    }
    let mut ids = HashSet::new();
    for profile in &settings.shell_profiles {
        if profile.id.trim().is_empty() || !ids.insert(profile.id.clone()) {
            return Err("shellProfiles must use unique non-empty ids".to_owned());
        }
        if profile.label.trim().is_empty() || profile.label.chars().any(char::is_control) {
            return Err(format!("shell profile {} has an invalid label", profile.id));
        }
        if let Some(executable) = profile.executable.as_deref() {
            if executable.trim().is_empty() || executable.chars().any(char::is_control) {
                return Err(format!(
                    "shell profile {} has an invalid executable",
                    profile.id
                ));
            }
        }
    }
    if !ids.contains(&settings.default_shell_profile_id) {
        return Err(format!(
            "defaultShellProfileId does not match a shell profile: {}",
            settings.default_shell_profile_id
        ));
    }
    Ok(())
}

fn read_settings(app: &dyn AppData) -> Result<Option<SettingsDocument>, String> {
    let path = settings_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => {
            let settings = parse_settings(&contents)
                .map_err(|error| format!("settings JSON is corrupt: {error}"))?;
            validate_settings(&settings)?;
            Ok(Some(settings))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read settings: {error}")),
    }
}

fn write_settings(app: &dyn AppData, settings: &SettingsDocument) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create Arkonad app data directory: {error}"))?;
    }
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("could not encode settings: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("could not write settings: {error}"))?;
    if let Err(rename_error) = fs::rename(&temporary_path, &path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("could not replace settings: {error}"))?;
            fs::rename(&temporary_path, &path)
                .map_err(|error| format!("could not replace settings: {error}"))?;
        } else {
            return Err(format!("could not publish settings: {rename_error}"));
        }
    }
    Ok(())
}

fn settings_path(app: &dyn AppData) -> Result<PathBuf, String> {
    app.data_directory()
        .map(|directory| directory.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("could not resolve Arkonad app data directory: {error}"))
}

fn fallback_result(message: &str) -> SettingsLoadResult {
    SettingsLoadResult {
        status: "invalid".to_owned(),
        message: message.to_owned(),
        settings: default_settings(),
    }
}

fn default_settings() -> SettingsDocument {
    SettingsDocument {
        schema_version: CURRENT_SCHEMA_VERSION,
        leader_chord: default_leader_chord(),
        startup_surface: default_startup_surface(),
        default_shell_profile_id: default_shell_profile_id(),
        shell_profiles: default_shell_profiles(),
        theme: default_theme(),
        pet: default_pet(),
        motion: default_motion(),
        transparency: default_transparency(),
        font_scale: default_font_scale(),
        high_contrast: false,
        screen_reader_labels: true,
        app_update_policy: default_app_update_policy(),
    }
}

fn current_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

fn default_leader_chord() -> String {
    "ctrl+space".to_owned()
}

fn default_startup_surface() -> String {
    "launchpad".to_owned()
}

fn default_shell_profile_id() -> String {
    "auto".to_owned()
}

#[cfg(windows)]
fn default_shell_profiles() -> Vec<ShellProfile> {
    vec![
        ShellProfile {
            id: "auto".to_owned(),
            label: "System default".to_owned(),
            executable: None,
        },
        ShellProfile {
            id: "powershell-7".to_owned(),
            label: "PowerShell 7".to_owned(),
            executable: Some("pwsh.exe".to_owned()),
        },
        ShellProfile {
            id: "windows-powershell".to_owned(),
            label: "Windows PowerShell".to_owned(),
            executable: Some("powershell.exe".to_owned()),
        },
        ShellProfile {
            id: "command-prompt".to_owned(),
            label: "Command Prompt".to_owned(),
            executable: Some("cmd.exe".to_owned()),
        },
        ShellProfile {
            id: "wsl".to_owned(),
            label: "WSL".to_owned(),
            executable: Some("wsl.exe".to_owned()),
        },
    ]
}

#[cfg(not(windows))]
fn default_shell_profiles() -> Vec<ShellProfile> {
    let mut profiles = vec![ShellProfile {
        id: "auto".into(),
        label: "System default".into(),
        executable: None,
    }];
    profiles.extend(
        ["bash", "zsh", "fish", "sh"]
            .into_iter()
            .map(|shell| ShellProfile {
                id: shell.into(),
                label: shell.into(),
                executable: Some(shell.into()),
            }),
    );
    profiles
}

fn default_theme() -> String {
    "amber".to_owned()
}

fn default_pet() -> String {
    "none".to_owned()
}

fn default_motion() -> String {
    "system".to_owned()
}

fn default_transparency() -> String {
    "solid".to_owned()
}

fn default_font_scale() -> f32 {
    1.0
}

fn default_app_update_policy() -> String {
    "review".to_owned()
}

fn default_screen_reader_labels() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_valid_and_terminal_safe() {
        let settings = default_settings();
        validate_settings(&settings).expect("defaults should pass validation");
        assert_eq!(settings.startup_surface, "launchpad");
        assert_eq!(settings.default_shell_profile_id, "auto");
        assert_eq!(settings.app_update_policy, "review");
        assert_eq!(settings.pet, "none");
    }

    #[test]
    fn invalid_settings_are_rejected_before_persistence() {
        let mut settings = default_settings();
        settings.font_scale = 2.0;
        let error = validate_settings(&settings).expect_err("an unsafe font scale must fail");
        assert!(error.contains("fontScale"));

        settings = default_settings();
        settings.default_shell_profile_id = "missing".to_owned();
        let error = validate_settings(&settings).expect_err("unknown shell profile must fail");
        assert!(error.contains("defaultShellProfileId"));

        settings = default_settings();
        settings.pet = "cloud-cat".to_owned();
        let error = validate_settings(&settings).expect_err("unknown pet must fail");
        assert!(error.contains("pet"));
    }

    #[test]
    fn human_readable_json_round_trips() {
        let original = default_settings();
        let json = serde_json::to_string_pretty(&original).expect("settings should encode");
        let decoded = parse_settings(&json).expect("settings should decode");
        assert_eq!(decoded, original);
    }
}
