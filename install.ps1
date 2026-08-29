$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repository = "prathyaksh24-wq/arkonad"
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers @{ "User-Agent" = "arkonad-bootstrap" }
if ($release.tag_name -notmatch '^v[0-9][A-Za-z0-9._-]*$') { throw "The release tag is not a safe version name." }
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'aarch64' } else { 'x86_64' }
$artifactName = "arkonad-windows-$architecture.exe"
$asset = $release.assets | Where-Object name -EQ $artifactName | Select-Object -First 1
$checksum = $release.assets | Where-Object name -EQ "$artifactName.sha256" | Select-Object -First 1
if ($null -eq $asset -or $null -eq $checksum) { throw "This release has no native Windows TUI and checksum. No desktop installer will be substituted." }
$binDirectory = if ($env:ARKONAD_INSTALL_DIR) { $env:ARKONAD_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Arkonad\bin" }
if (-not [IO.Path]::IsPathRooted($binDirectory)) { throw "ARKONAD_INSTALL_DIR must be absolute." }
$binDirectory = [IO.Path]::GetFullPath($binDirectory)
$temporaryRoot = Join-Path $binDirectory (".download-" + [Guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  $download = Join-Path $temporaryRoot $artifactName
  Write-Host "Downloading the Arkonad terminal executable..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $download
  $expected = ((Invoke-WebRequest -Uri $checksum.browser_download_url).Content.Trim() -split '\s+')[0]
  if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid release checksum." }
  if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ine $expected) { throw "Arkonad checksum mismatch." }
  if ((Get-AuthenticodeSignature -FilePath $download).Status -ne "Valid") { throw "The Arkonad executable does not have a valid Windows signature." }
  $versionDirectory = Join-Path $binDirectory "releases\$($release.tag_name)"
  New-Item -ItemType Directory -Path $versionDirectory -Force | Out-Null
  $executable = Join-Path $versionDirectory "arkonad.exe"
  if (Test-Path -LiteralPath $executable) {
    if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ine $expected) { throw "A different binary already exists for this version; it was left unchanged." }
  } else { Copy-Item -LiteralPath $download -Destination $executable }
  # Invoke synchronously in the caller's terminal.
  $wrapper = '@echo off' + [Environment]::NewLine + ('"%~dp0releases\{0}\arkonad.exe" %*' -f $release.tag_name) + [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $binDirectory "arkonad.cmd"), $wrapper)
  [IO.File]::WriteAllText((Join-Path $binDirectory "arkond.cmd"), $wrapper)
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $binDirectory.TrimEnd('\') })
  [Environment]::SetEnvironmentVariable("Path", (@($binDirectory) + $parts -join ';'), "User")
  $env:Path = "$binDirectory;$env:Path"
  Write-Host "Installed $($release.tag_name). Type arkonad (or arkond) in your terminal."
  Write-Host "Previous versions and app data were kept. CMD users: open a new terminal to refresh PATH."
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temporaryRoot)
  $expectedPrefix = $binDirectory.TrimEnd('\') + '\.download-'
  if ($resolvedTemp.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
