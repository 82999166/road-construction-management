export type PayrollMetricRow = { workerId: number; teamName: string | null; payableAmount: string | number; deductionAmount: string | number; actualAmount: string | number; status: string };
export type LaborWorkerCategory = "company_admin" | "labor_team" | "temporary_daily";

export type PayrollSummary = { payable: number; deduction: number; actual: number; approved: number; paid: number; pending: number };

export function summarizePayrollAmounts(records: Array<Pick<PayrollMetricRow, "payableAmount" | "deductionAmount" | "actualAmount" | "status">>): PayrollSummary {
  return records.reduce((summary, item) => ({ payable: summary.payable + Number(item.payableAmount || 0), deduction: summary.deduction + Number(item.deductionAmount || 0), actual: summary.actual + Number(item.actualAmount || 0), approved: summary.approved + (item.status === "approved" ? Number(item.actualAmount || 0) : 0), paid: summary.paid + (item.status === "paid" ? Number(item.actualAmount || 0) : 0), pending: summary.pending + (["draft", "reviewing"].includes(item.status) ? Number(item.actualAmount || 0) : 0) }), { payable: 0, deduction: 0, actual: 0, approved: 0, paid: 0, pending: 0 });
}

export function summarizeLaborPayrollCategories(rows: PayrollMetricRow[], categoryByWorkerId: Map<number, LaborWorkerCategory | undefined>) {
  const byCategory = (category: LaborWorkerCategory) => summarizePayrollAmounts(rows.filter(row => categoryByWorkerId.get(row.workerId) === category));
  const laborTeamNames = Array.from(new Set(rows.filter(row => categoryByWorkerId.get(row.workerId) === "labor_team").map(row => row.teamName || "未设置班组"))).sort();
  return { company: byCategory("company_admin"), laborTeam: byCategory("labor_team"), laborTeamRows: laborTeamNames.map(teamName => ({ teamName, summary: summarizePayrollAmounts(rows.filter(row => categoryByWorkerId.get(row.workerId) === "labor_team" && (row.teamName || "未设置班组") === teamName)) })) };
}
