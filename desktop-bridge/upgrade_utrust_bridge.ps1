$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$configuredTargetRoot = [Environment]::GetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", "User")
$targetRoot = if ([string]::IsNullOrWhiteSpace($configuredTargetRoot)) { if (Test-Path -LiteralPath "D:\") { "D:\manus" } else { Join-Path $env:ProgramData "YuexinRfidBridge" } } else { $configuredTargetRoot }
$bridgeVersion = "utrust-bridge-installer-v14"
$bridgeBuildId = "utrust-rfid-installer-20261115-erase-v14"
$bridgeContentSha256 = "5f53ad0ccd4637457e8155567d2033b2e8573601aacf7f7a217a71c8635fc557"
$writerVersion = "ntag216-atomic-v2"
$installerVersion = "utrust-upgrader-installer-v14"
$expectedHashes = @{
  "utrust_local_bridge.ps1" = "5f53ad0ccd4637457e8155567d2033b2e8573601aacf7f7a217a71c8635fc557"
  "run_utrust_rfid_write.ps1" = "1efff811e5149b7f6846848881635a5e81ed9e76c9aa741deb334d3ecbd551ac"
  "UTrustNtag216RfidWrite.cs" = "b602906ad5c982c0e2a5d6945409f77c379f16ff32996094f4b8a243ebb4bd78"
  "UTrustVehicleCardDiagnostic.cs" = "a50730677b403c71dd3c3c810d98b2186148f6f3fb6c06a033ec300b36bb3ade"
  "run_utrust_vehicle_card_diagnostic.ps1" = "09628a067d33c373d4d0b0eec634db5ab0b3ae541e26bd3b099e765281470d3e"
  "UTrustReadVehicleEntry.cs" = "a784630441f2a087b20b0596ce584a38015736765b759d936917bad3473c944d"
  "run_utrust_read_vehicle_entry.ps1" = "8c94c05f8c507125181b057cbe5ce8ebd44c1a3f7475253960597db1508428c4"
  "UTrustBridgeSupport.cs" = "1d43f62684fd277fd42a0d958762245bff023dee98078a3063eed0850c724e81"
  "run_utrust_read_uid.ps1" = "29e767ceaad276426d377435f610c19e4405b347ce7f10c5dc481d6f8763cd8f"
  "utrust_probe.ps1" = "8c4be3cf2fb03a3c083e530777e5dd3fa38a1b27da46446ca87e991d3266e64d"
  "run_utrust_erase_initial.ps1" = "67d7867b275d73313b5c0ac91de6cd266533c0c3cba8d86afc6de5cb3ddb9e77"
  "UTrustNtag216EraseInitial.cs" = "0444be9cf6eea412d8b3d0d7be240cc8c9c98582b018ecc87eff1d8543a74f01"
}

function Write-UpgradeProgress {
  param([string]$Message)
  Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Message) -ForegroundColor Cyan
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

function Test-PowerShellScriptSyntax {
  param([string]$ScriptPath)
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
  return (-not $parseErrors -or $parseErrors.Count -eq 0)
}

# /ready deliberately verifies bridge startup and build identity without opening the reader driver.
# Reader discovery stays on /health and is checked from the management page after installation.
function Test-UTrustBridgeReady {
  param($StartedProcess)
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      $StartedProcess.Process.Refresh()
      if ($StartedProcess.Process.HasExited) { return @{ Success = $false; Reason = "new_bridge_process_exited" } }
    } catch { return @{ Success = $false; Reason = "new_bridge_process_unavailable" } }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:47601/ready" -TimeoutSec 2
      $ready = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and [bool]$ready.success) {
        if ($ready.initialEraseReady -ne $true -or [string]$ready.initialEraseVersion -ne "ntag216-initial-erase-v1") { return @{ Success = $false; Reason = "bridge_erase_dependencies_not_ready" } }
        if ([string]$ready.bridgeVersion -eq $bridgeVersion -and [string]$ready.bridgeBuildId -eq $bridgeBuildId -and [string]$ready.bridgeContentSha256 -eq $bridgeContentSha256 -and [string]$ready.requiredWriterVersion -eq $writerVersion) { return @{ Success = $true; Reason = "ok" } }
        return @{ Success = $false; Reason = "bridge_build_identity_mismatch" }
      }
    } catch {}
    if ($attempt -eq 4 -or $attempt -eq 9 -or $attempt -eq 14) { Write-UpgradeProgress "Bridge is still starting; waiting briefly..." }
    Start-Sleep -Seconds 1
  }
  return @{ Success = $false; Reason = "bridge_ready_timeout" }
}

