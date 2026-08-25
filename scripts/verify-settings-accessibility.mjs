import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src", "main.ts"), "utf8");
const style = readFileSync(resolve(root, "src", "style.css"), "utf8");

const checks = [
  ["Settings surface exists", main.includes('data-settings-view')],
  ["Settings are reachable from the command palette", main.includes('id: "settings"')],
  ["Settings have keyboard list navigation", main.includes("moveSettingsSelection")],
  ["Reduced motion is applied", main.includes('dataset.motion = settings.motion') && style.includes('html[data-motion="reduced"]')],
  ["High contrast is applied", main.includes('dataset.highContrast = String(settings.highContrast)') && style.includes('html[data-high-contrast="true"]')],
  ["Font scaling is applied", main.includes('--arkonad-font-scale') && style.includes('zoom: var(--arkonad-font-scale')],
  ["Host controls expose screen-reader labels", main.includes('host.setAttribute("role", "region")') && main.includes('terminalHost.setAttribute("aria-label"')],
  ["Keyboard focus is visible", style.includes(':where(button, input, select, textarea, [tabindex]):focus-visible')],
  ["Hosted tools are kept native", main.includes("Hosted Catalog Tools retain their native appearance")],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length > 0) {
  console.error(`Settings/accessibility checks failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Settings/accessibility checks passed (${checks.length} contracts).`);
}
