import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("本地 uTrust 正式写卡服务", () => {
  const source = readFileSync(new URL("./localRfidBridge.ts", import.meta.url), "utf8");

  it("只允许以一次性桥接令牌领取加密暂存的写卡载荷", () => {
    expect(source).toContain('"/api/local-rfid-bridge/claim"');
    expect(source).toContain("hashRfidBridgeToken(token)");
    expect(source).toContain("decryptSecret(job.payloadEncrypted)");
    expect(source).toContain("card.cardUidFingerprint !== cardUidFingerprint");
    expect(source).toContain("const payloadJson = JSON.stringify(stored.payload)");
    expect(source).toContain("payload: stored.payload, payloadJson, nfcEntryUrl: stored.nfcEntryUrl");
  });

  it("仅在 UID 与回读载荷摘要均匹配时确认任务，失败会留存审计", () => {
    expect(source).toContain('"/api/local-rfid-bridge/complete"');
    expect(source).toContain("job.payloadFingerprint !== payloadFingerprint");
    expect(source).toContain('action: "confirm_rfid_bridge_write"');
    expect(source).toContain('"/api/local-rfid-bridge/fail"');
    expect(source).toContain('action: "fail_rfid_bridge_write"');
  });
});
