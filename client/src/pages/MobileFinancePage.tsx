import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { MobileFinanceAdjustmentPanel } from "@/components/MobileFinanceAdjustmentPanel";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { trpc } from "@/lib/trpc";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CircleHelp, FilePlus2, HardHat, Printer, WalletCards } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";

/** 资金金额在移动端只用于阅读；项目利润和待收待付都以服务端汇总为准。 */
function formatMoney(value: string | number | null | undefined) { return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function currentPeriod() { return new Date().toISOString().slice(0, 7); }

/** 财务成本页面始终回到移动工作台，不跳转到 PC 管理后台。 */
export const MOBILE_FINANCE_BACK_PATH = "/mobile";

/** 财务成本移动端：真实收支原始流水和按项目期间的汇总结果统一展示。 */
export default function MobileFinancePage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { isSuperAdmin } = useManagementPermissions();
  const [projectId, setProjectId] = useState<number>();
  const [period, setPeriod] = useState(currentPeriod);
  const [recordOpen, setRecordOpen] = useState(false);
  const [draft, setDraft] = useState({ direction: "expense" as "income" | "expense", category: "", amount: "", occurredAt: new Date().toISOString().slice(0, 16), settlementStatus: "unpaid" as "unpaid" | "partial" | "paid" | "void", remarks: "" });
  const projects = trpc.finance.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const workbench = trpc.mobile.workbench.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => { if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id); }, [projectId, projects.data]);
  const selectedProjectId = projectId ?? 0;
  const input = useMemo(() => ({ projectId: selectedProjectId, period }), [selectedProjectId, period]);
  const records = trpc.finance.listRecords.useQuery(input, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.finance.summary.useQuery(input, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const activeProjectName = projects.data?.find(project => project.id === selectedProjectId)?.name ?? "—";
  /** 会话未完成时工作台摘要可能尚无用户对象；门禁会在下方接管渲染。 */
  const roleCodes = workbench.data?.user?.roleCodes ?? [];
  const save = trpc.finance.saveRecord.useMutation({ onSuccess: async () => { toast.success("资金流水已登记"); setRecordOpen(false); await Promise.all([utils.finance.listRecords.invalidate(), utils.finance.summary.invalidate()]); }, onError: error => toast.error(error.message) });
  function submit() {
    if (!selectedProjectId || !draft.category.trim() || !draft.amount) return toast.error("请填写收支分类和金额");
    save.mutate({ projectId: selectedProjectId, direction: draft.direction, category: draft.category.trim(), amount: Number(draft.amount), occurredAt: new Date(draft.occurredAt).toISOString(), settlementStatus: isSuperAdmin ? draft.settlementStatus : "unpaid", sourceType: null, sourceId: null, evidenceId: null, remarks: draft.remarks.trim() || null });
  }
  if (loading || !isAuthenticated || projects.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projects.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载财务成本权限…" title="财务成本" description="请使用企业统一身份进入已授权项目的财务与成本数据。" Icon={WalletCards} onRetry={() => { void refresh(); void projects.refetch(); }} />;

  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-10 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => navigate(MOBILE_FINANCE_BACK_PATH)}><ArrowLeft className="h-5 w-5" /></Button><div className="text-center"><p className="text-sm font-semibold">财务成本</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">现金流 · 成本归集 · 利润</p></div><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => toast.info("收入、支出、未收未付和利润均按项目期间由服务端原始流水汇总。")}><CircleHelp className="h-5 w-5" /></Button></div><div className="relative mt-5"><p className="text-xs text-[#e8cfb2]">当前期间</p><p className="mt-1 text-lg font-semibold">{period}</p></div></header>
    <main className="space-y-4 px-5 py-5">
      <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">项目财务成本汇总表</h1><p className="mt-2 text-center text-sm">项目：{activeProjectName}　期间：{period}　生成时间：{new Date().toLocaleString("zh-CN")}</p><div className="mt-4 grid grid-cols-4 gap-3 text-center text-sm"><div>确认收入<p className="mt-1 font-semibold">{formatMoney(summary.data?.incomeAmount)}</p></div><div>本期支出<p className="mt-1 font-semibold">{formatMoney(summary.data?.expenseAmount)}</p></div><div>项目利润<p className="mt-1 font-semibold">{formatMoney(summary.data?.profitAmount)}</p></div><div>待收/待付<p className="mt-1 font-semibold">{formatMoney(summary.data?.receivableAmount)} / {formatMoney(summary.data?.payableAmount)}</p></div><div>现金流入<p className="mt-1 font-semibold">{formatMoney(summary.data?.cashInflowAmount)}</p></div><div>现金流出<p className="mt-1 font-semibold">{formatMoney(summary.data?.cashOutflowAmount)}</p></div><div>净现金流<p className="mt-1 font-semibold">{formatMoney(summary.data?.netCashFlowAmount)}</p></div></div></section>
      {!projects.data?.length ? <Card className="border-0"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs text-[#765544]">请联系管理员配置财务成本的数据权限。</p></CardContent></Card> : <>
        <div className="grid grid-cols-[1fr_110px] gap-2 print:hidden"><Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white"><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent>{projects.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select><Input className="h-11 border-[#e9d8c6] bg-white" type="month" value={period} onChange={event => setPeriod(event.target.value)} /></div>
        <section className="grid grid-cols-2 gap-3"><FinanceMetric label="确认收入" value={formatMoney(summary.data?.incomeAmount)} tone="text-emerald-700" /><FinanceMetric label="本期支出" value={formatMoney(summary.data?.expenseAmount)} tone="text-rose-700" /><FinanceMetric label="项目利润" value={formatMoney(summary.data?.profitAmount)} tone="text-teal-700" /><FinanceMetric label="待收/待付" value={`${formatMoney(summary.data?.receivableAmount)} / ${formatMoney(summary.data?.payableAmount)}`} tone="text-amber-700" /><FinanceMetric label="现金流入" value={formatMoney(summary.data?.cashInflowAmount)} tone="text-sky-700" /><FinanceMetric label="现金流出" value={formatMoney(summary.data?.cashOutflowAmount)} tone="text-orange-700" /><FinanceMetric label="净现金流" value={formatMoney(summary.data?.netCashFlowAmount)} tone="text-violet-700" /></section>
        <section className="flex items-center justify-between rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div><p className="font-semibold">{period} 项目现金流</p><p className="text-xs text-[#7d563d]">流入 {formatMoney(summary.data?.cashInflowAmount)}　流出 {formatMoney(summary.data?.cashOutflowAmount)}</p></div><div className="flex gap-1"><Button size="sm" variant="ghost" className="gap-1 text-[#8b3f20] hover:bg-[#e8cda9]" onClick={() => window.print()}><Printer className="h-4 w-4" />打印</Button><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setRecordOpen(true)}><FilePlus2 className="mr-1 h-4 w-4" />登记</Button></div></section>
        <section className="space-y-3">{records.data?.length ? records.data.map(record => <Card key={record.id} className="border-0 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className={`grid h-10 w-10 place-items-center rounded-full ${record.direction === "income" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{record.direction === "income" ? <ArrowDownRight className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}</div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{record.category}</p><p className="mt-1 text-xs text-[#8f7566]">{new Date(record.occurredAt).toLocaleString("zh-CN")}　{record.settlementStatus === "paid" ? "已结清" : record.settlementStatus === "partial" ? "部分结清" : record.settlementStatus === "void" ? "已作废" : "未结清"}</p></div><p className={record.direction === "income" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{record.direction === "income" ? "+" : "-"}{formatMoney(record.amount)}</p></CardContent></Card>) : <Card className="border-dashed border-[#e3cbb4] bg-[#fffaf4]"><CardContent className="p-7 text-center text-sm text-[#8f7566]">当前期间暂无真实资金流水。</CardContent></Card>}</section>
        {isSuperAdmin ? <MobileFinanceAdjustmentPanel projectId={selectedProjectId} roleCodes={roleCodes} records={records.data ?? []} /> : null}
      </>}
    </main>
    <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl">
        <DialogHeader><DialogTitle>登记资金流水</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>收支方向</Label><Select value={draft.direction} onValueChange={value => setDraft(current => ({ ...current, direction: value as "income" | "expense" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="income">收入</SelectItem><SelectItem value="expense">支出</SelectItem></SelectContent></Select></div>
          <div><Label>资金分类</Label><Input className="mt-1" placeholder="例如：材料款、工程回款" value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>金额</Label><Input className="mt-1" inputMode="decimal" value={draft.amount} onChange={event => setDraft(current => ({ ...current, amount: event.target.value }))} /></div>
            {isSuperAdmin ? <div><Label>结算状态</Label><Select value={draft.settlementStatus} onValueChange={value => setDraft(current => ({ ...current, settlementStatus: value as "unpaid" | "partial" | "paid" | "void" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unpaid">未结清</SelectItem><SelectItem value="partial">部分结清</SelectItem><SelectItem value="paid">已结清</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select></div> : <div><Label>结算状态</Label><Input className="mt-1 bg-[#fcf8f2]" value="未结清" readOnly /></div>}
          </div>
          <div><Label>发生时间</Label><Input className="mt-1" type="datetime-local" value={draft.occurredAt} onChange={event => setDraft(current => ({ ...current, occurredAt: event.target.value }))} /></div>
          <div><Label>备注</Label><Input className="mt-1" value={draft.remarks} onChange={event => setDraft(current => ({ ...current, remarks: event.target.value }))} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setRecordOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submit} disabled={save.isPending}>登记</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div></div>;
}

function FinanceMetric({ label, value, tone }: { label: string; value: string; tone: string }) { return <Card className="border-0 shadow-sm"><CardContent className="p-3.5"><p className={`text-sm font-semibold ${tone}`}>{value}</p><p className="mt-1 text-[11px] text-[#8f7566]">{label}</p></CardContent></Card>; }
