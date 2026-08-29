import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "dev";
const suffix = process.platform === "win32" ? ".exe" : "";
const candidates = [
  process.env.CARGO_HOME && join(process.env.CARGO_HOME, "bin", `cargo${suffix}`),
  process.platform === "win32" && "D:\\Toolchains\\cargo\\bin\\cargo.exe",
].filter(Boolean);
const cargo = candidates.find(existsSync) ?? "cargo";
const commands = {
  dev: ["run", "--bin", "arkonad", "--"],
  build: ["build", "--release", "--bin", "arkonad"],
  test: ["test"],
  desktop: ["run", "--features", "desktop", "--bin", "arkonad-desktop", "--"],
};
if (!commands[mode]) throw new Error(`Unknown native command: ${mode}`);
const [command, ...args] = commands[mode];
const result = spawnSync(cargo, [command, "--manifest-path", "src-tauri/Cargo.toml", ...args, ...process.argv.slice(3)], { stdio: "inherit" });
if (result.error) console.error(`Rust is required for source builds: ${result.error.message}`);
process.exit(result.status ?? 1);
