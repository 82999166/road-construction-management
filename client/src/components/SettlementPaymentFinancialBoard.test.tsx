import React, { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toChinaDateInput, toChinaMonthInput } from "@/lib/businessTime";
import {
  buildSettlementPaymentWorkbook, paymentRecordNavigationRow, settlementPaymentBoardRows,
  settlementPaymentQueryPlan, type SettlementPaymentMonthlyData, type SettlementPaymentSourceType,
} from "./SettlementPaymentFinancialBoard.helpers";
import SettlementPaymentFinancialBoard from "./SettlementPaymentFinancialBoard";

const hooks = vi.hoisted(() => ({ board: vi.fn(), monthly: vi.fn(), voucher: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { settlementPayment: { board: { useQuery: hooks.board }, monthlyReconciliation: { useQuery: hooks.monthly } } } }));
vi.mock("@/components/SettlementPaymentVoucherBatchDialog", () => ({ SettlementPaymentVoucherBatchDialog: (props: unknown) => { hooks.voucher(props); return null; } }));

const source = readFileSync(new URL("./SettlementPaymentFinancialBoard.tsx", import.meta.url), "utf8");
const helpers = readFileSync(new URL("./SettlementPaymentFinancialBoard.helpers.ts", import.meta.url), "utf8");
const boardRows = Array.from({ length: 45 }, (_, index) => ({ sourceType: "machine", sourceLabel: "机械结算", settlementId: index + 1, settlementNo: `BOARD-${index + 1}`, direction: "expense", lifecycle: "ready", businessStatus: "approved", originalAmount: 100, paidOrRecoveredAmount: 20, offsetAmount: 0, remainingAmount: 80, counterpartyDisplay: "机械收款人", periodLabel: "2026-09", canRegisterSettlementPayment: index !== 1, legacyFinalized: false }));
const monthlyData: SettlementPaymentMonthlyData = {
  meta: { projectId: 8, period: "2026-10", generatedAt: "2026-11-01T01:00:00.000Z", sourceTypes: ["machine"], direction: "all", status: "all", paymentMethod: "all", keyword: "" },
  records: Array.from({ length: 45 }, (_, index) => ({ id: index + 1, voucherNo: `SPV-8-${index + 1}`, settlementType: "machine", settlementTypeLabel: "机械结算", settlementId: index + 1, settlementNo: `SETTLE-${index + 1}`, periodLabel: "2026-09", direction: "expense", status: index === 44 ? "reversed" : "active", amount: 100, paymentDate: "2026-10-02", paymentMethod: "cash", paymentMethodLabel: "现金", payeeName: "机械收款人", operatorName: "会计", paidAt: new Date("2026-10-02T01:00:00Z"), proof: { evidenceId: index + 50, fileName: index === 0 ? null : `凭证${index + 1}.pdf`, mimeType: "application/pdf", sha256Prefix: "123456789abc" }, reconciliationStatus: "matched" })),
  // Intentionally not derived from pageRows: prove UI and export consume the backend summary.
  summary: { activeExpenseAmount: 8765.43, activeIncomeAmount: 321.09, reversedAmount: 100, matching: { matched: 44, missing: 1, inconsistent: 0 }, byType: [{ sourceType: "machine", label: "机械结算", count: 45, activeExpenseAmount: 8765.43, activeIncomeAmount: 321.09, reversedAmount: 100, matched: 44, missing: 1, inconsistent: 0 }] },
};

function queryResult(data: unknown, options: { isFetching?: boolean; isError?: boolean } = {}) {
  return { data, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(), ...options };
}
function render(props: Partial<React.ComponentProps<typeof SettlementPaymentFinancialBoard>> = {}) {
  return renderToStaticMarkup(createElement(SettlementPaymentFinancialBoard, { projectId: 8, period: "2026-10", ...props }));
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.board.mockReturnValue(queryResult({ asOfDate: "2026-11-04", rows: boardRows, summary: { payable: { count: 45, amount: 99999.12 }, receivable: { count: 0, amount: 0 }, partial: { count: 0, amount: 0 }, approvalPending: { count: 0, amount: 0 }, byType: [] } }));
  hooks.monthly.mockReturnValue(queryResult(monthlyData));
});

