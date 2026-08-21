type AttendanceRow = { workerId: number; workerName: string; teamName: string | null; status: string };
type WorkerRow = { id: number; realName: string | null; workerCategory: string | null };

export function getAttendanceTeams<T extends AttendanceRow>(rows: T[]) {
  return Array.from(new Set(rows.map(item => item.teamName || "未设置班组"))).sort();
}

export function filterAttendanceRows<T extends AttendanceRow>(rows: T[], workers: Map<number, WorkerRow>, filters: { workerName: string; team: string; category: string; status: string }) {
  const keyword = filters.workerName.trim().toLowerCase();
  return rows.filter(item => {
    const worker = workers.get(item.workerId);
    return (!keyword || [item.workerName, item.teamName, worker?.realName].some(value => String(value ?? "").toLowerCase().includes(keyword))) && (filters.team === "all" || (item.teamName || "未设置班组") === filters.team) && (filters.category === "all" || worker?.workerCategory === filters.category) && (filters.status === "all" || item.status === filters.status);
  });
}
