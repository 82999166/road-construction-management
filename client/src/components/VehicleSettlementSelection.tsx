import React, { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import {
  downloadCurrentFilteredCsv,
  escapePrintHtml,
  openA4PrintDocument,
} from "@/lib/a4Print";
import { formatChinaDateTime } from "@/lib/businessTime";
import {
  addInclusiveSettlementDays,
  inclusiveSettlementDayCount,
  settlementPositiveInteger,
  type VehicleSettlementMode,
  type VehicleSettlementPreview,
} from "@/lib/vehicleSettlementSelection";
import { formatAmount, formatQuantity } from "@shared/numberFormat";

export type {
  VehicleSettlementMode,
  VehicleSettlementPreview,
} from "@/lib/vehicleSettlementSelection";

export type VehicleSettlementSelectionProps = {
  mode: VehicleSettlementMode;
  tripCount: string;
  periodStart: string;
  periodEnd: string;
  onModeChange: (mode: VehicleSettlementMode) => void;
  onTripCountChange: (value: string) => void;
  onPeriodChange: (start: string, end: string) => void;
  preview?: VehicleSettlementPreview;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  disabled?: boolean;
  plateNo: string;
};

const modeLabels: Record<VehicleSettlementMode, string> = {
  day: "按天结算（默认）",
  period: "日期范围",
  trip_count: "指定趟数",
};
const previewNotice =
  "这是生成前预览，仅展示运费基数。柴油、资产、前期抵扣和净应付由服务端生成草稿时计算，预览不代表付款或收付结果。";
const money = (value: number | string | null) =>
  value === null || value === "" ? "—" : formatAmount(value);
const quantity = (value: number | string | null | undefined) =>
  value == null || value === "" ? "—" : formatQuantity(value);
// Also protect whitespace/tab-prefixed formulas before the shared CSV escaping helper.
const safeCsvValue = (value: string | number | null | undefined) => {
  if (typeof value !== "string") return value;
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value)
    ? `'${value}`
    : value;
};

