import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("财务账本打印中心", () => {
  it("为资金总账、发票、成本分类与成本小类目挂载当前筛选明细和末行汇总预览", () => {
    const source = readFileSync(new URL("../pages/AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("FinancialLedgerPrintPreviewDialogs");
    expect(source).toContain('id: "ledger"');
    expect(source).toContain('id: "invoices"');
    expect(source).toContain('id: "categories"');
    expect(source).toContain('id: "subcategories"');
    expect(source).toContain("financeLedgerFilterLabel");
    expect(source).toContain("financeLedgerPrintRows");
    expect(source).toContain("financeSettlementStatusDisplay");
    expect(source).toContain("financeSourceTypeDisplay");
    expect(source).toContain("expenseCategoryDisplay");
    expect(source).toContain("expenseSourceDisplay");
    expect(source).not.toContain("settlementStatusLabel[record.settlementStatus] ?? record.settlementStatus");
    expect(source).not.toContain('sourceTypeLabel[record.sourceType ?? "manual"] ?? record.sourceType');
  });

  it("为财税辅助、交接、薪税、合同税费和跨地区预缴资料补齐按项目与期间打印", () => {
    const taxHandoff = readFileSync(new URL("./TaxAccountingHandoffManager.tsx", import.meta.url), "utf8");
    const taxCompliance = readFileSync(new URL("./TaxComplianceControlPanel.tsx", import.meta.url), "utf8");
    expect(taxHandoff).toContain("打印当前辅助事项明细与汇总");
    expect(taxHandoff).toContain("打印当前交接批次明细与汇总");
    expect(taxCompliance).toContain("打印薪税台账");
    expect(taxCompliance).toContain("打印合同税费台账");
    expect(taxCompliance).toContain("打印跨地区预缴台账");
    expect(taxCompliance).toContain("不自动推算预缴税额");
  });
});
