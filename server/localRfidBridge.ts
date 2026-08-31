import type { Express } from "express";
import { and, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { auditLogs, rfidCardWriteJobs, rfidWriterDevices, transportVehicleRfidCards } from "../drizzle/schema";
import { getDb } from "./db";
import { decryptSecret } from "./services/secretVault";
import { hashRfidBridgeToken } from "./services/rfidBridge";

type StoredWritePayload = { payload: Record<string, unknown>; nfcEntryUrl: string };

function didConditionalWriteApply(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  return !(header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0);
}

function isCardStateAllowedForJob(card: { status: string; lastWrittenAt: Date | null }, action: string) {
  if (action === "issue") return !card.lastWrittenAt && (card.status === "suspended" || card.status === "active");
  if (action === "rewrite") return card.status === "active" && Boolean(card.lastWrittenAt);
  return action === "revoke" && card.status !== "revoked";
}

function getBridgeToken(req: Parameters<Express["post"]>[1] extends never ? never : any) {
  const raw = req.header("x-rfid-bridge-token");
  return typeof raw === "string" && raw.length >= 32 && raw.length <= 256 ? raw : null;
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

async function findBridgeJob(token: string, includeConfirmed = false) {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用");
  const statusCondition = includeConfirmed
    ? or(eq(rfidCardWriteJobs.status, "prepared"), eq(rfidCardWriteJobs.status, "confirmed"))
    : eq(rfidCardWriteJobs.status, "prepared");
  const [job] = await db.select().from(rfidCardWriteJobs).where(and(
    eq(rfidCardWriteJobs.bridgeTokenHash, hashRfidBridgeToken(token)),
    eq(rfidCardWriteJobs.executionMode, "pc_bridge"),
    statusCondition,
    gt(rfidCardWriteJobs.bridgeTokenExpiresAt, new Date()),
  )).limit(1);
  if (!job) throw new Error("写卡授权无效、已过期或已处理，请回到管理端重新生成任务");
  return { db, job };
}

function noStore(res: any) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

/**
 * 本机桥接只凭一次性令牌向服务器领取与当前 UID 匹配的加密载荷。
 * 浏览器不直接把 RC3 正文、签名密钥或写保护口令交给环回桥接。
 */
export function registerLocalRfidBridgeRoutes(app: Express) {
  app.post("/api/local-rfid-bridge/claim", async (req, res) => {
    noStore(res);
    try {
      const token = getBridgeToken(req);
      const cardUidFingerprint = req.body?.cardUidFingerprint;
      if (!token) return res.status(400).json({ success: false, code: "bridge_token_invalid", message: "本地桥接授权格式无效" });
      if (!isFingerprint(cardUidFingerprint)) return res.status(400).json({ success: false, code: "card_uid_fingerprint_invalid", message: "卡 UID 指纹格式无效" });
      const { db, job } = await findBridgeJob(token);
      const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, job.cardId)).limit(1);
      if (!card || !card.vehicleId || !isCardStateAllowedForJob(card, job.action) || card.cardUidFingerprint !== cardUidFingerprint) return res.status(409).json({ success: false, message: "当前感应卡与写卡任务绑定或状态不一致，已拒绝写入" });
      if (!job.payloadEncrypted) return res.status(409).json({ success: false, message: "该写卡任务不含受控载荷，请重新生成 PC 写卡任务" });
      const stored = JSON.parse(decryptSecret(job.payloadEncrypted)) as StoredWritePayload;
      if (!stored.nfcEntryUrl || !stored.payload || typeof stored.payload !== "object") throw new Error("受控写卡载荷格式无效");
      // PC 桥接必须原样写入此规范 JSON，再按完全相同 UTF-8 字节计算回读摘要；禁止由 PowerShell 重新序列化后改变字段顺序或 Unicode 转义方式。
      const payloadJson = JSON.stringify(stored.payload);
      const payloadUtf8ByteLength = Buffer.byteLength(payloadJson, "utf8");
      return res.json({ success: true, jobNo: job.jobNo, payload: stored.payload, payloadJson, nfcEntryUrl: stored.nfcEntryUrl, payloadFingerprint: job.payloadFingerprint, payloadUtf8ByteLength });
    } catch (error) {
      return res.status(422).json({ success: false, message: error instanceof Error ? error.message : "本地桥接领取写卡载荷失败" });
    }
  });

  app.post("/api/local-rfid-bridge/complete", async (req, res) => {
    noStore(res);
    try {
      const token = getBridgeToken(req);
      const cardUidFingerprint = req.body?.cardUidFingerprint;
      const payloadFingerprint = req.body?.payloadFingerprint;
      if (!token || !isFingerprint(cardUidFingerprint) || !isFingerprint(payloadFingerprint)) return res.status(400).json({ success: false, code: "bridge_complete_request_invalid", message: "本地桥接完成参数格式无效" });
      const { db, job } = await findBridgeJob(token, true);
      if (job.payloadFingerprint !== payloadFingerprint) return res.status(409).json({ success: false, message: "回读载荷摘要与写卡任务不一致，已拒绝确认" });
      const [card] = await db.select().from(transportVehicleRfidCards).where(eq(transportVehicleRfidCards.id, job.cardId)).limit(1);
      if (!card || card.cardUidFingerprint !== cardUidFingerprint) return res.status(409).json({ success: false, message: "当前感应卡与写卡任务绑定不一致，已拒绝确认" });
      // 网络在服务端已确认后中断时，桥接会携带同一短时令牌再次确认；已确认任务只返回原结果，禁止重复审计或重复变更卡状态。
      if (job.status === "confirmed") return res.json({ success: true, jobNo: job.jobNo, status: "confirmed", replayed: true });
      const now = new Date();
      const outcome = await db.transaction(async tx => {
        // 令牌哈希只保留到既定过期时间，作为短时幂等确认收据；仍不可用于领取已确认任务。
        const jobWrite = await tx.update(rfidCardWriteJobs).set({ status: "confirmed", confirmedBy: job.preparedBy, confirmedAt: now }).where(and(eq(rfidCardWriteJobs.id, job.id), eq(rfidCardWriteJobs.status, "prepared")));
        if (!didConditionalWriteApply(jobWrite)) {
          const [latestJob] = await tx.select({ status: rfidCardWriteJobs.status }).from(rfidCardWriteJobs).where(eq(rfidCardWriteJobs.id, job.id)).limit(1);
          if (latestJob?.status === "confirmed") return "replayed" as const;
          throw new Error("写卡任务状态已经变化，未执行重复确认");
        }
        const cardStateCondition = job.action === "issue"
          ? and(eq(transportVehicleRfidCards.id, job.cardId), isNull(transportVehicleRfidCards.lastWrittenAt), inArray(transportVehicleRfidCards.status, ["suspended", "active"]))
          : job.action === "rewrite"
            ? and(eq(transportVehicleRfidCards.id, job.cardId), eq(transportVehicleRfidCards.status, "active"), isNotNull(transportVehicleRfidCards.lastWrittenAt))
            : and(eq(transportVehicleRfidCards.id, job.cardId), ne(transportVehicleRfidCards.status, "revoked"));
        const cardWrite = await tx.update(transportVehicleRfidCards).set({ lastWrittenAt: now, status: job.action === "revoke" ? "revoked" : "active", revokedAt: job.action === "revoke" ? now : null }).where(cardStateCondition);
        if (!didConditionalWriteApply(cardWrite)) throw new Error("车辆卡状态已经变化，未执行启用确认");
        if (job.writerDeviceId) await tx.update(rfidWriterDevices).set({ lastConfirmedAt: now }).where(eq(rfidWriterDevices.id, job.writerDeviceId));
        await tx.insert(auditLogs).values({ userId: job.preparedBy, module: "transport", action: "confirm_rfid_bridge_write", targetType: "rfid_card_write_job", targetId: String(job.id), summary: "本地 uTrust 已完成车辆卡 UID 校验、NDEF 写入与回读确认" });
        return "confirmed" as const;
      });
      return res.json({ success: true, jobNo: job.jobNo, status: "confirmed", ...(outcome === "replayed" ? { replayed: true } : {}) });
    } catch (error) {
      return res.status(422).json({ success: false, message: error instanceof Error ? error.message : "本地桥接确认写卡失败" });
    }
  });

  app.post("/api/local-rfid-bridge/fail", async (req, res) => {
    noStore(res);
    try {
      const token = getBridgeToken(req);
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "本地 uTrust 写卡失败";
      if (!token) return res.status(400).json({ success: false, message: "本地桥接授权无效" });
      const { db, job } = await findBridgeJob(token);
      const now = new Date();
      await db.update(rfidCardWriteJobs).set({ status: "failed", failureReason: reason, confirmedBy: job.preparedBy, confirmedAt: now, bridgeTokenHash: null, bridgeTokenExpiresAt: null }).where(and(eq(rfidCardWriteJobs.id, job.id), eq(rfidCardWriteJobs.status, "prepared")));
      await db.insert(auditLogs).values({ userId: job.preparedBy, module: "transport", action: "fail_rfid_bridge_write", targetType: "rfid_card_write_job", targetId: String(job.id), summary: `本地 uTrust 写卡失败：${reason}` });
      return res.json({ success: true, status: "failed" });
    } catch (error) {
      return res.status(422).json({ success: false, message: error instanceof Error ? error.message : "本地桥接记录失败原因失败" });
    }
  });
}
