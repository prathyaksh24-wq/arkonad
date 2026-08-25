use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const RELEASE_STATE_FILE_NAME: &str = "release-state.json";
const MIGRATION_BACKUP_DIRECTORY: &str = "migration-backups";
const CURRENT_RELEASE_SCHEMA_VERSION: u32 = 1;
const CURRENT_DATA_SCHEMA_VERSION: u32 = 1;
const STORE_METADATA_FILE_NAME: &str = "store-metadata.json";
const DATA_FILE_NAMES: [&str; 4] = [
    "settings.json",
    STORE_METADATA_FILE_NAME,
    "install-receipts.json",
    "workspaces.json",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    pub schema_version: u32,
    pub data_schema_version: u32,
    pub last_migration_at: Option<String>,
    pub last_backup_path: Option<String>,
    pub last_migrated_files: Vec<String>,
    pub last_rollback_at: Option<String>,
    pub rollback_available: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRollbackRequest {
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseState {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    data_schema_version: u32,
    #[serde(default)]
    last_migration_at: Option<String>,
    #[serde(default)]
    last_backup_path: Option<String>,
    #[serde(default)]
    last_migrated_files: Vec<String>,
    #[serde(default)]
    last_rollback_at: Option<String>,
}

impl Default for ReleaseState {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_RELEASE_SCHEMA_VERSION,
            data_schema_version: CURRENT_DATA_SCHEMA_VERSION,
            last_migration_at: None,
            last_backup_path: None,
            last_migrated_files: Vec::new(),
            last_rollback_at: None,
        }
    }
}

#[derive(Debug)]
struct MigrationChange {
    name: String,
    original: Option<Vec<u8>>,
    migrated: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    schema_version: u32,
    created_at: String,
    files: Vec<BackupFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    name: String,
    existed: bool,
}

pub fn prepare(app: &AppHandle) -> Result<ReleaseStatus, String> {
    let root = app_data_dir(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("could not create Arkonad app data directory: {error}"))?;

    let state_path = root.join(RELEASE_STATE_FILE_NAME);
    let previous_state_contents = read_optional(&state_path)?;
    let state = read_state(&state_path)?;
    let mut changes = Vec::new();

    for name in DATA_FILE_NAMES {
        let path = root.join(name);
        let original = read_optional(&path)?;
        let Some(migrated) = migrate_file(name, original.as_deref())? else {
            continue;
        };
        if original.as_deref() != Some(migrated.as_slice()) {
            changes.push(MigrationChange {
                name: name.to_owned(),
                original,
                migrated,
            });
        }
    }

    if changes.is_empty()
        && previous_state_contents.is_some()
        && state.schema_version == CURRENT_RELEASE_SCHEMA_VERSION
        && state.data_schema_version == CURRENT_DATA_SCHEMA_VERSION
    {
        return Ok(status_for(
            &root,
            &state,
            "Release data is current. No migration was needed.",
        ));
    }

    let backup_path = if changes.is_empty() {
        None
    } else {
        Some(create_backup(&root, &changes)?)
    };

    if let Err(error) = apply_changes(&root, &changes) {
        let rollback = rollback_changes(
            &root,
            &changes,
            &state_path,
            previous_state_contents.as_deref(),
        );
        return Err(format_migration_error(error, rollback));
    }

    let mut next_state = state;
    next_state.schema_version = CURRENT_RELEASE_SCHEMA_VERSION;
    next_state.data_schema_version = CURRENT_DATA_SCHEMA_VERSION;
    if !changes.is_empty() {
        next_state.last_migration_at = Some(timestamp());
        next_state.last_migrated_files = changes.iter().map(|change| change.name.clone()).collect();
        next_state.last_backup_path = backup_path.as_ref().and_then(|path| {
            path.strip_prefix(&root)
                .ok()
                .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        });
    }

    let state_contents = serde_json::to_vec_pretty(&next_state)
        .map_err(|error| format!("could not encode release state: {error}"))?;
    if let Err(error) = write_atomic(&state_path, &state_contents) {
        let rollback = rollback_changes(
            &root,
            &changes,
            &state_path,
            previous_state_contents.as_deref(),
        );
        return Err(format_migration_error(error, rollback));
    }

    let message = if changes.is_empty() {
        "Release state initialized. User data was not changed.".to_owned()
    } else {
        format!(
            "Migrated {} release data file(s). A backup is available before rollback.",
            changes.len()
        )
    };
    Ok(status_for(&root, &next_state, &message))
}

