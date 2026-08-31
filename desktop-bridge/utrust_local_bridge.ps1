$ErrorActionPreference = "Stop"
$bridgeRoot = "D:\manus"
$serverBaseUrl = "https://yx.maomaoyx.com"
$allowedOrigins = @("https://yx.maomaoyx.com", "https://roadmanage-xjifzbue.manus.space", "http://localhost:3000")

function Write-BridgeJson {
  param($Context, $Payload, [int]$StatusCode = 200)
  $origin = $Context.Request.Headers["Origin"]
  if ($origin -and ($allowedOrigins -contains $origin)) {
    $Context.Response.Headers["Access-Control-Allow-Origin"] = $origin
    $Context.Response.Headers["Vary"] = "Origin"
    if ($Context.Request.Headers["Access-Control-Request-Private-Network"] -eq "true") { $Context.Response.Headers["Access-Control-Allow-Private-Network"] = "true" }
  }
  $Context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
  $Context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Access-Control-Request-Private-Network"
  $Context.Response.Headers["Cache-Control"] = "no-store, max-age=0"
  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = "application/json; charset=utf-8"
  $body = ($Payload | ConvertTo-Json -Compress -Depth 6)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Read-BridgeBody { param($Context)
  $reader = New-Object System.IO.StreamReader($Context.Request.InputStream, $Context.Request.ContentEncoding)
  $text = $reader.ReadToEnd(); $reader.Dispose()
  if ([string]::IsNullOrWhiteSpace($text)) { return @{} }
  return ($text | ConvertFrom-Json)
}

function Invoke-ReaderScript {
  param([string]$ScriptName)
  $scriptPath = Join-Path $bridgeRoot $ScriptName
  $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw ("reader_script_failed: " + ($output | Out-String)) }
  $text = ($output | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { throw "reader_script_empty_result" }
  return ($text | ConvertFrom-Json)
}

function Get-UidFingerprint {
  param([string]$Uid)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $source = [System.Text.Encoding]::UTF8.GetBytes("road-rfid-card:v1:" + $Uid.ToUpperInvariant()); return (([System.BitConverter]::ToString($sha.ComputeHash($source))) -replace "-", "").ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Invoke-RfidServer {
  param([string]$Path, [string]$BridgeToken, $Body)
  $headers = @{ "x-rfid-bridge-token" = $BridgeToken; "Cache-Control" = "no-store" }
  $json = $Body | ConvertTo-Json -Compress -Depth 4
  try { return Invoke-RestMethod -Method Post -Uri ($serverBaseUrl + $Path) -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 25 }
  catch { throw ("server_bridge_request_failed: " + $_.Exception.Message) }
}

function Invoke-FormalVehicleWrite {
  param([string]$BridgeToken)
  $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"
  if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "vehicle_card_not_present" }
  $fingerprint = Get-UidFingerprint $uidRead.uid
  $claim = Invoke-RfidServer "/api/local-rfid-bridge/claim" $BridgeToken @{ cardUidFingerprint = $fingerprint }
  if (-not $claim.success -or -not $claim.payload -or [string]::IsNullOrWhiteSpace([string]$claim.payloadJson) -or -not $claim.nfcEntryUrl) { if ($claim.message) { throw ([string]$claim.message) } else { throw "server_write_payload_not_available" } }
  # 此字符串由服务端生成，必须不经 PowerShell ConvertTo-Json 重写，确保写入、回读和任务摘要针对完全相同的 UTF-8 字节。
  $payloadJson = [string]$claim.payloadJson
  $oldPayload = $env:RC_RFID_PAYLOAD_B64; $oldUrl = $env:RC_RFID_URL_B64; $oldOverwrite = $env:RC_RFID_ALLOW_OVERWRITE
  try {
    $env:RC_RFID_PAYLOAD_B64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($payloadJson))
    $env:RC_RFID_URL_B64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$claim.nfcEntryUrl))
    $env:RC_RFID_ALLOW_OVERWRITE = "true"
    $writeResult = Invoke-ReaderScript "run_utrust_rfid_write.ps1"
  }
  finally { $env:RC_RFID_PAYLOAD_B64 = $oldPayload; $env:RC_RFID_URL_B64 = $oldUrl; $env:RC_RFID_ALLOW_OVERWRITE = $oldOverwrite }
  if (-not $writeResult.success -or -not $writeResult.written -or -not $writeResult.verified) { if ($writeResult.result) { throw ([string]$writeResult.result) } else { throw "vehicle_card_write_or_readback_failed" } }
  if ($writeResult.payloadFingerprint -ne $claim.payloadFingerprint) { throw "vehicle_card_readback_fingerprint_mismatch" }
  $completed = Invoke-RfidServer "/api/local-rfid-bridge/complete" $BridgeToken @{ cardUidFingerprint = $fingerprint; payloadFingerprint = $writeResult.payloadFingerprint }
  if (-not $completed.success) { if ($completed.message) { throw ([string]$completed.message) } else { throw "server_vehicle_card_confirm_failed" } }
  return @{ success = $true; jobNo = $claim.jobNo; status = $completed.status; cardUidFingerprint = $fingerprint }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:47601/")
