use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    process::Command,
    sync::Mutex,
};

const MANIFEST_SCHEMA_VERSION: u32 = 1;
const BUILTIN_MANIFESTS: &str = include_str!("../catalog/manifests.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub summary: String,
    pub category: CatalogCategory,
    pub publisher: String,
    pub license: String,
    pub platforms: Vec<Platform>,
    pub source: SourceReference,
    pub last_metadata_refresh: String,
    pub executable_detection: ExecutableDetection,
    pub versions: VersionInfo,
    pub install_methods: Vec<InstallMethod>,
    pub prerequisites: Vec<Prerequisite>,
    pub launch_profiles: Vec<LaunchProfile>,
    pub data_locations: Vec<DataLocation>,
    pub network_expectations: NetworkExpectations,
    pub optional_enhancements: Vec<OptionalEnhancement>,
    pub declared_capabilities: Vec<DeclaredCapability>,
    pub verified_compatibility: Vec<Platform>,
    pub managed_by_arkonad: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CatalogCategory {
    Agent,
    Productivity,
    Git,
}

impl CatalogCategory {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Productivity => "productivity",
            Self::Git => "git",
        }
    }
}

impl std::str::FromStr for CatalogCategory {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "agent" => Ok(Self::Agent),
            "productivity" => Ok(Self::Productivity),
            "git" => Ok(Self::Git),
            _ => Err(format!("unknown catalog category: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceReference {
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutableDetection {
    pub commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionInfo {
    pub latest: Option<String>,
    pub supported: Vec<String>,
    pub verified: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallMethod {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub source: String,
    pub command: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prerequisite {
    pub id: String,
    pub label: String,
    pub description: String,
    pub check: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchProfile {
    pub id: String,
    pub label: String,
    pub executable: String,
    pub arguments: Vec<String>,
    pub shell: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataLocation {
    pub kind: String,
    pub path: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkExpectations {
    pub required: bool,
    pub summary: String,
    pub endpoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionalEnhancement {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclaredCapability {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub manifest_id: String,
    pub command: String,
    pub path: String,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatus {
    pub id: String,
    pub label: String,
    pub state: StatusState,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StatusState {
    Active,
    Inactive,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub manifest: CatalogManifest,
    pub statuses: Vec<CatalogStatus>,
    pub detection: Option<Detection>,
}

#[derive(Debug)]
pub struct CatalogRuntime {
    manifests: Vec<CatalogManifest>,
    detections: Mutex<HashMap<String, Detection>>,
}

impl CatalogRuntime {
    pub fn builtins() -> Self {
        match Self::from_json(BUILTIN_MANIFESTS) {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("Arkonad catalog disabled: {error}");
                Self {
                    manifests: Vec::new(),
                    detections: Mutex::new(HashMap::new()),
                }
            }
        }
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let manifests: Vec<CatalogManifest> =
            serde_json::from_str(json).map_err(|error| format!("invalid catalog JSON: {error}"))?;

        if manifests.is_empty() {
            return Err("catalog must contain at least one manifest".to_owned());
        }

        let mut ids = HashSet::new();
        for manifest in &manifests {
            if !ids.insert(manifest.id.clone()) {
                return Err(format!("duplicate catalog manifest id: {}", manifest.id));
            }
            validate_manifest(manifest)?;
        }

        Ok(Self {
            manifests,
            detections: Mutex::new(HashMap::new()),
        })
    }

    fn list(
        &self,
        query: Option<&str>,
        category: Option<&str>,
    ) -> Result<Vec<CatalogEntry>, String> {
        let selected_category = category
            .filter(|value| !value.trim().is_empty())
            .map(str::parse::<CatalogCategory>)
            .transpose()?;
        let query = query.unwrap_or_default().trim().to_ascii_lowercase();
        let tokens = query.split_whitespace().collect::<Vec<_>>();
        let detections = self
            .detections
            .lock()
            .map_err(|_| "catalog detection state is unavailable".to_owned())?;

        Ok(self
            .manifests
            .iter()
            .filter(|manifest| {
                selected_category
                    .as_ref()
                    .map_or(true, |category| category == &manifest.category)
            })
            .filter(|manifest| {
                let haystack = format!(
                    "{} {} {} {}",
                    manifest.name,
                    manifest.summary,
                    manifest.publisher,
                    manifest.category.as_str()
                )
                .to_ascii_lowercase();
                tokens.iter().all(|token| haystack.contains(token))
            })
            .map(|manifest| {
                let detection = detections.get(&manifest.id).cloned();
                CatalogEntry {
                    statuses: statuses_for(manifest, detection.as_ref()),
                    manifest: manifest.clone(),
                    detection,
                }
            })
            .collect())
    }

    fn detect(&self) -> Result<Vec<Detection>, String> {
        let mut detections = HashMap::new();
        for manifest in &self.manifests {
            if let Some(detection) = detect_manifest(manifest) {
                detections.insert(manifest.id.clone(), detection);
            }
        }

        let mut state = self
            .detections
            .lock()
            .map_err(|_| "catalog detection state is unavailable".to_owned())?;
        *state = detections.clone();

        Ok(self
            .manifests
            .iter()
            .filter_map(|manifest| detections.get(&manifest.id).cloned())
            .collect())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_list(
    state: tauri::State<'_, CatalogRuntime>,
    query: Option<String>,
    category: Option<String>,
) -> Result<Vec<CatalogEntry>, String> {
    state.list(query.as_deref(), category.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_detect(state: tauri::State<'_, CatalogRuntime>) -> Result<Vec<Detection>, String> {
    state.detect()
}

fn validate_manifest(manifest: &CatalogManifest) -> Result<(), String> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "manifest {} uses unsupported schema version {}",
            manifest.id, manifest.schema_version
        ));
    }
    if manifest.id.is_empty()
        || manifest.id.len() > 64
        || !manifest.id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err(format!("manifest id is not a safe slug: {}", manifest.id));
    }
    require_text(&manifest.name, "name", &manifest.id)?;
    require_text(&manifest.summary, "summary", &manifest.id)?;
    require_text(&manifest.publisher, "publisher", &manifest.id)?;
    require_text(&manifest.license, "license", &manifest.id)?;
    require_text(
        &manifest.last_metadata_refresh,
        "lastMetadataRefresh",
        &manifest.id,
    )?;
    validate_source(&manifest.source, &manifest.id)?;
    if manifest.platforms.is_empty() {
        return Err(format!(
            "manifest {} must declare at least one platform",
            manifest.id
        ));
    }
    validate_unique_platforms(&manifest.platforms, &manifest.id)?;
    validate_executable_detection(&manifest.executable_detection, &manifest.id)?;
    validate_versions(&manifest.versions, &manifest.id)?;
    validate_install_methods(&manifest.install_methods, &manifest.id)?;
    validate_prerequisites(&manifest.prerequisites, &manifest.id)?;
    validate_launch_profiles(
        &manifest.launch_profiles,
        &manifest.executable_detection,
        &manifest.id,
    )?;
    validate_data_locations(&manifest.data_locations, &manifest.id)?;
    validate_network_expectations(&manifest.network_expectations, &manifest.id)?;
    validate_optional_enhancements(&manifest.optional_enhancements, &manifest.id)?;
    validate_capabilities(&manifest.declared_capabilities, &manifest.id)?;
    validate_unique_platforms(&manifest.verified_compatibility, &manifest.id)?;
    Ok(())
}

fn require_text(value: &str, field: &str, id: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(format!("manifest {id} has invalid {field}"));
    }
    Ok(())
}

fn validate_source(source: &SourceReference, id: &str) -> Result<(), String> {
    require_text(&source.kind, "source.kind", id)?;
    require_https_url(&source.url, "source.url", id)
}

fn require_https_url(value: &str, field: &str, id: &str) -> Result<(), String> {
    if !value.starts_with("https://") || value.chars().any(char::is_control) {
        return Err(format!("manifest {id} has an unsafe {field}"));
    }
    Ok(())
}

fn validate_unique_platforms(platforms: &[Platform], id: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    if platforms.iter().any(|platform| !seen.insert(platform)) {
        return Err(format!("manifest {id} repeats a platform"));
    }
    Ok(())
}

fn validate_executable_detection(detection: &ExecutableDetection, id: &str) -> Result<(), String> {
    if detection.commands.is_empty() {
        return Err(format!("manifest {id} must declare executable detection"));
    }
    let mut seen = HashSet::new();
    for command in &detection.commands {
        validate_executable(command, "executableDetection.commands", id)?;
        if !seen.insert(command) {
            return Err(format!("manifest {id} repeats executable {command}"));
        }
    }
    Ok(())
}

fn validate_executable(value: &str, field: &str, id: &str) -> Result<(), String> {
    const UNSAFE_EXECUTABLE_CHARACTERS: &str = "/\\:;&|<>`$(){}[]*?\"'";
    if value.is_empty()
        || value.len() > 96
        || value.chars().any(|character| {
            character.is_whitespace()
                || character.is_control()
                || UNSAFE_EXECUTABLE_CHARACTERS.contains(character)
        })
    {
        return Err(format!("manifest {id} has an unsafe {field} value"));
    }
    Ok(())
}

fn validate_versions(versions: &VersionInfo, id: &str) -> Result<(), String> {
    if versions
        .latest
        .as_deref()
        .is_some_and(|version| version.trim().is_empty() || version.chars().any(char::is_control))
    {
        return Err(format!("manifest {id} has an invalid latest version"));
    }
    validate_unique_text(&versions.supported, "versions.supported", id)?;
    validate_unique_text(&versions.verified, "versions.verified", id)
}

fn validate_install_methods(methods: &[InstallMethod], id: &str) -> Result<(), String> {
    if methods.is_empty() {
        return Err(format!("manifest {id} must declare an install method"));
    }
    let mut seen = HashSet::new();
    for method in methods {
        require_text(&method.id, "installMethods.id", id)?;
        require_text(&method.label, "installMethods.label", id)?;
        require_text(&method.kind, "installMethods.kind", id)?;
        require_https_url(&method.source, "installMethods.source", id)?;
        if !seen.insert(&method.id) {
            return Err(format!(
                "manifest {id} repeats install method {}",
                method.id
            ));
        }
        if let Some(command) = &method.command {
            if command.is_empty()
                || command
                    .iter()
                    .any(|part| part.chars().any(char::is_control))
            {
                return Err(format!("manifest {id} has an invalid install command"));
            }
        }
    }
    Ok(())
}

fn validate_prerequisites(prerequisites: &[Prerequisite], id: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for prerequisite in prerequisites {
        require_text(&prerequisite.id, "prerequisites.id", id)?;
        require_text(&prerequisite.label, "prerequisites.label", id)?;
        require_text(&prerequisite.description, "prerequisites.description", id)?;
        if !seen.insert(&prerequisite.id) {
            return Err(format!(
                "manifest {id} repeats prerequisite {}",
                prerequisite.id
            ));
        }
        if prerequisite
            .check
            .as_deref()
            .is_some_and(|check| check.chars().any(char::is_control))
        {
            return Err(format!("manifest {id} has an invalid prerequisite check"));
        }
    }
    Ok(())
}

fn validate_launch_profiles(
    profiles: &[LaunchProfile],
    detection: &ExecutableDetection,
    id: &str,
) -> Result<(), String> {
    if profiles.is_empty() {
        return Err(format!("manifest {id} must declare a launch profile"));
    }
    let mut seen = HashSet::new();
    for profile in profiles {
        require_text(&profile.id, "launchProfiles.id", id)?;
        require_text(&profile.label, "launchProfiles.label", id)?;
        validate_executable(&profile.executable, "launchProfiles.executable", id)?;
        if !detection.commands.contains(&profile.executable) {
            return Err(format!(
                "manifest {id} launch profile {} uses an undetected executable",
                profile.id
            ));
        }
        if !seen.insert(&profile.id) {
            return Err(format!(
                "manifest {id} repeats launch profile {}",
                profile.id
            ));
        }
        if profile
            .arguments
            .iter()
            .any(|argument| argument.chars().any(char::is_control))
            || profile
                .shell
                .as_deref()
                .is_some_and(|shell| shell.chars().any(char::is_control))
            || profile
                .working_directory
                .as_deref()
                .is_some_and(|directory| directory.chars().any(char::is_control))
        {
            return Err(format!("manifest {id} has an unsafe launch profile"));
        }
    }
    Ok(())
}

fn validate_data_locations(locations: &[DataLocation], id: &str) -> Result<(), String> {
    for location in locations {
        require_text(&location.kind, "dataLocations.kind", id)?;
        require_text(&location.path, "dataLocations.path", id)?;
        require_text(&location.description, "dataLocations.description", id)?;
    }
    Ok(())
}

fn validate_network_expectations(
    expectations: &NetworkExpectations,
    id: &str,
) -> Result<(), String> {
    require_text(&expectations.summary, "networkExpectations.summary", id)?;
    for endpoint in &expectations.endpoints {
        require_https_url(endpoint, "networkExpectations.endpoints", id)?;
    }
    Ok(())
}

fn validate_optional_enhancements(
    enhancements: &[OptionalEnhancement],
    id: &str,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for enhancement in enhancements {
        require_text(&enhancement.id, "optionalEnhancements.id", id)?;
        require_text(&enhancement.label, "optionalEnhancements.label", id)?;
        require_text(
            &enhancement.description,
            "optionalEnhancements.description",
            id,
        )?;
        if !seen.insert(&enhancement.id) {
            return Err(format!(
                "manifest {id} repeats optional enhancement {}",
                enhancement.id
            ));
        }
    }
    Ok(())
}

fn validate_capabilities(capabilities: &[DeclaredCapability], id: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for capability in capabilities {
        require_text(&capability.id, "declaredCapabilities.id", id)?;
        require_text(&capability.label, "declaredCapabilities.label", id)?;
        require_text(
            &capability.description,
            "declaredCapabilities.description",
            id,
        )?;
        if !seen.insert(&capability.id) {
            return Err(format!(
                "manifest {id} repeats declared capability {}",
                capability.id
            ));
        }
    }
    Ok(())
}

fn validate_unique_text(values: &[String], field: &str, id: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for value in values {
        require_text(value, field, id)?;
        if !seen.insert(value) {
            return Err(format!("manifest {id} repeats {field} value {value}"));
        }
    }
    Ok(())
}

fn detect_manifest(manifest: &CatalogManifest) -> Option<Detection> {
    manifest
        .executable_detection
        .commands
        .iter()
        .find_map(|command| {
            find_executable(command).map(|path| Detection {
                manifest_id: manifest.id.clone(),
                command: command.clone(),
                path,
                source: "PATH".to_owned(),
                version: None,
            })
        })
}

fn find_executable(command: &str) -> Option<String> {
    let resolver = if cfg!(windows) { "where.exe" } else { "which" };
    let output = Command::new(resolver).arg(command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("INFO:"))
        .map(ToOwned::to_owned)
}

fn statuses_for(manifest: &CatalogManifest, detection: Option<&Detection>) -> Vec<CatalogStatus> {
    let detected = detection.is_some();
    let update_state = match (
        detection.and_then(|value| value.version.as_deref()),
        manifest.versions.latest.as_deref(),
    ) {
        (Some(current), Some(latest)) if current != latest => StatusState::Active,
        (Some(_), Some(_)) => StatusState::Inactive,
        _ => StatusState::Unknown,
    };

    vec![
        status(
            "listed",
            "Listed",
            StatusState::Active,
            "Catalog manifest loaded",
        ),
        status(
            "detected",
            "Detected",
            if detected {
                StatusState::Active
            } else {
                StatusState::Inactive
            },
            if detected {
                "Executable found on PATH"
            } else {
                "Executable not found on PATH"
            },
        ),
        status(
            "installed",
            "Installed",
            if manifest.managed_by_arkonad {
                StatusState::Active
            } else {
                StatusState::Inactive
            },
            if manifest.managed_by_arkonad {
                "Arkonad has an installation record"
            } else {
                "No Arkonad installation record"
            },
        ),
        status(
            "launchable",
            "Launchable",
            if detected {
                StatusState::Active
            } else {
                StatusState::Inactive
            },
            if detected {
                "A declared launch profile can be resolved"
            } else {
                "Resolve the executable before launching"
            },
        ),
        status(
            "updateAvailable",
            "Update Available",
            update_state,
            if manifest.versions.latest.is_some()
                && detection.and_then(|value| value.version.as_ref()).is_some()
            {
                "Local and catalog versions can be compared"
            } else {
                "Version comparison is not available"
            },
        ),
        status(
            "verifiedCompatibility",
            "Verified Compatibility",
            if manifest.verified_compatibility.is_empty() {
                StatusState::Inactive
            } else {
                StatusState::Active
            },
            if manifest.verified_compatibility.is_empty() {
                "No compatibility verification declared"
            } else {
                "Compatibility is declared for selected platforms"
            },
        ),
        status(
            "managedByArkonad",
            "Managed by Arkonad",
            if manifest.managed_by_arkonad {
                StatusState::Active
            } else {
                StatusState::Inactive
            },
            if manifest.managed_by_arkonad {
                "Arkonad owns the installation record"
            } else {
                "Arkonad does not own this installation"
            },
        ),
    ]
}

fn status(id: &str, label: &str, state: StatusState, detail: &str) -> CatalogStatus {
    CatalogStatus {
        id: id.to_owned(),
        label: label.to_owned(),
        state,
        detail: detail.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_an_untrusted_executable_value() {
        let mut value: serde_json::Value = serde_json::from_str(BUILTIN_MANIFESTS).unwrap();
        value[0]["executableDetection"]["commands"][0] =
            serde_json::Value::String("codex --unsafe".to_owned());

        let error = CatalogRuntime::from_json(&value.to_string()).unwrap_err();

        assert!(error.contains("executableDetection.commands"));
    }

    #[test]
    fn searches_case_insensitively_and_filters_by_category() {
        let runtime = CatalogRuntime::from_json(BUILTIN_MANIFESTS).unwrap();

        let entries = runtime.list(Some("CODEX"), Some("AGENT")).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].manifest.id, "codex");

        let entries = runtime.list(Some("codex"), Some("productivity")).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn distinguishes_external_detection_from_managed_installation() {
        let runtime = CatalogRuntime::from_json(BUILTIN_MANIFESTS).unwrap();
        let entry = runtime.list(Some("superfile"), None).unwrap().remove(0);

        let state_for = |id: &str| {
            entry
                .statuses
                .iter()
                .find(|status| status.id == id)
                .map(|status| &status.state)
                .unwrap()
        };

        assert_eq!(state_for("listed"), &StatusState::Active);
        assert_eq!(state_for("detected"), &StatusState::Inactive);
        assert_eq!(state_for("installed"), &StatusState::Inactive);
        assert_eq!(state_for("managedByArkonad"), &StatusState::Inactive);
        assert_eq!(state_for("verifiedCompatibility"), &StatusState::Inactive);
    }

    #[cfg(windows)]
    #[test]
    fn detects_a_windows_command_without_running_it() {
        assert!(find_executable("cmd.exe").is_some());
    }
}
