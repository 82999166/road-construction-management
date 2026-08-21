type PayrollRow = { workerName: string; teamName: string | null; period: string; status: string };

export function filterPayrollRows<T extends PayrollRow>(rows: T[], filters: { search: string; team: string; status: string }) {
  const keyword = filters.search.trim().toLowerCase();
  return rows.filter(item => (!keyword || [item.workerName, item.teamName, item.period, item.status].some(value => String(value ?? "").toLowerCase().includes(keyword))) && (filters.team === "all" || (item.teamName || "未设置班组") === filters.team) && (filters.status === "all" || item.status === filters.status));
}

export function getPayrollTeams<T extends PayrollRow>(rows: T[]) {
  return Array.from(new Set(rows.map(item => item.teamName || "未设置班组"))).sort();
}
