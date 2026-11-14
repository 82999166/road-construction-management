/** Business presentation only: never use these strings as calculation inputs or overwrite stored snapshots. */
export type BusinessNumericValue = number | string | null | undefined;

/** Round the supplied decimal representation to 2 places, with ties away from zero. */
export function formatBusinessDecimal(
  value: BusinessNumericValue,
  useGrouping = false
): string {
  if (value === null || value === undefined || value === "") return "0.00";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(
    String(value).trim()
  );
  if (!match || (!match[2] && !match[3])) return "—";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 320) return "—";
  const fraction = match[3] ?? "";
  const digits = BigInt((match[2] || "0") + fraction);
  const power = exponent - fraction.length + 2;
  let cents: bigint;
  if (power >= 0) cents = digits * BigInt("1" + "0".repeat(power));
  else {
    const divisor = BigInt("1" + "0".repeat(-power));
    cents =
      digits / divisor +
      ((digits % divisor) * BigInt(2) >= divisor ? BigInt(1) : BigInt(0));
  }
  const whole = (cents / BigInt(100)).toString();
  const integer = useGrouping
    ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : whole;
  const sign = match[1] === "-" && cents !== BigInt(0) ? "-" : "";
  return `${sign}${integer}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function formatAmount(
  value: BusinessNumericValue,
  useGrouping = true
): string {
  return formatBusinessDecimal(value, useGrouping);
}

export function formatQuantity(
  value: BusinessNumericValue,
  useGrouping = false
): string {
  return formatBusinessDecimal(value, useGrouping);
}

/** Generic charts keep integer counts, IDs and percentage series separate from monetary/physical metrics. */
export function formatBusinessMetricValue(
  value: unknown,
  metricName: string,
  kind?: "amount" | "quantity" | "count"
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number" && typeof value !== "string")
    return String(value);
  const countLike =
    /count|percent|percentage|ratio|latitude|longitude|(?:^|_)id$|数量统计|笔数|条数|人数|台数|趟数|占比|百分比|进度/i.test(
      metricName
    );
  const decimalLike =
    /amount|price|cost|rent|salary|wage|fee|liters|quantity|volume|distance|weight|hours|balance|deduction|paid|payable|income|expense|金额|费用|单价|租金|工资|余额|收入|支出|升数|油量|方量|工程量|重量|里程|工时|加班小时/i.test(
      metricName
    );
  if (
    kind === "amount" ||
    kind === "quantity" ||
    (kind !== "count" && !countLike && decimalLike)
  )
    return formatBusinessDecimal(value, true);
  return typeof value === "number" ? value.toLocaleString("zh-CN") : value;
}

/** OCR text remains provisional; only a complete numeric amount is formatted, never guessed. */
export function formatRecognizedAmount(value: BusinessNumericValue): string {
  if (value === null || value === undefined || value === "") return "未识别";
  const raw = String(value).trim();
  const match = /^([¥￥]?)([+-]?(?:\d+(?:,\d{3})*)(?:\.\d+)?)(元?)$/.exec(raw);
  if (!match) return raw;
  return `${match[1]}${formatAmount(match[2].replaceAll(",", ""))}${match[3]}`;
}