pub fn status(app: &AppHandle) -> Result<ReleaseStatus, String> {
    let root = app_data_dir(app)?;
    let state = read_state(&root.join(RELEASE_STATE_FILE_NAME))?;
    Ok(status_for(
        &root,
        &state,
        "Release migration status loaded.",
    ))
}

pub fn restore_last_backup(
    app: &AppHandle,
    request: ReleaseRollbackRequest,
) -> Result<ReleaseStatus, String> {
    if !request.confirmed {
        return Err("release rollback requires explicit confirmation".to_owned());
    }
    let root = app_data_dir(app)?;
    let state_path = root.join(RELEASE_STATE_FILE_NAME);
    let mut state = read_state(&state_path)?;
    let relative_path = state
        .last_backup_path
        .as_deref()
        .ok_or_else(|| "no release migration backup is available".to_owned())?;
    let backup_path = resolve_backup_path(&root, relative_path)?;
    restore_data_from_backup(&root, &backup_path)?;
    state.last_rollback_at = Some(timestamp());
    write_atomic(
        &state_path,
        &serde_json::to_vec_pretty(&state)
            .map_err(|error| format!("could not encode release state: {error}"))?,
    )?;
    Ok(status_for(
        &root,
        &state,
        "The last release data migration backup was restored. Restart Arkonad before using the restored state.",
    ))
}

#[tauri::command(rename_all = "camelCase")]
pub fn release_status(app: AppHandle) -> Result<ReleaseStatus, String> {
    status(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn release_restore_last_backup(
    app: AppHandle,
    request: ReleaseRollbackRequest,
) -> Result<ReleaseStatus, String> {
    restore_last_backup(&app, request)
}

fn migrate_file(name: &str, contents: Option<&[u8]>) -> Result<Option<Vec<u8>>, String> {
    if name == STORE_METADATA_FILE_NAME && contents.is_none() {
        return Ok(Some(
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": CURRENT_DATA_SCHEMA_VERSION,
                "catalogSchemaVersion": 1,
                "source": "bundled"
            }))
            .map_err(|error| format!("could not encode store metadata: {error}"))?,
        ));
    }

    let Some(contents) = contents else {
        return Ok(None);
    };
    let mut value: Value = serde_json::from_slice(contents)
        .map_err(|error| format!("{name} is not valid JSON: {error}"))?;

    if name == "install-receipts.json" && value.is_array() {
        value = json!({
            "schemaVersion": CURRENT_DATA_SCHEMA_VERSION,
            "receipts": value
        });
    }

    let object = value
        .as_object_mut()
        .ok_or_else(|| format!("{name} must contain a JSON object"))?;
    ensure_current_schema(object, name)?;

    match name {
        "install-receipts.json" => {
            if object.get("receipts").is_none() {
                object.insert("receipts".to_owned(), Value::Array(Vec::new()));
            }
            if !object.get("receipts").is_some_and(Value::is_array) {
                return Err("install-receipts.json receipts must be an array".to_owned());
            }
        }
        "workspaces.json" => {
            if object.get("workspaces").is_none() {
                object.insert("workspaces".to_owned(), Value::Array(Vec::new()));
            }
            if object.get("lastWorkspaceId").is_none() {
                object.insert("lastWorkspaceId".to_owned(), Value::Null);
            }
        }
        STORE_METADATA_FILE_NAME => {
            let catalog_schema = object
                .get("catalogSchemaVersion")
                .and_then(Value::as_u64)
                .unwrap_or(1);
            if catalog_schema > 1 {
                return Err(format!(
                    "store metadata uses unsupported catalog schema version {catalog_schema}"
                ));
            }
            object.insert("catalogSchemaVersion".to_owned(), json!(1));
            object
                .entry("source".to_owned())
                .or_insert_with(|| Value::String("bundled".to_owned()));
        }
        _ => {}
    }

    serde_json::to_vec_pretty(&value)
        .map(Some)
        .map_err(|error| format!("could not encode {name}: {error}"))
}

