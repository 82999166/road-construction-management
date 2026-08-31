$ErrorActionPreference = "Stop"
$bridgeRoot = "D:\manus"
$serverBaseUrl = "https://yx.maomaoyx.com"
$allowedOrigins = @("https://yx.maomaoyx.com", "https://roadmanage-xjifzbue.manus.space", "http://localhost:3000")
$confirmationReceiptPath = Join-Path $bridgeRoot "rfid_confirm_receipt.dpapi"

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

function Clear-PendingRfidConfirmation {
  if (Test-Path -LiteralPath $confirmationReceiptPath) { Remove-Item -LiteralPath $confirmationReceiptPath -Force -ErrorAction SilentlyContinue }
}

function Save-PendingRfidConfirmation {
  param([string]$BridgeToken, [string]$CardUidFingerprint, [string]$PayloadFingerprint, [string]$JobNo)
  $receipt = @{ bridgeToken = $BridgeToken; cardUidFingerprint = $CardUidFingerprint; payloadFingerprint = $PayloadFingerprint; jobNo = $JobNo; createdAtUtc = [DateTime]::UtcNow.ToString("o"); expiresAtUtc = [DateTime]::UtcNow.AddMinutes(4).ToString("o") }
  $json = $receipt | ConvertTo-Json -Compress -Depth 3
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [System.IO.File]::WriteAllText($confirmationReceiptPath, [Convert]::ToBase64String($protected), [System.Text.Encoding]::ASCII)
}

