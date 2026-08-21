use crate::catalog::{
    CatalogManifest, CatalogRuntime, Detection, InstallMethod, Prerequisite, PrivilegeRequirement,
    SourceReference,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
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
            message: "Installation was cancelled before execution; no system change was made."
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
}