fn ensure_current_schema(object: &mut Map<String, Value>, name: &str) -> Result<(), String> {
    let version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if version > u64::from(CURRENT_DATA_SCHEMA_VERSION) {
        return Err(format!("{name} uses unsupported schema version {version}"));
    }
    object.insert(
        "schemaVersion".to_owned(),
        json!(CURRENT_DATA_SCHEMA_VERSION),
    );
    Ok(())
}

fn create_backup(root: &Path, changes: &[MigrationChange]) -> Result<PathBuf, String> {
    let directory = root.join(MIGRATION_BACKUP_DIRECTORY).join(timestamp());
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create release migration backup: {error}"))?;
    let mut files = Vec::new();
    for change in changes {
        let path = root.join(&change.name);
        let existed = change.original.is_some();
        if existed {
            fs::copy(&path, directory.join(&change.name))
                .map_err(|error| format!("could not back up {}: {error}", change.name))?;
        }
        files.push(BackupFile {
            name: change.name.clone(),
            existed,
        });
    }
    let manifest = BackupManifest {
        schema_version: CURRENT_DATA_SCHEMA_VERSION,
        created_at: timestamp(),
        files,
    };
    write_atomic(
        &directory.join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("could not encode migration backup: {error}"))?,
    )?;
    Ok(directory)
}

fn apply_changes(root: &Path, changes: &[MigrationChange]) -> Result<(), String> {
    for change in changes {
        write_atomic(&root.join(&change.name), &change.migrated)?;
    }
    Ok(())
}

fn rollback_changes(
    root: &Path,
    changes: &[MigrationChange],
    state_path: &Path,
    previous_state_contents: Option<&[u8]>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for change in changes {
        let path = root.join(&change.name);
        let result = match change.original.as_deref() {
            Some(contents) => write_atomic(&path, contents),
            None => match fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("could not remove new {}: {error}", change.name)),
            },
        };
        if let Err(error) = result {
            errors.push(error);
        }
    }
    let state_result = match previous_state_contents {
        Some(contents) => write_atomic(state_path, contents),
        None => match fs::remove_file(state_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("could not remove new release state: {error}")),
        },
    };
    if let Err(error) = state_result {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn restore_data_from_backup(root: &Path, backup_path: &Path) -> Result<(), String> {
    let manifest_contents = fs::read(backup_path.join("manifest.json"))
        .map_err(|error| format!("could not read release migration backup: {error}"))?;
    let manifest: BackupManifest = serde_json::from_slice(&manifest_contents)
        .map_err(|error| format!("release migration backup is corrupt: {error}"))?;
    if manifest.schema_version != CURRENT_DATA_SCHEMA_VERSION {
        return Err("release migration backup uses an unsupported schema version".to_owned());
    }
    for file in manifest.files {
        if !DATA_FILE_NAMES.contains(&file.name.as_str()) {
            return Err(format!(
                "release migration backup names an unknown file: {}",
                file.name
            ));
        }
        let destination = root.join(&file.name);
        if file.existed {
            let contents = fs::read(backup_path.join(&file.name))
                .map_err(|error| format!("could not read backed up {}: {error}", file.name))?;
            write_atomic(&destination, &contents)?;
        } else {
            match fs::remove_file(destination) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("could not remove migrated {}: {error}", file.name));
                }
            }
        }
    }
    Ok(())
}

fn format_migration_error(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => format!("release data migration was rolled back: {error}"),
        Err(rollback_error) => format!(
            "release data migration failed: {error}; automatic rollback also failed: {rollback_error}"
        ),
    }
}

