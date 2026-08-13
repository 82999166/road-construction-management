import { and, eq } from "drizzle-orm";
import { auditLogs, systemSettings } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";

const gatewayUrl = "https://wechat-egress.maomaoyx.com";
const secretKey = "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET";
const urlKey = "WECHAT_OFFICIAL_EGRESS_URL";
const db = await getDb();
if (!db) throw new Error("database_unavailable");
const [secret] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, secretKey)).limit(1);
if (!secret?.secretEncrypted) throw new Error("egress_secret_draft_missing");
const [existingUrl] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, urlKey)).limit(1);
if (existingUrl) {
  await db.update(systemSettings).set({ valueJson: gatewayUrl, valuePreview: gatewayUrl, isSensitive: false, status: "published", version: existingUrl.version + 1, publishedAt: new Date(), remarks: "已验证 HTTPS 固定出口网关；仅转发受签名的 api.weixin.qq.com 请求。" }).where(eq(systemSettings.id, existingUrl.id));
} else {
  await db.insert(systemSettings).values({ category: "微信公众号服务号", settingKey: urlKey, displayName: "微信 API 固定出口网关地址", valueJson: gatewayUrl, valuePreview: gatewayUrl, isSensitive: false, status: "published", version: 1, publishedAt: new Date(), remarks: "已验证 HTTPS 固定出口网关；仅转发受签名的 api.weixin.qq.com 请求。" });
}
if (secret.status !== "published") {
  await db.update(systemSettings).set({ status: "published", version: secret.version + 1, publishedAt: new Date() }).where(and(eq(systemSettings.id, secret.id), eq(systemSettings.status, "draft")));
}
await db.insert(auditLogs).values({ module: "system_settings", action: "publish", targetType: "setting_group", targetId: "WECHAT_OFFICIAL_EGRESS", summary: "已成对发布微信 API 固定出口网关地址与加密签名密钥（不含密钥内容）" });
console.log("published");
