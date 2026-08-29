import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const workflow = read(".github/workflows/release-windows.yml");
const installer = read("src-tauri/src/installer.rs");
const manifests = JSON.parse(read("src-tauri/catalog/manifests.json"));
const docs = read("docs/terminal-native.md");
const checks = [
  [workflow.includes("--bin arkonad --target") && !workflow.includes("tauri build"), "release builds native executable"],
  [["windows-latest", "ubuntu-24.04", "ubuntu-24.04-arm", "macos-15-intel", "macos-latest"].every(s => workflow.includes(s)), "platform runners"],
  [["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-apple-darwin", "aarch64-apple-darwin"].every(s => workflow.includes(s)), "six architecture targets"],
  [workflow.includes("WINDOWS_CERTIFICATE_BASE64") && workflow.includes("signtool.exe") && workflow.includes("Get-AuthenticodeSignature"), "signed Windows binaries"],
  [workflow.includes("notarytool submit") && workflow.includes('test "$status" = Accepted'), "macOS notarization must be accepted"],
  [workflow.includes(".sha256") && workflow.includes("Get-FileHash"), "checksums published"],
  [workflow.includes("--draft --verify-tag"), "manual release QA before publication"],
  [workflow.includes("cargo test --locked") && workflow.includes("--features desktop --lib"), "native and retained desktop tests"],
  [installer.includes("if value.is_array()"), "legacy receipts remain readable"],
  [manifests.every(m => m.schemaVersion === 1), "manifest schema unchanged"],
  [docs.includes("have not yet been ported") && docs.includes("publish the first native release"), "migration and distribution limits documented"],
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Native release source contract passed (${checks.length} checks).`);
