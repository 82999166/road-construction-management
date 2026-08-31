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
    expect(source).toContain("card_write_stage_read_user_area");
    expect(source).toContain("card_write_stage_verify_ndef");
    expect(source).toContain("server_vehicle_card_confirm_retryable");
    expect(source).toContain('if ($safeReason -ne "server_vehicle_card_confirm_retryable")');
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
    expect(source).toContain('Invoke-ReaderScript "run_utrust_rfid_write.ps1" -AllowStructuredFailure');
    expect(source).toContain('if ($AllowStructuredFailure -and -not [string]::IsNullOrWhiteSpace($text))');
    expect(source).toContain('$text -split "`r?`n"');
    expect(source).toContain('Where-Object { $_.Trim().StartsWith("{") -and $_.Trim().EndsWith("}") }');
    expect(source).toContain('"server_vehicle_card_claim_card_or_payload_conflict"');
    expect(source).toContain('"server_vehicle_card_claim_authorization_or_server_unavailable"');
    expect(source).not.toContain('match "写卡授权无效');
    expect(source).toContain('"claim"');
    expect(source).toContain('"complete"');
    expect(source).toContain('"/api/read-vehicle-entry"');
    expect(source).toContain("run_utrust_read_vehicle_entry.ps1");
    expect(source).toContain("vehicle_card_ndef_entry_not_allowed");
  });

  it("C# 写卡器必须按 CC 声明容量限制用户区读写，并保留实际 NDEF 字节回读校验", () => {
    const source = readFileSync(new URL("../desktop-bridge/UTrustNtag216RfidWrite.cs", import.meta.url), "utf8");
    expect(source).toContain("int ndefCapacityBytes = cc[2] * 8");
    expect(source).toContain("int userPageCount = (ndefCapacityBytes + 3) / 4");
    expect(source).toContain("ndef_exceeds_declared_card_capacity");
    expect(source).toContain("if (!ndef.SequenceEqual(verified.ToArray()))");
    expect(source).toContain('string stage = "prepare"');
    expect(source).toContain('stage = "read_user_area"');
    expect(source).toContain('stage = "verify_ndef"');
    expect(source).toContain('"stage\\":\\"" + JsonEscape(stage)');
    expect(source).not.toContain("UserPageCount = 222");
  });
});
