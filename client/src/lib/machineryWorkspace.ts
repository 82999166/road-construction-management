export const MACHINERY_WORKSPACE_TABS = [
  { value: "archives", label: "机械档案" },
  { value: "overtime", label: "司机加班" },
  { value: "costs", label: "费用统计" },
  { value: "settlements", label: "租金结算" },
] as const;
export type MachineryWorkspaceTab =
  (typeof MACHINERY_WORKSPACE_TABS)[number]["value"];
export const MACHINERY_DETAIL_TABS = [
  { value: "basic", label: "基本" },
  { value: "overtime", label: "加班" },
  { value: "costs", label: "费用" },
  { value: "maintenance", label: "维保采购" },
  { value: "settlements", label: "结算" },
] as const;
export type MachineryDetailTab =
  (typeof MACHINERY_DETAIL_TABS)[number]["value"];
export const machineryMoney = (value: unknown) =>
  `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const machineryStatus = (status: string) =>
  (
    ({
      draft: "草稿",
      submitted: "待会计审核",
      approved: "已审核",
      settled: "已结算",
      partial: "部分付款",
      paid: "已付款",
      void: "已作废",
    }) as Record<string, string>
  )[status] ?? "未知状态";
export const machineryCostType = (type: string) =>
  (
    ({
      fuel: "油料",
      repair: "维修",
      overtime: "独立加班成本",
      mobilization: "进退场",
      other: "其他",
    }) as Record<string, string>
  )[type] ?? "其他";
export function filterMachineSettlements<
  T extends { period: string; machineId: number },
>(rows: readonly T[], period: string, machineId: string | number = "all"): T[] {
  return rows.filter(
    row =>
      row.period === period &&
      (machineId === "all" || !machineId || row.machineId === Number(machineId))
  );
}
export interface MachineryOvertimeRow {
  id: number;
  machineId: number;
  projectId: number;
  date: string;
  machineName: string;
  machineCode: string;
  driverName: string | null;
  overtimeHours: number;
  overtimeHourlyRate: number;
  overtimeAmount: number;
  status: string;
  remarks: string | null;
  legacyShiftCount: number;
}
export function filterMachineryOvertime<T extends MachineryOvertimeRow>(
  rows: readonly T[],
  filters: { date?: string; status?: string; machineId?: number }
): T[] {
  return rows.filter(
    row =>
      (row.overtimeHours > 0 ||
        row.legacyShiftCount > 0 ||
        row.status === "void") &&
      (!filters.machineId || row.machineId === filters.machineId) &&
      (!filters.date || row.date === filters.date) &&
      (filters.status === "all" ||
        !filters.status ||
        row.status === filters.status)
  );
}
export function overtimeTotals(rows: readonly MachineryOvertimeRow[]) {
  const valid = rows.filter(row => row.status !== "void");
  return {
    count: rows.length,
    validCount: valid.length,
    hours: valid.reduce((sum, row) => sum + row.overtimeHours, 0),
    amount: valid.reduce((sum, row) => sum + row.overtimeAmount, 0),
  };
}
export function overtimeNextActions(
  status: string,
  capabilities?: {
    canManage?: boolean;
    canApprove?: boolean;
    canSettle?: boolean;
  }
) {
  const actions: Array<{
    nextStatus: "submitted" | "approved" | "settled" | "void";
    label: string;
  }> = [];
  if (status === "draft" && capabilities?.canManage)
    actions.push({ nextStatus: "submitted", label: "提交审核" });
  if (status === "submitted" && capabilities?.canApprove)
    actions.push({ nextStatus: "approved", label: "会计审核" });
  if (status === "approved" && capabilities?.canSettle)
    actions.push({ nextStatus: "settled", label: "确认结算" });
  if (
    ["draft", "submitted", "approved"].includes(status) &&
    capabilities?.canManage
  )
    actions.push({ nextStatus: "void", label: "作废" });
  return actions;
}
/** 显式展示来源，不把租金、加班、维保、采购和实际付款二次相加。 */
export const MACHINERY_COST_SCOPE_NOTE =
  "日：原始加班与费用凭证；月：所选自然月费用/租金快照；累计：机械成本台账全历史（排除作废）。柴油领用优先于历史油料成本；司机加班与独立加班成本分别核对，不重复计工资。维保、配件采购、应付租金与实际付款分开列示，不合并为同一成本。";
/** CSV 公式注入保护，且导出调用者只传业务字段，禁止账户与存储链接。 */
export function machineryCsv(headers: string[], rows: Array<Array<unknown>>) {
  const escape = (value: unknown) => {
    const raw = String(value ?? "");
    const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [headers, ...rows].map(row => row.map(escape).join(",")).join("\n")
  );
}
export function downloadMachineryCsv(
  fileName: string,
  headers: string[],
  rows: Array<Array<unknown>>
) {
  const url = URL.createObjectURL(
    new Blob([machineryCsv(headers, rows)], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
