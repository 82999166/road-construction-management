import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { systemSettings, auditLogs } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { encryptSecret, maskSecret } from "../server/services/secretVault.ts";

const settingKey = "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET";
const db = await getDb();
if (!db) throw new Error("database_unavailable");
const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, settingKey)).limit(1);
if (existing?.status === "published") throw new Error("egress_secret_already_published");

const plainSecret = randomBytes(48).toString("base64url");
const encrypted = encryptSecret(plainSecret);
if (existing) {
  await db.update(systemSettings).set({ secretEncrypted: encrypted, valueJson: null, valuePreview: maskSecret(plainSecret), isSensitive: true, status: "draft", version: existing.version + 1, remarks: "固定出口网关 HMAC 配对密钥；部署完成后与网关地址一并发布。" }).where(eq(systemSettings.id, existing.id));
} else {
  await db.insert(systemSettings).values({ category: "微信公众号服务号", settingKey, displayName: "固定出口网关签名密钥", secretEncrypted: encrypted, valueJson: null, valuePreview: maskSecret(plainSecret), isSensitive: true, status: "draft", version: 1, remarks: "固定出口网关 HMAC 配对密钥；部署完成后与网关地址一并发布。" });
}
await db.insert(auditLogs).values({ module: "system_settings", action: "create", targetType: "setting", targetId: settingKey, summary: "已生成固定出口网关配对密钥草稿（密钥未写入审计）" });
process.stdout.write(plainSecret);
