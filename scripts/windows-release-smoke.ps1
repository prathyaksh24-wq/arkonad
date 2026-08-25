[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [ValidateSet("CleanInstall", "Upgrade", "Repair", "Uninstall")]
    [string]$Scenario = "CleanInstall",
    [string]$PreviousInstallerPath,
    [ValidateSet("nsis", "msi")]
    [string]$InstallerKind = "nsis",
    [string]$InstallDirectory = "$env:LOCALAPPDATA\Arkonad-release-smoke"
)

$ErrorActionPreference = "Stop"

function Invoke-Installer {
    param([string]$Path, [string]$Kind, [string]$TargetDirectory)

    if ($Kind -eq "nsis") {
        $arguments = @("/S", ("/D=`"{0}`"" -f $TargetDirectory))
        $process = Start-Process -FilePath $Path -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    } else {
        $arguments = @("/i", ("`"{0}`"" -f $Path), "/qn", "/norestart", ("TARGETDIR=`"{0}`"" -f $TargetDirectory))
        $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    }
    if ($process.ExitCode -ne 0) {
        throw "Installer exited with code $($process.ExitCode): $Path"
    }
}

function Find-ArkonadExecutable {
    $candidate = Get-ChildItem -LiteralPath $InstallDirectory -Filter "*.exe" -Recurse -File |
        Where-Object { $_.Name -notmatch "uninstall" } |
        Select-Object -First 1
    if ($null -eq $candidate) {
        throw "Arkonad executable was not found under $InstallDirectory"
    }
    return $candidate.FullName
}

function Start-ArkonadAndFindData {
    $executable = Find-ArkonadExecutable
    $process = Start-Process -FilePath $executable -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 4
    if ($process.HasExited -and $process.ExitCode -ne 0) {
        throw "Arkonad exited with code $($process.ExitCode) after installation."
    }
    if (!$process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }

    $data = @(
        (Join-Path $env:APPDATA "ai.arkonad.terminal"),
        (Join-Path $env:LOCALAPPDATA "ai.arkonad.terminal")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($null -eq $data) {
        throw "Arkonad did not create its app-data directory."
    }
    return $data
}

function Uninstall-Arkonad {
    if ($InstallerKind -eq "nsis") {
        $uninstaller = Get-ChildItem -LiteralPath $InstallDirectory -Filter "uninstall.exe" -Recurse -File | Select-Object -First 1
        if ($null -eq $uninstaller) {
            throw "NSIS uninstaller was not found under $InstallDirectory"
        }
        $process = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
    } else {
        $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/x", "`"$InstallerPath`"", "/qn", "/norestart") -Wait -PassThru -WindowStyle Hidden
    }
    if ($process.ExitCode -ne 0) {
        throw "Uninstaller exited with code $($process.ExitCode)."
    }
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if ($Scenario -eq "Upgrade") {
    if ([string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
        throw "Upgrade smoke testing requires -PreviousInstallerPath."
    }
    Invoke-Installer (Resolve-Path -LiteralPath $PreviousInstallerPath).Path $InstallerKind $InstallDirectory
    $dataDirectory = Start-ArkonadAndFindData
    Set-Content -LiteralPath (Join-Path $dataDirectory "release-smoke-sentinel.txt") -Value "preserve-me" -NoNewline
    Invoke-Installer $installer $InstallerKind $InstallDirectory
    $null = Start-ArkonadAndFindData
    if ((Get-Content -Raw -LiteralPath (Join-Path $dataDirectory "release-smoke-sentinel.txt")) -ne "preserve-me") {
        throw "Upgrade did not preserve the app-data sentinel."
    }
} elseif ($Scenario -eq "Repair") {
    Invoke-Installer $installer $InstallerKind $InstallDirectory
    $dataDirectory = Start-ArkonadAndFindData
    Set-Content -LiteralPath (Join-Path $dataDirectory "release-smoke-sentinel.txt") -Value "preserve-me" -NoNewline
    if ($InstallerKind -eq "msi") {
        $repair = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/fa", ("`"{0}`"" -f $installer), "/qn", "/norestart") -Wait -PassThru -WindowStyle Hidden
        if ($repair.ExitCode -ne 0) {
            throw "MSI repair exited with code $($repair.ExitCode)."
        }
    } else {
        Invoke-Installer $installer $InstallerKind $InstallDirectory
    }
    $null = Start-ArkonadAndFindData
    if ((Get-Content -Raw -LiteralPath (Join-Path $dataDirectory "release-smoke-sentinel.txt")) -ne "preserve-me") {
        throw "Repair did not preserve the app-data sentinel."
    }
} else {
    Invoke-Installer $installer $InstallerKind $InstallDirectory
    $dataDirectory = Start-ArkonadAndFindData
    if ($Scenario -eq "Uninstall") {
        Set-Content -LiteralPath (Join-Path $dataDirectory "release-smoke-sentinel.txt") -Value "preserve-me" -NoNewline
        Uninstall-Arkonad
        if (Test-Path -LiteralPath $InstallDirectory) {
            throw "Uninstall left the application directory in place: $InstallDirectory"
        }
        if (!(Test-Path -LiteralPath (Join-Path $dataDirectory "release-smoke-sentinel.txt"))) {
            throw "Uninstall removed app data that should remain available for recovery."
        }
    }
}

Write-Host "Windows $Scenario smoke test passed. App data remains at $dataDirectory."
