import React from "react";
import { Button } from "@/components/ui/button";

export type FullBackupHistoryEntry = {
  id: number;
  createdAt: Date | string;
  operatorName: string;
  status: string;
  description: string;
};

function displayTime(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间待确认"
    : date.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      });
}

export default function FullDatabaseBackupHistory({
  entries = [],
  loading,
  error,
  onRefresh,
}: {
  entries?: FullBackupHistoryEntry[];
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}) {
  const latest = entries[0];
  const labels: Record<string, string> = {
    success: "备份完成",
    failed: "操作未成功",
    requested: "请求已提交",
  };
  return (
    <section aria-label="完整备份操作记录" className="space-y-3">
      {latest?.status === "failed" && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          <p className="font-medium">最近一次按钮操作未成功</p>
          <p className="mt-1 text-xs">
            {displayTime(latest.createdAt)} · {latest.description}
          </p>
          <p className="mt-1 text-xs">
            上方显示的是最近可用备份，不代表这次按钮操作成功；仍可下载上次经过校验的备份。
          </p>
        </div>
      )}
      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
        <summary className="cursor-pointer font-medium">
          如何查看备份日志？为什么宝塔面板日志没有记录？
        </summary>
        <div className="mt-3 space-y-2 leading-6">
          <p>
            本页记录按钮申请、发起管理员、完成或失败结果；不展示服务器原始日志、数据库凭据或文件路径。
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              先查看下面的“备份操作记录”，记下操作时间和结果；可点击“刷新操作记录”。
            </li>
            <li>
              服务器管理员在宝塔左侧打开“终端”，查看备份服务日志：
              <code className="break-all">
                journalctl -u yx-db-backup.service --since "30 minutes ago"
                --no-pager
              </code>
              。
            </li>
            <li>
              若启动前就失败，备份服务没有新日志。本服务器应用错误日志写入文件；以下命令从服务配置读取日志位置并显示最近100行，无需手填路径：
              <code className="break-all">
                {
                  "systemctl cat yx-cloud-management.service --no-pager | sed -n 's/^StandardError=append://p' | tail -n 1 | xargs -r tail -n 100 --"
                }
              </code>
              。
            </li>
          </ol>
          <p>
            宝塔“面板日志”主要记录面板自身的操作，并非这套独立备份服务的日志。请不要公开原始日志；只向授权管理员提供脱敏错误码。
          </p>
        </div>
      </details>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-800">备份操作记录</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
          >
            刷新操作记录
          </Button>
        </div>
        {loading ? (
          <p className="mt-3 text-xs text-slate-500">正在读取备份操作记录…</p>
        ) : error ? (
          <p className="mt-3 text-xs text-amber-800">
            暂时无法读取操作记录，请稍后刷新。
          </p>
        ) : entries.length ? (
          <div className="mt-3 divide-y divide-slate-100">
            {entries.map(entry => (
              <div
                key={entry.id}
                className="grid gap-1 py-2 text-xs sm:grid-cols-[160px_1fr_100px]"
              >
                <time className="text-slate-500">
                  {displayTime(entry.createdAt)}
                </time>
                <div className="min-w-0">
                  <p className="break-words text-slate-700">
                    {entry.operatorName} · {entry.description}
                  </p>
                </div>
                <span
                  className={
                    entry.status === "success"
                      ? "text-emerald-700"
                      : entry.status === "failed"
                        ? "text-rose-700"
                        : "text-amber-700"
                  }
                >
                  {labels[entry.status] || "结果待确认"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            暂无后台按钮操作记录。服务器手工执行或定时备份的技术记录请在备份服务日志中查看。
          </p>
        )}
      </div>
    </section>
  );
}