describe("结算工作台视图查询与兼容", () => {
  it.each([
    ["all", true, true], ["board", true, false], ["records", false, true], ["reconciliation", false, true],
  ] as const)("%s 仅启用所需数据源", (view, board, monthly) => {
    expect(settlementPaymentQueryPlan(view, true, 8, "2026-10", "2026-11-04")).toEqual({ board, monthly });
    render({ view });
    expect(hooks.board.mock.lastCall?.[1].enabled).toBe(board);
    expect(hooks.monthly.mock.lastCall?.[1].enabled).toBe(monthly);
  });
  it.each(["all", "board", "records", "reconciliation"] as const)("隐藏 %s 不发起任何财务请求也不使用缓存摘要", view => {
    const html = render({ view, enabled: false });
    expect(hooks.board.mock.lastCall?.[1].enabled).toBe(false);
    expect(hooks.monthly.mock.lastCall?.[1].enabled).toBe(false);
    expect(html).not.toContain("99,999.12");
    expect(html).not.toContain("8,765.43");
    expect(hooks.voucher.mock.lastCall?.[0].records).toHaveLength(0);
  });
  it("默认all保留两种旧视图、完整下载和有效凭证批打", () => {
    const html = render();
    expect(html).toContain("待付款 / 待收补款财务看板");
    expect(html).toContain("付款凭证批打与月度内部对账");
    expect(html).toContain("月度汇总及付款明细");
    expect(html).toContain("批量打印凭证");
  });
  it("records显示真实付款行；reconciliation仅提供简洁摘要和完整下载", () => {
    const records = render({ view: "records" });
    expect(records).toContain("SPV-8-1");
    expect(records).not.toContain("待付款 / 待收补款财务看板");
    const reconciliation = render({ view: "reconciliation" });
    expect(reconciliation).toContain("8,765.43");
    expect(reconciliation).not.toContain("SPV-8-1");
    expect(reconciliation).not.toContain("真实付款记录分页");
    expect(hooks.voucher.mock.lastCall?.[0].records).toHaveLength(45);
  });
  it("受控月份进入query；截至日与月份各自采用北京时间且互不替代", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T16:30:00Z"));
    try {
      expect(toChinaDateInput()).toBe("2026-11-01");
      expect(toChinaMonthInput()).toBe("2026-11");
      render({ period: "2026-09" });
      expect(hooks.board.mock.lastCall?.[0].asOfDate).toBe("2026-11-01");
      expect(hooks.monthly.mock.lastCall?.[0].period).toBe("2026-09");
      render({ period: undefined });
      expect(hooks.monthly.mock.lastCall?.[0].period).toBe("2026-11");
    } finally { vi.useRealTimers(); }
    expect(source).toContain("const period = controlledPeriod ?? localPeriod");
    expect(source).toContain("if (controlledPeriod === undefined) setLocalPeriod(nextPeriod)");
    expect(source).toContain("onPeriodChange?.(nextPeriod)");
  });
  it("非法月份、截至日与无项目不会触发相应query", () => {
    expect(settlementPaymentQueryPlan("all", true, 0, "2026-10", "2026-11-04")).toEqual({ board: false, monthly: false });
    expect(settlementPaymentQueryPlan("all", true, 8, "2026-13", "2026-11-04")).toEqual({ board: true, monthly: false });
    expect(settlementPaymentQueryPlan("all", true, 8, "2026-10", "")).toEqual({ board: false, monthly: true });
    expect(render({ period: "2026-13", view: "records" })).toContain("请选择有效付款月份");
  });
});

