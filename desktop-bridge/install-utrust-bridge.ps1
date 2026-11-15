$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$bridgeVersion = "utrust-bridge-installer-v14"
$bridgeBuildId = "utrust-rfid-installer-20261115-erase-v14"
$installerVersion = "utrust-first-install-v17"
$taskName = "YuexinUTrustRfidBridge"
$defaultServerBaseUrl = "https://yx.maomaoyx.com"
$allowedOrigins = @("https://yx.maomaoyx.com", "https://roadmanage-xjifzbue.manus.space", "http://localhost:3000")

function Write-InstallResult {
  param([bool]$Success, [string]$Stage, [string]$TargetRoot, [string]$BridgeContentSha256 = "")
  @{ success = $Success; installerVersion = $installerVersion; bridgeVersion = $bridgeVersion; bridgeBuildId = $bridgeBuildId; stage = $Stage; targetRoot = $TargetRoot; bridgeContentSha256 = $BridgeContentSha256; tokenPersisted = $false } | ConvertTo-Json -Compress
}

function Write-InstallProgress {
  param([string]$Message)
  Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Message) -ForegroundColor Cyan
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-InstallTargetRoot {
  $configuredTargetRoot = [Environment]::GetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", "User")
  if (-not [string]::IsNullOrWhiteSpace($configuredTargetRoot)) { return $configuredTargetRoot }
  if (Test-Path -LiteralPath "D:\") { return "D:\manus" }
  return (Join-Path $env:ProgramData "YuexinRfidBridge")
}

function Test-PowerShellScriptSyntax {
  param([string]$ScriptPath)
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
  return (-not $parseErrors -or $parseErrors.Count -eq 0)
}

function Test-InstallerPackage {
  $requiredFiles = @(
    "Install-Yuexin-RFID-Bridge.cmd", "elevate-utrust-installer.ps1",
    "install-utrust-bridge.ps1", "upgrade_utrust_bridge.ps1", "utrust_local_bridge.ps1",
    "run_utrust_read_uid.ps1", "utrust_probe.ps1", "run_utrust_rfid_write.ps1",
    "run_utrust_read_vehicle_entry.ps1", "run_utrust_vehicle_card_diagnostic.ps1",
    "run_utrust_erase_initial.ps1", "UTrustNtag216RfidWrite.cs", "UTrustBridgeSupport.cs",
    "UTrustReadVehicleEntry.cs", "UTrustVehicleCardDiagnostic.cs", "UTrustNtag216EraseInitial.cs"
  )
  # Fail before configuration, deployment, or stopping any existing bridge.
  foreach ($name in $requiredFiles) {
    $sourcePath = Join-Path $sourceRoot $name
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw ("installer_package_file_missing:" + $name) }
    if ($name.EndsWith(".ps1") -and -not (Test-PowerShellScriptSyntax $sourcePath)) { throw ("installer_package_parse_invalid:" + $name) }
  }
  $manifestPath = Join-Path $sourceRoot "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "installer_package_manifest_missing" }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if ([string]$manifest.packageVersion -ne $installerVersion) { throw "installer_package_version_mismatch" }
  foreach ($name in $requiredFiles) {
    $entry = $manifest.files.PSObject.Properties[$name]
    if ($null -eq $entry -or [string]$entry.Value -notmatch "^[a-f0-9]{64}$") { throw ("installer_package_manifest_entry_missing:" + $name) }
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $sourceRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne [string]$entry.Value) { throw ("installer_package_checksum_mismatch:" + $name) }
  }
}

function Register-BridgeAutostart {
  param([string]$TargetRoot)
  $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $bridgePath = Join-Path $TargetRoot "utrust_local_bridge.ps1"
  $action = New-ScheduledTaskAction -Execute $powershellPath -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"" + $bridgePath + "`"")
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $userId = if ([string]::IsNullOrWhiteSpace($env:USERDOMAIN)) { $env:USERNAME } else { $env:USERDOMAIN + "\" + $env:USERNAME }
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description "Yuexin local RFID bridge" -Force | Out-Null
}

# /ready only validates service startup. It never calls the card-reader driver.
function Test-BridgeReady {
  param([string]$ExpectedContentSha256)
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:47601/ready" -TimeoutSec 2
      $ready = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and [bool]$ready.success -and [string]$ready.bridgeVersion -eq $bridgeVersion -and [string]$ready.bridgeBuildId -eq $bridgeBuildId -and [string]$ready.bridgeContentSha256 -eq $ExpectedContentSha256 -and $ready.initialEraseReady -eq $true -and [string]$ready.initialEraseVersion -eq "ntag216-initial-erase-v1") { return $true }
    } catch {}
    if ($attempt -eq 4) { Write-InstallProgress "Local bridge is still starting; waiting briefly..." }
    Start-Sleep -Seconds 1
  }
  return $false
}

$targetRoot = Get-InstallTargetRoot
$stage = "prepare"
try {
  $stage = "check_windows_environment"
  Write-InstallProgress "1/5 Checking Windows, administrator permission, and smart-card support..."
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw "powershell_5_required" }
  if (-not [Environment]::Is64BitProcess) { throw "powershell_64bit_required" }
  if (-not (Test-Path -LiteralPath (Join-Path $env:SystemRoot "System32\winscard.dll"))) { throw "winscard_not_found" }
  if (-not (Test-Administrator)) { throw "administrator_permission_required" }

  $stage = "verify_package_syntax"
  Write-InstallProgress "2/5 Checking the downloaded installation package..."
  Test-InstallerPackage

  $stage = "write_local_configuration"
  Write-InstallProgress "3/5 Creating local bridge configuration..."
  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
  [Environment]::SetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", $targetRoot, "User")
  $config = @{ schemaVersion = 1; serverBaseUrl = $defaultServerBaseUrl; allowedOrigins = $allowedOrigins; bridgeTokenStorage = "server_issued_short_lived_not_persisted"; generatedAtUtc = [DateTime]::UtcNow.ToString("o") }
  $configPath = Join-Path $targetRoot "bridge.config.json"
  [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Compress -Depth 3), (New-Object System.Text.UTF8Encoding($false)))

  $stage = "install_local_bridge"
  Write-InstallProgress "4/5 Installing and starting the local bridge..."
  $upgradeResult = @(& (Join-Path $sourceRoot "upgrade_utrust_bridge.ps1")) | Select-Object -Last 1
  if ($null -eq $upgradeResult) { throw "bridge_upgrade_result_missing" }
  $upgrade = $upgradeResult | ConvertFrom-Json
  if (-not [bool]$upgrade.success) { throw ("bridge_install_or_upgrade_failed:" + [string]$upgrade.failureStage) }

  $stage = "register_autostart"
  Write-InstallProgress "5/5 Registering automatic startup and confirming bridge readiness..."
  Register-BridgeAutostart $targetRoot
  $bridgePath = Join-Path $targetRoot "utrust_local_bridge.ps1"
  $bridgeContentSha256 = (Get-FileHash -LiteralPath $bridgePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not (Test-BridgeReady $bridgeContentSha256)) { throw "bridge_ready_validation_failed" }
  Write-Host "Installation complete. Return to Yuexin Cloud Management and use Check Local Bridge." -ForegroundColor Green
  Write-InstallResult $true "finished" $targetRoot $bridgeContentSha256
  exit 0
} catch {
  Write-Host ("Installation failed at: " + $stage) -ForegroundColor Red
  Write-InstallResult $false $stage $targetRoot
  exit 1
}
