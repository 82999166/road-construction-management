import type { PayrollSummary } from "@/lib/laborPayrollMetrics";

export function LaborPayrollHeadline({ summary, formatMoney }: { summary: PayrollSummary; formatMoney: (value: string | number | null | undefined) => string }) {
  const cards = [
    { title: "当前筛选应发总额", value: `¥${formatMoney(summary.payable)}`, description: `扣款 ¥${formatMoney(summary.deduction)} · 实发 ¥${formatMoney(summary.actual)}` },
    { title: "待处理金额", value: `¥${formatMoney(summary.pending)}`, description: "草稿及会计审核中" },
    { title: "已结算金额", value: `¥${formatMoney(summary.paid)}`, description: `已审核待付款 ¥${formatMoney(summary.approved)}` },
  ];
  return <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cards.map(card => <div key={card.title} className="rounded-xl border border-[#d8e3e0] bg-white p-4 shadow-sm"><p className="text-sm font-medium text-[#46615a]">{card.title}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#203c48]">{card.value}</p><p className="mt-1 text-xs text-slate-500">{card.description}</p></div>)}</section>;
}