function Get-PendingRfidConfirmation {
  if (-not (Test-Path -LiteralPath $confirmationReceiptPath)) { return $null }
  try {
    $encoded = [System.IO.File]::ReadAllText($confirmationReceiptPath, [System.Text.Encoding]::ASCII).Trim()
    if ([string]::IsNullOrWhiteSpace($encoded)) { Clear-PendingRfidConfirmation; return $null }
    $protected = [Convert]::FromBase64String($encoded)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $receipt = ([System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
    if (-not $receipt.bridgeToken -or -not $receipt.cardUidFingerprint -or -not $receipt.payloadFingerprint -or -not $receipt.expiresAtUtc -or ([DateTime]::Parse([string]$receipt.expiresAtUtc).ToUniversalTime() -le [DateTime]::UtcNow)) { Clear-PendingRfidConfirmation; return $null }
    return $receipt
  } catch { Clear-PendingRfidConfirmation; return $null }
}

function Invoke-RfidServer {
  param([string]$Path, [string]$BridgeToken, $Body, [ValidateSet("claim", "complete", "fail")][string]$Operation = "fail")
  $headers = @{ "x-rfid-bridge-token" = $BridgeToken; "Cache-Control" = "no-store" }
  $json = $Body | ConvertTo-Json -Compress -Depth 4
  try { return Invoke-RestMethod -Method Post -Uri ($serverBaseUrl + $Path) -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 25 }
  catch {
    $statusCode = $null
    if ($_.Exception.Response) { try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {} }
    if ($Operation -eq "claim") {
      if ($statusCode -eq 400) { throw "server_vehicle_card_claim_request_invalid" }
      if ($statusCode -eq 409) { throw "server_vehicle_card_claim_card_or_payload_conflict" }
      if ($statusCode -eq 422) { throw "server_vehicle_card_claim_authorization_or_server_unavailable" }
      throw ("server_vehicle_card_claim_failed" + $(if ($null -ne $statusCode) { "_http_" + $statusCode } else { "" }))
    }
    if ($Operation -eq "complete") { throw ("server_vehicle_card_confirm_failed" + $(if ($null -ne $statusCode) { "_http_" + $statusCode } else { "" })) }
    throw "server_bridge_failure_record_failed"
  }
}

function Get-FormalWriteFailureCode {
  param([string]$Reason)
  $text = if ($null -eq $Reason) { "" } else { [string]$Reason }
  if ($text -match "ndef_exceeds_declared_card_capacity") { return "ndef_exceeds_declared_card_capacity" }
  if ($text -match "post_write_byte_mismatch") { return "post_write_byte_mismatch" }
  if ($text -match "card_write_stage_reader_connect") { return "card_reader_connection_failed" }
  if ($text -match "card_write_stage_capability_container") { return "ntag_type2_ndef_cc_not_detected" }
  if ($text -match "card_write_stage_read_user_area") { return "card_user_area_read_failed" }
  if ($text -match "card_write_stage_clear_user_area|card_write_stage_write_ndef") { return "card_user_area_write_failed" }
  if ($text -match "card_write_stage_verify_ndef") { return "post_write_byte_mismatch" }
  if ($text -match "vehicle_card_readback_fingerprint_mismatch") { return "vehicle_card_readback_fingerprint_mismatch" }
  if ($text -match "server_vehicle_card_claim_failed") { return "server_vehicle_card_claim_failed" }
  if ($text -match "server_vehicle_card_claim_request_invalid") { return "server_vehicle_card_claim_request_invalid" }
  if ($text -match "server_vehicle_card_claim_card_or_payload_conflict") { return "server_vehicle_card_claim_card_or_payload_conflict" }
  if ($text -match "server_vehicle_card_claim_authorization_or_server_unavailable") { return "server_vehicle_card_claim_authorization_or_server_unavailable" }
  if ($text -match "server_vehicle_card_confirm_failed") { return "server_vehicle_card_confirm_retryable" }
  if ($text -match "pending_vehicle_card_confirmation_not_found") { return "pending_vehicle_card_confirmation_not_found" }
  if ($text -match "vehicle_ndef_tlv_not_found|vehicle_ndef_record_not_found|vehicle_ndef_uri_record_invalid|vehicle_ndef_uri_prefix_invalid") { return "vehicle_card_ndef_entry_not_found" }
  if ($text -match "vehicle_ndef_entry_url_not_allowed|vehicle_ndef_entry_parameter_invalid") { return "vehicle_card_ndef_entry_not_allowed" }
  if ($text -match "write_page_") { return "card_user_area_write_failed" }
  if ($text -match "read_page_") { return "card_user_area_read_failed" }
  if ($text -match "ntag_type2_ndef_cc_not_detected") { return "ntag_type2_ndef_cc_not_detected" }
  if ($text -match "bridge_payload_shape_invalid") { return "bridge_payload_shape_invalid" }
  return "vehicle_card_write_or_readback_failed"
}

function Invoke-FormalVehicleWrite {
  param([string]$BridgeToken)
  Clear-PendingRfidConfirmation
  $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"
  if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "vehicle_card_not_present" }
  $fingerprint = Get-UidFingerprint $uidRead.uid
  $claim = Invoke-RfidServer "/api/local-rfid-bridge/claim" $BridgeToken @{ cardUidFingerprint = $fingerprint } "claim"
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
  if (-not $writeResult.success -or -not $writeResult.written -or -not $writeResult.verified) {
    $writeStage = if ($null -eq $writeResult.stage) { "" } else { [string]$writeResult.stage }
    if ($writeStage -match "^(prepare|reader_connect|capability_container|read_user_area|clear_user_area|write_ndef|verify_ndef)$") { throw ("card_write_stage_" + $writeStage) }
    if ($writeResult.result) { throw ([string]$writeResult.result) } else { throw "vehicle_card_write_or_readback_failed" }
  }
  if ($writeResult.payloadFingerprint -ne $claim.payloadFingerprint) { throw "vehicle_card_readback_fingerprint_mismatch" }
  # 仅在实体写入、逐字节回读和摘要比对均成功后保存当前用户可解密的短时确认收据；不保存 RC3 明文或写保护信息。
  Save-PendingRfidConfirmation $BridgeToken $fingerprint ([string]$writeResult.payloadFingerprint) ([string]$claim.jobNo)
  $completed = Invoke-RfidServer "/api/local-rfid-bridge/complete" $BridgeToken @{ cardUidFingerprint = $fingerprint; payloadFingerprint = $writeResult.payloadFingerprint } "complete"
  if (-not $completed.success) { throw "server_vehicle_card_confirm_failed" }
  Clear-PendingRfidConfirmation
  return @{ success = $true; jobNo = $claim.jobNo; status = $completed.status; cardUidFingerprint = $fingerprint }
}

function Invoke-PendingVehicleConfirmation {
  $receipt = Get-PendingRfidConfirmation
  if ($null -eq $receipt) { throw "pending_vehicle_card_confirmation_not_found" }
  $completed = Invoke-RfidServer "/api/local-rfid-bridge/complete" ([string]$receipt.bridgeToken) @{ cardUidFingerprint = [string]$receipt.cardUidFingerprint; payloadFingerprint = [string]$receipt.payloadFingerprint } "complete"
  if (-not $completed.success -or $completed.status -ne "confirmed") { throw "server_vehicle_card_confirm_failed" }
  Clear-PendingRfidConfirmation
  return @{ success = $true; jobNo = [string]$receipt.jobNo; status = "confirmed"; confirmationOnly = $true }
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
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/read-vehicle-entry") {
        try {
          $entry = Invoke-ReaderScript "run_utrust_read_vehicle_entry.ps1"
          if (-not $entry.success -or [string]::IsNullOrWhiteSpace([string]$entry.nfcEntryUrl)) { throw "vehicle_card_ndef_entry_not_found" }
          Write-BridgeJson $context @{ success = $true; nfcEntryUrl = [string]$entry.nfcEntryUrl; reader = [string]$entry.reader }
          continue
        } catch { throw (Get-FormalWriteFailureCode ([string]$_.Exception.Message)) }
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/test-write") { $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"; if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "test_card_not_present" }; $writeResult = Invoke-ReaderScript "run_utrust_authorized_overwrite.ps1"; if (-not $writeResult.written -or -not $writeResult.verified) { throw "test_write_or_verify_failed" }; $recheck = Invoke-ReaderScript "run_utrust_read_ndef.ps1"; if (-not $recheck.payloadPersisted) { throw "test_ndef_recheck_failed" }; Write-BridgeJson $context @{ success = $true; message = "test_write_verified"; cardUidFingerprint = (Get-UidFingerprint $uidRead.uid) }; continue }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/erase-initial-card") { $request = Read-BridgeBody $context; if ($request.confirmErase -ne "ERASE_NTAG216_USER_AREA") { throw "erase_confirmation_required" }; $uidRead = Invoke-ReaderScript "run_utrust_read_uid.ps1"; if (-not $uidRead.cardPresent -or -not $uidRead.uid) { throw "card_not_present" }; $eraseResult = Invoke-ReaderScript "run_utrust_erase_initial.ps1"; if (-not $eraseResult.success -or -not $eraseResult.erased -or -not $eraseResult.verified) { throw "erase_initial_card_failed" }; Write-BridgeJson $context @{ success = $true; message = "initial_card_restored"; cardUidFingerprint = (Get-UidFingerprint $uidRead.uid); initialNdef = $true; writeProtectionChanged = $false }; continue }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/write-vehicle-card") {
        $request = Read-BridgeBody $context; $bridgeToken = [string]$request.bridgeToken
        if ([string]::IsNullOrWhiteSpace($bridgeToken) -or $bridgeToken.Length -lt 32) { throw "bridge_token_required" }
        try { $result = Invoke-FormalVehicleWrite $bridgeToken; Write-BridgeJson $context $result; continue }
        catch {
          $safeReason = Get-FormalWriteFailureCode ([string]$_.Exception.Message)
          # 已经完成实体写入与回读时，确认回传的瞬时网络失败必须保留 prepared 任务和短时令牌，允许同一窗口再次确认；不得错误标记失败。
          if ($safeReason -ne "server_vehicle_card_confirm_retryable") { try { Invoke-RfidServer "/api/local-rfid-bridge/fail" $bridgeToken @{ reason = $safeReason } | Out-Null } catch {} }
          throw $safeReason
        }
      }
      if ($context.Request.HttpMethod -eq "POST" -and $path -eq "/api/confirm-vehicle-card") {
        try { $result = Invoke-PendingVehicleConfirmation; Write-BridgeJson $context $result; continue }
        catch { throw (Get-FormalWriteFailureCode ([string]$_.Exception.Message)) }
      }
      Write-BridgeJson $context @{ success = $false; message = "bridge_path_not_found" } 404
    } catch { Write-BridgeJson $context @{ success = $false; message = $_.Exception.Message } 422 }
  }
} finally { if ($listener.IsListening) { $listener.Stop() }; $listener.Close() }
