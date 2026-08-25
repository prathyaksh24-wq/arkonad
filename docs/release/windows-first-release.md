# First Windows release

This document describes how Arkonad is packaged, updated, migrated, and checked before a Windows release is published.

## Installer shape

The Windows release produces two signed installers:

- an NSIS `.exe` for a per-user installation;
- an MSI for environments that use Windows Installer.

The Tauri bundle is active only for these Windows targets. The release workflow refuses to publish when the signing certificate or its password is missing. It signs the installer artifacts with SHA-256 and verifies their Authenticode signatures before uploading them.

The installer owns the application files. Arkonad app data is stored in the operating-system app-data directory, outside the install directory. Upgrade, repair, and uninstall do not remove Store receipts, Workspaces, Settings, or third-party app data. Removing a third-party tool's data remains a separate, reviewed My Apps action.

## Update behavior

Arkonad updates follow this order:

1. notify the user that a signed release is available;
2. show the release and ask for review;
3. install only after the user confirms.

`review` is the default policy. There is no silent application update. A release installer is the unit that changes the installed Arkonad version, and the installer itself is never launched as a background side effect of opening the terminal. A future updater must preserve this order and the same signed-artifact check.

Catalog Tool updates use the same user-visible review boundary. A Store listing is not a promise that Arkonad manages the tool or that the tool keeps data local.

## Versioned data and rollback

At startup, the release data module checks these app-owned JSON documents:

- `settings.json` — Settings and shell profiles;
- `store-metadata.json` — the bundled Store metadata schema;
- `install-receipts.json` — managed-install receipts, including legacy array-form receipts;
- `workspaces.json` — Workspace layouts and metadata.

Each document carries a `schemaVersion`. The release state records the data schema, the files changed by the last migration, and a backup under `migration-backups/`. A migration validates every document before writing. Writes use temporary files and replacement so a partially written JSON file is not treated as a successful migration.

If a migration fails, Arkonad restores the files changed during that migration and leaves the original data available. The `release_restore_last_backup` command requires explicit confirmation before restoring the last recorded backup. Arkonad rejects a future schema instead of guessing how to rewrite it.

## Shell support

The Windows app is tested as an Arkonad application with shell profiles for Command Prompt, Windows PowerShell, PowerShell 7, WSL, and the system default. CMD, PowerShell, and WSL are shell profiles; they are not the same thing as Windows app support. A successful Arkonad install does not claim that a shell, a coding agent, or a third-party TUI is installed.

## Release test matrix

The release workflow runs `pnpm run test:release`, the frontend build, and the Rust test suite before it builds installers. The following matrix is the evidence required for a tagged release:

| Scenario | Check | Expected result |
| --- | --- | --- |
| Clean install | Install the signed NSIS and MSI artifacts on a clean Windows profile | Arkonad starts, creates app data, and does not require a repository or agent |
| Upgrade | Install the previous signed version, create Settings and a Workspace, then install the new version | The version changes and Settings, receipts, and Workspace data remain readable |
| Repair | Run the NSIS reinstall or MSI repair operation after creating app data | Application files are restored without removing Settings, receipts, Workspaces, or third-party app data |
| Uninstall | Uninstall both supported installer forms after an install | Application files and shortcuts are removed; Store receipts, Workspaces, Settings, and third-party app data remain |
| shell-only onboarding | Start with no repository and no agent installed | Onboarding reaches a usable shell and does not invent an agent prerequisite |
| Store browsing | Open the bundled Store with the network disabled | Bundled manifests remain searchable and status text distinguishes listing from Verified Compatibility |
| app install, manage, and launch | Use a reviewed manifest and a safe test command | Install, update, repair, uninstall, receipt ownership, and launch follow the declared method |
| Agent Task | Create a task with a clean test repository | Worktree and permission policy checks run before task creation |
| Workspace recovery | Save a Workspace with an interrupted process marker, then restart | The Workspace opens for review and does not silently replay a process |
| disabled network | Disable network access after installation and reopen Arkonad | The shell, Settings, Workspaces, receipts, and bundled Store remain usable; network-dependent steps show a reviewed unavailable state |

The Rust tests already cover the pure behavior behind Store validation, install and management plans, receipt preservation, launch resolution, Agent Tasks, and Workspace recovery. The Windows runner is required for the installer and signature rows because those rows depend on NSIS, MSI, WebView2, and Authenticode.

## Release commands

From a Windows checkout:

```powershell
pnpm install --frozen-lockfile
pnpm run test:release
pnpm run build
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
pnpm exec tauri build
.\scripts\verify-windows-release.ps1 -BundleRoot .\src-tauri\target\release\bundle
.\scripts\windows-release-smoke.ps1 -InstallerPath .\src-tauri\target\release\bundle\nsis\Arkonad_0.1.0_x64-setup.exe -Scenario CleanInstall
```

The signed workflow runs on `v*` tags or by manual dispatch. It requires the repository secrets `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`; the certificate is decoded only on the Windows runner and is not committed to the repository.

## WinGet publication

WinGet publication happens after the signed installer has passed the release matrix. The release owner creates a separate `microsoft/winget-pkgs` pull request containing the version, publisher, installer URLs, SHA-256 hashes, architecture, and the stable MSI or NSIS installer metadata. The publication path is reviewed after verification; Arkonad does not publish a package from an unverified build.
