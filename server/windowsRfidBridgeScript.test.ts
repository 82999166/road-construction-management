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
  });
});
