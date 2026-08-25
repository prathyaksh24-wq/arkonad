use crate::catalog::{
    CatalogCategory, CatalogManifest, CatalogRuntime, DataLocation, Detection, InstallMethod,
    OptionalEnhancement, Prerequisite, PrerequisiteCheck, PrivilegeRequirement, SourceReference,
};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const RECEIPT_FILE_NAME: &str = "install-receipts.json";
const RECEIPT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStep {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub optional: bool,
    pub availability: PrerequisiteAvailability,
    pub description: String,
    pub command: Option<Vec<String>>,
    pub source: Option<String>,
    pub privileges: PrivilegeRequirement,
    pub rollback_limits: String,
    pub requires_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrerequisiteAvailability {
    Ready,
    Missing,
    Unknown,
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
    pub optional_setup: Vec<InstallStep>,
    pub prerequisites_ready: bool,
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
    #[serde(default)]
    pub ownership: ReceiptOwnership,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ReceiptOwnership {
    #[default]
    Managed,
    Adopted,
}

impl ReceiptOwnership {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Managed => "managed",
            Self::Adopted => "adopted",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptStoreFile {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    receipts: Vec<InstallReceipt>,
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
    Adopt,
    IntegrationReset,
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
    pub launch_profile_id: Option<String>,
    pub supports_working_directory: bool,
    pub source: String,
    pub last_checked_at: String,
    pub method_id: Option<String>,
    pub method_label: Option<String>,
    pub data_locations: Vec<DataLocation>,
    pub receipt: Option<InstallReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyAppsSnapshot {
    pub entries: Vec<MyAppEntry>,
    pub updates_available: usize,
    pub checked_at: String,
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
    #[serde(default)]
    pub method_id: Option<String>,
    pub confirmed: bool,
}

#[derive(Debug, Default)]
pub struct InstallRuntime {
    receipt_lock: Mutex<()>,
}

#[derive(Debug, Clone)]
struct CommandResult {
    success: bool,
    status: String,
    stdout: String,
    stderr: String,
}

trait OperationAdapter {
    fn run(&self, argv: &[String]) -> Result<CommandResult, String>;
    fn detect_all(&self) -> Result<Vec<Detection>, String>;
    fn detect(&self, manifest: &CatalogManifest) -> Result<Option<Detection>, String> {
        Ok(self
            .detect_all()?
            .into_iter()
            .find(|detection| detection.manifest_id == manifest.id))
    }
    fn load_receipts(&self) -> Result<Vec<InstallReceipt>, String>;
    fn upsert_receipt(&self, receipt: InstallReceipt) -> Result<(), String>;
    fn remove_receipt(&self, manifest_id: &str) -> Result<Option<InstallReceipt>, String>;
    fn now(&self) -> String;
}

struct SystemOperationAdapter<'a> {
    app: &'a AppHandle,
    catalog: &'a CatalogRuntime,
    installer: &'a InstallRuntime,
}

impl OperationAdapter for SystemOperationAdapter<'_> {
    fn run(&self, argv: &[String]) -> Result<CommandResult, String> {
        run_command(argv).map(CommandResult::from)
    }

    fn detect_all(&self) -> Result<Vec<Detection>, String> {
        self.catalog.detect()
    }

    fn load_receipts(&self) -> Result<Vec<InstallReceipt>, String> {
        self.installer.receipts(self.app)
    }

    fn upsert_receipt(&self, receipt: InstallReceipt) -> Result<(), String> {
        self.installer.record_receipt(self.app, receipt)
    }

    fn remove_receipt(&self, manifest_id: &str) -> Result<Option<InstallReceipt>, String> {
        self.installer.remove_receipt(self.app, manifest_id)
    }

    fn now(&self) -> String {
        timestamp()
    }
}

impl From<Output> for CommandResult {
    fn from(output: Output) -> Self {
        Self {
            success: output.status.success(),
            status: output.status.to_string(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        }
    }
}

impl InstallRuntime {
    pub fn build_plan(
        manifest: &CatalogManifest,
        method_id: Option<&str>,
    ) -> Result<InstallPlan, String> {
        Self::build_plan_with_probe(manifest, method_id, &prerequisite_is_available)
    }

    pub(crate) fn build_plan_with_probe(
        manifest: &CatalogManifest,
        method_id: Option<&str>,
        probe: &impl Fn(&PrerequisiteCheck) -> bool,
    ) -> Result<InstallPlan, String> {
        let method = select_method(manifest, method_id)?;
        let supported = method_is_supported(method);
        let command = method.command.clone().filter(|_| supported);
        let prerequisites = manifest
            .prerequisites
            .iter()
            .map(|prerequisite| prerequisite_step(prerequisite, probe))
            .collect::<Vec<_>>();
        let prerequisites_ready = prerequisites
            .iter()
            .all(|step| step.optional || step.availability == PrerequisiteAvailability::Ready);
        let optional_setup = manifest
            .optional_enhancements
            .iter()
            .map(|enhancement| optional_enhancement_step(enhancement, probe))
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
            availability: PrerequisiteAvailability::Unknown,
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
            optional_setup,
            prerequisites_ready,
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
        let adapter = SystemOperationAdapter {
            app,
            catalog,
            installer: self,
        };
        execute_install_with_adapter(catalog, request, &adapter)
    }

    pub fn list_my_apps(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
    ) -> Result<MyAppsSnapshot, String> {
        let adapter = SystemOperationAdapter {
            app,
            catalog,
            installer: self,
        };
        my_apps_snapshot_with_adapter(catalog, &adapter)
    }

    pub fn management_plan(
        &self,
        app: &AppHandle,
        catalog: &CatalogRuntime,
        manifest_id: &str,
        operation: ManagementOperation,
        method_id: Option<&str>,
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
        Ok(build_management_plan_for_method(
            &manifest,
            detection.as_ref(),
            receipt.as_ref(),
            operation,
            method_id,
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

        if request.operation != ManagementOperation::DataCleanup {
            let adapter = SystemOperationAdapter {
                app,
                catalog,
                installer: self,
            };
            return execute_management_with_adapter(catalog, request, &adapter);
        }

        let plan = self.management_plan(
            app,
            catalog,
            &request.manifest_id,
            request.operation.clone(),
            request.method_id.as_deref(),
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
        self.execute_data_cleanup(app, &plan, receipt)
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

fn execute_install_with_adapter(
    catalog: &CatalogRuntime,
    request: InstallRequest,
    adapter: &impl OperationAdapter,
) -> Result<InstallOutcome, String> {
    if !request.confirmed {
        return Ok(InstallRuntime::cancelled_outcome());
    }

    let manifest = catalog
        .manifest(&request.manifest_id)
        .ok_or_else(|| format!("unknown catalog manifest: {}", request.manifest_id))?;
    let plan = InstallRuntime::build_plan(&manifest, request.method_id.as_deref())?;
    let step = find_step(&plan, &request.step_id)
        .ok_or_else(|| format!("unknown install step: {}", request.step_id))?;
    if step.kind == "application" && !plan.prerequisites_ready {
        return Ok(InstallOutcome {
            state: "prerequisites-required".to_owned(),
            message: "Required prerequisites are still missing. Complete their reviewed steps or leave the tool unavailable.".to_owned(),
            system_change: false,
            retryable: true,
            rollback_available: false,
            logs: String::new(),
            manual_recovery: Some(
                "Refresh the install plan after completing the required prerequisite steps."
                    .to_owned(),
            ),
            receipt: None,
        });
    }
    let command = match &step.command {
        Some(command) => command,
        None => {
            return Ok(InstallOutcome {
                state: "manual-required".to_owned(),
                message:
                    "This step has no declared executable command; follow its manual instructions."
                        .to_owned(),
                system_change: false,
                retryable: false,
                rollback_available: false,
                logs: String::new(),
                manual_recovery: plan.manual_instructions.clone(),
                receipt: None,
            });
        }
    };

    let result = match adapter.run(command) {
        Ok(result) => result,
        Err(error) => {
            return Ok(failed_outcome("failed", error, false, String::new()));
        }
    };
    let logs = command_result_log(&result);
    if !result.success {
        return Ok(failed_outcome(
            "failed",
            format!("{} exited with status {}.", command[0], result.status),
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

    let detection = match adapter.detect(&manifest)? {
        Some(detection) => detection,
        None => {
            return Ok(failed_outcome(
                "verification-failed",
                "The package command completed, but the declared executable was not found on PATH."
                    .to_owned(),
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
    let verification = match verify_installation_with_adapter(method, &detection, adapter) {
        Ok(verification) => verification,
        Err(error) => {
            return Ok(failed_outcome("verification-failed", error, true, logs));
        }
    };
    let now = adapter.now();
    let receipt = InstallReceipt {
        id: format!("{}-{now}", manifest.id),
        ownership: ReceiptOwnership::Managed,
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
        installed_at: now,
    };
    if let Err(error) = adapter.upsert_receipt(receipt.clone()) {
        return Ok(failed_outcome(
            "installed-unrecorded",
            format!(
                "The tool was installed, but Arkonad could not write its local receipt: {error}"
            ),
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

fn execute_management_with_adapter(
    catalog: &CatalogRuntime,
    request: ManagementRequest,
    adapter: &impl OperationAdapter,
) -> Result<InstallOutcome, String> {
    if !request.confirmed {
        return Ok(InstallRuntime::cancelled_outcome());
    }

    let manifest = catalog
        .manifest(&request.manifest_id)
        .ok_or_else(|| format!("unknown catalog manifest: {}", request.manifest_id))?;
    let detection = adapter.detect(&manifest)?;
    let receipts = adapter.load_receipts()?;
    let receipt = receipts
        .iter()
        .find(|receipt| receipt.manifest_id == request.manifest_id)
        .cloned();
    let plan = build_management_plan_for_method(
        &manifest,
        detection.as_ref(),
        receipt.as_ref(),
        request.operation.clone(),
        request.method_id.as_deref(),
    );
    if !plan.supported {
        return Ok(manual_outcome(
            "manual-required",
            plan.manual_instructions.unwrap_or_else(|| {
                "This operation is not supported for the current installation.".to_owned()
            }),
        ));
    }

    match request.operation {
        ManagementOperation::Adopt => {
            let detection =
                detection.ok_or_else(|| "adoption requires a detected executable".to_owned())?;
            let method_id = plan
                .method_id
                .as_deref()
                .ok_or_else(|| "adoption requires a selected method".to_owned())?;
            let method = manifest
                .install_methods
                .iter()
                .find(|method| method.id == method_id)
                .ok_or_else(|| format!("unknown adoption method: {method_id}"))?;
            let (method_verification, package_listing) =
                match verify_adoption_method_with_adapter(method, adapter) {
                    Ok(verification) => verification,
                    Err(error) => {
                        return Ok(failed_outcome(
                            "adoption-verification-failed",
                            error,
                            false,
                            String::new(),
                        ));
                    }
                };
            let verification = match verify_installation_with_adapter(method, &detection, adapter) {
                Ok(verification) => verification,
                Err(error) => {
                    return Ok(failed_outcome(
                        "verification-failed",
                        error,
                        false,
                        String::new(),
                    ));
                }
            };
            if !shares_release_version(&package_listing, &verification) {
                return Ok(failed_outcome(
                    "adoption-verification-failed",
                    "WinGet and the detected executable did not report the same release version. The detected executable remains externally owned.".to_owned(),
                    false,
                    format!("{method_verification}\n{verification}"),
                ));
            }
            let now = adapter.now();
            let adopted_receipt = InstallReceipt {
                id: format!("{}-{now}", manifest.id),
                ownership: ReceiptOwnership::Adopted,
                manifest_id: manifest.id.clone(),
                tool_name: manifest.name.clone(),
                publisher: manifest.publisher.clone(),
                version: detection.version,
                source: method.source.clone(),
                method_id: Some(method.id.clone()),
                method: method.label.clone(),
                package_id: method.package_id.clone(),
                executable_path: detection.path,
                verification: format!("{method_verification}\n{verification}"),
                installed_at: now,
            };
            if let Err(error) = adapter.upsert_receipt(adopted_receipt.clone()) {
                return Ok(failed_outcome(
                    "adoption-unrecorded",
                    format!("The executable was verified, but Arkonad could not write its adoption receipt: {error}"),
                    false,
                    format!("{method_verification}\n{verification}"),
                ));
            }
            Ok(InstallOutcome {
                state: "adopted".to_owned(),
                message: format!(
                    "{} now uses the reviewed {} method for explicitly authorized lifecycle actions; Arkonad does not own its files or data.",
                    manifest.name, method.label
                ),
                system_change: false,
                retryable: false,
                rollback_available: false,
                logs: format!("{method_verification}\n{verification}"),
                manual_recovery: None,
                receipt: Some(adopted_receipt),
            })
        }
        ManagementOperation::IntegrationReset => {
            let detection = detection
                .ok_or_else(|| "integration reset requires a detected executable".to_owned())?;
            let mut receipt = receipt
                .ok_or_else(|| "integration reset requires an Arkonad receipt".to_owned())?;
            let method = recorded_method(&manifest, Some(&receipt)).ok_or_else(|| {
                "the receipt's install method is no longer in the catalog".to_owned()
            })?;
            let verification = match verify_installation_with_adapter(method, &detection, adapter) {
                Ok(verification) => verification,
                Err(error) => {
                    return Ok(failed_outcome(
                        "verification-failed",
                        error,
                        false,
                        String::new(),
                    ));
                }
            };
            receipt.executable_path = detection.path;
            receipt.verification = verification.clone();
            if let Err(error) = adapter.upsert_receipt(receipt.clone()) {
                return Ok(failed_outcome(
                    "integration-reset-unrecorded",
                    format!("The executable was verified, but Arkonad could not refresh its integration receipt: {error}"),
                    false,
                    verification,
                ));
            }
            Ok(InstallOutcome {
                state: "integration-reset".to_owned(),
                message: format!(
                    "{} integration metadata was refreshed; tool data was not changed.",
                    manifest.name
                ),
                system_change: false,
                retryable: false,
                rollback_available: false,
                logs: verification,
                manual_recovery: None,
                receipt: Some(receipt),
            })
        }
        ManagementOperation::Update | ManagementOperation::Repair => {
            let operation = request.operation;
            let operation_name = operation_label(&operation);
            let original_receipt = receipt
                .ok_or_else(|| format!("managed {operation_name} requires an Arkonad receipt"))?;
            let command = plan
                .command
                .as_ref()
                .ok_or_else(|| format!("managed {operation_name} has no declared command"))?;
            let result = match adapter.run(command) {
                Ok(result) => result,
                Err(error) => {
                    return Ok(failed_management_outcome(
                        "failed",
                        error,
                        false,
                        String::new(),
                        original_receipt,
                    ));
                }
            };
            let logs = command_result_log(&result);
            if !result.success {
                return Ok(failed_management_outcome(
                    "failed",
                    format!("{} exited with status {}.", command[0], result.status),
                    true,
                    logs,
                    original_receipt,
                ));
            }

            let detection = match adapter.detect(&manifest) {
                Err(error) => {
                    return Ok(failed_management_outcome(
                        "verification-failed",
                        format!(
                            "The {operation_name} completed, but Arkonad could not re-check the executable: {error}"
                        ),
                        true,
                        logs,
                        original_receipt,
                    ));
                }
                Ok(Some(detection)) => detection,
                Ok(None) => {
                    return Ok(failed_management_outcome(
                        "verification-failed",
                        format!("The {operation_name} completed, but the declared executable was not found on PATH."),
                        true,
                        logs,
                        original_receipt,
                    ));
                }
            };
            let method = recorded_method(&manifest, Some(&original_receipt)).ok_or_else(|| {
                "the receipt's install method is no longer in the catalog".to_owned()
            })?;
            let verification = match verify_installation_with_adapter(method, &detection, adapter) {
                Ok(verification) => verification,
                Err(error) => {
                    return Ok(failed_management_outcome(
                        "verification-failed",
                        error,
                        true,
                        logs,
                        original_receipt,
                    ));
                }
            };
            let mut updated_receipt = original_receipt.clone();
            if operation == ManagementOperation::Update {
                updated_receipt.version =
                    manifest.versions.latest.clone().or(updated_receipt.version);
            }
            updated_receipt.executable_path = detection.path;
            updated_receipt.verification = verification.clone();
            if let Err(error) = adapter.upsert_receipt(updated_receipt.clone()) {
                return Ok(failed_management_outcome(
                    "updated-unrecorded",
                    format!("The {operation_name} completed, but Arkonad could not write its local receipt: {error}"),
                    true,
                    format!("{logs}\n{verification}"),
                    original_receipt,
                ));
            }
            let (state, message) = if operation == ManagementOperation::Update {
                (
                    "updated",
                    format!("{} was updated and remains launchable.", manifest.name),
                )
            } else {
                (
                    "repaired",
                    format!("{} was repaired and remains launchable.", manifest.name),
                )
            };
            Ok(InstallOutcome {
                state: state.to_owned(),
                message,
                system_change: true,
                retryable: false,
                rollback_available: false,
                logs: format!("{logs}\n{verification}"),
                manual_recovery: None,
                receipt: Some(updated_receipt),
            })
        }
        ManagementOperation::Uninstall => {
            let original_receipt = receipt
                .ok_or_else(|| "managed uninstall requires an Arkonad receipt".to_owned())?;
            let command = plan
                .command
                .as_ref()
                .ok_or_else(|| "managed uninstall has no declared command".to_owned())?;
            let result = match adapter.run(command) {
                Ok(result) => result,
                Err(error) => {
                    return Ok(failed_management_outcome(
                        "failed",
                        error,
                        false,
                        String::new(),
                        original_receipt,
                    ));
                }
            };
            let logs = command_result_log(&result);
            if !result.success {
                return Ok(failed_management_outcome(
                    "failed",
                    format!("{} exited with status {}.", command[0], result.status),
                    true,
                    logs,
                    original_receipt,
                ));
            }

            match adapter.remove_receipt(&manifest.id) {
                Ok(Some(_)) => {}
                Ok(None) => {
                    return Ok(failed_management_outcome(
                        "uninstalled-unrecorded",
                        "The package command completed, but no Arkonad receipt remained to remove. Review the preserved receipt before retrying.".to_owned(),
                        true,
                        logs,
                        original_receipt,
                    ));
                }
                Err(error) => {
                    return Ok(failed_management_outcome(
                        "uninstalled-unrecorded",
                        format!("The package was uninstalled, but Arkonad could not update its local receipt: {error}"),
                        true,
                        logs,
                        original_receipt,
                    ));
                }
            }
            let message = match original_receipt.ownership {
                ReceiptOwnership::Managed => format!(
                    "{} was removed from Arkonad-managed installations; its data was preserved.",
                    manifest.name
                ),
                ReceiptOwnership::Adopted => format!(
                    "The adopted package-management method removed {}; external tool data was preserved.",
                    manifest.name
                ),
            };
            Ok(InstallOutcome {
                state: "uninstalled".to_owned(),
                message,
                system_change: true,
                retryable: false,
                rollback_available: false,
                logs,
                manual_recovery: None,
                receipt: Some(original_receipt),
            })
        }
        ManagementOperation::DataCleanup => {
            Err("the controlled management interface does not handle this operation yet".to_owned())
        }
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
) -> Result<MyAppsSnapshot, String> {
    installer.list_my_apps(&app, &catalog)
}

fn my_apps_snapshot_with_adapter(
    catalog: &CatalogRuntime,
    adapter: &impl OperationAdapter,
) -> Result<MyAppsSnapshot, String> {
    let checked_at = adapter.now();
    let detection_by_manifest = adapter
        .detect_all()?
        .into_iter()
        .map(|detection| (detection.manifest_id.clone(), detection))
        .collect::<HashMap<_, _>>();
    let receipt_by_manifest = adapter
        .load_receipts()?
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
                &checked_at,
            ))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        (
            entry.ownership != "managed",
            entry.tool_name.to_ascii_lowercase(),
        )
    });
    let updates_available = entries
        .iter()
        .filter(|entry| entry.update_state == "available")
        .count();
    Ok(MyAppsSnapshot {
        entries,
        updates_available,
        checked_at,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn app_management_plan(
    app: AppHandle,
    catalog: tauri::State<'_, CatalogRuntime>,
    installer: tauri::State<'_, InstallRuntime>,
    manifest_id: String,
    operation: ManagementOperation,
    method_id: Option<String>,
) -> Result<ManagementPlan, String> {
    installer.management_plan(
        &app,
        &catalog,
        &manifest_id,
        operation,
        method_id.as_deref(),
    )
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
    let ownership = receipt
        .map(|receipt| receipt.ownership.as_str())
        .unwrap_or("detected");
    let update_state = if receipt.is_none() {
        "notManaged".to_owned()
    } else {
        match (
            installed_version.as_deref(),
            manifest.versions.latest.as_deref(),
        ) {
            (Some(current), Some(latest)) => match release_version_order(current, latest) {
                Some(Ordering::Less) => "available".to_owned(),
                Some(Ordering::Equal | Ordering::Greater) => "current".to_owned(),
                None => "unknown".to_owned(),
            },
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
        launch_profile_id: manifest
            .launch_profiles
            .first()
            .map(|profile| profile.id.clone()),
        supports_working_directory: manifest
            .launch_profiles
            .first()
            .is_some_and(|profile| profile.working_directory.is_none()),
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

#[cfg(test)]
fn build_management_plan(
    manifest: &CatalogManifest,
    detection: Option<&Detection>,
    receipt: Option<&InstallReceipt>,
    operation: ManagementOperation,
) -> ManagementPlan {
    build_management_plan_for_method(manifest, detection, receipt, operation, None)
}

fn build_management_plan_for_method(
    manifest: &CatalogManifest,
    detection: Option<&Detection>,
    receipt: Option<&InstallReceipt>,
    operation: ManagementOperation,
    requested_method_id: Option<&str>,
) -> ManagementPlan {
    let method = if operation == ManagementOperation::Adopt {
        requested_method_id
            .and_then(|method_id| {
                manifest
                    .install_methods
                    .iter()
                    .find(|method| method.id == method_id)
            })
            .or_else(|| {
                manifest
                    .install_methods
                    .iter()
                    .find(|method| adoption_supported(method))
            })
    } else {
        receipt.and_then(|receipt| recorded_method(manifest, Some(receipt)))
    };
    let ownership = if let Some(receipt) = receipt {
        receipt.ownership.as_str()
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
        ManagementOperation::Adopt => {
            supported =
                receipt.is_none() && detection.is_some() && method.is_some_and(adoption_supported);
            manual_instructions = Some(if receipt.is_some() {
                "This installation already has an Arkonad receipt and does not need adoption."
                    .to_owned()
            } else if detection.is_none() {
                "The executable is not currently detected, so Arkonad cannot verify it for adoption."
                    .to_owned()
            } else if supported {
                "Adoption verifies the detected executable and records the selected management method. It does not reinstall the tool or change its data."
                    .to_owned()
            } else {
                "No supported management method is declared for this detected installation."
                    .to_owned()
            });
        }
        ManagementOperation::IntegrationReset => {
            supported = receipt.is_some()
                && detection.is_some()
                && method.is_some_and(|method| method.verification_command.is_some());
            if !supported {
                manual_instructions = Some(if receipt.is_none() {
                    "Only an Arkonad-managed installation has integration metadata to reset."
                        .to_owned()
                } else if detection.is_none() {
                    "The executable is not currently detected, so Arkonad cannot refresh its integration metadata."
                        .to_owned()
                } else {
                    "The recorded method has no verification command, so Arkonad cannot safely reset its integration metadata."
                        .to_owned()
                });
            }
        }
        ManagementOperation::DataCleanup => {
            supported = receipt.is_some_and(|receipt| {
                receipt.ownership == ReceiptOwnership::Managed
                    && data_targets.iter().any(|target| target.allowed)
            });
            if !supported {
                manual_instructions = Some(if receipt.is_none() {
                    "This installation is not managed by Arkonad. It will not remove data from a detected installation.".to_owned()
                } else if receipt
                    .is_some_and(|receipt| receipt.ownership == ReceiptOwnership::Adopted)
                {
                    "Adoption grants the reviewed package-management method, not ownership of external tool data. Arkonad will not clean it.".to_owned()
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

    let source = if operation == ManagementOperation::Adopt {
        method.map(|method| method.source.clone()).unwrap_or(source)
    } else {
        source
    };

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
        ManagementOperation::Adopt => None,
        ManagementOperation::IntegrationReset => None,
        ManagementOperation::Update => method.update_command.clone(),
        ManagementOperation::Repair => method.repair_command.clone(),
        ManagementOperation::Uninstall => method.uninstall_command.clone(),
        ManagementOperation::DataCleanup => None,
    }
}

fn operation_label(operation: &ManagementOperation) -> &'static str {
    match operation {
        ManagementOperation::Adopt => "adoption",
        ManagementOperation::IntegrationReset => "integration reset",
        ManagementOperation::Update => "update",
        ManagementOperation::Repair => "repair",
        ManagementOperation::Uninstall => "uninstall",
        ManagementOperation::DataCleanup => "data cleanup",
    }
}

fn adoption_supported(method: &InstallMethod) -> bool {
    cfg!(windows)
        && method.kind.eq_ignore_ascii_case("winget")
        && method.package_id.is_some()
        && method.verification_command.is_some()
        && method.update_command.is_some()
        && method.uninstall_command.is_some()
}

fn verify_adoption_method_with_adapter(
    method: &InstallMethod,
    adapter: &impl OperationAdapter,
) -> Result<(String, String), String> {
    let package_id = method
        .package_id
        .as_deref()
        .ok_or_else(|| "the selected method does not declare a package identifier".to_owned())?;
    if !method.kind.eq_ignore_ascii_case("winget") {
        return Err("only a declared WinGet method can currently be adopted".to_owned());
    }
    let command = vec![
        "winget.exe".to_owned(),
        "list".to_owned(),
        "--id".to_owned(),
        package_id.to_owned(),
        "--exact".to_owned(),
        "--source".to_owned(),
        "winget".to_owned(),
        "--accept-source-agreements".to_owned(),
        "--disable-interactivity".to_owned(),
    ];
    let result = adapter.run(&command)?;
    if !result.success
        || !result
            .stdout
            .to_ascii_lowercase()
            .contains(&package_id.to_ascii_lowercase())
    {
        return Err(format!(
            "WinGet did not report {package_id} as an installed package. The detected executable remains externally owned."
        ));
    }
    Ok((
        format!("WinGet reported the exact installed package {package_id}."),
        result.stdout,
    ))
}

fn shares_release_version(left: &str, right: &str) -> bool {
    let left_versions = release_versions_in(left);
    release_versions_in(right)
        .iter()
        .any(|version| left_versions.contains(version))
}

fn release_versions_in(value: &str) -> Vec<Vec<u64>> {
    value
        .split_whitespace()
        .filter_map(|token| {
            let token = token.trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && character != '.'
            });
            numeric_release_version(token)
        })
        .collect()
}

fn release_version_order(current: &str, latest: &str) -> Option<Ordering> {
    let current = numeric_release_version(current)?;
    let latest = numeric_release_version(latest)?;
    let width = current.len().max(latest.len());
    for index in 0..width {
        let ordering = current
            .get(index)
            .copied()
            .unwrap_or_default()
            .cmp(&latest.get(index).copied().unwrap_or_default());
        if ordering != Ordering::Equal {
            return Some(ordering);
        }
    }
    Some(Ordering::Equal)
}

fn numeric_release_version(value: &str) -> Option<Vec<u64>> {
    let value = value.trim().strip_prefix('v').unwrap_or(value.trim());
    if value.is_empty() || value.contains(['-', '+']) {
        return None;
    }
    value
        .split('.')
        .map(|part| {
            if part.is_empty() || !part.chars().all(|character| character.is_ascii_digit()) {
                None
            } else {
                part.parse::<u64>().ok()
            }
        })
        .collect()
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

fn prerequisite_step(
    prerequisite: &Prerequisite,
    probe: &impl Fn(&PrerequisiteCheck) -> bool,
) -> InstallStep {
    let availability = match prerequisite.check.as_ref() {
        Some(check) if probe(check) => PrerequisiteAvailability::Ready,
        Some(_) => PrerequisiteAvailability::Missing,
        None => PrerequisiteAvailability::Unknown,
    };
    InstallStep {
        id: prerequisite.id.clone(),
        label: prerequisite.label.clone(),
        kind: "prerequisite".to_owned(),
        optional: prerequisite.optional,
        availability,
        description: prerequisite.description.clone(),
        command: prerequisite.command.clone().filter(|_| cfg!(windows)),
        source: prerequisite.source.clone(),
        privileges: prerequisite.privileges.clone(),
        rollback_limits: prerequisite.rollback_limits.clone(),
        requires_confirmation: true,
    }
}

fn optional_enhancement_step(
    enhancement: &OptionalEnhancement,
    probe: &impl Fn(&PrerequisiteCheck) -> bool,
) -> InstallStep {
    let availability = match enhancement.check.as_ref() {
        Some(check) if probe(check) => PrerequisiteAvailability::Ready,
        Some(_) => PrerequisiteAvailability::Missing,
        None => PrerequisiteAvailability::Unknown,
    };
    InstallStep {
        id: format!("enhancement-{}", enhancement.id),
        label: enhancement.label.clone(),
        kind: "enhancement".to_owned(),
        optional: true,
        availability,
        description: enhancement.description.clone(),
        command: enhancement.command.clone().filter(|_| cfg!(windows)),
        source: enhancement.source.clone(),
        privileges: enhancement.privileges.clone(),
        rollback_limits: enhancement.rollback_limits.clone(),
        requires_confirmation: true,
    }
}

fn prerequisite_is_available(check: &PrerequisiteCheck) -> bool {
    run_command(&check.command)
        .map(CommandResult::from)
        .is_ok_and(|result| prerequisite_check_matches(check, &result))
}

fn prerequisite_check_matches(check: &PrerequisiteCheck, result: &CommandResult) -> bool {
    result.success
        && check.stdout_contains.as_ref().map_or(true, |marker| {
            result
                .stdout
                .to_ascii_lowercase()
                .contains(&marker.to_ascii_lowercase())
        })
}

fn find_step<'a>(plan: &'a InstallPlan, step_id: &str) -> Option<&'a InstallStep> {
    plan.prerequisites
        .iter()
        .chain(plan.optional_setup.iter())
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

fn verify_installation_with_adapter(
    method: &InstallMethod,
    detection: &Detection,
    adapter: &impl OperationAdapter,
) -> Result<String, String> {
    let mut command = method
        .verification_command
        .clone()
        .ok_or_else(|| "the manifest does not declare a verification command".to_owned())?;
    command[0] = detection.path.clone();
    let result = adapter.run(&command)?;
    let logs = command_result_log(&result);
    if !result.success {
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

fn failed_management_outcome(
    state: &str,
    message: String,
    system_change: bool,
    logs: String,
    receipt: InstallReceipt,
) -> InstallOutcome {
    let mut outcome = failed_outcome(state, message, system_change, logs);
    outcome.receipt = Some(receipt);
    outcome
}

fn command_result_log(result: &CommandResult) -> String {
    match (result.stdout.is_empty(), result.stderr.is_empty()) {
        (true, true) => "No command output.".to_owned(),
        (false, true) => result.stdout.clone(),
        (true, false) => format!("stderr: {}", result.stderr),
        (false, false) => format!("stdout: {}\nstderr: {}", result.stdout, result.stderr),
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
        Ok(contents) => parse_receipt_store(&contents),
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
    let contents = serde_json::to_vec_pretty(&ReceiptStoreFile {
        schema_version: RECEIPT_SCHEMA_VERSION,
        receipts: receipts.to_vec(),
    })
    .map_err(|error| format!("could not encode installation receipt: {error}"))?;
    fs::write(&path, contents)
        .map_err(|error| format!("could not write installation receipt: {error}"))
}

fn parse_receipt_store(contents: &str) -> Result<Vec<InstallReceipt>, String> {
    let value: serde_json::Value = serde_json::from_str(contents)
        .map_err(|error| format!("invalid installation receipt file: {error}"))?;
    if value.is_array() {
        return serde_json::from_value(value)
            .map_err(|error| format!("invalid installation receipt file: {error}"));
    }
    let store: ReceiptStoreFile = serde_json::from_value(value)
        .map_err(|error| format!("invalid installation receipt file: {error}"))?;
    if store.schema_version != RECEIPT_SCHEMA_VERSION {
        return Err(format!(
            "installation receipt schema version {} is not supported",
            store.schema_version
        ));
    }
    Ok(store.receipts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct TestOperationAdapter {
        detection: Option<Detection>,
        receipts: RefCell<Vec<InstallReceipt>>,
        commands: RefCell<Vec<Vec<String>>>,
        failed_verb: Option<String>,
        detection_error_after_verb: Option<String>,
        package_membership: bool,
    }

    impl TestOperationAdapter {
        fn successful(detection: Option<Detection>, receipts: Vec<InstallReceipt>) -> Self {
            Self {
                detection,
                receipts: RefCell::new(receipts),
                commands: RefCell::new(Vec::new()),
                failed_verb: None,
                detection_error_after_verb: None,
                package_membership: true,
            }
        }

        fn failing(
            detection: Option<Detection>,
            receipts: Vec<InstallReceipt>,
            verb: &str,
        ) -> Self {
            Self {
                detection,
                receipts: RefCell::new(receipts),
                commands: RefCell::new(Vec::new()),
                failed_verb: Some(verb.to_owned()),
                detection_error_after_verb: None,
                package_membership: true,
            }
        }

        fn detection_fails_after(
            detection: Option<Detection>,
            receipts: Vec<InstallReceipt>,
            verb: &str,
        ) -> Self {
            Self {
                detection,
                receipts: RefCell::new(receipts),
                commands: RefCell::new(Vec::new()),
                failed_verb: None,
                detection_error_after_verb: Some(verb.to_owned()),
                package_membership: true,
            }
        }

        fn without_package_membership(
            detection: Option<Detection>,
            receipts: Vec<InstallReceipt>,
        ) -> Self {
            Self {
                detection,
                receipts: RefCell::new(receipts),
                commands: RefCell::new(Vec::new()),
                failed_verb: None,
                detection_error_after_verb: None,
                package_membership: false,
            }
        }
    }

    impl OperationAdapter for TestOperationAdapter {
        fn run(&self, argv: &[String]) -> Result<CommandResult, String> {
            self.commands.borrow_mut().push(argv.to_vec());
            let failed = self
                .failed_verb
                .as_ref()
                .is_some_and(|verb| argv.iter().any(|part| part == verb));
            Ok(CommandResult {
                success: !failed,
                status: if failed { "1" } else { "0" }.to_owned(),
                stdout: if failed {
                    String::new()
                } else if argv.iter().any(|part| part == "list") {
                    if self.package_membership {
                        "lazygit JesseDuffield.lazygit 0.64.0 winget".to_owned()
                    } else {
                        "No installed package found matching input criteria.".to_owned()
                    }
                } else if argv.iter().any(|part| part == "--version") {
                    "lazygit version 0.64.0".to_owned()
                } else {
                    "completed".to_owned()
                },
                stderr: if failed {
                    "simulated package failure".to_owned()
                } else {
                    String::new()
                },
            })
        }

        fn detect_all(&self) -> Result<Vec<Detection>, String> {
            if self
                .detection_error_after_verb
                .as_ref()
                .is_some_and(|verb| {
                    self.commands
                        .borrow()
                        .iter()
                        .any(|command| command.iter().any(|part| part == verb))
                })
            {
                return Err("simulated detection failure".to_owned());
            }
            Ok(self.detection.clone().into_iter().collect())
        }

        fn load_receipts(&self) -> Result<Vec<InstallReceipt>, String> {
            Ok(self.receipts.borrow().clone())
        }

        fn upsert_receipt(&self, receipt: InstallReceipt) -> Result<(), String> {
            let mut receipts = self.receipts.borrow_mut();
            receipts.retain(|existing| existing.manifest_id != receipt.manifest_id);
            receipts.push(receipt);
            Ok(())
        }

        fn remove_receipt(&self, manifest_id: &str) -> Result<Option<InstallReceipt>, String> {
            let mut receipts = self.receipts.borrow_mut();
            let removed = receipts
                .iter()
                .find(|receipt| receipt.manifest_id == manifest_id)
                .cloned();
            receipts.retain(|receipt| receipt.manifest_id != manifest_id);
            Ok(removed)
        }

        fn now(&self) -> String {
            "1700000000".to_owned()
        }
    }

    #[cfg(windows)]
    struct HostSafeOperationAdapter {
        receipt_file: PathBuf,
    }

    #[cfg(windows)]
    impl OperationAdapter for HostSafeOperationAdapter {
        fn run(&self, argv: &[String]) -> Result<CommandResult, String> {
            run_command(argv).map(CommandResult::from)
        }

        fn detect_all(&self) -> Result<Vec<Detection>, String> {
            let output = run_command(&["where.exe".to_owned(), "cmd.exe".to_owned()])?;
            if !output.status.success() {
                return Ok(Vec::new());
            }
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .ok_or_else(|| "where.exe returned no cmd.exe path".to_owned())?
                .to_owned();
            Ok(vec![Detection {
                manifest_id: "lazygit".to_owned(),
                command: "cmd.exe".to_owned(),
                path,
                source: "PATH".to_owned(),
                version: Some("1.0.0".to_owned()),
            }])
        }

        fn load_receipts(&self) -> Result<Vec<InstallReceipt>, String> {
            match fs::read_to_string(&self.receipt_file) {
                Ok(contents) => serde_json::from_str(&contents)
                    .map_err(|error| format!("invalid test receipt file: {error}")),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
                Err(error) => Err(format!("could not read test receipt file: {error}")),
            }
        }

        fn upsert_receipt(&self, receipt: InstallReceipt) -> Result<(), String> {
            let mut receipts = self.load_receipts()?;
            receipts.retain(|existing| existing.manifest_id != receipt.manifest_id);
            receipts.push(receipt);
            let contents = serde_json::to_vec_pretty(&receipts)
                .map_err(|error| format!("could not encode test receipt: {error}"))?;
            fs::write(&self.receipt_file, contents)
                .map_err(|error| format!("could not write test receipt file: {error}"))
        }

        fn remove_receipt(&self, manifest_id: &str) -> Result<Option<InstallReceipt>, String> {
            let mut receipts = self.load_receipts()?;
            let removed = receipts
                .iter()
                .find(|receipt| receipt.manifest_id == manifest_id)
                .cloned();
            receipts.retain(|receipt| receipt.manifest_id != manifest_id);
            let contents = serde_json::to_vec_pretty(&receipts)
                .map_err(|error| format!("could not encode test receipt: {error}"))?;
            fs::write(&self.receipt_file, contents)
                .map_err(|error| format!("could not write test receipt file: {error}"))?;
            Ok(removed)
        }

        fn now(&self) -> String {
            "1700000000".to_owned()
        }
    }

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
    fn missing_required_prerequisite_keeps_the_application_unavailable() {
        let mut manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        manifest.prerequisites.push(Prerequisite {
            id: "required-runtime".to_owned(),
            label: "Required runtime".to_owned(),
            description: "Required before the application can be installed.".to_owned(),
            kind: "runtime".to_owned(),
            optional: false,
            check: Some(PrerequisiteCheck {
                command: vec!["runtime.exe".to_owned(), "--version".to_owned()],
                stdout_contains: None,
            }),
            command: Some(vec!["runtime-installer.exe".to_owned()]),
            source: Some("https://example.com/runtime".to_owned()),
            privileges: PrivilegeRequirement::MayElevate,
            rollback_limits: "The shared runtime is not removed automatically.".to_owned(),
        });

        let plan =
            InstallRuntime::build_plan_with_probe(&manifest, Some("winget"), &|_| false).unwrap();

        assert!(!plan.prerequisites_ready);
        assert_eq!(
            plan.prerequisites[0].availability,
            PrerequisiteAvailability::Missing
        );
    }

    #[test]
    fn install_plan_reports_optional_prerequisite_discovery() {
        let mut manifest = CatalogRuntime::builtins().manifest("codex").unwrap();
        manifest.prerequisites.extend([
            Prerequisite {
                id: "wsl2".to_owned(),
                label: "WSL 2 runtime".to_owned(),
                description: "Adds WSL without selecting a distribution.".to_owned(),
                kind: "wsl".to_owned(),
                optional: true,
                check: Some(PrerequisiteCheck {
                    command: vec!["wsl.exe".to_owned(), "--status".to_owned()],
                    stdout_contains: None,
                }),
                command: Some(vec![
                    "wsl.exe".to_owned(),
                    "--install".to_owned(),
                    "--no-distribution".to_owned(),
                ]),
                source: Some("https://learn.microsoft.com/windows/wsl/basic-commands".to_owned()),
                privileges: PrivilegeRequirement::ElevationRequired,
                rollback_limits: "Arkonad will not remove shared WSL infrastructure.".to_owned(),
            },
            Prerequisite {
                id: "ubuntu".to_owned(),
                label: "Ubuntu distribution".to_owned(),
                description: "Adds Ubuntu after WSL is ready.".to_owned(),
                kind: "distribution".to_owned(),
                optional: true,
                check: Some(PrerequisiteCheck {
                    command: vec![
                        "wsl.exe".to_owned(),
                        "--list".to_owned(),
                        "--quiet".to_owned(),
                    ],
                    stdout_contains: Some("Ubuntu".to_owned()),
                }),
                command: Some(vec![
                    "wsl.exe".to_owned(),
                    "--install".to_owned(),
                    "--distribution".to_owned(),
                    "Ubuntu".to_owned(),
                    "--no-launch".to_owned(),
                ]),
                source: Some("https://learn.microsoft.com/windows/wsl/install".to_owned()),
                privileges: PrivilegeRequirement::MayElevate,
                rollback_limits: "Arkonad will not unregister Ubuntu or delete its files."
                    .to_owned(),
            },
        ]);
        let plan = InstallRuntime::build_plan_with_probe(&manifest, Some("publisher"), &|check| {
            check.stdout_contains.is_none()
        })
        .unwrap();

        let wsl = plan
            .prerequisites
            .iter()
            .find(|step| step.id == "wsl2")
            .unwrap();
        assert_eq!(wsl.availability, PrerequisiteAvailability::Ready);
        assert!(wsl.optional);
        assert!(wsl.requires_confirmation);

        let ubuntu = plan
            .prerequisites
            .iter()
            .find(|step| step.id == "ubuntu")
            .unwrap();
        assert_eq!(ubuntu.availability, PrerequisiteAvailability::Missing);
        assert!(ubuntu.optional);
        assert!(ubuntu.requires_confirmation);
    }

    #[test]
    fn codex_ships_declineable_wsl_and_ubuntu_setup_without_making_them_prerequisites() {
        let manifest = CatalogRuntime::builtins().manifest("codex").unwrap();
        let plan = InstallRuntime::build_plan_with_probe(&manifest, Some("publisher"), &|check| {
            check.stdout_contains.is_none()
        })
        .unwrap();

        assert!(plan.prerequisites.is_empty());
        assert!(plan.prerequisites_ready);
        assert_eq!(plan.optional_setup.len(), 2);
        assert_eq!(plan.optional_setup[0].id, "enhancement-wsl2");
        assert_eq!(
            plan.optional_setup[0].availability,
            PrerequisiteAvailability::Ready
        );
        assert_eq!(plan.optional_setup[1].id, "enhancement-ubuntu");
        assert_eq!(
            plan.optional_setup[1].availability,
            PrerequisiteAvailability::Missing
        );
        assert!(plan.optional_setup.iter().all(|step| step.optional));
        assert!(plan
            .optional_setup
            .iter()
            .all(|step| step.requires_confirmation));
    }

    #[test]
    fn prerequisite_discovery_requires_the_declared_output_marker() {
        let check = crate::catalog::PrerequisiteCheck {
            command: vec![
                "wsl.exe".to_owned(),
                "--list".to_owned(),
                "--quiet".to_owned(),
            ],
            stdout_contains: Some("Ubuntu".to_owned()),
        };
        let missing = CommandResult {
            success: true,
            status: "0".to_owned(),
            stdout: "Debian".to_owned(),
            stderr: String::new(),
        };
        let ready = CommandResult {
            stdout: "Debian\nUbuntu".to_owned(),
            ..missing.clone()
        };

        assert!(!prerequisite_check_matches(&check, &missing));
        assert!(prerequisite_check_matches(&check, &ready));
    }

    #[test]
    fn approved_install_is_verified_and_recorded_through_the_operation_interface() {
        let catalog = CatalogRuntime::builtins();
        let adapter = TestOperationAdapter::successful(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: Some("0.64.0".to_owned()),
            }),
            Vec::new(),
        );

        let outcome = execute_install_with_adapter(
            &catalog,
            InstallRequest {
                manifest_id: "lazygit".to_owned(),
                method_id: Some("winget".to_owned()),
                step_id: "application".to_owned(),
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "installed");
        assert_eq!(adapter.commands.borrow().len(), 2);
        assert_eq!(adapter.commands.borrow()[0][1], "install");
        assert_eq!(adapter.commands.borrow()[1][0], r"C:\Tools\lazygit.exe");

        let receipts = adapter.receipts.borrow();
        assert_eq!(receipts.len(), 1);
        assert_eq!(
            receipts[0].source,
            "https://learn.microsoft.com/windows/package-manager/winget/"
        );
        assert_eq!(receipts[0].method_id.as_deref(), Some("winget"));
        assert_eq!(
            receipts[0].verification,
            "Launch check passed for C:\\Tools\\lazygit.exe.\nlazygit version 0.64.0"
        );
    }

    #[cfg(windows)]
    #[test]
    fn host_safe_install_runs_a_real_process_detects_path_and_persists_receipt() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let target_root = std::env::var_os("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target"));
        let test_directory = target_root
            .join("arkonad-acceptance-tests")
            .join(format!("{}-{unique}", std::process::id()));
        fs::create_dir_all(&test_directory).unwrap();
        let adapter = HostSafeOperationAdapter {
            receipt_file: test_directory.join("install-receipts.json"),
        };
        let catalog = CatalogRuntime::builtins();
        let mut manifest = catalog.manifest("lazygit").unwrap();
        let method = manifest
            .install_methods
            .iter_mut()
            .find(|method| method.id == "winget")
            .unwrap();
        method.command = Some(vec![
            "cmd.exe".to_owned(),
            "/D".to_owned(),
            "/C".to_owned(),
            "exit".to_owned(),
            "0".to_owned(),
        ]);
        method.verification_command = Some(vec![
            "cmd.exe".to_owned(),
            "/D".to_owned(),
            "/C".to_owned(),
            "echo".to_owned(),
            "host-safe launch check".to_owned(),
        ]);
        let catalog = CatalogRuntime::from_manifests_for_test(vec![manifest]);

        let outcome = execute_install_with_adapter(
            &catalog,
            InstallRequest {
                manifest_id: "lazygit".to_owned(),
                method_id: Some("winget".to_owned()),
                step_id: "application".to_owned(),
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "installed");
        assert!(Path::new(&outcome.receipt.as_ref().unwrap().executable_path).exists());
        let persisted = adapter.load_receipts().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].method_id.as_deref(), Some("winget"));
        assert!(persisted[0].verification.contains("host-safe launch check"));
        fs::remove_dir_all(&test_directory).unwrap();
    }

    #[test]
    fn managed_installation_uses_recorded_lifecycle_commands() {
        let manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        let receipt = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
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
            ownership: ReceiptOwnership::Managed,
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

    #[test]
    fn my_apps_snapshot_notifies_about_updates_without_running_them() {
        let catalog = CatalogRuntime::builtins();
        let adapter = TestOperationAdapter::successful(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: Some("0.63.0".to_owned()),
            }),
            vec![InstallReceipt {
                id: "lazygit-1".to_owned(),
                ownership: ReceiptOwnership::Managed,
                manifest_id: "lazygit".to_owned(),
                tool_name: "lazygit".to_owned(),
                publisher: "Jesse Duffield".to_owned(),
                version: Some("0.63.0".to_owned()),
                source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
                method_id: Some("winget".to_owned()),
                method: "Install with WinGet".to_owned(),
                package_id: Some("JesseDuffield.lazygit".to_owned()),
                executable_path: r"C:\Tools\lazygit.exe".to_owned(),
                verification: "Launch check passed".to_owned(),
                installed_at: "1".to_owned(),
            }],
        );

        let snapshot = my_apps_snapshot_with_adapter(&catalog, &adapter).unwrap();

        assert_eq!(snapshot.updates_available, 1);
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].update_state, "available");
        assert!(adapter.commands.borrow().is_empty());
    }

    #[test]
    fn my_apps_does_not_offer_a_downgrade_as_an_update() {
        let manifest = CatalogRuntime::builtins().manifest("lazygit").unwrap();
        let receipt = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.65.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: r"C:\Tools\lazygit.exe".to_owned(),
            verification: "Launch check passed".to_owned(),
            installed_at: "1".to_owned(),
        };

        let entry = my_app_entry(&manifest, None, Some(&receipt), "2");

        assert_eq!(entry.update_state, "current");
    }

    #[test]
    fn adoption_version_evidence_must_match_the_detected_executable() {
        assert!(shares_release_version(
            "lazygit JesseDuffield.lazygit 0.64.0 winget",
            "lazygit version 0.64.0",
        ));
        assert!(!shares_release_version(
            "lazygit JesseDuffield.lazygit 0.63.0 winget",
            "lazygit version 0.64.0",
        ));
    }

    #[test]
    fn detected_installation_is_adopted_only_after_method_ownership_is_verified() {
        let catalog = CatalogRuntime::builtins();
        let adapter = TestOperationAdapter::successful(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: None,
            }),
            Vec::new(),
        );

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::Adopt,
                method_id: Some("winget".to_owned()),
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "adopted");
        assert_eq!(adapter.commands.borrow().len(), 2);
        assert_eq!(adapter.commands.borrow()[0][0], "winget.exe");
        assert!(adapter.commands.borrow()[0]
            .iter()
            .any(|part| part == "list"));
        assert!(adapter.commands.borrow()[0]
            .iter()
            .any(|part| part == "JesseDuffield.lazygit"));
        assert_eq!(adapter.commands.borrow()[1][0], r"C:\Tools\lazygit.exe");
        assert!(!adapter.commands.borrow().iter().flatten().any(|part| {
            matches!(
                part.as_str(),
                "install" | "upgrade" | "repair" | "uninstall"
            )
        }));

        let receipts = adapter.receipts.borrow();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].ownership, ReceiptOwnership::Adopted);
        assert_eq!(receipts[0].method_id.as_deref(), Some("winget"));
        assert_eq!(receipts[0].executable_path, r"C:\Tools\lazygit.exe");
    }

    #[test]
    fn adoption_refuses_a_method_that_does_not_own_the_detected_package() {
        let catalog = CatalogRuntime::builtins();
        let adapter = TestOperationAdapter::without_package_membership(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: Some("0.64.0".to_owned()),
            }),
            Vec::new(),
        );

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::Adopt,
                method_id: Some("winget".to_owned()),
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "adoption-verification-failed");
        assert!(!outcome.system_change);
        assert!(outcome.receipt.is_none());
        assert!(adapter.receipts.borrow().is_empty());
    }

    #[test]
    fn integration_reset_refreshes_only_arkonad_metadata() {
        let catalog = CatalogRuntime::builtins();
        let original = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.64.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: r"C:\Old\lazygit.exe".to_owned(),
            verification: "old verification".to_owned(),
            installed_at: "1".to_owned(),
        };
        let adapter = TestOperationAdapter::successful(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: Some("0.64.0".to_owned()),
            }),
            vec![original.clone()],
        );

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::IntegrationReset,
                method_id: None,
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "integration-reset");
        assert_eq!(adapter.commands.borrow().len(), 1);
        assert_eq!(adapter.commands.borrow()[0][0], r"C:\Tools\lazygit.exe");
        let receipts = adapter.receipts.borrow();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].id, original.id);
        assert_eq!(receipts[0].method_id, original.method_id);
        assert_eq!(receipts[0].executable_path, r"C:\Tools\lazygit.exe");
        assert!(receipts[0].verification.contains("Launch check passed"));
    }

    #[test]
    fn repair_reverifies_the_app_without_uninstalling_or_cleaning_data() {
        let catalog = CatalogRuntime::builtins();
        let original = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.64.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: r"C:\Tools\lazygit.exe".to_owned(),
            verification: "old verification".to_owned(),
            installed_at: "1".to_owned(),
        };
        let adapter = TestOperationAdapter::successful(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: Some("0.64.0".to_owned()),
            }),
            vec![original.clone()],
        );

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::Repair,
                method_id: None,
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "repaired");
        assert_eq!(adapter.receipts.borrow().len(), 1);
        assert_eq!(adapter.receipts.borrow()[0].id, original.id);
        assert_eq!(adapter.receipts.borrow()[0].version, original.version);
        assert!(adapter.commands.borrow()[0]
            .iter()
            .any(|part| part == "repair"));
        assert!(!adapter
            .commands
            .borrow()
            .iter()
            .flatten()
            .any(|part| matches!(part.as_str(), "uninstall" | "remove" | "cleanup")));
    }

    #[test]
    fn failed_update_preserves_the_original_receipt_and_recovery() {
        let catalog = CatalogRuntime::builtins();
        let original = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.63.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: r"C:\Tools\lazygit.exe".to_owned(),
            verification: "Launch check passed".to_owned(),
            installed_at: "1".to_owned(),
        };
        let adapter = TestOperationAdapter::failing(None, vec![original.clone()], "upgrade");

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::Update,
                method_id: None,
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "failed");
        assert_eq!(adapter.receipts.borrow()[0].id, original.id);
        assert_eq!(adapter.receipts.borrow()[0].version, original.version);
        assert_eq!(outcome.receipt.as_ref().unwrap().id, original.id);
        assert!(outcome.manual_recovery.is_some());
    }

    #[test]
    fn post_update_detection_error_preserves_the_original_receipt_and_recovery() {
        let catalog = CatalogRuntime::builtins();
        let original = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.63.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: r"C:\Tools\lazygit.exe".to_owned(),
            verification: "Launch check passed".to_owned(),
            installed_at: "1".to_owned(),
        };
        let adapter = TestOperationAdapter::detection_fails_after(
            Some(Detection {
                manifest_id: "lazygit".to_owned(),
                command: "lazygit.exe".to_owned(),
                path: r"C:\Tools\lazygit.exe".to_owned(),
                source: "PATH".to_owned(),
                version: Some("0.63.0".to_owned()),
            }),
            vec![original.clone()],
            "upgrade",
        );

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::Update,
                method_id: None,
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "verification-failed");
        assert!(outcome.system_change);
        assert_eq!(outcome.receipt.as_ref().unwrap().id, original.id);
        assert_eq!(adapter.receipts.borrow()[0].version, original.version);
        assert!(outcome.manual_recovery.is_some());
    }

    #[test]
    fn failed_uninstall_preserves_the_original_receipt_and_recovery() {
        let catalog = CatalogRuntime::builtins();
        let original = InstallReceipt {
            id: "lazygit-1".to_owned(),
            ownership: ReceiptOwnership::Managed,
            manifest_id: "lazygit".to_owned(),
            tool_name: "lazygit".to_owned(),
            publisher: "Jesse Duffield".to_owned(),
            version: Some("0.64.0".to_owned()),
            source: "https://learn.microsoft.com/windows/package-manager/winget/".to_owned(),
            method_id: Some("winget".to_owned()),
            method: "Install with WinGet".to_owned(),
            package_id: Some("JesseDuffield.lazygit".to_owned()),
            executable_path: r"C:\Tools\lazygit.exe".to_owned(),
            verification: "Launch check passed".to_owned(),
            installed_at: "1".to_owned(),
        };
        let adapter = TestOperationAdapter::failing(None, vec![original.clone()], "uninstall");

        let outcome = execute_management_with_adapter(
            &catalog,
            ManagementRequest {
                manifest_id: "lazygit".to_owned(),
                operation: ManagementOperation::Uninstall,
                method_id: None,
                confirmed: true,
            },
            &adapter,
        )
        .unwrap();

        assert_eq!(outcome.state, "failed");
        assert_eq!(adapter.receipts.borrow().len(), 1);
        assert_eq!(adapter.receipts.borrow()[0].id, original.id);
        assert_eq!(outcome.receipt.as_ref().unwrap().id, original.id);
        assert!(outcome.manual_recovery.is_some());
    }
}