describe("分页不截断后端摘要、Excel与有效凭证", () => {
  it("两张表只显示当前20行而非全量45行，摘要仍用原后端数值", () => {
    const html = render();
    expect(html).toContain("BOARD-20");
    expect(html).not.toContain("BOARD-21");
    expect(html).toContain("SPV-8-20");
    expect(html).not.toContain("SPV-8-21");
    expect(html).toContain("99,999.12");
    expect(html).toContain("8,765.43");
    expect(html).toContain("共 45 条");
    const voucherProps = hooks.voucher.mock.lastCall?.[0];
    expect(voucherProps.records).toHaveLength(45);
    expect(voucherProps.records.filter((row: { status: string }) => row.status === "active")).toHaveLength(44);
    expect(voucherProps.records[0].proof.fileName).toBe("未命名凭证");
  });
  it("工作簿保留完整45笔、冲正说明、内部非银行口径与脱敏", () => {
    const workbook = buildSettlementPaymentWorkbook(monthlyData, "项目甲");
    expect(workbook.filename).toContain("2026-10");
    expect(workbook.sheets[1].rows).toHaveLength(45);
    expect(workbook.sheets[1].rows[44]).toContain("SPV-8-45");
    expect(workbook.sheets[1].rows[44]).toContain("已冲正");
    expect(workbook.sheets[0].rows[0]).toContain(8765.43);
    expect(workbook.overview).toContainEqual(["付款记录数", 45]);
    expect(JSON.stringify(workbook)).toContain("非银行账单自动对账");
    expect(JSON.stringify(workbook)).not.toContain("paidAt");
    expect(JSON.stringify(workbook)).not.toContain("evidenceId");
    expect(helpers).not.toMatch(/pageRows|payeeAccount|paymentReference|storageKey|signedUrl/);
  });
  it("只在表格map使用共用pageRows；筛选、项目及月份进入重置key", () => {
    expect(source).toContain("useFinancePagination(boardRows, JSON.stringify(boardInput))");
    expect(source).toContain("useFinancePagination(paymentRecords, JSON.stringify(reconciliationInput))");
    expect(source.match(/pageRows\.map/g)).toHaveLength(2);
    expect(source).toContain("buildSettlementPaymentWorkbook(monthlyData, projectText)");
    expect(source).toContain("records={voucherRecords}");
    expect(source).not.toMatch(/function (?:FinancePagination|useFinancePagination)/);
  });
  it("错误及重新请求期间禁用下载和打印，不打印旧范围", () => {
    hooks.monthly.mockReturnValue(queryResult(monthlyData, { isFetching: true }));
    const fetching = render({ view: "records" });
    expect(fetching).toMatch(/<button[^>]*disabled[^>]*>[^<]*<svg[^]*?批量打印凭证/);
    expect(hooks.voucher.mock.lastCall?.[0].open).toBe(false);
    hooks.monthly.mockReturnValue({ ...queryResult(monthlyData, { isError: true }), error: { message: "无权读取当前项目" } });
    const failed = render({ view: "records" });
    expect(failed).toContain("无权读取当前项目");
    expect(failed).not.toContain("SPV-8-1");
    expect(hooks.voucher.mock.lastCall?.[0].records).toHaveLength(0);
    expect(source).toContain("setVoucherOpen(false)");
    expect(source).toContain("[projectId, period, sourceType, direction, keyword, paymentStatus, paymentMethod, view, enabled]");
  });
});

describe("原DTO、原权限及结算只导航", () => {
  it("验证看板DTO原数值和权限而不重算或推断", () => {
    const normalized = settlementPaymentBoardRows(boardRows);
    expect(normalized).toHaveLength(45);
    expect(normalized[0]).toBe(boardRows[0]);
    expect(normalized[1].canRegisterSettlementPayment).toBe(false);
    expect(settlementPaymentBoardRows([{ sourceType: "future_type", settlementId: 1 }])).toEqual([]);
  });
  it.each(["transport_vehicle", "machine", "payroll", "daily_wage", "subcontract"] as SettlementPaymentSourceType[])("%s付款记录只投影结算定位信息，不伪造付款授权", type => {
    const row = paymentRecordNavigationRow(8, { ...monthlyData.records[0], settlementType: type });
    expect(row).toEqual({ projectId: 8, sourceType: type, settlementId: 1, settlementNo: "SETTLE-1", periodLabel: "2026-09", direction: "expense" });
    expect(row).not.toHaveProperty("canRegisterSettlementPayment");
    expect(row).not.toHaveProperty("amount");
  });
  it("无回调不显示导航；有回调按后端board权限与原父导航办理", () => {
    const noNavigation = render({ view: "board" });
    expect(noNavigation).not.toMatch(/<button[^>]*>进入结算台账/);
    const withNavigation = render({ view: "board", onNavigateToSettlement: vi.fn() });
    expect(withNavigation.match(/<button[^>]*>进入结算台账/g)).toHaveLength(19);
    expect(withNavigation.match(/<button[^>]*>只读查看结算/g)).toHaveLength(1);
    expect(source).toContain("row.canRegisterSettlementPayment ?");
    expect(source).toContain("onNavigateToSettlement(paymentRecordNavigationRow(projectId, record))");
    expect(source).not.toMatch(/useMutation|\.mutate\(|window\.location|location\.href/);
  });
  it("共享筛选在各view可见且query使用同一state，金额直接使用后端summary", () => {
    for (const view of ["board", "records", "reconciliation"] as const) {
      const html = render({ view });
      expect(html).toContain("当前筛选范围");
      expect(html).toContain("结算类型");
      expect(html).toContain("收付方向");
      expect(html).toContain("结算单号 / 对方 / 业务归属 / 凭证编号");
    }
    expect(source).toContain("boardData?.summary.payable.amount");
    expect(source).toContain("monthlyData?.summary.activeExpenseAmount");
    expect(source).not.toContain(".reduce(");
    expect(source).not.toContain("toISOString().slice(0");
  });
});
