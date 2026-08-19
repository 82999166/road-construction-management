import { and, eq } from "drizzle-orm";
import { systemSettings } from "../../drizzle/schema";
import type { getDb } from "../db";

/**
 * 统一上级主管审核策略：开启后只替代“上级主管确认”这一审核节点；
 * 会计审核、付款、收入确认、终态锁定等职责分离节点仍必须按原状态机办理。
 */
export const SUPERVISOR_REVIEW_AUTO_APPROVE_SETTING_KEY = "SUPERVISOR_REVIEW_AUTO_APPROVE";

export async function isSupervisorReviewAutoApprove(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [setting] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(and(eq(systemSettings.settingKey, SUPERVISOR_REVIEW_AUTO_APPROVE_SETTING_KEY), eq(systemSettings.status, "published")))
    .limit(1);
  // 缺省保持人工审核，避免新配置发布前意外跳过主管确认。
  return setting?.valueJson === "true" || setting?.valueJson === "1" || setting?.valueJson === '{"enabled":true}';
}
