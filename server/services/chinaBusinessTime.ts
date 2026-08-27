const CHINA_TIME_ZONE = "Asia/Shanghai";

function getParts(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => ["year", "month", "day"].includes(part.type)).map(part => [part.type, part.value]));
}

/** 数据库存储 UTC；柴油业务的日、月筛选和价格生效日一律按中国标准时间裁切。 */
export function chinaBusinessDate(value: Date | string | number) {
  const parts = getParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function chinaBusinessMonth(value: Date | string | number) {
  return chinaBusinessDate(value).slice(0, 7);
}
