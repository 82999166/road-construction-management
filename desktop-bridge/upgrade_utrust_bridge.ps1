$sourceRoot = $PSScriptRoot
$targetRoot = "D:\manus"
$bridgeVersion = "utrust-bridge-confirm-v11"
$bridgeBuildId = "utrust-rfid-confirm-recovery-20260831-readonly-a"
$bridgeContentSha256 = "4a47e8d071bf62bcbb71052d78c93d46939fd763264d9fb11c366c7db4b0a6ca"
$writerVersion = "ntag216-atomic-v2"
$installerVersion = "utrust-upgrader-confirm-v11"
$expectedHashes = @{
  "utrust_local_bridge.ps1" = "4a47e8d071bf62bcbb71052d78c93d46939fd763264d9fb11c366c7db4b0a6ca"
  "run_utrust_rfid_write.ps1" = "1efff811e5149b7f6846848881635a5e81ed9e76c9aa741deb334d3ecbd551ac"
  "UTrustNtag216RfidWrite.cs" = "b602906ad5c982c0e2a5d6945409f77c379f16ff32996094f4b8a243ebb4bd78"
  "UTrustVehicleCardDiagnostic.cs" = "a50730677b403c71dd3c3c810d98b2186148f6f3fb6c06a033ec300b36bb3ade"
}

function Get-BridgeListenerProcessIds {
  $ids = @()
  try {
    $ids += @(Get-NetTCPConnection -LocalPort 47601 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
  } catch {}
  if ($ids.Count -eq 0) {
    try {
      $lines = @(netstat -ano -p tcp | Select-String -Pattern "127\.0\.0\.1:47601\s+.*LISTENING\s+(\d+)\s*$")
      foreach ($line in $lines) {
        if ([string]$line -match "LISTENING\s+(\d+)\s*$") { $ids += [int]$Matches[1] }
      }
    } catch {}
  }
  return @($ids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Stop-UTrustBridge {
  foreach ($processId in @(Get-BridgeListenerProcessIds)) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @("powershell.exe", "pwsh.exe") -and [string]$_.CommandLine -match "utrust_local_bridge\.ps1" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (@(Get-BridgeListenerProcessIds).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Start-UTrustBridge {
  param([string]$OutputSuffix)
  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $bridgePath = Join-Path $targetRoot "utrust_local_bridge.ps1"
  $stdoutPath = Join-Path $targetRoot ("bridge-" + $OutputSuffix + "-stdout.log")
  $stderrPath = Join-Path $targetRoot ("bridge-" + $OutputSuffix + "-stderr.log")
  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$bridgePath`""
  $process = Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  return @{ Process = $process; StdOut = $stdoutPath; StdErr = $stderrPath }
}

# 在停止任何现有桥接前，先用运行该升级器的 Windows PowerShell 解析每个新脚本。
function Test-PowerShellScriptSyntax {
  param([string]$ScriptPath)
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors -and $parseErrors.Count -gt 0) { return $false }
  return $true
}

function Test-UTrustBridgeVersion {
  param($StartedProcess)
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $StartedProcess.Process.Refresh()
      if ($StartedProcess.Process.HasExited) { return @{ Success = $false; Reason = "new_bridge_process_exited" } }
    } catch { return @{ Success = $false; Reason = "new_bridge_process_unavailable" } }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:47601/health" -TimeoutSec 3
      $health = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and [bool]$health.success) {
        if ([string]$health.bridgeVersion -eq $bridgeVersion -and [string]$health.bridgeBuildId -eq $bridgeBuildId -and [string]$health.bridgeContentSha256 -eq $bridgeContentSha256 -and [string]$health.requiredWriterVersion -eq $writerVersion) { return @{ Success = $true; Reason = "ok" } }
        return @{ Success = $false; Reason = "bridge_build_identity_mismatch" }
      }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return @{ Success = $false; Reason = "bridge_health_timeout" }
}

function Test-AnyBridgeHealth {
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:47601/health" -TimeoutSec 3
      $health = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and [bool]$health.success) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

$stage = "prepare"
$backupRoot = $null
$newBridge = $null
try {
  $stage = "verify_upgrade_files"
  if (-not (Test-Path -LiteralPath $targetRoot)) { New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null }
  foreach ($name in $expectedHashes.Keys) {
    $sourcePath = Join-Path $sourceRoot $name
    if (-not (Test-Path -LiteralPath $sourcePath)) { throw "upgrade_file_missing" }
    $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHashes[$name]) { throw "upgrade_file_checksum_mismatch" }
  }

  $stage = "verify_upgrade_script_syntax"
  if (-not (Test-PowerShellScriptSyntax (Join-Path $sourceRoot "upgrade_utrust_bridge.ps1"))) { throw "upgrade_script_parse_invalid" }
  $stage = "verify_bridge_script_syntax"
  if (-not (Test-PowerShellScriptSyntax (Join-Path $sourceRoot "utrust_local_bridge.ps1"))) { throw "bridge_script_parse_invalid" }

  $stage = "backup_previous_version"
  $backupRoot = Join-Path $targetRoot ("backup-confirm-v11-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  foreach ($name in $expectedHashes.Keys) {
    $targetPath = Join-Path $targetRoot $name
    if (Test-Path -LiteralPath $targetPath) { Copy-Item -LiteralPath $targetPath -Destination (Join-Path $backupRoot $name) -Force }
  }

  $stage = "stop_previous_bridge"
  Stop-UTrustBridge | Out-Null

  $stage = "install_fingerprint_v10_files"
  foreach ($name in $expectedHashes.Keys) {
    $sourcePath = Join-Path $sourceRoot $name
    $targetPath = Join-Path $targetRoot $name
    $tempPath = $targetPath + ".fingerprint-v10.tmp"
    Copy-Item -LiteralPath $sourcePath -Destination $tempPath -Force
    Move-Item -LiteralPath $tempPath -Destination $targetPath -Force
    $installedHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installedHash -ne $expectedHashes[$name]) { throw "installed_file_checksum_mismatch" }
  }

  $stage = "start_fingerprint_v10_bridge"
  $newBridge = Start-UTrustBridge -OutputSuffix "fingerprint-v10"
  $stage = "verify_fingerprint_v10_health"
  $healthResult = Test-UTrustBridgeVersion -StartedProcess $newBridge
  if (-not [bool]$healthResult.Success) { $stage = [string]$healthResult.Reason; throw $stage }

  @{ success = $true; installerVersion = $installerVersion; bridgeVersion = $bridgeVersion; bridgeBuildId = $bridgeBuildId; bridgeContentSha256 = $bridgeContentSha256; writerVersion = $writerVersion; backupCreated = $true; targetRoot = $targetRoot } | ConvertTo-Json -Compress
  exit 0
} catch {
  $failureStage = $stage
  Stop-UTrustBridge | Out-Null
  if ($backupRoot -and (Test-Path -LiteralPath $backupRoot)) {
    foreach ($name in $expectedHashes.Keys) {
      $backupPath = Join-Path $backupRoot $name
      if (Test-Path -LiteralPath $backupPath) { Copy-Item -LiteralPath $backupPath -Destination (Join-Path $targetRoot $name) -Force }
    }
  }
  $newBridge = Start-UTrustBridge -OutputSuffix "rollback"
  $rollbackHealthy = Test-AnyBridgeHealth
  @{ success = $false; installerVersion = $installerVersion; failureStage = $failureStage; previousVersionRestored = $rollbackHealthy; newBridgeExited = [bool]($newBridge -and $newBridge.Process.HasExited) } | ConvertTo-Json -Compress
  exit 1
}
