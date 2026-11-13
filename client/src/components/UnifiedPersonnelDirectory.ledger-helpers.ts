import { dateInput, salaryPayerTypeOf, type SalaryPayerProjection } from "./UnifiedPersonnelDirectory.helpers";

export function referenceLabel(kind: string, id: number | null | undefined, name?: string | null) {
  return id == null ? (name || `未分配${kind}`) : name ? `${name} · ${kind} ID ${id}` : `${kind} ID ${id}（字典不可用）`;
}
export function beijingTimestamp(value: Date | string | null | undefined) {
  if (!value) return "时间未登记";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间不可用";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date) + "（北京时间）";
}
export function monthRange(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  const [year, month] = period.split("-").map(Number);
  return { start: `${period}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
type Subject = { joinedAt: Date | string | null; leftAt: Date | string | null };
type Salary = SalaryPayerProjection & { effectiveFrom: string; payrollEnabled: boolean; id?: number; version?: number };
export function subjectEligibility(subject: Subject, period: string, history: Salary[], channel: "monthly" | "advance" = "monthly") {
  const month = monthRange(period);
  if (!month) return [];
  const start = [month.start, dateInput(subject.joinedAt)].filter(Boolean).sort().at(-1)!;
  const end = [month.end, dateInput(subject.leftAt)].filter(Boolean).sort()[0];
  if (start > end) return [];
  const versions = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.id ?? a.version ?? 0) - (b.id ?? b.version ?? 0));
  return versions.flatMap((salary, index) => {
    if (!salary.payrollEnabled || salaryPayerTypeOf(salary) !== "company" || salary.affiliation === "external" || channel === "monthly" && salary.affiliation === "temporary") return [];
    const from = salary.effectiveFrom > start ? salary.effectiveFrom : start;
    const next = versions[index + 1]?.effectiveFrom;
    const until = next && next <= end ? new Date(Date.parse(`${next}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : end;
    return from <= until ? [{ start: from, end: until }] : [];
  });
}
export function changeEntries(changes: unknown): [string, unknown][] {
  if (typeof changes === "string") {
    try { return changeEntries(JSON.parse(changes)); } catch { return [["历史记录", changes]]; }
  }
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return changes == null ? [] : [["历史记录", changes]];
  return Object.entries(changes);
}
export function changeValueText(value: unknown, after = false): string {
  if (value == null || value === "") return after ? "已清空" : "未登记";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return beijingTimestamp(value);
  if (Array.isArray(value)) return value.length ? value.map(item => changeValueText(item, after)).join("、") : (after ? "已清空" : "未登记");
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.some(([key]) => /encrypted|cipher/i.test(key))) return "已加密（未提供授权原值）";
    return entries.map(([key, item]) => `${key}: ${changeValueText(item, after)}`).join("；") || (after ? "已清空" : "未登记");
  }
  return String(value);
}
export function changeDetailText(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value) && ("before" in value || "after" in value)) {
    const row = value as { before?: unknown; after?: unknown };
    return `${changeValueText(row.before)} → ${changeValueText(row.after, true)}`;
  }
  return changeValueText(value);
}
