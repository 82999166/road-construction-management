import { useAuth } from "@/_core/hooks/useAuth";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatChinaDateTime } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import {
  Banknote,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  Tractor,
  UserRound,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `¥${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function costTypeLabel(value: string) {
  return (
    (
      {
        fuel: "油料",
        repair: "维修",
        overtime: "加班",
        mobilization: "进退场",
        other: "其他",
      } as Record<string, string>
    )[value] ?? "其他"
  );
}

function costStatusLabel(value: string) {
  return (
    (
      {
        draft: "待审核",
        approved: "已审核",
        settled: "已结算",
        void: "已作废",
      } as Record<string, string>
    )[value] ?? value
  );
}

/** 机械老板仅查看名下显式绑定设备，所有明细均由服务端按 ownerUserId 再次收口。 */
export default function MachineOwnerPortalPage() {
  const { user, loading, isAuthenticated, authLoadingTimedOut, refresh } =
    useAuth();
  const [, navigate] = useLocation();
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(
    null
  );
  const portal = trpc.machinery.ownerExpensePortal.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const selected = useMemo(
    () =>
      portal.data?.status === "ready"
        ? (portal.data.machines.find(
            item => item.machine.id === selectedMachineId
          ) ?? null)
        : null,
    [portal.data, selectedMachineId]
  );

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return (
      <MobileAccessGate
        isAuthenticated={isAuthenticated}
        isLoading={loading}
        authLoadingTimedOut={authLoadingTimedOut}
        loadingText="正在核验机械老板账号…"
        title="机械费用清单"
        description="请先使用已绑定的机械老板账号登录。"
        Icon={Tractor}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mobile-viewport-shell mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-8 shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#233b36] px-5 pb-8 pt-6 text-[#f5fff9]">
          <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[#86b89f]/20 blur-2xl" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#6f9e86] shadow-[0_8px_18px_rgba(0,0,0,.24)]">
                <Tractor className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">悦信云智管</p>
                <p className="mt-0.5 text-xs text-[#cce4d5]">
                  机械老板费用清单
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="进入我的资料"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
              onClick={() => navigate("/mobile/profile")}
            >
              <UserRound className="h-4.5 w-4.5" />
            </button>
          </div>
          <div className="relative mt-7">
            <p className="text-sm text-[#cce4d5]">
              您好，{user?.name || "机械老板"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              名下机械费用清单
            </h1>
            <p className="mt-2 text-xs leading-5 text-[#cce4d5]">
              仅展示后台明确绑定到本账号的机械；不可录入、审核、结算或查看其他项目设备。
            </p>
          </div>
        </header>

        <main className="space-y-5 px-5 py-5">
          {portal.isLoading ? (
            <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]">
              <CardContent className="flex items-center gap-2 p-4 text-sm text-[#547367]">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在核验名下机械并读取真实费用…
              </CardContent>
            </Card>
          ) : null}
          {portal.error ? (
            <Card className="border-[#d0b899] bg-[#fff5df]">
              <CardContent className="p-4 text-sm leading-6 text-[#885622]">
                {getUserFacingErrorMessage(
                  portal.error,
                  "暂无法读取名下机械费用，请稍后刷新"
                )}
              </CardContent>
            </Card>
          ) : null}
          {portal.data?.status === "unbound" ? (
            <Card className="border-[#d8e3e0] bg-white">
              <CardContent className="p-5 text-center">
                <Building2 className="mx-auto h-7 w-7 text-[#6f9e86]" />
                <h2 className="mt-3 font-semibold text-[#284a3e]">
                  暂无名下机械绑定
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#6b7f75]">
                  请联系超级管理员，在“机械档案”中为设备选择您的机械老板账号。绑定后这里会显示名下机械最近最多100条有效成本记录。
                </p>
              </CardContent>
            </Card>
          ) : null}
          {portal.data?.status === "ready"
            ? portal.data.machines.map(item => (
                <section
                  key={item.machine.id}
                  className="overflow-hidden rounded-2xl border border-[#d8e3e0] bg-white shadow-[0_6px_18px_rgba(47,83,67,.07)]"
                >
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-[#284a3e]">
                          {item.machine.name}
                        </h2>
                        <Badge
                          variant="outline"
                          className="border-[#b7d1c3] bg-[#f2faf5] text-[#477460]"
                        >
                          {item.machine.code}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-[#6b7f75]">
                        {item.machine.projectName} ·{" "}
                        {item.machine.model || "型号未登记"}
                        {item.machine.plateOrAssetNo
                          ? ` · ${item.machine.plateOrAssetNo}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-[#d8e3e0] bg-[#f7fbf8] text-[#547367]"
                    >
                      {item.machine.ownership === "leased" ? "外租" : "自有"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-px border-y border-[#e7f0eb] bg-[#e7f0eb]">
                    {[
                      {
                        label: "最近100条内费用小计",
                        value: money(item.summary.totalExpense),
                        icon: Banknote,
                        accent: "text-[#9a5128]",
                      },
                      {
                        label: "最近有效成本记录",
                        value: `${item.summary.expenseCount} 笔`,
                        icon: ReceiptText,
                        accent: "text-[#477460]",
                      },
                      {
                        label: "油料费用",
                        value: money(item.summary.fuelExpense),
                        icon: Tractor,
                        accent: "text-[#73543c]",
                      },
                      {
                        label: "维修 / 加班",
                        value: `${money(item.summary.repairExpense)} / ${money(item.summary.overtimeExpense)}`,
                        icon: Wrench,
                        accent: "text-[#754b3e]",
                      },
                    ].map(metric => (
                      <div key={metric.label} className="bg-white p-3">
                        <metric.icon className="h-4 w-4 text-[#87a898]" />
                        <p className="mt-2 text-[11px] text-[#7a9086]">
                          {metric.label}
                        </p>
                        <p
                          className={`mt-0.5 text-sm font-bold ${metric.accent}`}
                        >
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="text-xs leading-5 text-[#885622]">
                      范围：每台机械最近最多100条有效机械成本，非全历史累计；不含独立租金应付、维保采购及实际付款，不与其他来源重复相加。
                    </p>
                    <p className="text-xs text-[#70857b]">
                      {item.machine.leaseRule
                        ? `合同计价：${({ monthly: "月租", daily: "日租", hourly: "小时租", shift: "台班" } as Record<string, string>)[item.machine.leaseRule.billingType]} ${money(item.machine.leaseRule.rate)}`
                        : "未登记有效计价合同"}
                    </p>
                    <Button
                      variant="outline"
                      className="h-10 w-full border-[#b9d2c4] bg-[#f7fbf8] text-[#35604e]"
                      onClick={() => setSelectedMachineId(item.machine.id)}
                    >
                      <FileText className="mr-1.5 h-4 w-4" />
                      查看费用明细 <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </section>
              ))
            : null}
          <Button
            variant="outline"
            className="w-full border-[#86aa98] bg-white text-[#35604e]"
            onClick={() => portal.refetch()}
            disabled={portal.isFetching}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${portal.isFetching ? "animate-spin" : ""}`}
            />
            {portal.isFetching ? "正在刷新…" : "刷新费用清单"}
          </Button>
        </main>
      </div>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={open => {
          if (!open) setSelectedMachineId(null);
        }}
      >
        <DialogContent className="max-h-[86dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>机械费用明细</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-[#edf6f0] p-3">
                <p className="font-semibold text-[#284a3e]">
                  {selected.machine.name} · {selected.machine.code}
                </p>
                <p className="mt-1 text-xs text-[#547367]">
                  {selected.machine.projectName} · 最近最多100条中{" "}
                  {selected.summary.expenseCount} 笔有效机械成本（非全累计）
                </p>
              </div>
              <div className="space-y-2">
                {selected.expenses.length ? (
                  selected.expenses.map(record => (
                    <div
                      key={String(record.id)}
                      className="rounded-xl border border-[#e0ebe4] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#335a4a]">
                            {record.costName}
                          </p>
                          <p className="mt-1 text-xs text-[#71877c]">
                            {costTypeLabel(record.costType)} ·{" "}
                            {formatChinaDateTime(record.occurredAt, "未记录")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[#9a5128]">
                            {money(record.amount)}
                          </p>
                          <Badge
                            variant="outline"
                            className="mt-1 border-[#d8e3e0] text-[10px] text-[#547367]"
                          >
                            {costStatusLabel(record.status)}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-[#71877c]">
                        数量 {record.quantity} × 单价 {money(record.unitPrice)}
                        {record.remarks ? ` · ${record.remarks}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-[#d8e3e0] p-4 text-center text-sm text-[#71877c]">
                    该机械暂无有效费用记录。
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
