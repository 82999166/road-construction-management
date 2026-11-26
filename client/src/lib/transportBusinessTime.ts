import { formatChinaDate } from "./businessTime";

/** 展示口径；查询由服务端使用下一天零点 exclusive，包含最后一秒内全部毫秒。 */
export const TRANSPORT_BUSINESS_DAY_NOTICE =
  "统计/结算按北京时间，起始日 00:00:00 至结束日 23:59:59（含该秒内全部毫秒，起止当天均包含）。";

/** DATE 是业务日标签，不将日期字符串再次按设备时区解析或偏移。 */
export function formatTransportBusinessDate(value: Date | string | null | undefined) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatChinaDate(value);
}

export function formatTransportBusinessDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
) {
  return `北京时间 ${formatTransportBusinessDate(start)} 00:00:00 至 ${formatTransportBusinessDate(end)} 23:59:59（含该秒内全部毫秒）`;
}

export function formatTransportBusinessMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "未选择月份";
  const [year, monthNumber] = month.split("-").map(Number);
  if (year < 1 || monthNumber < 1 || monthNumber > 12) return "未选择月份";
  // UTC 仅用来计算日历月末，不代表 DATE 字段的时间戳或查询边界。
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, monthNumber, 0);
  return formatTransportBusinessDateRange(
    `${month}-01`,
    `${month}-${String(lastDay.getUTCDate()).padStart(2, "0")}`
  );
}
