import { and, eq } from "drizzle-orm";
import { systemSettings } from "../../drizzle/schema";

/** 考勤设备绑定上限配置键；配置缺失、未发布或非法时安全回退为3台。 */
export const ATTENDANCE_DEVICE_LIMIT_SETTING_KEY = "ATTENDANCE_DEVICE_BINDING_LIMIT";
export const DEFAULT_ATTENDANCE_DEVICE_LIMIT = 3;
export const MAX_ATTENDANCE_DEVICE_LIMIT = 50;

export function normalizeAttendanceDeviceLimit(value: string | null | undefined) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ATTENDANCE_DEVICE_LIMIT) return DEFAULT_ATTENDANCE_DEVICE_LIMIT;
  return parsed;
}

/** 只读取已发布配置，避免草稿提前改变现场打卡规则。 */
export async function getPublishedAttendanceDeviceLimit(db: { select: (...args: any[]) => any }) {
  const [setting] = await db.select({ valueJson: systemSettings.valueJson }).from(systemSettings).where(and(eq(systemSettings.settingKey, ATTENDANCE_DEVICE_LIMIT_SETTING_KEY), eq(systemSettings.status, "published"))).limit(1);
  return normalizeAttendanceDeviceLimit(setting?.valueJson);
}
