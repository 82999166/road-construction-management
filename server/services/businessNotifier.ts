import { auditLogs } from "../../drizzle/schema";
import { getDb } from "../db";
import { sendWecomTextNotification, type WecomNotificationResult } from "./wecomNotifier";

export type BusinessNotificationEvent = {
  userId: number;
  module: "purchasing" | "measurement" | "finance" | "machinery" | "transport" | "security";
  eventCode: string;
  targetType: string;
  targetId: string;
  title: string;
  deepLink: string;
};

/**
 * 统一企业微信业务节点提醒。
 * 文本仅包含模块、动作、单据标识和站内深链，不拼接金额、手机号、身份证、银行卡、Webhook 或其他敏感字段。
 * 外部投递失败绝不回滚已完成的业务动作，但会异步记录审计结果，供管理员在后台追溯配置或网络问题。
 */
export async function notifyWecomBusinessEvent(event: BusinessNotificationEvent): Promise<WecomNotificationResult> {
  const result = await sendWecomTextNotification(`【道路施工承包管理系统】\n${event.title}\n单据：${event.targetType} #${event.targetId}\n查看：${event.deepLink}`);
  try {
    const db = await getDb();
    if (db) {
      await db.insert(auditLogs).values({
        userId: event.userId,
        module: event.module,
        action: "wecom_delivery",
        targetType: event.targetType,
        targetId: event.targetId,
        summary: `企业微信业务提醒 ${event.eventCode}：${result.reason}`,
      });
    }
  } catch {
    // 审计写入失败也不得反向影响主业务状态；主业务审计已在调用方同步写入。
  }
  return result;
}
