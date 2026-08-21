import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import BusinessStatusBadge from "./BusinessStatusBadge";

export type PayrollStatementLedgerRow = {
  id: number;
  workerName: string;
  teamName: string | null;
  period: string;
  payableAmount: string | number;
  deductionAmount: string | number;
  actualAmount: string | number;
  paymentReference: string | null;
  status: string;
};

/** 月度工资条详细台账；实际项目范围、字段可见性、导出审计和详情弹窗仍由父页面统一控制。 */
export default function PayrollStatementLedger({ period, onPeriodChange, search, onSearchChange, team, onTeamChange, status, onStatusChange, teams, rows, formatMoney, onExport, onOpenDetail }: { period: string; onPeriodChange: (value: string) => void; search: string; onSearchChange: (value: string) => void; team: string; onTeamChange: (value: string) => void; status: string; onStatusChange: (value: string) => void; teams: string[]; rows: PayrollStatementLedgerRow[]; formatMoney: (value: string | number) => string; onExport: () => void; onOpenDetail: (row: PayrollStatementLedgerRow) => void }) {
  return <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><CardTitle className="text-base">工资条详细台账</CardTitle><CardDescription>按工资月份、人员、班组或状态筛选；导出仅包含当前项目范围内的真实工资条。</CardDescription></div><div className="flex flex-wrap gap-2"><Input aria-label="工资期间" className="w-[150px]" type="month" value={period} onChange={event => onPeriodChange(event.target.value)} /><Input aria-label="检索工资人员" className="w-[180px]" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="人员、班组或状态" /><Select value={team} onValueChange={onTeamChange}><SelectTrigger className="w-[150px]"><SelectValue placeholder="全部班组" /></SelectTrigger><SelectContent><SelectItem value="all">全部班组</SelectItem>{teams.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={onStatusChange}><SelectTrigger className="w-[140px]"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="reviewing">审核中</SelectItem><SelectItem value="approved">已审核</SelectItem><SelectItem value="paid">已付款</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={!rows.length} onClick={onExport}>按当前筛选导出 CSV</Button></div></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>人员</TableHead><TableHead>工资期间</TableHead><TableHead>应发金额</TableHead><TableHead>扣款</TableHead><TableHead>实发金额</TableHead><TableHead>付款凭证</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map(item => <TableRow key={item.id}><TableCell><p className="font-medium">{item.workerName}</p><p className="text-xs text-slate-500">{item.teamName || "未设置班组"}</p></TableCell><TableCell>{item.period}</TableCell><TableCell>¥{formatMoney(item.payableAmount)}</TableCell><TableCell>¥{formatMoney(item.deductionAmount)}</TableCell><TableCell className="font-medium">¥{formatMoney(item.actualAmount)}</TableCell><TableCell>{item.paymentReference || "—"}</TableCell><TableCell><BusinessStatusBadge status={item.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => onOpenDetail(item)}>查看</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-slate-500">当前筛选条件下暂无工资条记录。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}
