export type VehicleSettlementMode = "day" | "period" | "trip_count";

/** Only safe, pre-generation freight fields; never include payment or account data. */
export type VehicleSettlementPreview = {
  tripIds: number[];
  rows: {
    id: number;
    tripNo: string;
    startAt: Date | string;
    quantity: number | string | null;
    unitPrice: number | string | null;
    grossAmount: number;
  }[];
  availableCount: number;
  selectedCount: number;
  grossFreightAmount: number;
  eligible: boolean;
  reason: string | null;
  dailyGroups: {
    date: string;
    tripCount: number;
    grossFreightAmount: number;
  }[];
  selectionMode: string;
};

const DAY_MS = 86_400_000;

/** A Chinese business date is a calendar label, NOT a local or UTC timestamp. */
function settlementDateUtc(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31)
    return undefined;
  // setUTCFullYear also handles years 0001–0099 without Date.UTC's 1900 offset.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return date.getTime();
}

export function settlementPositiveInteger(
  value: string,
  maximum: number
): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= maximum
    ? count
    : undefined;
}

/** Inclusive end date: 7 days from Jan 29 ends on Feb 4, in every device timezone. */
export function addInclusiveSettlementDays(
  start: string,
  days: string
): string {
  const startUtc = settlementDateUtc(start);
  const count = settlementPositiveInteger(days, 3650);
  if (startUtc === undefined || count === undefined) return "";
  const date = new Date(startUtc + (count - 1) * DAY_MS);
  if (date.getUTCFullYear() > 9999) return "";
  return date.toISOString().slice(0, 10);
}

/** Undefined for missing/invalid/reversed calendar dates; never leaks NaN. */
export function inclusiveSettlementDayCount(
  start: string,
  end: string
): number | undefined {
  const startUtc = settlementDateUtc(start);
  const endUtc = settlementDateUtc(end);
  if (startUtc === undefined || endUtc === undefined || endUtc < startUtc)
    return undefined;
  return (endUtc - startUtc) / DAY_MS + 1;
}
