import { Activity, ArrowUpRight, Building2, ClipboardCheck, CreditCard, FileText, Gauge, HardHat, RefreshCw, Route, Truck, WalletCards } from "lucide-react";
import React from "react";

export type OperatingDashboardData = {
  scope: { projectId: number | null; period: string | null };
  finance: {
    totalIncome: number;
    totalExpense: number;
    receivable: number;
    payable: number;
    paidAmount: number;
    invoiceAmount: number;
    paymentRatio: number | null;
    settlementRatio: number | null;
    categories: Array<{ category: string; amount: number; unpaid: number; paid: number }>;
  };
  measurement: { declaredAmount: number; approvedAmount: number; settledAmount: number; pendingCount: number };
  progress: { averageProgressPercent: number | null; reportCount: number; approvedReportCount: number };
  resources: { payrollActualAmount: number; dailyWageActualAmount: number; transportTripCount: number };
};

type OperatingCommandCenterProps = {
  data: OperatingDashboardData;
  scopeLabel: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
};

const currency = (value: number) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percentage = (value: number | null) => value === null ? "—" : `${Number(value).toFixed(1)}%`;

function CommandPanel({ title, icon: Icon, children, className = "" }: { title: string; icon: typeof WalletCards; children: React.ReactNode; className?: string }) {
  return <section className={`command-panel relative overflow-hidden border border-cyan-300/20 bg-[#091d42]/82 p-4 shadow-[inset_0_0_28px_rgba(35,111,214,.13)] ${className}`}><div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(64,197,255,.08)_1px,transparent_1px),linear-gradient(rgba(64,197,255,.06)_1px,transparent_1px)] bg-[size:24px_24px] opacity-30" /><div className="relative mb-3 flex items-center gap-2 text-sm font-semibold tracking-[0.12em] text-cyan-100"><Icon className="h-4 w-4 text-cyan-300" /><span>{title}</span><span className="h-px flex-1 bg-gradient-to-r from-cyan-300/70 to-transparent" /></div>{children}</section>;
}

