import { eq } from "drizzle-orm";
import { systemSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptSecret } from "./secretVault";

const WECOM_WEBHOOK_SETTING_KEY = "WECHAT_WORK_WEBHOOK";

export type WecomNotificationResult = {
  delivered: boolean;
  reason: "sent" | "not_configured" | "disabled" | "invalid_config" | "delivery_failed" | "database_unavailable";
};

/**
 * 将企业微信机器人地址限制在官方域名和固定路径。
 * 即便密文被错误录入或数据库数据遭到篡改，也不能令服务端访问任意地址。
 */
function getSafeWecomWebhookUrl(rawValue: string) {
  const url = new URL(rawValue);
  if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com" || url.pathname !== "/cgi-bin/webhook/send" || !url.searchParams.get("key")) {
    throw new Error("企业微信 Webhook 配置不符合安全要求");
  }
  return url;
}

/**
 * 发送企业微信纯文本提醒。
 * 调用方不得传入工资金额、银行卡、身份证号、手机号或其他个人敏感信息；
 * 本方法仅用于业务节点摘要，失败时不抛出错误，因此不会回滚已完成的主业务操作。
 */
export async function sendWecomTextNotification(content: string): Promise<WecomNotificationResult> {
  const db = await getDb();
  if (!db) return { delivered: false, reason: "database_unavailable" };
  const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.settingKey, WECOM_WEBHOOK_SETTING_KEY)).limit(1);
  if (!setting) return { delivered: false, reason: "not_configured" };
  if (setting.status !== "published") return { delivered: false, reason: "disabled" };
  if (!setting.isSensitive || !setting.secretEncrypted) return { delivered: false, reason: "invalid_config" };

  let webhookUrl: URL;
  try {
    webhookUrl = getSafeWecomWebhookUrl(decryptSecret(setting.secretEncrypted));
  } catch {
    return { delivered: false, reason: "invalid_config" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: content.slice(0, 1800) } }),
      signal: AbortSignal.timeout(6_000),
    });
    let payload: { errcode?: number } | null = null;
    try { payload = await response.json() as { errcode?: number }; } catch { payload = null; }
    return response.ok && payload?.errcode === 0 ? { delivered: true, reason: "sent" } : { delivered: false, reason: "delivery_failed" };
  } catch {
    return { delivered: false, reason: "delivery_failed" };
  }
}