/** Presentational only: the parent owns API queries, mode/date changes and draft creation. */
export function VehicleSettlementSelection({
  mode,
  tripCount,
  periodStart,
  periodEnd,
  onModeChange,
  onTripCountChange,
  onPeriodChange,
  preview,
  loading,
  error,
  onRefresh,
  disabled = false,
  plateNo,
}: VehicleSettlementSelectionProps) {
  const id = useId();
  const actualDays = inclusiveSettlementDayCount(periodStart, periodEnd);
  const [days, setDays] = useState(() =>
    actualDays === undefined ? "" : String(actualDays)
  );
  const [outputError, setOutputError] = useState("");
  useEffect(() => {
    setDays(actualDays === undefined ? "" : String(actualDays));
  }, [periodStart, periodEnd, actualDays]);
  useEffect(() => {
    setOutputError("");
  }, [mode, periodStart, periodEnd, tripCount, preview]);

  const dateError =
    actualDays === undefined
      ? "请填写有效的开始和结束日期，结束日期不能早于开始日期。"
      : mode === "day" && periodStart !== periodEnd
        ? "按天结算必须为同一天，请重新选择结算日期。"
        : "";
  const tripError =
    mode === "trip_count" &&
    settlementPositiveInteger(tripCount, 1000) === undefined
      ? "指定趟数须为 1–1000 的正整数。"
      : "";
  const daysEnd = addInclusiveSettlementDays(periodStart, days);
  const daysError =
    mode !== "day" && !daysEnd
      ? "连续天数须为 1–3650 的正整数，且开始日期有效。"
      : "";
  const busy = disabled || loading;
  const visiblePreview =
    !loading && !error && !dateError && !tripError ? preview : undefined;
  const pagination = useFinancePagination(
    visiblePreview?.rows ?? [],
    JSON.stringify([
      plateNo,
      mode,
      periodStart,
      periodEnd,
      tripCount,
      visiblePreview?.tripIds,
    ])
  );
  const canOutput =
    !busy &&
    !!visiblePreview &&
    (visiblePreview.rows.length > 0 || visiblePreview.dailyGroups.length > 0);

  const printAll = () => {
    if (!canOutput || !visiblePreview) return;
    try {
      const html = escapePrintHtml;
      const rows = visiblePreview.rows
        .map(
          (row, index) =>
            `<tr><td>${index + 1}</td><td>${html(row.tripNo)}</td><td>${html(formatChinaDateTime(row.startAt))}</td><td>${html(quantity(row.quantity))}</td><td>${html(money(row.unitPrice))}</td><td>${html(money(row.grossAmount))}</td></tr>`
        )
        .join("");
      const groups = visiblePreview.dailyGroups
        .map(
          group =>
            `<tr><td>${html(group.date)}</td><td>${html(group.tripCount)}</td><td>${html(money(group.grossFreightAmount))}</td></tr>`
        )
        .join("");
      openA4PrintDocument({
        title: "渣土车结算生成前预览",
        orientation: "portrait",
        bodyHtml: `<h1>渣土车结算生成前预览</h1><p class="sub">车牌 ${html(plateNo)} · ${html(modeLabels[mode])} · ${html(periodStart)} 至 ${html(periodEnd)}（起止当天均包含）${mode === "trip_count" ? ` · 最早 ${html(tripCount)} 趟` : ""}</p><p>${html(previewNotice)}</p><p>可结算 ${html(visiblePreview.availableCount)} 趟 · 本次选取 ${html(visiblePreview.selectedCount)} 趟 · 运费基数 ¥${html(money(visiblePreview.grossFreightAmount))}</p>${visiblePreview.reason ? `<p>${html(visiblePreview.reason)}</p>` : ""}<h2>完整逐趟明细（${visiblePreview.rows.length} 条）</h2><table><thead><tr><th>序号</th><th>运单号</th><th>业务时间（北京时间）</th><th>数量</th><th>单价</th><th>运费基数</th></tr></thead><tbody>${rows}</tbody></table><h2>完整逐日汇总（${visiblePreview.dailyGroups.length} 天）</h2><table><thead><tr><th>日期</th><th>选取趟数</th><th>运费基数</th></tr></thead><tbody>${groups}</tbody></table>`,
      });
      setOutputError("");
    } catch {
      setOutputError("打印预览失败，请重试；未生成或修改结算单。");
    }
  };
  const exportAll = () => {
    if (!canOutput || !visiblePreview) return;
    try {
      const headers = [
        "记录类型",
        "车牌",
        "业务日期/时间（北京时间）",
        "运单号",
        "数量",
        "单价",
        "趟数",
        "运费基数",
        "说明",
      ];
      const rows: Array<Array<string | number | null | undefined>> = [
        [
          "生成前预览",
          plateNo,
          `${periodStart} 至 ${periodEnd}`,
          "",
          "",
          "",
          visiblePreview.selectedCount,
          visiblePreview.grossFreightAmount,
          `${modeLabels[mode]}；${previewNotice}`,
        ],
        [
          "可结算趟数",
          plateNo,
          "",
          "",
          "",
          "",
          visiblePreview.availableCount,
          "",
          visiblePreview.reason ?? "",
        ],
        ...visiblePreview.rows.map(row => [
          "逐趟明细",
          plateNo,
          formatChinaDateTime(row.startAt),
          row.tripNo,
          quantity(row.quantity),
          money(row.unitPrice),
          1,
          money(row.grossAmount),
          "",
        ]),
        ...visiblePreview.dailyGroups.map(group => [
          "逐日汇总",
          plateNo,
          group.date,
          "",
          "",
          "",
          group.tripCount,
          group.grossFreightAmount,
          "",
        ]),
      ];
      const filePlate = plateNo.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
      downloadCurrentFilteredCsv(
        `结算生成前预览-${filePlate}-${periodStart}-${periodEnd}.csv`,
        headers,
        rows.map(row => row.map(safeCsvValue))
      );
      setOutputError("");
    } catch {
      setOutputError("导出预览失败，请重试；未生成或修改结算单。");
    }
  };

  return (
    <section
      aria-label="渣土车合并结算选择"
      aria-busy={loading}
      className="w-full min-w-0 max-w-full space-y-4 rounded-xl border border-border bg-background p-3 text-foreground sm:p-4 [overflow-wrap:anywhere]"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold">
          合并结算 · {plateNo || "待选择车辆"}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {previewNotice}
        </p>
      </div>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <legend className="mb-2 text-sm font-medium">结算选取方式</legend>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          {(Object.keys(modeLabels) as VehicleSettlementMode[]).map(value => (
            <label
              key={value}
              className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${value === mode ? "border-primary bg-primary/5 text-primary" : "border-border"}`}
            >
              <input
                aria-label={modeLabels[value]}
                type="radio"
                name={`${id}-mode`}
                value={value}
                checked={mode === value}
                disabled={busy}
                onChange={() => onModeChange(value)}
              />
              <span className="min-w-0 break-words">{modeLabels[value]}</span>
            </label>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          切换方式仅改变选取规则，不生成结算。切回按天时，结束日期由父页面同步为开始日期；日期范围和指定趟数保留当前起止日期。
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1 text-sm">
            <span>{mode === "day" ? "结算日期" : "开始日期（包含当天）"}</span>
            <Input
              aria-label={mode === "day" ? "结算日期" : "结算开始日期"}
              aria-invalid={!!dateError}
              className="max-w-full"
              type="date"
              value={periodStart}
              disabled={busy}
              onChange={event =>
                onPeriodChange(
                  event.target.value,
                  mode === "day" ? event.target.value : periodEnd
                )
              }
            />
          </label>
          {mode !== "day" && (
            <label className="min-w-0 space-y-1 text-sm">
              <span>结束日期（包含当天）</span>
              <Input
                aria-label="结算结束日期"
                aria-invalid={!!dateError}
                className="max-w-full"
                type="date"
                value={periodEnd}
                disabled={busy}
                onChange={event =>
                  onPeriodChange(periodStart, event.target.value)
                }
              />
            </label>
          )}
        </div>
        {mode !== "day" && (
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <label className="block min-w-0 space-y-1 text-sm">
              <span>连续天数（快捷输入）</span>
              <Input
                aria-label="连续结算天数"
                aria-invalid={!!daysError}
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                value={days}
                disabled={busy}
                onChange={event => setDays(event.target.value)}
              />
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !daysEnd}
                onClick={() => {
                  if (daysEnd) onPeriodChange(periodStart, daysEnd);
                }}
              >
                应用连续天数
              </Button>
              <span className="min-w-0 text-xs text-muted-foreground">
                {daysEnd
                  ? `应用后：${periodStart} 至 ${daysEnd}（含起止当天）`
                  : "输入 1–3650 天"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              当前实际范围：{periodStart || "未填"} 至 {periodEnd || "未填"}
              {actualDays === undefined ? "" : `，共 ${actualDays} 天`}
              。只有点击“应用连续天数”才更新实际起止日期。
            </p>
            {daysError && (
              <p role="alert" className="text-xs text-destructive">
                {daysError}
              </p>
            )}
          </div>
        )}
        {mode === "trip_count" && (
          <div className="space-y-2">
            <label className="block min-w-0 space-y-1 text-sm">
              <span>指定趟数（1–1000）</span>
              <Input
                aria-label="指定结算趟数"
                aria-invalid={!!tripError}
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                value={tripCount}
                disabled={busy}
                onChange={event => onTripCountChange(event.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              在日期范围内按业务时间从早到晚取最早 N
              趟，可跨天，不可随意跳过较早运单。可结算趟数不足时以服务端预览原因提示为准。
            </p>
          </div>
        )}
      </fieldset>
      {(dateError || tripError) && (
        <p role="alert" className="text-sm text-destructive">
          {dateError || tripError}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">生成前预览</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={busy || !!dateError || !!tripError}
        >
          刷新预览
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        刷新仅重新读取可结算数据，不写入、不生成、不锁定运单。
      </p>
      {loading ? (
        <p role="status" className="rounded-lg bg-muted/40 p-3 text-sm">
          正在读取生成前预览，请稍候…
        </p>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          预览读取失败：{error}。可点击刷新预览重试。
        </p>
      ) : !dateError && !tripError && !preview ? (
        <p role="status" className="rounded-lg bg-muted/40 p-3 text-sm">
          尚无预览，请刷新读取当前选择的可结算运单。
        </p>
      ) : null}
      {visiblePreview && (
        <>
          <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["可结算趟数", `${visiblePreview.availableCount} 趟`],
              ["本次选取趟数", `${visiblePreview.selectedCount} 趟`],
              ["运费基数", `¥${money(visiblePreview.grossFreightAmount)}`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 rounded-lg border border-border bg-muted/30 p-3"
              >
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {visiblePreview.reason && (
            <p
              role={visiblePreview.eligible ? "status" : "alert"}
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              {visiblePreview.reason}
            </p>
          )}
          {visiblePreview.eligible && (
            <p className="text-xs text-muted-foreground">
              预览符合选取条件；生成草稿时服务端仍会重新核验趟次及金额。
            </p>
          )}
          {!visiblePreview.rows.length && (
            <p role="status" className="rounded-lg bg-muted/40 p-3 text-sm">
              当前选择暂无可预览的逐趟明细，请调整日期或刷新预览。
            </p>
          )}
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canOutput}
              onClick={printAll}
            >
              打印完整预览
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canOutput}
              onClick={exportAll}
            >
              导出完整预览 CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            打印和导出包含全部逐趟明细及逐日汇总，不受当前分页或折叠状态影响。
          </p>
          <details className="min-w-0 rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              逐趟明细（{visiblePreview.rows.length} 条）
            </summary>
            <div className="mt-3 min-w-0 space-y-3">
              <table
                aria-label="结算预览逐趟明细"
                className="w-full max-w-full table-fixed text-left text-xs"
              >
                <thead>
                  <tr className="border-b">
                    <th className="w-[9%] py-2">序号</th>
                    <th className="w-[37%] py-2">运单 / 北京时间</th>
                    <th className="w-[16%] py-2">数量</th>
                    <th className="w-[18%] py-2">单价</th>
                    <th className="w-[20%] py-2">运费基数</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageRows.map((row, index) => (
                    <tr
                      key={row.id}
                      className="border-b align-top [overflow-wrap:anywhere]"
                    >
                      <td className="py-2 pr-1">
                        {(pagination.page - 1) * pagination.pageSize +
                          index +
                          1}
                      </td>
                      <td className="py-2 pr-1">
                        <p className="break-all font-medium">{row.tripNo}</p>
                        <p className="mt-1 text-muted-foreground">
                          {formatChinaDateTime(row.startAt)}
                        </p>
                      </td>
                      <td className="py-2 pr-1">{row.quantity == null ? "—" : quantity(row.quantity)}</td>
                      <td className="py-2 pr-1">{money(row.unitPrice)}</td>
                      <td className="py-2">{money(row.grossAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <fieldset disabled={disabled} className="min-w-0">
                <FinancePagination
                  label="预览趟次"
                  page={pagination.page}
                  pageSize={pagination.pageSize}
                  total={pagination.total}
                  onPageChange={pagination.setPage}
                  onPageSizeChange={pagination.setPageSize}
                />
              </fieldset>
            </div>
          </details>
          <details className="min-w-0 rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              逐日汇总（{visiblePreview.dailyGroups.length} 天，仅本次选取趟次）
            </summary>
            <table
              aria-label="结算预览逐日汇总"
              className="mt-3 w-full table-fixed text-left text-xs"
            >
              <thead>
                <tr className="border-b">
                  <th className="py-2">业务日期</th>
                  <th className="py-2">选取趟数</th>
                  <th className="py-2">运费基数</th>
                </tr>
              </thead>
              <tbody>
                {visiblePreview.dailyGroups.map(group => (
                  <tr
                    key={group.date}
                    className="border-b [overflow-wrap:anywhere]"
                  >
                    <td className="py-2">{group.date}</td>
                    <td className="py-2">{group.tripCount}</td>
                    <td className="py-2">¥{money(group.grossFreightAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visiblePreview.dailyGroups.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                暂无逐日汇总。
              </p>
            )}
          </details>
        </>
      )}
      {outputError && (
        <p role="alert" className="text-sm text-destructive">
          {outputError}
        </p>
      )}
    </section>
  );
}

export default VehicleSettlementSelection;