$listener.Start()
Write-Output "uTrust bridge ready on 127.0.0.1:47601"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.AbsolutePath
      if ($context.Request.HttpMethod -eq "OPTIONS") { Write-BridgeJson $context @{ success = $true } 200; continue }
      if ($context.Request.HttpMethod -eq "GET" -and $path -eq "/health") { $probe = Invoke-ReaderScript "utrust_probe.ps1"; $names = @($probe.Readers | ForEach-Object { $_.FriendlyName }); Write-BridgeJson $context @{ success = $true; service = $probe.SmartCardService; readers = $names }; continue }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/read-uid") { $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"; if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "card_not_present" }; Write-BridgeJson $context @{ success = $true; cardUid = $uidRead.uid }; continue }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/test-write") { $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"; if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "test_card_not_present" }; $writeResult = Invoke-ReaderScript "run_utrust_authorized_overwrite.ps1"; if (-not $writeResult.written -or -not $writeResult.verified) { throw "test_write_or_verify_failed" }; $recheck = Invoke-ReaderScript "run_utrust_read_ndef.ps1"; if (-not $recheck.payloadPersisted) { throw "test_ndef_recheck_failed" }; Write-BridgeJson $context @{ success = $true; message = "test_write_verified"; cardUidFingerprint = (Get-UidFingerprint $uidRead.uid) }; continue }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/erase-initial-card") { $request = Read-BridgeBody $context; if ($request.confirmErase -ne "ERASE_NTAG216_USER_AREA") { throw "erase_confirmation_required" }; $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"; if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "card_not_present" }; $eraseResult = Invoke-ReaderScript "run_utrust_erase_initial.ps1"; if (-not $eraseResult.success -or -not $eraseResult.erased -or -not $eraseResult.verified) { throw "erase_initial_card_failed" }; Write-BridgeJson $context @{ success = $true; message = "initial_card_restored"; cardUidFingerprint = (Get-UidFingerprint $uidRead.uid); initialNdef = $true; writeProtectionChanged = $false }; continue }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/write-vehicle-card") {
        $request = Read-BridgeBody $context; $bridgeToken = [string]$request.bridgeToken
        if ([string]::IsNullOrWhiteSpace($bridgeToken) -or $bridgeToken.Length -lt 32) { throw "bridge_token_required" }
        try { $result = Invoke-FormalVehicleWrite $bridgeToken; Write-BridgeJson $context $result; continue }
        catch { try { Invoke-RfidServer "/api/local-rfid-bridge/fail" $bridgeToken @{ reason = $_.Exception.Message } | Out-Null } catch {}; throw }
      }
      Write-BridgeJson $context @{ success = $false; message = "bridge_path_not_found" } 404
    } catch { Write-BridgeJson $context @{ success = $false; message = $_.Exception.Message } 422 }
  }
} finally { if ($listener.IsListening) { $listener.Stop() }; $listener.Close() }
