/** Business timestamps remain UTC instants; only natural-day grouping uses Asia/Shanghai. */
export const CHINA_BUSINESS_TIME_ZONE = "Asia/Shanghai";
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 北京时间当天 00:00:00 至 23:59:59 的完整业务范围。
 * 查询必须使用 >= start && < end（次日零点），包含末秒内的全部毫秒，且不串入次日。
 * 只用于 DATETIME/TIMESTAMP；MySQL DATE 字段继续保存原 YYYY-MM-DD 自然日期，不能套用此偏移。
 */
export function getChinaBusinessDateRange(value: string) {
  const start = new Date(`${value}T00:00:00+08:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(start.getTime()) ||
    new Date(start.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("业务日期必须为有效的 YYYY-MM-DD 自然日期");
  }
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function formatChinaBusinessDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(
    parts
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, part.value])
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}
