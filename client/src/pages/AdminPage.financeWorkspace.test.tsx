import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
const text = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
const normalized = text.replace(/\s+/g, " ");
const source = ts.createSourceFile(
  "AdminPage.tsx",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const section = text.slice(
  text.indexOf("  const renderFinance ="),
  text.indexOf("  const renderRisk =")
);
const norm = section.replace(/\s+/g, " ");
const querySection = (name: string, next: string) => {
  const start = text.indexOf(`  const ${name} =`);
  return text.slice(start, text.indexOf(`  const ${next}`, start + 1));
};
describe("财务七栏目工作区完整性", () => {
  it("完整JSX可解析且财务默认总览，柴油仍使用独立业务模块", () => {
    expect(
      (source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics
    ).toHaveLength(0);
    expect(normalized).toContain('useState<FinanceWorkspaceTab>("overview")');
    expect(norm).toContain("<FinanceWorkspaceNavigation");
    expect(norm).toContain('active={isDiesel} label="柴油管理"');
    expect(norm).toContain('setLocation("/admin/diesel")');
  });
  it("各财务内容分配到保留式面板，切栏目不卸载资料草稿", () => {
    for (const label of [
      "财务总览",
      "收支账本",
      "成本分析",
      "发票管理",
      "日结封存",
      "财税交接",
    ]) {
      expect(norm).toContain(`label="${label}"`);
    }
    expect(norm).toContain('financeTab === "settlements"');
    expect(norm).toContain('financeTab === "closing"');
    expect(norm).toContain("onDirtyChange={setFinanceTaxDirty}");
    expect(normalized).toContain("confirmFinanceScopeChange");
    expect(normalized).toContain("当前财务资料有未保存内容");
  });
  it("资金、柴油、发票及财税读取按当前栏目开启而不是只CSS隐藏", () => {
    expect(querySection("financeSummary", "financeBusinessSummary")).toContain(
      'financeTab === "ledger"'
    );
    expect(querySection("financeInvoices", "dailyAccountingReport")).toContain(
      'financeTab === "invoices"'
    );
    expect(
      querySection("dieselGuidelinePrices", "dieselRefuelRecords")
    ).toContain("isDiesel");
    expect(norm).toContain('enabled={financeTab === "tax" && !isDiesel}');
    expect(norm).toContain('financeClosingView === "reconciliation"');
  });
  it("资金、发票、支出表只分页渲染，汇总和打印保留全部筛选结果", () => {
    expect(norm).toContain("financeLedgerPageRows.map");
    expect(norm).toContain("financeInvoicePageRows.map");
    expect(norm).toContain("expensePageRows.map");
    expect(norm).toContain("const invoicePrintRows = financeInvoiceRows.map");
    expect(norm).toContain("financeLedgerRows.map(record => [");
    expect(norm).toContain("total={financeLedgerRows.length}");
    expect(norm).toContain("total={financeInvoiceRows.length}");
  });
  it("打印先等待当前范围数据，并保留真实日结和成本日期说明", () => {
    expect(norm).toContain(
      "activeBook={financePrintReady ? financePrintPreview : null}"
    );
    expect(norm).toContain(
      "financePrintQuery.isSuccess && !financePrintQuery.isFetching"
    );
    expect(norm).toContain("全部筛选结果");
    expect(norm).toContain("明细日期范围");
    expect(norm).toContain("查看本月");
    expect(norm).toContain("日结封存、授权反结账与版本快照");
  });
  it("付款记录不推断新支付权限，复用原凭证闭环窗口且范围变更受控", () => {
    expect(norm).toContain("row.canRegisterSettlementPayment !== true");
    expect(norm).toContain("readOnly={financePaymentTarget.readOnly}");
    const dialog = readFileSync(
      new URL("../components/SettlementPaymentDialog.tsx", import.meta.url),
      "utf8"
    ).replace(/\s+/g, " ");
    expect(dialog).toContain("if (readOnly) return;");
    expect(dialog).toContain("!readOnly ? (");
    expect(dialog).toContain(
      "trpc.settlementPayment.uploadProof.useMutation()"
    );
    expect(dialog).toContain("trpc.settlementPayment.record.useMutation()");
  });
});
