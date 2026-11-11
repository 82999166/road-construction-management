import React from "react";

export function FinanceApprovalBadge({ count, loading = false, failed = false, collapsed = false }: { count?: number; loading?: boolean; failed?: boolean; collapsed?: boolean }) {
  if (failed) return <span role="status" aria-label="财务审核提醒暂不可用" title="待审核数量读取失败，请进入财务管理刷新；不是零待办。" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-amber-300 bg-amber-50 px-1 text-[10px] font-bold text-amber-800">!</span>;
  if (loading && count === undefined) return <span role="status" aria-label="正在读取财务待审核数量" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-slate-400 motion-reduce:animate-none" />;
  if (count === undefined || !Number.isSafeInteger(count) || count <= 0) return null;
  return <span role="status" aria-label={`财务待审核 ${count} 项`} title={`有 ${count} 项已提交待审核事项，进入财务管理 → 结算收付 → 审核中心办理。`} className={`${collapsed ? "absolute right-0 top-0" : "ml-auto"} inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 tabular-nums text-white shadow-sm`}>{count > 99 ? "99+" : count}</span>;
}
