import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export default function LaborWorkspaceShell({ projectFilter, hasProject, queryEnabled, loading, hasError, refreshing, onRetry, children }: { projectFilter: ReactNode; hasProject: boolean; queryEnabled: boolean; loading: boolean; hasError: boolean; refreshing: boolean; onRetry: () => void; children: ReactNode }) {
  const emptyText = !hasProject ? "请先选择已授权项目，以读取真实劳务工资台账。" : !queryEnabled ? "劳务台账查询尚未就绪，请刷新当前项目后重试。" : loading ? "正在读取实名制、上下班考勤、工资条和临时日结数据…" : hasError ? "暂无法读取劳务工资数据，请确认当前账号的服务端授权后重试。" : null;
  return <div className="space-y-6"><div><p className="text-sm font-medium text-[#203c48]">劳务工资 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">实名制、考勤与工资条</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">人员证件、手机号和银行卡均由服务端脱敏后返回；工资发放只保存付款凭证引用，不会在系统内发起转账。档案和工资条详情均在当前 PC 台账中查看。</p></div>{projectFilter}{hasProject && (loading || hasError) ? <div className="flex justify-end"><Button size="sm" variant="outline" onClick={onRetry} disabled={refreshing}>重新读取劳务台账</Button></div> : null}{emptyText ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">{emptyText}</div> : children}</div>;
}