fn read_state(path: &Path) -> Result<ReleaseState, String> {
    let Some(contents) = read_optional(path)? else {
        return Ok(ReleaseState::default());
    };
    let mut state: ReleaseState = serde_json::from_slice(&contents)
        .map_err(|error| format!("release state is corrupt: {error}"))?;
    if state.schema_version == 0 {
        state.schema_version = CURRENT_RELEASE_SCHEMA_VERSION;
    }
    if state.data_schema_version == 0 {
        state.data_schema_version = CURRENT_DATA_SCHEMA_VERSION;
    }
    if state.schema_version > CURRENT_RELEASE_SCHEMA_VERSION
        || state.data_schema_version > CURRENT_DATA_SCHEMA_VERSION
    {
        return Err(
            "release state is newer than this Arkonad build and cannot be migrated".to_owned(),
        );
    }
    Ok(state)
}

fn status_for(root: &Path, state: &ReleaseState, message: &str) -> ReleaseStatus {
    let rollback_available = state
        .last_backup_path
        .as_deref()
        .and_then(|path| resolve_backup_path(root, path).ok())
        .is_some_and(|path| path.join("manifest.json").is_file());
    ReleaseStatus {
        schema_version: state.schema_version,
        data_schema_version: state.data_schema_version,
        last_migration_at: state.last_migration_at.clone(),
        last_backup_path: state.last_backup_path.clone(),
        last_migrated_files: state.last_migrated_files.clone(),
        last_rollback_at: state.last_rollback_at.clone(),
        rollback_available,
        message: message.to_owned(),
    }
}

fn resolve_backup_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("release backup path is outside the Arkonad migration directory".to_owned());
    }
    let path = root.join(relative);
    let backup_root = root.join(MIGRATION_BACKUP_DIRECTORY);
    if !path.starts_with(&backup_root) {
        return Err("release backup path is outside the Arkonad migration directory".to_owned());
    }
    Ok(path)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve Arkonad app data directory: {error}"))
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    }
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    if let Err(rename_error) = fs::rename(&temporary_path, path) {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("could not replace {}: {error}", path.display()))?;
            fs::rename(&temporary_path, path)
                .map_err(|error| format!("could not replace {}: {error}", path.display()))?;
        } else {
            return Err(format!(
                "could not publish {}: {rename_error}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_receipts_into_a_versioned_store() {
        let migrated = migrate_file(
            "install-receipts.json",
            Some(br#"[{"manifestId":"codex"}]"#),
        )
        .expect("legacy receipts should migrate")
        .expect("legacy receipts should produce a document");
        let value: Value = serde_json::from_slice(&migrated).expect("migrated JSON should parse");
        assert_eq!(value["schemaVersion"], json!(1));
        assert!(value["receipts"].is_array());
    }

    #[test]
    fn adds_schema_to_existing_workspace_data() {
        let migrated = migrate_file("workspaces.json", Some(br#"{"workspaces":[]}"#))
            .expect("workspace state should migrate")
            .expect("workspace state should produce a document");
        let value: Value = serde_json::from_slice(&migrated).expect("migrated JSON should parse");
        assert_eq!(value["schemaVersion"], json!(1));
        assert!(value["lastWorkspaceId"].is_null());
    }

    #[test]
    fn creates_versioned_store_metadata() {
        let migrated = migrate_file(STORE_METADATA_FILE_NAME, None)
            .expect("store metadata should be created")
            .expect("store metadata should produce a document");
        let value: Value = serde_json::from_slice(&migrated).expect("metadata should parse");
        assert_eq!(value["schemaVersion"], json!(1));
        assert_eq!(value["catalogSchemaVersion"], json!(1));
        assert_eq!(value["source"], json!("bundled"));
    }

    #[test]
    fn future_data_versions_are_rejected_without_a_write() {
        let error = migrate_file("settings.json", Some(br#"{"schemaVersion":99}"#))
            .expect_err("future settings should not be silently changed");
        assert!(error.contains("unsupported schema version"));
    }

    #[test]
    fn backup_paths_cannot_escape_the_migration_directory() {
        let root = PathBuf::from(r"C:\Arkonad");
        assert!(resolve_backup_path(&root, "migration-backups/123").is_ok());
        assert!(resolve_backup_path(&root, "../settings.json").is_err());
        assert!(resolve_backup_path(&root, r"C:\other").is_err());
    }
}
