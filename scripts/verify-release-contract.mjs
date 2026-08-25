import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const manifests = JSON.parse(read("src-tauri/catalog/manifests.json"));
const workflow = read(".github/workflows/release-windows.yml");
const docs = read("docs/release/windows-first-release.md");
const release = read("src-tauri/src/release.rs");
const installer = read("src-tauri/src/installer.rs");
const smoke = read("scripts/windows-release-smoke.ps1");
const packageJson = JSON.parse(read("package.json"));

const checks = [
  ["Tauri bundles are active", config.bundle?.active === true],
  ["NSIS and MSI targets are configured", ["nsis", "msi"].every((target) => config.bundle?.targets?.includes(target))],
  ["Per-user NSIS installation is configured", config.bundle?.windows?.nsis?.installMode === "currentUser"],
  ["Downgrades are not silent", config.bundle?.windows?.allowDowngrades === false],
  ["Release workflow requires a signing certificate", workflow.includes("WINDOWS_CERTIFICATE_BASE64")],
  ["Release workflow signs with signtool", workflow.includes("signtool.exe") && workflow.includes("/fd SHA256")],
  ["Release workflow verifies signed artifacts", workflow.includes("verify-windows-release.ps1 -BundleRoot")],
  ["Windows smoke harness covers installer lifecycle", ["CleanInstall", "Upgrade", "Repair", "Uninstall"].every((scenario) => smoke.includes(scenario))],
  ["Release data has a migration entry point", release.includes("pub fn prepare") && release.includes("DATA_FILE_NAMES")],
  ["Release data has an explicit rollback entry point", release.includes("pub fn restore_last_backup")],
  ["Receipt storage accepts the legacy format", installer.includes("if value.is_array()")],
  ["Release documentation covers the required scenarios", [
    "Clean install",
    "Upgrade",
    "Uninstall",
    "shell-only onboarding",
    "Store browsing",
    "app install, manage, and launch",
    "Agent Task",
    "Workspace recovery",
    "disabled network",
  ].every((text) => docs.includes(text))],
  ["Release documentation covers update and privacy boundaries", [
    "notify",
    "review",
    "install",
    "Store listing",
    "Verified Compatibility",
    "third-party app data",
  ].every((text) => docs.includes(text))],
  ["Every bundled manifest declares a schema", Array.isArray(manifests) && manifests.length > 0 && manifests.every((manifest) => manifest.schemaVersion === 1)],
  ["Release contract is runnable from package scripts", packageJson.scripts?.["test:release"] === "node scripts/verify-release-contract.mjs"],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length > 0) {
  console.error(`Release contract checks failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Release contract checks passed (${checks.length} contracts).`);
}
