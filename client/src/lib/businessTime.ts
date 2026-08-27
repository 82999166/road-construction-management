export const CHINA_TIME_ZONE = "Asia/Shanghai";

type TimeValue = Date | string | number | null | undefined;

function asValidDate(value: TimeValue) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function chinaParts(value: TimeValue) {
  const date = asValidDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => ["year", "month", "day", "hour", "minute", "second"].includes(part.type)).map(part => [part.type, part.value]));
}

/** 业务明细、导出与打印统一按中国标准时间显示；存储值始终保持原始 UTC 时间戳。 */
export function formatChinaDateTime(value: TimeValue, fallback = "—") {
  const parts = chinaParts(value);
  if (!parts) return fallback;
  return `${parts.year}/${Number(parts.month)}/${Number(parts.day)} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatChinaDate(value: TimeValue, fallback = "—") {
  const parts = chinaParts(value);
  if (!parts) return fallback;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function toChinaDateInput(value: TimeValue = new Date()) {
  return formatChinaDate(value, "");
}

export function toChinaMonthInput(value: TimeValue = new Date()) {
  const parts = chinaParts(value);
  return parts ? `${parts.year}-${parts.month}` : "";
}

/** datetime-local 不含时区；该值必须由当前设备系统时钟生成，不能截取 UTC ISO 字符串。 */
export function toDeviceDateTimeInput(value: TimeValue = new Date()) {
  const date = asValidDate(value);
  if (!date) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function toDeviceDateInput(value: TimeValue = new Date()) {
  return toDeviceDateTimeInput(value).slice(0, 10);
}
