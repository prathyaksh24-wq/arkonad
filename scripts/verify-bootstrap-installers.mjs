import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const ps = read("install.ps1"), sh = read("install.sh"), docs = read("README.md");
const checks = [
  [docs.includes("install.ps1 | iex") && docs.includes("install.sh | sh"), "one-line installers documented"],
  [ps.includes('arkonad-windows-$architecture.exe') && sh.includes('arkonad-$platform-$architecture'), "native asset names"],
  [!ps.includes("Start-Process") && !sh.includes("exec open") && !sh.includes(".AppImage"), "no detached desktop launcher"],
  [ps.includes('Get-AuthenticodeSignature') && ps.includes('Status -ne "Valid"'), "Windows rejects unsigned executables"],
  [sh.includes("codesign --verify --strict") && sh.includes("spctl --assess --type execute"), "macOS validates trust"],
  [ps.includes("Get-FileHash") && ps.includes("checksum mismatch") && sh.includes('checksum mismatch'), "checksums are mandatory"],
  [ps.indexOf("checksum mismatch") < ps.indexOf("Copy-Item") && sh.indexOf("checksum mismatch") < sh.indexOf("mv -f"), "verification precedes replacement"],
  [ps.includes('"arkonad.cmd"') && ps.includes('"arkond.cmd"') && sh.includes('ln -sf "$bin_root/arkonad" "$bin_root/arkond"'), "canonical command and alias"],
  [ps.includes("Previous versions and app data were kept") && sh.includes('arkonad.previous'), "previous binary retained"],
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Bootstrap source contract passed (${checks.length} checks).`);
