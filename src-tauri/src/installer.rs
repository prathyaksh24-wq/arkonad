use crate::catalog::{
    CatalogCategory, CatalogManifest, CatalogRuntime, DataLocation, Detection, InstallMethod,
    Prerequisite, PrivilegeRequirement, SourceReference,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const RECEIPT_FILE_NAME: &str = "install-receipts.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStep {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub optional: bool,
    pub description: String,
    pub command: Option<Vec<String>>,
    pub source: Option<String>,
    pub privileges: PrivilegeRequirement,
    pub rollback_limits: String,
    pub requires_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub manifest_id: String,
    pub tool_name: String,
    pub publisher: String,
    pub version: Option<String>,
    pub catalog_source: SourceReference,
    pub package_source: String,
    pub method_id: String,
    pub method_label: String,
    pub method_kind: String,
    pub package_id: Option<String>,
    pub supported: bool,
    pub command: Option<Vec<String>>,
    pub privileges: PrivilegeRequirement,
    pub download_size_bytes: Option<u64>,
    pub affected_system_features: Vec<String>,
    pub data_expectations: String,
    pub rollback_limits: String,
    pub prerequisites: Vec<InstallStep>,
    pub app_step: InstallStep,
    pub manual_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub manifest_id: String,
    pub method_id: Option<String>,
    pub step_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReceipt {
    pub id: String,
    pub manifest_id: String,
    pub tool_name: String,
    pub publisher: String,
    pub version: Option<String>,
    pub source: String,
    #[serde(default)]
    pub method_id: Option<String>,
    pub method: String,
    pub package_id: Option<String>,
    pub executable_path: String,
    pub verification: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub state: String,
    pub message: String,
    pub system_change: bool,
    pub retryable: bool,
    pub rollback_available: bool,
    pub logs: String,
    pub manual_recovery: Option<String>,
    pub receipt: Option<InstallReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ManagementOperation {
    Update,
    Repair,
    Uninstall,
    DataCleanup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyAppEntry {
    pub manifest_id: String,
    pub tool_name: String,
    pub summary: String,
    pub category: CatalogCategory,
    pub publisher: String,
    pub ownership: String,
    pub installed_version: Option<String>,
    pub detected_version: Option<String>,
    pub update_state: String,
    pub launchable: bool,
    pub executable_path: Option<String>,
    pub source: String,
    pub last_checked_at: String,
    pub method_id: Option<String>,
    pub method_label: Option<String>,
    pub data_locations: Vec<DataLocation>,
    pub receipt: Option<InstallReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCleanupTarget {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub path: String,
    pub exists: bool,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementPlan {
    pub manifest_id: String,
    pub tool_name: String,
    pub publisher: String,
    pub operation: ManagementOperation,
    pub ownership: String,
    pub installed_version: Option<String>,
    pub source: String,
    pub method_id: Option<String>,
    pub method_label: Option<String>,
    pub method_kind: Option<String>,
    pub package_id: Option<String>,
    pub supported: bool,
    pub command: Option<Vec<String>>,
    pub privileges: PrivilegeRequirement,
    pub affected_system_features: Vec<String>,
    pub data_expectations: String,
    pub rollback_limits: String,
    pub data_targets: Vec<DataCleanupTarget>,
    pub requires_confirmation: bool,
    pub manual_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementRequest {
    pub manifest_id: String,
    pub operation: ManagementOperation,
    pub confirmed: bool,
}

#[derive(Debug, Default)]
pub struct InstallRuntime {
    receipt_lock: Mutex<()>,
}

impl InstallRuntime {
    pub fn build_plan(
        manifest: &CatalogManifest,
        method_id: Option<&str>,
    ) -> Result<InstallPlan, String> {
        let method = select_method(manifest, method_id)?;
        let supported = method_is_supported(method);
        let command = method.command.clone().filter(|_| supported);
        let prerequisites = manifest
            .prerequisites
            .iter()
            .map(prerequisite_step)
            .collect::<Vec<_>>();
        let method_version = method
            .version
            .clone()
            .or_else(|| manifest.versions.latest.clone());
        let app_step = InstallStep {
            id: "application".to_owned(),
            label: format!("Install {}", manifest.name),
            kind: "application".to_owned(),
            optional: false,
            description: format!(
                "Run the declared {} method from {}.",
                method.label, method.source
            ),
            command: command.clone(),
            source: Some(method.source.clone()),
            privileges: method.privileges.clone(),
            rollback_limits: method.rollback_limits.clone(),
            requires_confirmation: true,
        };

        Ok(InstallPlan {
            manifest_id: manifest.id.clone(),
            tool_name: manifest.name.clone(),
            publisher: manifest.publisher.clone(),
            version: method_version,
            catalog_source: manifest.source.clone(),
            package_source: method.source.clone(),
            method_id: method.id.clone(),
            method_label: method.label.clone(),
            method_kind: method.kind.clone(),
            package_id: method.package_id.clone(),
            supported,
            command,
            privileges: method.privileges.clone(),
            download_size_bytes: method.download_size_bytes,
            affected_system_features: method.affected_system_features.clone(),
            data_expectations: method.data_expectations.clone(),
            rollback_limits: method.rollback_limits.clone(),
            prerequisites,
            app_step,
            manual_instructions: (!supported).then(|| {
                format!(
                    "This method is not executable by Arkonad. Follow the publisher instructions at {}. Arkonad will not guess a package command.",
                    method.source
                )
            }),
        })
    }

    pub fn cancelled_outcome() -> InstallOutcome {
        InstallOutcome {
            state: "cancelled".to_owned(),
            message: "The operation was cancelled before execution; no system change was made."
                .to_owned(),
            system_change: false,
            retryable: true,
            rollback_available: false,
            logs: String::new(),
            manual_recovery: None,
            receipt: None,
        }
    }

    pub fn execute(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
        request: InstallRequest,
    ) -> Result<InstallOutcome, String> {
        if !request.confirmed {
            return Ok(Self::cancelled_outcome());
        }

        let manifest = catalog
            .manifest(&request.manifest_id)
            .ok_or_else(|| format!("unknown catalog manifest: {}", request.manifest_id))?;
        let plan = Self::build_plan(&manifest, request.method_id.as_deref())?;
        let step = find_step(&plan, &request.step_id)
            .ok_or_else(|| format!("unknown install step: {}", request.step_id))?;
        let command = match &step.command {
            Some(command) => command,
            None => {
                return Ok(InstallOutcome {
                    state: "manual-required".to_owned(),
                    message: "This step has no declared executable command; follow its manual instructions.".to_owned(),
                    system_change: false,
                    retryable: false,
                    rollback_available: false,
                    logs: String::new(),
                    manual_recovery: plan.manual_instructions.clone(),
                    receipt: None,
                });
            }
        };

        let output = match run_command(command) {
            Ok(output) => output,
            Err(error) => {
                return Ok(failed_outcome("failed", error, false, String::new()));
            }
        };
        let logs = output_log(&output);
        if !output.status.success() {
            return Ok(failed_outcome(
                "failed",
                format!("{} exited with status {}.", command[0], output.status),
                true,
                logs,
            ));
        }

        if step.kind != "application" {
            return Ok(InstallOutcome {
                state: "completed".to_owned(),
                message: format!("{} completed.", step.label),
                system_change: true,
                retryable: false,
                rollback_available: false,
                logs,
                manual_recovery: None,
                receipt: None,
            });
        }

        let detection = catalog
            .detect()?
            .into_iter()
            .find(|detection| detection.manifest_id == manifest.id);
        let detection = match detection {
            Some(detection) => detection,
            None => {
                return Ok(failed_outcome(
                    "verification-failed",
                    "The package command completed, but the declared executable was not found on PATH.".to_owned(),
                    true,
                    logs,
                ));
            }
        };
        let method = manifest
            .install_methods
            .iter()
            .find(|method| method.id == plan.method_id)
            .ok_or_else(|| format!("install method disappeared: {}", plan.method_id))?;
        let verification = match verify_installation(method, &detection) {
            Ok(verification) => verification,
            Err(error) => {
                return Ok(failed_outcome("verification-failed", error, true, logs));
            }
        };
        let receipt = InstallReceipt {
            id: format!("{}-{}", manifest.id, timestamp()),
            manifest_id: manifest.id.clone(),
            tool_name: manifest.name.clone(),
            publisher: manifest.publisher.clone(),
            version: plan.version.clone(),
            source: method.source.clone(),
            method_id: Some(plan.method_id.clone()),
            method: method.label.clone(),
            package_id: method.package_id.clone(),
            executable_path: detection.path,
            verification: verification.clone(),
            installed_at: timestamp(),
        };
        if let Err(error) = self.record_receipt(app, receipt.clone()) {
            return Ok(failed_outcome(
                "installed-unrecorded",
                format!("The tool was installed, but Arkonad could not write its local receipt: {error}"),
                true,
                format!("{logs}\n{verification}"),
            ));
        }

        Ok(InstallOutcome {
            state: "installed".to_owned(),
            message: format!("{} is installed and launchable.", manifest.name),
            system_change: true,
            retryable: false,
            rollback_available: false,
            logs: format!("{logs}\n{verification}"),
            manual_recovery: None,
            receipt: Some(receipt),
        })
    }

    pub fn list_my_apps(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
    ) -> Result<Vec<MyAppEntry>, String> {
        let last_checked_at = timestamp();
        let detections = catalog.detect()?;
        let detection_by_manifest = detections
            .into_iter()
            .map(|detection| (detection.manifest_id.clone(), detection))
            .collect::<HashMap<_, _>>();
        let receipts = self.receipts(app)?;
        let receipt_by_manifest = receipts
            .into_iter()
            .map(|receipt| (receipt.manifest_id.clone(), receipt))
            .collect::<HashMap<_, _>>();

        let mut entries = catalog
            .list(None, None)?
            .into_iter()
            .filter_map(|entry| {
                let detection = detection_by_manifest.get(&entry.manifest.id);
                let receipt = receipt_by_manifest.get(&entry.manifest.id);
                if detection.is_none() && receipt.is_none() {
                    return None;
                }
                Some(my_app_entry(
                    &entry.manifest,
                    detection,
                    receipt,
                    &last_checked_at,
                ))
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| {
            (
                entry.ownership != "managed",
                entry.tool_name.to_ascii_lowercase(),
            )
        });
        Ok(entries)
    }

    pub fn management_plan(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
        manifest_id: &str,
        operation: ManagementOperation,
    ) -> Result<ManagementPlan, String> {
        let manifest = catalog
            .manifest(manifest_id)
            .ok_or_else(|| format!("unknown catalog manifest: {manifest_id}"))?;
        let detection = catalog
            .detect()?
            .into_iter()
            .find(|detection| detection.manifest_id == manifest_id);
        let receipt = self
            .receipts(app)?
            .into_iter()
            .find(|receipt| receipt.manifest_id == manifest_id);
        Ok(build_management_plan(
            &manifest,
            detection.as_ref(),
            receipt.as_ref(),
            operation,
        ))
    }

    pub fn execute_management(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
        request: ManagementRequest,
    ) -> Result<InstallOutcome, String> {
        if !request.confirmed {
            return Ok(Self::cancelled_outcome());
        }

        let plan = self.management_plan(
            app,
            catalog,
            &request.manifest_id,
            request.operation.clone(),
        )?;
        if !plan.supported {
            return Ok(manual_outcome(
                "manual-required",
                plan.manual_instructions.unwrap_or_else(|| {
                    "This operation is not supported for the current installation.".to_owned()
                }),
            ));
        }

        let receipt = self
            .receipts(app)?
            .into_iter()
            .find(|receipt| receipt.manifest_id == request.manifest_id);
        match request.operation {
            ManagementOperation::DataCleanup => self.execute_data_cleanup(app, &plan, receipt),
            operation => {
                let command = plan
                    .command
                    .as_ref()
                    .ok_or_else(|| "supported management operation has no command".to_owned())?;
                let output = match run_command(command) {
                    Ok(output) => output,
                    Err(error) => {
                        return Ok(failed_outcome("failed", error, false, String::new()));
                    }
                };
                let logs = output_log(&output);
                if !output.status.success() {
                    return Ok(failed_outcome(
                        "failed",
                        format!("{} exited with status {}.", command[0], output.status),
                        true,
                        logs,
                    ));
                }

                if operation == ManagementOperation::Uninstall {
                    let removed_receipt = match self.remove_receipt(app, &request.manifest_id) {
                        Ok(Some(receipt)) => receipt,
                        Ok(None) => {
                            return Ok(failed_outcome(
                                "uninstalled-unrecorded",
                                "The package command completed, but no Arkonad receipt was found to remove.".to_owned(),
                                true,
                                logs,
                            ));
                        }
                        Err(error) => {
                            return Ok(failed_outcome(
                                "uninstalled-unrecorded",
                                format!("The package was uninstalled, but Arkonad could not update its local receipt: {error}"),
                                true,
                                logs,
                            ));
                        }
                    };
                    return Ok(InstallOutcome {
                        state: "uninstalled".to_owned(),
                        message: format!("{} was removed from Arkonad-managed installations; its data was preserved.", plan.tool_name),
                        system_change: true,
                        retryable: false,
                        rollback_available: false,
                        logs,
                        manual_recovery: None,
                        receipt: Some(removed_receipt),
                    });
                }

                let manifest = catalog
                    .manifest(&request.manifest_id)
                    .ok_or_else(|| format!("unknown catalog manifest: {}", request.manifest_id))?;
                let detection = catalog
                    .detect()?
                    .into_iter()
                    .find(|detection| detection.manifest_id == manifest.id);
                let detection = match detection {
                    Some(detection) => detection,
                    None => {
                        return Ok(failed_outcome(
                            "verification-failed",
                            "The management command completed, but the declared executable was not found on PATH.".to_owned(),
                            true,
                            logs,
                        ));
                    }
                };
                let method = recorded_method(&manifest, receipt.as_ref()).ok_or_else(|| {
                    "the receipt's install method is no longer in the catalog".to_owned()
                })?;
                let verification = match verify_installation(method, &detection) {
                    Ok(verification) => verification,
                    Err(error) => {
                        return Ok(failed_outcome("verification-failed", error, true, logs));
                    }
                };
                let mut receipt = receipt
                    .ok_or_else(|| "managed operation has no installation receipt".to_owned())?;
                if operation == ManagementOperation::Update {
                    receipt.version = manifest.versions.latest.clone().or(receipt.version);
                }
                if let Err(error) = self.record_receipt(app, receipt.clone()) {
                    return Ok(failed_outcome(
                        "updated-unrecorded",
                        format!("The management command completed, but Arkonad could not write its local receipt: {error}"),
                        true,
                        format!("{logs}\n{verification}"),
                    ));
                }
                let (state, message) = match operation {
                    ManagementOperation::Update => (
                        "updated",
                        format!("{} was updated and remains launchable.", plan.tool_name),
                    ),
                    ManagementOperation::Repair => (
                        "repaired",
                        format!("{} was repaired and remains launchable.", plan.tool_name),
                    ),
                    ManagementOperation::Uninstall | ManagementOperation::DataCleanup => {
                        unreachable!()
                    }
                };
                Ok(InstallOutcome {
                    state: state.to_owned(),
                    message,
                    system_change: true,
                    retryable: false,
                    rollback_available: false,
                    logs: format!("{logs}\n{verification}"),
                    manual_recovery: None,
                    receipt: Some(receipt),
                })
            }
        }
    }

    pub fn receipts(&self, app: &AppHandle) -> Result<Vec<InstallReceipt>, String> {
        let _guard = self
            .receipt_lock
            .lock()
            .map_err(|_| "installation receipt state is unavailable".to_owned())?;
        read_receipts(app)
    }

    fn record_receipt(&self, app: &AppHandle, receipt: InstallReceipt) -> Result<(), String> {
        let _guard = self
            .receipt_lock
            .lock()
            .map_err(|_| "installation receipt state is unavailable".to_owned())?;
        let mut receipts = read_receipts(app)?;
        receipts.retain(|existing| existing.manifest_id != receipt.manifest_id);
        receipts.push(receipt);
        write_receipts(app, &receipts)
    }

    fn remove_receipt(
        &self,
        app: &AppHandle,
        manifest_id: &str,
    ) -> Result<Option<InstallReceipt>, String> {
        let _guard = self
            .receipt_lock
            .lock()
            .map_err(|_| "installation receipt state is unavailable".to_owned())?;
        let mut receipts = read_receipts(app)?;
        let removed = receipts
            .iter()
            .find(|receipt| receipt.manifest_id == manifest_id)
            .cloned();
        if removed.is_some() {
            receipts.retain(|receipt| receipt.manifest_id != manifest_id);
            write_receipts(app, &receipts)?;
        }
        Ok(removed)
    }

    fn execute_data_cleanup(
        &self,
        _app: &AppHandle,
        plan: &ManagementPlan,
        receipt: Option<InstallReceipt>,
    ) -> Result<InstallOutcome, String> {
        let mut logs = Vec::new();
        let mut system_change = false;
        for target in plan.data_targets.iter().filter(|target| target.allowed) {
            let path = PathBuf::from(&target.path);
            if !path.exists() {
                logs.push(format!("{} is already absent.", target.path));
                continue;
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    return Ok(failed_outcome(
                        "failed",
                        format!("Could not inspect the data target {}: {error}", target.path),
                        system_change,
                        logs.join("\n"),
                    ));
                }
            };
            if metadata.file_type().is_symlink() {
                return Ok(failed_outcome(
                    "failed",
                    format!("Refusing to remove symlink data target {}.", target.path),
                    system_change,
                    logs.join("\n"),
                ));
            }
            let result = if metadata.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            if let Err(error) = result {
                return Ok(failed_outcome(
                    "failed",
                    format!("Could not remove the data target {}: {error}", target.path),
                    system_change,
                    logs.join("\n"),
                ));
            }
            system_change = true;
            logs.push(format!("Removed {}.", target.path));
        }
        Ok(InstallOutcome {
            state: "data-cleaned".to_owned(),
            message: format!(
                "Selected {} data targets were removed; the installation receipt remains.",
                plan.tool_name
            ),
            system_change,
            retryable: false,
            rollback_available: false,
            logs: if logs.is_empty() {
                "No data targets were selected.".to_owned()
            } else {
                logs.join("\n")
            },
            manual_recovery: None,
            receipt,
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn install_plan(
    catalog: tauri::State<'_, CatalogRuntime>,
    manifest_id: String,
    method_id: Option<String>,
) -> Result<InstallPlan, String> {
    let manifest = catalog
        .manifest(&manifest_id)
        .ok_or_else(|| format!("unknown catalog manifest: {manifest_id}"))?;
    InstallRuntime::build_plan(&manifest, method_id.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn install_execute(
    app: AppHandle,
    catalog: tauri::State<'_, CatalogRuntime>,
    installer: tauri::State<'_, InstallRuntime>,
    request: InstallRequest,
) -> Result<InstallOutcome, String> {
    installer.execute(&app, &catalog, request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn install_receipts(
    app: AppHandle,
    installer: tauri::State<'_, InstallRuntime>,
) -> Result<Vec<InstallReceipt>, String> {
    installer.receipts(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn my_apps_list(
    app: AppHandle,
    catalog: tauri::State<'_, CatalogRuntime>,
    installer: tauri::State<'_, InstallRuntime>,
) -> Result<Vec<MyAppEntry>, String> {
    installer.list_my_apps(&app, &catalog)
}

#[tauri::command(rename_all = "camelCase")]
pub fn app_management_plan(
    app: AppHandle,
    catalog: tauri::State<'_, CatalogRuntime>,
    installer: tauri::State<'_, InstallRuntime>,
    manifest_id: String,
    operation: ManagementOperation,
) -> Result<ManagementPlan, String> {
    installer.management_plan(&app, &catalog, &manifest_id, operation)
}

#[tauri::command(rename_all = "camelCase")]
pub fn app_management_execute(
    app: AppHandle,
    catalog: tauri::State<'_, CatalogRuntime>,
    installer: tauri::State<'_, InstallRuntime>,
    request: ManagementRequest,
) -> Result<InstallOutcome, String> {
    installer.execute_management(&app, &catalog, request)
}

fn my_app_entry(
    manifest: &CatalogManifest,
    detection: Option<&Detection>,
    receipt: Option<&InstallReceipt>,
    last_checked_at: &str,
) -> MyAppEntry {
    let method = receipt.and_then(|receipt| recorded_method(manifest, Some(receipt)));
    let installed_version = receipt
        .and_then(|receipt| receipt.version.clone())
        .or_else(|| detection.and_then(|detection| detection.version.clone()));
    let ownership = if receipt.is_some() {
        "managed"
    } else {
        "detected"
    };
    let update_state = if receipt.is_none() {
        "notManaged".to_owned()
    } else {
        match (
            installed_version.as_deref(),
            manifest.versions.latest.as_deref(),
        ) {
            (Some(current), Some(latest)) if current != latest => "available".to_owned(),
            (Some(_), Some(_)) => "current".to_owned(),
            _ => "unknown".to_owned(),
        }
    };
    let executable_path = detection
        .map(|detection| detection.path.clone())
        .or_else(|| receipt.map(|receipt| receipt.executable_path.clone()));
    let source = receipt
        .map(|receipt| receipt.source.clone())
        .or_else(|| detection.map(|detection| detection.source.clone()))
        .unwrap_or_else(|| manifest.source.url.clone());

    MyAppEntry {
        manifest_id: manifest.id.clone(),
        tool_name: manifest.name.clone(),
        summary: manifest.summary.clone(),
        category: manifest.category.clone(),
        publisher: manifest.publisher.clone(),
        ownership: ownership.to_owned(),
        installed_version,
        detected_version: detection.and_then(|detection| detection.version.clone()),
        update_state,
        launchable: detection.is_some()
            || receipt.is_some_and(|receipt| Path::new(&receipt.executable_path).exists()),
        executable_path,
        source,
        last_checked_at: last_checked_at.to_owned(),
        method_id: receipt
            .and_then(|receipt| receipt.method_id.clone())
            .or_else(|| method.map(|method| method.id.clone())),
        method_label: receipt
            .map(|receipt| receipt.method.clone())
            .or_else(|| method.map(|method| method.label.clone())),
        data_locations: manifest.data_locations.clone(),
        receipt: receipt.cloned(),
    }
}

fn build_management_plan(
    manifest: &CatalogManifest,
    detection: Option<&Detection>,
    receipt: Option<&InstallReceipt>,
    operation: ManagementOperation,
) -> ManagementPlan {
    let method = receipt.and_then(|receipt| recorded_method(manifest, Some(receipt)));
    let ownership = if receipt.is_some() {
        "managed"
    } else if detection.is_some() {
        "detected"
    } else {
        "unavailable"
    };
    let installed_version = receipt
        .and_then(|receipt| receipt.version.clone())
        .or_else(|| detection.and_then(|detection| detection.version.clone()));
    let source = receipt
        .map(|receipt| receipt.source.clone())
        .or_else(|| detection.map(|detection| detection.source.clone()))
        .unwrap_or_else(|| manifest.source.url.clone());
    let data_targets = data_cleanup_targets(&manifest.data_locations);
    let mut command = None;
    let mut supported = false;
    let mut manual_instructions = None;

    match operation {
        ManagementOperation::DataCleanup => {
            supported = receipt.is_some() && data_targets.iter().any(|target| target.allowed);
            if !supported {
                manual_instructions = Some(if receipt.is_none() {
                    "This installation is not managed by Arkonad. It will not remove data from a detected installation.".to_owned()
                } else {
                    "The manifest does not declare exact safe data targets. No data will be removed.".to_owned()
                });
            }
        }
        _ if receipt.is_none() => {
            manual_instructions = Some(
                "This installation was detected outside Arkonad. Updates, repair, uninstall, and data cleanup are unavailable until it is installed through a supported Arkonad method.".to_owned(),
            );
        }
        _ if method.is_none() => {
            manual_instructions = Some(
                "The recorded install method is no longer declared in the catalog, so Arkonad will not guess a management command.".to_owned(),
            );
        }
        _ => {
            let method = method.expect("management method checked above");
            command = lifecycle_command(method, &operation);
            supported = cfg!(windows) && command.is_some();
            if !supported {
                manual_instructions = Some(format!(
                    "The recorded {} method does not declare a {} command. Arkonad will not guess one.",
                    method.label,
                    operation_label(&operation),
                ));
            }
        }
    }

    ManagementPlan {
        manifest_id: manifest.id.clone(),
        tool_name: manifest.name.clone(),
        publisher: manifest.publisher.clone(),
        operation: operation.clone(),
        ownership: ownership.to_owned(),
        installed_version,
        source,
        method_id: receipt
            .and_then(|receipt| receipt.method_id.clone())
            .or_else(|| method.map(|method| method.id.clone())),
        method_label: receipt
            .map(|receipt| receipt.method.clone())
            .or_else(|| method.map(|method| method.label.clone())),
        method_kind: method.map(|method| method.kind.clone()),
        package_id: method.and_then(|method| method.package_id.clone()),
        supported,
        command,
        privileges: method
            .map(|method| method.privileges.clone())
            .unwrap_or_default(),
        affected_system_features: method
            .map(|method| method.affected_system_features.clone())
            .unwrap_or_default(),
        data_expectations: method
            .map(|method| method.data_expectations.clone())
            .unwrap_or_else(|| "The manifest does not declare additional data changes.".to_owned()),
        rollback_limits: if operation == ManagementOperation::DataCleanup {
            "Data cleanup cannot be rolled back automatically; the selected targets are shown before execution.".to_owned()
        } else {
            method
                .map(|method| method.rollback_limits.clone())
                .unwrap_or_else(|| {
                    "Rollback limits are not declared; review the publisher instructions."
                        .to_owned()
                })
        },
        data_targets,
        requires_confirmation: true,
        manual_instructions,
    }
}

fn lifecycle_command(
    method: &InstallMethod,
    operation: &ManagementOperation,
) -> Option<Vec<String>> {
    match operation {
        ManagementOperation::Update => method.update_command.clone(),
        ManagementOperation::Repair => method.repair_command.clone(),
        ManagementOperation::Uninstall => method.uninstall_command.clone(),
        ManagementOperation::DataCleanup => None,
    }
}

fn operation_label(operation: &ManagementOperation) -> &'static str {
    match operation {
        ManagementOperation::Update => "update",
        ManagementOperation::Repair => "repair",
        ManagementOperation::Uninstall => "uninstall",
        ManagementOperation::DataCleanup => "data cleanup",
    }
}

fn recorded_method<'a>(
    manifest: &'a CatalogManifest,
    receipt: Option<&InstallReceipt>,
) -> Option<&'a InstallMethod> {
    let receipt = receipt?;
    receipt
        .method_id
        .as_deref()
        .and_then(|method_id| {
            manifest
                .install_methods
                .iter()
                .find(|method| method.id == method_id)
        })
        .or_else(|| {
            receipt.package_id.as_deref().and_then(|package_id| {
                manifest
                    .install_methods
                    .iter()
                    .find(|method| method.package_id.as_deref() == Some(package_id))
            })
        })
        .or_else(|| {
            manifest
                .install_methods
                .iter()
                .find(|method| method.label == receipt.method)
        })
}

fn data_cleanup_targets(locations: &[DataLocation]) -> Vec<DataCleanupTarget> {
    locations
        .iter()
        .enumerate()
        .map(
            |(index, location)| match resolve_cleanup_path(&location.path) {
                Ok(path) => {
                    let path = path.to_string_lossy().into_owned();
                    DataCleanupTarget {
                        id: format!("data-{}", index + 1),
                        label: location.kind.clone(),
                        kind: location.kind.clone(),
                        exists: Path::new(&path).exists(),
                        allowed: true,
                        reason: "Exact user-data path declared by the manifest.".to_owned(),
                        path,
                    }
                }
                Err(reason) => DataCleanupTarget {
                    id: format!("data-{}", index + 1),
                    label: location.kind.clone(),
                    kind: location.kind.clone(),
                    path: location.path.clone(),
                    exists: false,
                    allowed: false,
                    reason,
                },
            },
        )
        .collect()
}

fn resolve_cleanup_path(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err("The manifest path is empty or contains control characters.".to_owned());
    }
    if value
        .chars()
        .any(|character| matches!(character, '*' | '?'))
    {
        return Err("Wildcards are not allowed in data cleanup targets.".to_owned());
    }

    let mut expanded = value.to_owned();
    for (token, variable) in [
        ("%APPDATA%", "APPDATA"),
        ("%LOCALAPPDATA%", "LOCALAPPDATA"),
        ("%USERPROFILE%", "USERPROFILE"),
    ] {
        if expanded.contains(token) {
            let root = std::env::var(variable)
                .map_err(|_| format!("The {variable} environment path is unavailable."))?;
            expanded = expanded.replace(token, &root);
        }
    }
    if expanded.contains('%') {
        return Err("Unresolved environment variables are not allowed.".to_owned());
    }

    let path = PathBuf::from(expanded);
    if !path.is_absolute() {
        return Err("Only absolute user-data paths are eligible for cleanup.".to_owned());
    }
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Parent-directory segments are not allowed in cleanup targets.".to_owned());
    }
    let user_roots = ["APPDATA", "LOCALAPPDATA", "USERPROFILE"]
        .into_iter()
        .filter_map(|variable| std::env::var(variable).ok())
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if !user_roots.iter().any(|root| path.starts_with(root)) {
        return Err("The target is outside known user-data roots.".to_owned());
    }
    if user_roots.iter().any(|root| &path == root) {
        return Err("A user-data root is too broad to clean.".to_owned());
    }
    Ok(path)
}

fn manual_outcome(state: &str, message: String) -> InstallOutcome {
    InstallOutcome {
        state: state.to_owned(),
        message: message.clone(),
        system_change: false,
        retryable: false,
        rollback_available: false,
        logs: String::new(),
        manual_recovery: Some(message),
        receipt: None,
    }
}

fn select_method<'a>(
    manifest: &'a CatalogManifest,
    method_id: Option<&str>,
) -> Result<&'a InstallMethod, String> {
    if let Some(method_id) = method_id {
        return manifest
            .install_methods
            .iter()
            .find(|method| method.id == method_id)
            .ok_or_else(|| format!("unknown install method: {method_id}"));
    }

    manifest
        .install_methods
        .iter()
        .find(|method| method_is_supported(method))
        .or_else(|| manifest.install_methods.first())
        .ok_or_else(|| format!("manifest {} has no install methods", manifest.id))
}

fn method_is_supported(method: &InstallMethod) -> bool {
    cfg!(windows)
        && method.kind.eq_ignore_ascii_case("winget")
        && method.command.is_some()
        && method.verification_command.is_some()
}

fn prerequisite_step(prerequisite: &Prerequisite) -> InstallStep {
    InstallStep {
        id: prerequisite.id.clone(),
        label: prerequisite.label.clone(),
        kind: "prerequisite".to_owned(),
        optional: prerequisite.optional,
        description: prerequisite.description.clone(),
        command: prerequisite.command.clone().filter(|_| cfg!(windows)),
        source: prerequisite.source.clone(),
        privileges: prerequisite.privileges.clone(),
        rollback_limits: prerequisite.rollback_limits.clone(),
        requires_confirmation: true,
    }
}

fn find_step<'a>(plan: &'a InstallPlan, step_id: &str) -> Option<&'a InstallStep> {
    plan.prerequisites
        .iter()
        .find(|step| step.id == step_id)
        .or_else(|| (plan.app_step.id == step_id).then_some(&plan.app_step))
}

fn run_command(argv: &[String]) -> Result<Output, String> {
    let executable = argv
        .first()
        .ok_or_else(|| "declared command is empty".to_owned())?;
    Command::new(executable)
        .args(argv.iter().skip(1))
        .output()
        .map_err(|error| format!("could not start {executable}: {error}"))
}

fn verify_installation(method: &InstallMethod, detection: &Detection) -> Result<String, String> {
    let mut command = method
        .verification_command
        .clone()
        .ok_or_else(|| "the manifest does not declare a verification command".to_owned())?;
    command[0] = detection.path.clone();
    let output = run_command(&command)?;
    let logs = output_log(&output);
    if !output.status.success() {
        return Err(format!(
            "the executable was found, but its verification command failed: {logs}"
        ));
    }
    Ok(format!(
        "Launch check passed for {}.\n{logs}",
        detection.path
    ))
}

fn failed_outcome(
    state: &str,
    message: String,
    system_change: bool,
    logs: String,
) -> InstallOutcome {
    InstallOutcome {
        state: state.to_owned(),
        message,
        system_change,
        retryable: true,
        rollback_available: false,
        logs,
        manual_recovery: Some(
            "Review the command log, retry the declared method, or follow the publisher's manual recovery instructions. Arkonad will not remove shared prerequisites automatically.".to_owned(),
        ),
        receipt: None,
    }
}

fn output_log(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => "No command output.".to_owned(),
        (false, true) => stdout,
        (true, false) => format!("stderr: {stderr}"),
        (false, false) => format!("stdout: {stdout}\nstderr: {stderr}"),
    }
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_owned())
}

fn receipt_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(RECEIPT_FILE_NAME))
        .map_err(|error| format!("could not resolve Arkonad app data directory: {error}"))
}

fn read_receipts(app: &AppHandle) -> Result<Vec<InstallReceipt>, String> {
    let path = receipt_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("invalid installation receipt file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("could not read installation receipts: {error}")),
    }
}

fn write_receipts(app: &AppHandle, receipts: &[InstallReceipt]) -> Result<(), String> {
    let path = receipt_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create Arkonad app data directory: {error}"))?;
    }
    let contents = serde_json::to_vec_pretty(receipts)
        .map_err(|error| format!("could not encode installation receipt: {error}"))?;
    fs::write(&path, contents)
        .map_err(|error| format!("could not write installation receipt: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_reviewable_winget_plan_from_the_manifest() {
        let manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();

        let plan = InstallRuntime::build_plan(&manifest, Some("winget")).unwrap();

        assert_eq!(plan.package_id.as_deref(), Some("JesseDuffield.lazygit"));
        assert_eq!(plan.version.as_deref(), Some("0.64.0"));
        assert_eq!(
            plan.command,
            Some(vec![
                "winget.exe".to_owned(),
                "install".to_owned(),
                "--id".to_owned(),
                "JesseDuffield.lazygit".to_owned(),
                "--exact".to_owned(),
                "--source".to_owned(),
                "winget".to_owned(),
                "--accept-source-agreements".to_owned(),
                "--accept-package-agreements".to_owned(),
            ])
        );
        assert!(plan.app_step.requires_confirmation);
    }

    #[test]
    fn manual_methods_have_instructions_and_no_executable_command() {
        let manifest = CatalogRuntime::builtins().manifest("codex").unwrap();

        let plan = InstallRuntime::build_plan(&manifest, Some("publisher")).unwrap();

        assert!(!plan.supported);
        assert!(plan.command.is_none());
        assert!(plan.manual_instructions.is_some());
    }

    #[test]
    fn cancellation_reports_no_system_change() {
        let outcome = InstallRuntime::cancelled_outcome();

        assert_eq!(outcome.state, "cancelled");
        assert!(!outcome.system_change);
        assert!(outcome.receipt.is_none());
    }

    #[test]
    fn optional_prerequisites_are_separate_reviewed_steps() {
        let mut manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        manifest.prerequisites.push(Prerequisite {
            id: "wsl".to_owned(),
            label: "Optional WSL support".to_owned(),
            description: "Adds an optional Linux runtime for tools that need it.".to_owned(),
            kind: "wsl".to_owned(),
            optional: true,
            check: None,
            command: None,
            source: Some("https://learn.microsoft.com/windows/wsl/".to_owned()),
            privileges: PrivilegeRequirement::MayElevate,
            rollback_limits: "Arkonad will not remove WSL when this step is declined.".to_owned(),
        });

        let plan = InstallRuntime::build_plan(&manifest, Some("winget")).unwrap();

        assert_eq!(plan.prerequisites.len(), 1);
        assert_eq!(plan.prerequisites[0].id, "wsl");
        assert!(plan.prerequisites[0].optional);
        assert!(plan.prerequisites[0].requires_confirmation);
        assert_eq!(plan.app_step.id, "application");
    }

    #[test]
    fn managed_installation_uses_recorded_lifecycle_commands() {
        let manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        let receipt = InstallReceipt {
            id: "lazygit-1".to_owned(),
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.64.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: "lazygit.exe".to_owned(),
            verification: "Launch check passed".to_owned(),
            installed_at: "1".to_owned(),
        };

        let update =
            build_management_plan(&manifest, None, Some(&receipt), ManagementOperation::Update);
        assert!(update.supported);
        assert_eq!(update.command.as_ref().unwrap()[1], "upgrade");
        assert!(update.requires_confirmation);

        let uninstall = build_management_plan(
            &manifest,
            None,
            Some(&receipt),
            ManagementOperation::Uninstall,
        );
        assert!(uninstall.supported);
        assert!(uninstall
            .command
            .as_ref()
            .unwrap()
            .iter()
            .any(|part| part == "--preserve"));
    }

    #[test]
    fn detected_installations_do_not_get_management_commands() {
        let manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        let detection = Detection {
            manifest_id: "lazygit".to_owned(),
            command: "lazygit.exe".to_owned(),
            path: "lazygit.exe".to_owned(),
            source: "PATH".to_owned(),
            version: None,
        };

        let plan = build_management_plan(
            &manifest,
            Some(&detection),
            None,
            ManagementOperation::Uninstall,
        );

        assert_eq!(plan.ownership, "detected");
        assert!(!plan.supported);
        assert!(plan.command.is_none());
        assert!(plan
            .manual_instructions
            .unwrap()
            .contains("outside Arkonad"));
    }

    #[test]
    fn unresolved_data_locations_are_not_cleanup_targets() {
        let manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        let receipt = InstallReceipt {
            id: "lazygit-1".to_owned(),
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.64.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: "lazygit.exe".to_owned(),
            verification: "Launch check passed".to_owned(),
            installed_at: "1".to_owned(),
        };

        let plan = build_management_plan(
            &manifest,
            None,
            Some(&receipt),
            ManagementOperation::DataCleanup,
        );

        assert!(!plan.supported);
        assert_eq!(plan.data_targets.len(), 1);
        assert!(!plan.data_targets[0].allowed);
        assert!(plan
            .manual_instructions
            .unwrap()
            .contains("exact safe data targets"));
    }
}
