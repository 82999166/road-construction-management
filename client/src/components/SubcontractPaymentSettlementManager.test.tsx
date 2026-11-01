import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const component = readFileSync(resolve(process.cwd(), "client/src/components/SubcontractPaymentSettlementManager.tsx"), "utf8");

describe("SubcontractPaymentSettlementManager", () => {
  it("keeps confirmed packages on the payable settlement workflow instead of direct package settlement", () => {
    expect(component).toContain("已确认分包包件");
    expect(component).toContain("建立应付草稿");
    expect(component).toContain("提交审核");
    expect(component).toContain("会计审核");
    expect(component).toContain("登记分笔付款");
    expect(component).toContain("只有余额结清后包件才会标记为已结算");
  });

  it("routes actual subcontract payment through the common proof, balance and payment-record dialog", () => {
    expect(component).toContain("SettlementPaymentDialog");
    expect(component).toContain('settlementType="subcontract"');
    expect(component).toContain("settlementPayment.monthlyReconciliation.invalidate()");
    expect(component).toContain("部分付款");
    expect(component).not.toContain('targetStatus: "paid"');
    expect(component).not.toContain("paymentReference, setPaymentReference");
  });

  it("captures payment method and invoice evidence, then filters exports and renders a separate A4 summary", () => {
    expect(component).toContain("paymentMethod");
    expect(component).toContain("invoiceEvidenceId");
    expect(component).toContain("filteredSettlements");
    expect(component).toContain("CurrentFilterPrintActions");
    expect(component).toContain("downloadCurrentFilteredCsv");
    expect(component).toContain("openA4LandscapePrintDocument");
    expect(component).toContain("合计：结算单");
  });

  it("uses Chinese status labels and China-date format in table, export and print", () => {
    expect(component).toContain("invoiceStatusDisplay(item.invoiceStatus)");
    expect(component).toContain("paymentMethodDisplay(item.paymentMethod)");
    expect(component).toContain("settlementStatusDisplay(item.status)");
    expect(component).toContain("formatChinaDate(item.paymentDate)");
    expect(component).toContain("formatChinaDateTime(new Date())");
  });
});
