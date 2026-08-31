import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("本地 uTrust 正式写卡服务", () => {
  const source = readFileSync(new URL("./localRfidBridge.ts", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

  it("在本地桥接路由前注册受限 JSON 解析，避免领取写卡载荷时请求体为空", () => {
    expect(serverSource).toContain('app.use("/api/local-rfid-bridge", standardJsonParser)');
    expect(serverSource.indexOf('app.use("/api/local-rfid-bridge", standardJsonParser)')).toBeLessThan(serverSource.indexOf("registerLocalRfidBridgeRoutes(app)"));
  });

  it("只允许以一次性桥接令牌领取加密暂存的写卡载荷", () => {
    expect(source).toContain('"/api/local-rfid-bridge/claim"');
    expect(source).toContain("hashRfidBridgeToken(token)");
    expect(source).toContain("decryptSecret(job.payloadEncrypted)");
    expect(source).toContain("card.cardUidFingerprint !== cardUidFingerprint");
    expect(source).toContain('typeof stored.payloadJson === "string" ? stored.payloadJson');
    expect(source).toContain("createTransportNfcCardPayloadContract(payload)");
    expect(source).toContain("payloadContract.payloadJson !== payloadJson");
    expect(source).toContain("payloadContract.payloadFingerprint !== job.payloadFingerprint");
    expect(source).toContain("payloadUtf8ByteLength");
    expect(source).toContain("payload, payloadJson, nfcEntryUrl: stored.nfcEntryUrl");
    expect(source).toContain('code: "bridge_token_invalid"');
    expect(source).toContain('code: "card_uid_fingerprint_invalid"');
    expect(source).toContain("isCardStateAllowedForJob(card, job.action)");
    expect(source).toContain('action === "issue"');
    expect(source).toContain('card.status === "suspended" || card.status === "active"');
  });

  it("仅在 UID 与回读载荷摘要均匹配时确认任务，失败会留存审计", () => {
    expect(source).toContain('"/api/local-rfid-bridge/complete"');
    expect(source).toContain("job.payloadFingerprint !== payloadFingerprint");
    expect(source).toContain('isConfirmationRecovery ? "confirm_rfid_bridge_readback_recovery" : "confirm_rfid_bridge_write"');
    expect(source).toContain('job.failureReason === "confirmation_recovery_prepared"');
    expect(source).toContain('req.body?.confirmationMode !== "verify_existing_ndef"');
    expect(source).toContain("req.body?.wroteCard !== false");
    expect(source).toContain("req.body?.readbackVerified !== true");
    expect(source).toContain("failureReason: null");
    expect(source).toContain("未再次写卡并完成确认");
    expect(source).toContain('"/api/local-rfid-bridge/fail"');
    expect(source).toContain('action: "fail_rfid_bridge_write"');
  });

  it("确认回传在未过期短时令牌内支持幂等重试，不重复变更状态或重复写入审计", () => {
    const completeSource = source.slice(source.indexOf('app.post("/api/local-rfid-bridge/complete"'), source.indexOf('app.post("/api/local-rfid-bridge/fail"'));
    expect(source).toContain('const { db, job } = await findBridgeJob(token, true)');
    expect(completeSource).toContain('if (job.status === "confirmed") return res.json({ success: true, jobNo: job.jobNo, status: "confirmed", replayed: true })');
    expect(source).toContain('gt(rfidCardWriteJobs.bridgeTokenExpiresAt, new Date())');
    expect(completeSource).not.toContain('bridgeTokenHash: null, bridgeTokenExpiresAt: null');
  });

  it("完成确认以 prepared 条件更新和事务保护卡片启用，竞争失败时不继续更新卡与审计", () => {
    const completeSource = source.slice(source.indexOf('app.post("/api/local-rfid-bridge/complete"'), source.indexOf('app.post("/api/local-rfid-bridge/fail"'));
    expect(completeSource).toContain("const outcome = await db.transaction(async tx =>");
    expect(completeSource).toContain('eq(rfidCardWriteJobs.status, "prepared")');
    expect(completeSource).toContain("if (!didConditionalWriteApply(jobWrite))");
    expect(completeSource.indexOf("if (!didConditionalWriteApply(jobWrite))")).toBeLessThan(completeSource.indexOf("const cardWrite = await tx.update(transportVehicleRfidCards)"));
    expect(completeSource).toContain("if (!didConditionalWriteApply(cardWrite)) throw new Error");
    expect(completeSource).toContain("isNull(transportVehicleRfidCards.lastWrittenAt)");
    expect(completeSource).toContain("isNotNull(transportVehicleRfidCards.lastWrittenAt)");
  });
});