function DataButton({ label, value, hint, onClick, accent = "cyan" }: { label: string; value: string; hint: string; onClick: () => void; accent?: "cyan" | "amber" | "rose" }) {
  const color = accent === "rose" ? "text-[#ff5f9e]" : accent === "amber" ? "text-[#ffd066]" : "text-[#59d6ff]";
  return <button type="button" onClick={onClick} className="group w-full rounded-sm border border-cyan-300/15 bg-[#071832]/80 px-3 py-3 text-left transition hover:border-cyan-300/60 hover:bg-[#0d2855]"><p className="text-[11px] tracking-[0.08em] text-blue-100/65">{label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-cyan-100/45">{hint}<ArrowUpRight className="h-3 w-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></p></button>;
}

/** 仅展示服务端真实聚合结果；图表和道路线路为视觉承载，不生成或推断施工业务数据。 */
export default function OperatingCommandCenter({ data, scopeLabel, isRefreshing, onRefresh, onNavigate }: OperatingCommandCenterProps) {
  const progress = Math.max(0, Math.min(100, data.progress.averageProgressPercent ?? 0));
  const circumference = 2 * Math.PI * 42;
  const maxCategoryAmount = Math.max(1, ...data.finance.categories.map(item => Number(item.amount)));
  const topCategories = data.finance.categories.slice(0, 5);

  return <div className="relative overflow-hidden rounded-xl border border-[#2261b0] bg-[#040e27] p-3 text-[#e6f5ff] shadow-[0_18px_60px_rgba(0,20,65,.46)] lg:p-5" id="operating-command-center">
    <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(29,103,190,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(29,103,190,.14)_1px,transparent_1px),radial-gradient(circle_at_50%_0%,rgba(27,103,255,.38),transparent_42%)] [background-size:34px_34px,34px_34px,auto]" />
    <div className="relative">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-cyan-300/25 pb-3">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center border border-cyan-300/70 bg-cyan-400/10 text-cyan-200"><Route className="h-5 w-5" /></div><div><p className="text-xs tracking-[0.25em] text-cyan-300">YUEXIN · TRAFFIC CONSTRUCTION</p><h2 className="mt-1 text-xl font-bold tracking-[0.12em] text-white">悦信云智管 · 交通施工指挥中心</h2></div></div>
        <div className="flex flex-wrap items-center gap-2"><span className="rounded border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100">范围：{scopeLabel}</span><span className="inline-flex items-center gap-1 rounded border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />真实台账汇总</span><button type="button" onClick={onRefresh} disabled={isRefreshing} className="inline-flex items-center gap-1 rounded border border-cyan-300/45 px-2.5 py-1 text-xs text-cyan-100 transition hover:bg-cyan-300/10 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />刷新数据</button></div>
      </header>

      <div className="grid gap-3 xl:grid-cols-[minmax(230px,.85fr)_minmax(420px,1.55fr)_minmax(230px,.85fr)]">
        <div className="space-y-3"><CommandPanel title="资金结算态势" icon={WalletCards}><div className="grid grid-cols-2 gap-2"><DataButton label="总收入" value={currency(data.finance.totalIncome)} hint="进入财务明细" onClick={() => onNavigate("/admin/finance")} /><DataButton label="已开发票" value={currency(data.finance.invoiceAmount)} hint="查看票据台账" onClick={() => onNavigate("/admin/finance")} accent="amber" /><DataButton label="应收欠款" value={currency(data.finance.receivable)} hint="查看回款状态" onClick={() => onNavigate("/admin/finance")} accent="rose" /><DataButton label="应付欠款" value={currency(data.finance.payable)} hint="查看付款安排" onClick={() => onNavigate("/admin/finance")} accent="rose" /></div><div className="mt-3 grid grid-cols-2 gap-2 border-t border-cyan-300/15 pt-3 text-xs"><p className="text-cyan-100/65">付款比 <b className="ml-1 text-cyan-200">{percentage(data.finance.paymentRatio)}</b></p><p className="text-cyan-100/65">已付金额 <b className="ml-1 text-cyan-200">{currency(data.finance.paidAmount)}</b></p></div></CommandPanel>
          <CommandPanel title="施工资源投入" icon={HardHat}><div className="space-y-3"><div className="flex items-end justify-between border-b border-cyan-300/15 pb-2"><span className="text-xs text-cyan-100/60">月度工资实发</span><b className="text-lg text-cyan-200">{currency(data.resources.payrollActualAmount)}</b></div><div className="flex items-end justify-between border-b border-cyan-300/15 pb-2"><span className="text-xs text-cyan-100/60">临时日结实发</span><b className="text-lg text-cyan-200">{currency(data.resources.dailyWageActualAmount)}</b></div><button type="button" onClick={() => onNavigate("/admin/labor")} className="flex w-full items-center justify-between rounded border border-cyan-300/15 bg-[#071832]/70 px-3 py-2 text-xs text-cyan-100 transition hover:border-cyan-300/60"><span>劳务工资与考勤台账</span><ArrowUpRight className="h-4 w-4 text-cyan-300" /></button></div></CommandPanel></div>

        <div className="space-y-3"><CommandPanel title="施工线路与工程进度" icon={Route} className="min-h-[290px]"><div className="relative grid min-h-[220px] items-center gap-4 md:grid-cols-[1fr_170px]"><div className="relative min-h-[190px] overflow-hidden rounded border border-cyan-300/15 bg-[radial-gradient(circle_at_25%_60%,rgba(24,103,205,.32),transparent_20%),radial-gradient(circle_at_78%_32%,rgba(0,223,255,.2),transparent_18%),linear-gradient(135deg,#071630,#0b2b55)]"><div className="absolute left-[10%] top-[56%] h-1 w-[79%] -rotate-[13deg] bg-gradient-to-r from-cyan-300 via-blue-200 to-cyan-300 shadow-[0_0_14px_rgba(67,217,255,.9)]" /><div className="absolute left-[12%] top-[47%] h-5 w-5 rounded-full border-2 border-cyan-200 bg-[#0c2e57] shadow-[0_0_16px_rgba(67,217,255,.9)]" /><div className="absolute right-[10%] top-[26%] h-5 w-5 rounded-full border-2 border-amber-200 bg-[#3b2e20] shadow-[0_0_16px_rgba(255,203,102,.8)]" /><div className="absolute left-[25%] top-[29%] text-[10px] text-cyan-100/70">施工起点</div><div className="absolute right-[9%] top-[14%] text-[10px] text-amber-100/80">计量节点</div><div className="absolute bottom-3 left-3 rounded border border-cyan-300/25 bg-[#061733]/80 px-2 py-1 text-[10px] text-cyan-100">以项目施工日报、计量与运输真实台账汇总</div></div><div className="flex flex-col items-center justify-center"><div className="relative grid h-32 w-32 place-items-center"><svg className="absolute h-full w-full -rotate-90"><circle cx="64" cy="64" r="42" fill="none" stroke="rgba(100,170,255,.18)" strokeWidth="9" /><circle cx="64" cy="64" r="42" fill="none" stroke="#39d6ff" strokeLinecap="round" strokeWidth="9" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress / 100)} /></svg><div className="text-center"><p className="text-3xl font-bold text-white">{data.progress.averageProgressPercent === null ? "—" : `${progress.toFixed(1)}%`}</p><p className="mt-1 text-[10px] tracking-[0.18em] text-cyan-200">项目进度</p></div></div><button type="button" onClick={() => onNavigate("/admin/construction")} className="mt-3 text-xs text-cyan-300 hover:text-white">进入施工管理 →</button></div></div></CommandPanel>
          <CommandPanel title="计量、产值与成本构成" icon={Activity}><div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4"><div><p className="text-cyan-100/55">申报计量</p><b className="mt-1 block text-cyan-200">{currency(data.measurement.declaredAmount)}</b></div><div><p className="text-cyan-100/55">核定计量</p><b className="mt-1 block text-cyan-200">{currency(data.measurement.approvedAmount)}</b></div><div><p className="text-cyan-100/55">已结算产值</p><b className="mt-1 block text-cyan-200">{currency(data.measurement.settledAmount)}</b></div><div><p className="text-cyan-100/55">结算比</p><b className="mt-1 block text-amber-200">{percentage(data.finance.settlementRatio)}</b></div></div><div className="mt-4 flex h-20 items-end gap-2 border-t border-cyan-300/15 pt-3">{topCategories.length ? topCategories.map((item, index) => <div key={item.category} className="group flex flex-1 flex-col items-center gap-1"><span className="text-[9px] text-cyan-100/55">{currency(item.amount)}</span><div className="w-full bg-gradient-to-t from-[#1a69d7] to-cyan-300/90" style={{ height: `${Math.max(10, Number(item.amount) / maxCategoryAmount * 46)}px` }} /><span className="max-w-full truncate text-[9px] text-cyan-100/70">{index + 1}.{item.category}</span></div>) : <p className="w-full text-center text-xs text-cyan-100/50">当前范围暂无有效支出分类。</p>}</div></CommandPanel></div>

        <div className="space-y-3"><CommandPanel title="运输与现场动态" icon={Truck}><div className="grid grid-cols-2 gap-2"><DataButton label="运输趟次" value={`${data.resources.transportTripCount} 趟`} hint="查看运单台账" onClick={() => onNavigate("/admin/transport")} /><DataButton label="施工日报" value={`${data.progress.reportCount} 条`} hint="查看施工记录" onClick={() => onNavigate("/admin/construction")} /><DataButton label="已审核日报" value={`${data.progress.approvedReportCount} 条`} hint="查看审核状态" onClick={() => onNavigate("/admin/construction")} accent="amber" /><DataButton label="待处理计量" value={`${data.measurement.pendingCount} 笔`} hint="查看计量流程" onClick={() => onNavigate("/admin/measurement-tools")} accent={data.measurement.pendingCount ? "rose" : "cyan"} /></div></CommandPanel>
          <CommandPanel title="项目风险与控制" icon={Gauge}><div className="space-y-2 text-xs"><div className="flex items-center justify-between rounded border border-cyan-300/15 bg-[#071832]/70 px-3 py-2"><span className="text-cyan-100/60">资金待付</span><b className="text-[#ff9fc3]">{currency(data.finance.payable)}</b></div><div className="flex items-center justify-between rounded border border-cyan-300/15 bg-[#071832]/70 px-3 py-2"><span className="text-cyan-100/60">计量待处理</span><b className="text-[#ffd46b]">{data.measurement.pendingCount} 笔</b></div><button type="button" onClick={() => onNavigate("/admin/risk")} className="mt-1 flex w-full items-center justify-between rounded border border-cyan-300/25 px-3 py-2 text-cyan-200 transition hover:bg-cyan-300/10"><span>进入 AI 项目风控</span><ArrowUpRight className="h-4 w-4" /></button></div></CommandPanel></div>
      </div>

      <CommandPanel title="各类成本、付款与结算明细" icon={CreditCard} className="mt-3"><div className="overflow-x-auto"><div className="min-w-[620px]"><div className="grid grid-cols-[1.45fr_1fr_1fr_1fr] border-b border-cyan-300/20 px-3 pb-2 text-[11px] tracking-[0.1em] text-cyan-100/55"><span>成本类别</span><span className="text-right">有效支出</span><span className="text-right">待付金额</span><span className="text-right">已付金额</span></div>{data.finance.categories.length ? data.finance.categories.map(item => <button type="button" key={item.category} onClick={() => onNavigate("/admin/finance")} className="grid w-full grid-cols-[1.45fr_1fr_1fr_1fr] border-b border-cyan-300/10 px-3 py-2 text-left text-xs transition hover:bg-cyan-300/10"><span className="text-cyan-100">{item.category}</span><span className="text-right text-cyan-100/75">{currency(item.amount)}</span><span className="text-right text-[#ff9fc3]">{currency(item.unpaid)}</span><span className="text-right text-[#66e2b5]">{currency(item.paid)}</span></button>) : <p className="px-3 py-6 text-center text-xs text-cyan-100/50">当前范围暂无有效支出分类数据。</p>}</div></div></CommandPanel>
      <p className="mt-3 flex items-center gap-1 text-[10px] text-cyan-100/45"><ClipboardCheck className="h-3.5 w-3.5" />金额单位：元；所有数据均由当前项目与期间范围内的真实业务台账服务端聚合。工程线路为大屏视觉承载，不代表地图、坐标或未录入的施工节点。</p>
    </div>
  </div>;
}
