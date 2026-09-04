$sourceRoot = $PSScriptRoot
$bridgeVersion = "utrust-bridge-installer-v12"
$bridgeBuildId = "utrust-rfid-installer-20260904-firstsetup-a"
$installerVersion = "utrust-first-install-v1"
$taskName = "YuexinUTrustRfidBridge"
$defaultServerBaseUrl = "https://yx.maomaoyx.com"
$allowedOrigins = @("https://yx.maomaoyx.com", "https://roadmanage-xjifzbue.manus.space", "http://localhost:3000")

function Write-InstallResult {
  param([bool]$Success, [string]$Stage, [string]$TargetRoot, [string]$BridgeContentSha256 = "")
  @{ success = $Success; installerVersion = $installerVersion; bridgeVersion = $bridgeVersion; bridgeBuildId = $bridgeBuildId; stage = $Stage; targetRoot = $TargetRoot; bridgeContentSha256 = $BridgeContentSha256; tokenPersisted = $false } | ConvertTo-Json -Compress
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-InstallTargetRoot {
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

function Register-BridgeAutostart {
  param([string]$TargetRoot)
  $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $bridgePath = Join-Path $TargetRoot "utrust_local_bridge.ps1"
  $action = New-ScheduledTaskAction -Execute $powershellPath -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"" + $bridgePath + "`"")
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $userId = if ([string]::IsNullOrWhiteSpace($env:USERDOMAIN)) { $env:USERNAME } else { $env:USERDOMAIN + "\" + $env:USERNAME }
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description "悦信云智管 uTrust 本机车辆卡桥接" -Force | Out-Null
}

function Test-BridgeHealth {
  param([string]$ExpectedContentSha256)
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:47601/health" -TimeoutSec 3
      $health = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and [bool]$health.success -and [string]$health.bridgeVersion -eq $bridgeVersion -and [string]$health.bridgeBuildId -eq $bridgeBuildId -and [string]$health.bridgeContentSha256 -eq $ExpectedContentSha256) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

$targetRoot = Get-InstallTargetRoot
try {
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw "powershell_5_required" }
  if (-not [Environment]::Is64BitProcess) { throw "powershell_64bit_required" }
  if (-not (Test-Path -LiteralPath (Join-Path $env:SystemRoot "System32\winscard.dll"))) { throw "winscard_not_found" }
  if (-not (Test-Administrator)) { throw "administrator_permission_required" }
  foreach ($name in @("install-utrust-bridge.ps1", "upgrade_utrust_bridge.ps1", "utrust_local_bridge.ps1", "run_utrust_read_uid.ps1", "utrust_probe.ps1", "run_utrust_rfid_write.ps1")) {
    if (-not (Test-PowerShellScriptSyntax (Join-Path $sourceRoot $name))) { throw "installer_package_parse_invalid" }
  }
  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
  [Environment]::SetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", $targetRoot, "User")
  $config = @{ schemaVersion = 1; serverBaseUrl = $defaultServerBaseUrl; allowedOrigins = $allowedOrigins; bridgeTokenStorage = "server_issued_short_lived_not_persisted"; generatedAtUtc = [DateTime]::UtcNow.ToString("o") }
  $configPath = Join-Path $targetRoot "bridge.config.json"
  [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Compress -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
  & (Join-Path $sourceRoot "upgrade_utrust_bridge.ps1")
  if ($LASTEXITCODE -ne 0) { throw "bridge_install_or_upgrade_failed" }
  Register-BridgeAutostart $targetRoot
  $bridgePath = Join-Path $targetRoot "utrust_local_bridge.ps1"
  $bridgeContentSha256 = (Get-FileHash -LiteralPath $bridgePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not (Test-BridgeHealth $bridgeContentSha256)) { throw "bridge_health_validation_failed" }
  Write-InstallResult $true "finished" $targetRoot $bridgeContentSha256
  exit 0
} catch {
  Write-InstallResult $false "install_failed" $targetRoot
  exit 1
}
