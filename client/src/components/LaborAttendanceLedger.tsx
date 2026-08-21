import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BusinessStatusBadge from "./BusinessStatusBadge";

export type LaborAttendanceFilter = { workerName: string; team: string; category: string; status: string };
export type LaborAttendanceLedgerRow = { id: number; workerId: number; workerName: string; teamName: string | null; attendanceDate: Date | string; workHours: string | number; overtimeHours: string | number; source: string; status: string; note: string | null };
export type LaborWorkerCategory = "company_admin" | "labor_team" | "temporary_daily" | undefined;

function categoryLabel(category: LaborWorkerCategory) {
  return category === "company_admin" ? "公司管理人员" : category === "temporary_daily" ? "临时日结" : "劳务队人员";
}

/** 可筛选的劳务工时台账；筛选结果和 CSV 仍由父页面的真实项目数据及审计元数据控制。 */
export default function LaborAttendanceLedger({ filter, onFilterChange, teams, rows, hasAttendance, getWorkerCategory, displayDate, onExport }: { filter: LaborAttendanceFilter; onFilterChange: (filter: LaborAttendanceFilter) => void; teams: string[]; rows: LaborAttendanceLedgerRow[]; hasAttendance: boolean; getWorkerCategory: (workerId: number) => LaborWorkerCategory; displayDate: (value: Date | string) => string; onExport: () => void }) {
  return <Card>
    <CardHeader className="space-y-3">
      <div><CardTitle className="text-base">考勤记录</CardTitle><CardDescription>可按姓名、班组、人员类型与考勤状态组合筛选；导出仅包含当前项目与实际筛选范围，锁定记录不可由前端覆盖。</CardDescription></div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-[145px]" value={filter.workerName} placeholder="姓名或班组" onChange={event => onFilterChange({ ...filter, workerName: event.target.value })} />
        <Select value={filter.team} onValueChange={value => onFilterChange({ ...filter, team: value })}><SelectTrigger className="w-[130px]"><SelectValue placeholder="全部班组" /></SelectTrigger><SelectContent><SelectItem value="all">全部班组</SelectItem>{teams.map(team => <SelectItem key={team} value={team}>{team}</SelectItem>)}</SelectContent></Select>
        <Select value={filter.category} onValueChange={value => onFilterChange({ ...filter, category: value })}><SelectTrigger className="w-[140px]"><SelectValue placeholder="全部人员类型" /></SelectTrigger><SelectContent><SelectItem value="all">全部人员类型</SelectItem><SelectItem value="company_admin">公司管理人员</SelectItem><SelectItem value="labor_team">劳务队人员</SelectItem><SelectItem value="temporary_daily">临时日结人员</SelectItem></SelectContent></Select>
        <Select value={filter.status} onValueChange={value => onFilterChange({ ...filter, status: value })}><SelectTrigger className="w-[120px]"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="confirmed">已确认</SelectItem><SelectItem value="locked">已锁定</SelectItem></SelectContent></Select>
        <Button size="sm" variant="outline" disabled={!rows.length} onClick={onExport}>导出当前筛选</Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-2">
      {rows.length ? rows.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><p className="text-sm font-medium text-slate-800">{item.workerName} <span className="font-normal text-slate-400">{item.teamName ? `· ${item.teamName}` : ""}</span></p><p className="mt-1 text-xs text-slate-500">{displayDate(item.attendanceDate)} · 正常 {item.workHours} h · 加班 {item.overtimeHours} h · {item.source} · {categoryLabel(getWorkerCategory(item.workerId))}</p></div><BusinessStatusBadge status={item.status} /></div>) : <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{hasAttendance ? "当前筛选条件下没有考勤记录。" : "当前项目尚无真实考勤记录。"}</p>}
    </CardContent>
  </Card>;
}
