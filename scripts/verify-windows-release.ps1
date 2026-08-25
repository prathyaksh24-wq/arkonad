[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BundleRoot,
    [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $BundleRoot).Path
$artifacts = @(Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object { $_.Extension -in @(".exe", ".msi") })

if ($artifacts.Count -eq 0) {
    throw "No Windows installer artifacts were found under $root."
}

$nsis = @($artifacts | Where-Object { $_.Extension -eq ".exe" })
$msi = @($artifacts | Where-Object { $_.Extension -eq ".msi" })
if ($nsis.Count -eq 0 -or $msi.Count -eq 0) {
    throw "The release must contain both an NSIS .exe and an MSI installer."
}

foreach ($artifact in $artifacts) {
    if ($artifact.Length -le 0) {
        throw "Release artifact is empty: $($artifact.FullName)"
    }
    if ($RequireSignature) {
        $signature = Get-AuthenticodeSignature -LiteralPath $artifact.FullName
        if ($signature.Status -ne "Valid") {
            throw "Release artifact is not signed with a valid Authenticode signature: $($artifact.FullName) ($($signature.Status))"
        }
    }
}

Write-Host "Windows release contract passed: $($nsis.Count) NSIS artifact(s), $($msi.Count) MSI artifact(s)."
if ($RequireSignature) {
    Write-Host "All Windows installer artifacts have valid Authenticode signatures."
}