function Test-AnyBridgeListener {
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (@(Get-BridgeListenerProcessIds).Count -gt 0) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

$stage = "prepare"
$backupRoot = $null
$newBridge = $null
$bridgeStopped = $false
$deploymentStarted = $false
$previousFiles = @{}
try {
  $stage = "verify_upgrade_files"
  Write-UpgradeProgress "1/5 Verifying bridge files..."
  foreach ($name in $expectedHashes.Keys) {
    $sourcePath = Join-Path $sourceRoot $name
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw ("upgrade_file_missing:" + $name) }
    $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHashes[$name]) { throw "upgrade_file_checksum_mismatch" }
  }

  $stage = "verify_upgrade_script_syntax"
  Write-UpgradeProgress "2/5 Checking PowerShell script syntax..."
  if (-not (Test-PowerShellScriptSyntax (Join-Path $sourceRoot "upgrade_utrust_bridge.ps1"))) { throw "upgrade_script_parse_invalid" }
  $stage = "verify_bridge_script_syntax"
  if (-not (Test-PowerShellScriptSyntax (Join-Path $sourceRoot "utrust_local_bridge.ps1"))) { throw "bridge_script_parse_invalid" }
  foreach ($name in $expectedHashes.Keys) {
    if ($name.EndsWith(".ps1") -and -not (Test-PowerShellScriptSyntax (Join-Path $sourceRoot $name))) { throw ("upgrade_script_parse_invalid:" + $name) }
  }

  $stage = "backup_previous_version"
  Write-UpgradeProgress "3/5 Backing up the existing bridge..."
  if (-not (Test-Path -LiteralPath $targetRoot)) { New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null }
  $backupRoot = Join-Path $targetRoot ("backup-installer-v14-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  foreach ($name in $expectedHashes.Keys) {
    $targetPath = Join-Path $targetRoot $name
    $previousFiles[$name] = Test-Path -LiteralPath $targetPath -PathType Leaf
    if ($previousFiles[$name]) { Copy-Item -LiteralPath $targetPath -Destination (Join-Path $backupRoot $name) -Force }
  }

  $stage = "stop_previous_bridge"
  Write-UpgradeProgress "4/5 Restarting the local bridge..."
  if (-not (Stop-UTrustBridge)) { throw "previous_bridge_stop_failed" }
  $bridgeStopped = $true

  $stage = "install_verified_bridge_files"
  $deploymentStarted = $true
  foreach ($name in $expectedHashes.Keys) {
    $sourcePath = Join-Path $sourceRoot $name
    $targetPath = Join-Path $targetRoot $name
    $tempPath = $targetPath + ".erase-v14.tmp"
    Copy-Item -LiteralPath $sourcePath -Destination $tempPath -Force
    Move-Item -LiteralPath $tempPath -Destination $targetPath -Force
    $installedHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installedHash -ne $expectedHashes[$name]) { throw "installed_file_checksum_mismatch" }
  }

  $stage = "start_erase_v14_bridge"
  Write-UpgradeProgress "5/5 Starting and verifying the local bridge..."
  [Environment]::SetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", $targetRoot, "User")
  $newBridge = Start-UTrustBridge -OutputSuffix "erase-v14"
  $stage = "verify_erase_v14_ready"
  $readyResult = Test-UTrustBridgeReady -StartedProcess $newBridge
  if (-not [bool]$readyResult.Success) { $stage = [string]$readyResult.Reason; throw $stage }

  @{ success = $true; installerVersion = $installerVersion; bridgeVersion = $bridgeVersion; bridgeBuildId = $bridgeBuildId; bridgeContentSha256 = $bridgeContentSha256; writerVersion = $writerVersion; backupCreated = $true; targetRoot = $targetRoot } | ConvertTo-Json -Compress
  return
} catch {
  $failureStage = $stage
  Write-Host ("Bridge upgrade failed at: " + $failureStage) -ForegroundColor Red
  $rollbackHealthy = $false
  # Preflight errors must not stop or replace a working bridge.
  if ($bridgeStopped -or $deploymentStarted) {
    try {
      if (-not (Stop-UTrustBridge)) { throw "rollback_bridge_stop_failed" }
      if ($deploymentStarted -and $backupRoot -and (Test-Path -LiteralPath $backupRoot)) {
        foreach ($name in $expectedHashes.Keys) {
          $targetPath = Join-Path $targetRoot $name
          $backupPath = Join-Path $backupRoot $name
          Remove-Item -LiteralPath ($targetPath + ".erase-v14.tmp") -Force -ErrorAction SilentlyContinue
          if ($previousFiles[$name]) { Copy-Item -LiteralPath $backupPath -Destination $targetPath -Force }
          else { Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue }
        }
      }
      if (Test-Path -LiteralPath (Join-Path $targetRoot "utrust_local_bridge.ps1") -PathType Leaf) {
        $newBridge = Start-UTrustBridge -OutputSuffix "rollback"
        $rollbackHealthy = Test-AnyBridgeListener
      }
    } catch {
      Write-Host "Previous bridge could not be restored automatically." -ForegroundColor Red
    }
  } else {
    $rollbackHealthy = (@(Get-BridgeListenerProcessIds).Count -gt 0)
  }
  @{ success = $false; installerVersion = $installerVersion; failureStage = $failureStage; previousVersionRestored = $rollbackHealthy; newBridgeExited = [bool]($newBridge -and $newBridge.Process.HasExited) } | ConvertTo-Json -Compress
  throw ("bridge_upgrade_failed:" + $failureStage)
}
