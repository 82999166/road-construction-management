import React, { type ReactNode } from "react";

/** 查询完成前不渲染汇总、记录、分页；失败不是“没有记录”。 */
export function DieselLedgerDataState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: boolean;
  children: ReactNode;
}) {
  if (loading)
    return (
      <p
        role="status"
        className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-600"
      >
        正在读取当前筛选柴油记录，汇总、打印和导出暂不可用…
      </p>
    );
  if (error)
    return (
      <p
        role="alert"
        className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
      >
        柴油记录读取失败，未显示旧记录或零汇总。请点击“刷新当前筛选台账”重试。
      </p>
    );
  return <>{children}</>;
}
