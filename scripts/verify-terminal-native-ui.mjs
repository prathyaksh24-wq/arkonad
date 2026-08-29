import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const cargo = read("src-tauri/Cargo.toml");
const main = read("src-tauri/src/main.rs");
const terminal = read("src-tauri/src/tui/terminal.rs");
const view = read("src-tauri/src/tui/view.rs");
const app = read("src-tauri/src/tui/app.rs");
const awesome = JSON.parse(read("src-tauri/catalog/awesome-tui-ai.json"));
const checks = [
  [awesome.length === 32 && new Set(awesome.map(e => e.id)).size === 32, "32 unique Awesome TUI AI entries"],
  [cargo.includes('default-run = "arkonad"') && cargo.includes("ratatui =") && cargo.includes("crossterm ="), "native default binary"],
  [cargo.includes('default = []') && cargo.includes('required-features = ["desktop"]'), "desktop is opt-in"],
  [main.includes("arkonad::tui::run") && !main.includes("tauri::Builder"), "entrypoint starts the TUI"],
  [terminal.includes("Stdio::inherit()") && terminal.includes("ratatui::restore()") && terminal.includes("ratatui::try_init()"), "child owns the caller terminal"],
  [view.includes("BorderType::Plain") && view.includes("Modifier::REVERSED"), "square frames and reverse-video selection"],
  [app.includes("ManagementOperation::Uninstall") && app.includes("ManagementOperation::Update"), "shared lifecycle actions exposed"],
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Native source contract passed (${checks.length} checks). Run Cargo tests for behavior.`);
