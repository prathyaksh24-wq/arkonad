# Failure-path tests only: never reach PATH registration or install real software.
$ErrorActionPreference = 'Stop'
$bootstrap = Join-Path $PSScriptRoot '../install.ps1'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri/target/bootstrap-tests'))
$oldInstallDir = $env:ARKONAD_INSTALL_DIR
foreach ($scenario in @('missing-native', 'bad-checksum', 'unsigned', 'changed-version')) {
  $testRoot = Join-Path $root ([Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  $env:ARKONAD_INSTALL_DIR = $testRoot
  $sentinel = Join-Path $testRoot 'arkonad.cmd'
  [IO.File]::WriteAllText($sentinel, 'existing launcher')
  function Invoke-RestMethod {
    if ($scenario -eq 'missing-native') { return @{ tag_name='v1.0.0'; assets=@() } }
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'aarch64' } else { 'x86_64' }
    $name = "arkonad-windows-$architecture.exe"
    return @{ tag_name='v1.0.0'; assets=@(@{name=$name;browser_download_url='mock-binary'}, @{name="$name.sha256";browser_download_url='mock-checksum'}) }
  }
  function Invoke-WebRequest {
    param($Uri, $OutFile)
    if ($OutFile) { [IO.File]::WriteAllText($OutFile, 'mock binary'); return }
    $hash = if ($scenario -eq 'bad-checksum') { '0' * 64 } else {
      $bytes = [Text.Encoding]::UTF8.GetBytes('mock binary')
      $sha = [Security.Cryptography.SHA256]::Create()
      try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    }
    return @{Content="$hash  arkonad.exe"}
  }
  function Get-AuthenticodeSignature {
    param($FilePath)
    return @{Status=$(if ($scenario -eq 'changed-version') { 'Valid' } else { 'NotSigned' })}
  }
  if ($scenario -eq 'changed-version') {
    $version = Join-Path $testRoot 'releases/v1.0.0'
    New-Item -ItemType Directory -Path $version -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $version 'arkonad.exe'), 'prior binary')
  }
  try {
    $failure = $null
    try { & $bootstrap } catch { $failure = $_.Exception.Message }
    $expected = switch ($scenario) {
      'missing-native' { 'no native Windows TUI' }
      'bad-checksum' { 'checksum mismatch' }
      'unsigned' { 'valid Windows signature' }
      'changed-version' { 'different binary already exists' }
    }
    if (!$failure -or !$failure.Contains($expected)) { throw "Unexpected result for ${scenario}: $failure" }
    if ([IO.File]::ReadAllText($sentinel) -ne 'existing launcher') { throw 'Existing launcher was changed.' }
    if ($scenario -eq 'changed-version' -and [IO.File]::ReadAllText((Join-Path $version 'arkonad.exe')) -ne 'prior binary') { throw 'Prior version was changed.' }
    Write-Output "PASS $scenario"
  } finally {
    $env:ARKONAD_INSTALL_DIR = $oldInstallDir
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (!$resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
