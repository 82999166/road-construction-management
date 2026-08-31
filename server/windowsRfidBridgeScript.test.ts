import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Windows uTrust 正式写卡桥接脚本", () => {
  it("必须使用服务端下发的规范 JSON 原文，避免 PowerShell 重序列化导致回读摘要误判", () => {
    const source = readFileSync(new URL("../desktop-bridge/utrust_local_bridge.ps1", import.meta.url), "utf8");
    expect(source).toContain("claim.payloadJson");
    expect(source).toContain("$payloadJson = [string]$claim.payloadJson");
    expect(source).toContain("UTF8.GetBytes($payloadJson)");
    expect(source).not.toContain("UTF8.GetBytes(($claim.payload | ConvertTo-Json");
  });

  it("正式写卡仍须执行 UID 校验、NDEF 回读、摘要比对和服务端确认，且不改变写保护设置", () => {
    const source = readFileSync(new URL("../desktop-bridge/utrust_local_bridge.ps1", import.meta.url), "utf8");
    expect(source).toContain('Invoke-RfidServer "/api/local-rfid-bridge/claim"');
    expect(source).toContain('Invoke-ReaderScript "run_utrust_rfid_write.ps1"');
    expect(source).toContain("vehicle_card_readback_fingerprint_mismatch");
    expect(source).toContain('Invoke-RfidServer "/api/local-rfid-bridge/complete"');
    expect(source).toContain('$env:RC_RFID_ALLOW_OVERWRITE = "true"');
    expect(source).toContain("function Get-FormalWriteFailureCode");
    expect(source).toContain("card_user_area_read_failed");
    expect(source).toContain("vehicle_card_readback_fingerprint_mismatch");
    expect(source).toContain('$text = if ($null -eq $Reason) { "" } else { [string]$Reason }');
    expect(source).not.toContain("$Reason ??");
    expect(source).toContain("card_write_stage_prepare");
    expect(source).toContain("card_write_prepare_failed");
    expect(source).toContain("card_writer_load_failed");
    expect(source).toContain("card_write_stage_read_user_area");
    expect(source).toContain("card_write_stage_verify_ndef");
    expect(source).toContain("server_vehicle_card_confirm_retryable");
    expect(source).toContain('if ($safeReason -ne "server_vehicle_card_confirm_retryable")');
    expect(source).toContain("failureRecorded = [bool]$failed.success");
    expect(source).toContain("server_bridge_failure_record_failed");
    expect(source).toContain("rfid_confirm_receipt.dpapi");
    expect(source).toContain("DataProtectionScope]::CurrentUser");
    expect(source).toContain('"/api/confirm-vehicle-card"');
    expect(source).toContain("Invoke-PendingVehicleConfirmation");
    expect(source).toContain('"server_vehicle_card_claim_failed"');
    expect(source).toContain('"server_vehicle_card_claim_request_invalid"');
    expect(source).toContain('"server_vehicle_card_claim_token_invalid"');
    expect(source).toContain('"server_vehicle_card_claim_uid_invalid"');
    expect(source).toContain('"application/json; charset=utf-8"');
    expect(source).toContain("Invoke-WebRequest -UseBasicParsing");
    expect(source).toContain("$_.ErrorDetails");
    expect(source).toContain("[switch]$AllowStructuredFailure");
    expect(source).toContain("[switch]$RequireSuccessProperty");
    expect(source).toContain('Invoke-ReaderScript "run_utrust_rfid_write.ps1" -AllowStructuredFailure -RequireSuccessProperty');
    expect(source).toContain('$bridgeVersion = "utrust-bridge-stage-v4"');
    expect(source).toContain('$requiredWriterVersion = "ntag216-atomic-v2"');
    expect(source).toContain('if ([string]$writeResult.writerVersion -ne $requiredWriterVersion)');
    expect(source).toContain('bridgeVersion = $bridgeVersion');
    expect(source).toContain("function Get-StructuredReaderResult");
    expect(source).toContain('$start = $line.IndexOf("{")');
    expect(source).toContain('$end = $line.LastIndexOf("}")');
    expect(source).toContain('if ($AllowStructuredFailure -and $null -ne $structuredResult -and -not [bool]$structuredResult.success)');
    expect(source).toContain('throw "reader_script_no_structured_result"');
    expect(source).toContain('$lines = @($Text -split "`r?`n")');
    expect(source).toContain('"card_writer_no_diagnostic_result"');
    expect(source).toContain('"server_vehicle_card_claim_card_or_payload_conflict"');
    expect(source).toContain('"server_vehicle_card_claim_authorization_or_server_unavailable"');
    expect(source).not.toContain('match "写卡授权无效');
    expect(source).toContain('"claim"');
    expect(source).toContain('"complete"');
    expect(source).toContain('"/api/read-vehicle-entry"');
    expect(source).toContain("run_utrust_read_vehicle_entry.ps1");
    expect(source).toContain("vehicle_card_ndef_entry_not_allowed");
    expect(source).toContain("function Get-FormalWriteStageFailureCode");
    expect(source).toContain('$script:formalWriteStage = "read_uid"');
    expect(source).toContain('$script:formalWriteStage = "claim"');
    expect(source).toContain('$script:formalWriteStage = "invoke_writer"');
    expect(source).toContain('$script:formalWriteStage = "validate_writer_result"');
    expect(source).toContain('"/api/last-write-failure"');
    expect(source).toContain("lastFormalWriteFailure");
  });

  it("C# 写卡器必须按 CC 声明容量限制用户区读写，并保留实际 NDEF 字节回读校验", () => {
    const source = readFileSync(new URL("../desktop-bridge/UTrustNtag216RfidWrite.cs", import.meta.url), "utf8");
    expect(source).toContain("int ndefCapacityBytes = cc[2] * 8");
    expect(source).toContain("int userPageCount = (ndefCapacityBytes + 3) / 4");
    expect(source).toContain("ndef_exceeds_declared_card_capacity");
    expect(source).toContain("if (!ndef.SequenceEqual(verified.ToArray()))");
    expect(source).toContain('WriterVersion = "ntag216-atomic-v2"');
    expect(source).toContain('stage = "invalidate_ndef"');
    expect(source).toContain('stage = "write_ndef_body"');
    expect(source).toContain('stage = "verify_ndef_body"');
    expect(source).toContain('stage = "commit_ndef_length"');
    expect(source).toContain('WritePage(card, ref request, FirstUserPage, new byte[] { 0x00, 0x00, 0x00, 0x00 })');
    expect(source).toContain('for (int index = 1; index < pageCount; index++)');
    expect(source).toContain('WritePage(card, ref request, FirstUserPage, GetPage(ndef, 0))');
    expect(source).toContain('"committed\\":true');
    expect(source).not.toContain('for (int index = 0; index < userPageCount; index++) WritePage');
    expect(source).toContain('string stage = "prepare"');
    expect(source).toContain('stage = "read_user_area"');
    expect(source).toContain('stage = "verify_ndef"');
    expect(source).toContain('"stage\\":\\"" + JsonEscape(stage)');
    expect(source).not.toContain("UserPageCount = 222");
  });

  it("正式写卡 PowerShell 包装器必须保留 C# 的结构化控制台输出并传递 Main 返回码", () => {
    const source = readFileSync(new URL("../desktop-bridge/run_utrust_rfid_write.ps1", import.meta.url), "utf8");
    expect(source).toContain('Join-Path $PSScriptRoot "UTrustNtag216RfidWrite.cs"');
    expect(source).toContain("[int][UTrustNtag216RfidWrite]::Main()");
    expect(source).toContain("exit $exitCode");
    expect(source).toContain('$wrapperVersion = "utrust-writer-wrapper-diagnostic-v3"');
    expect(source).toContain('"writer_load_failed"');
    expect(source).toContain("ConvertTo-Json -Compress");
    expect(source).not.toContain("[void][UTrustNtag216RfidWrite]::Main()");
  });

  it("只读车辆卡诊断必须报告 TLV 边界和锁定配置摘要且绝不发送写入指令", () => {
    const source = readFileSync(new URL("../desktop-bridge/UTrustVehicleCardDiagnostic.cs", import.meta.url), "utf8");
    expect(source).toContain("InspectTlv");
    expect(source).toContain('TryReadPage(card, ref request, 0xE2');
    expect(source).toContain('TryReadPage(card, ref request, 0xE3');
    expect(source).toContain('TryReadPage(card, ref request, 0xE4');
    expect(source).toContain('staticPage.Skip(2).Take(2)');
    expect(source).toContain('dynamicLockPage.Take(3)');
    expect(source).toContain('config0Page[3]');
    expect(source).toContain('(config1Page[0] & 0x80)');
    expect(source).toContain('"tlvDeclaredLength\\":"');
    expect(source).toContain('"firstAllZeroUserPage\\":"');
    expect(source).toContain('"writeOperation\\":false');
    expect(source).not.toContain("0xD6");
    expect(source).not.toContain("WritePage(");
  });

  it("Windows 一致版本升级器必须校验核心文件、备份旧版、验证 v4 健康并在失败时回滚", () => {
    const source = readFileSync(new URL("../desktop-bridge/upgrade_utrust_bridge.ps1", import.meta.url), "utf8");
    expect(source).toContain('$installerVersion = "utrust-upgrader-stage-v4"');
    expect(source).toContain('$bridgeVersion = "utrust-bridge-stage-v4"');
    expect(source).toContain('$writerVersion = "ntag216-atomic-v2"');
    expect(source).toContain("Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256");
    expect(source).toContain("backup-stage-v4-");
    expect(source).toContain("Test-UTrustBridgeVersion");
    expect(source).toContain("previousVersionRestored = $rollbackHealthy");
  });
});
