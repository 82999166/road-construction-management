import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("结算财务看板、月度内部对账与凭证批打", () => {
  it("将分包纳入统一逐笔凭证付款，而不是旧的一次性付款流水", () => {
    const schema = read("../drizzle/schema.ts");
    const paymentRouter = read("./routers/settlementPayments.ts");
    const subcontract = read("./routers/subcontract.ts");
    expect(schema).toContain('"daily_wage", "subcontract"');
    expect(schema).toContain('"approved", "partial", "paid", "void"');
    expect(schema).toContain("settlement_payment_records_project_date_type_status_index");
    expect(paymentRouter).toContain('input.settlementType === "subcontract"');
    expect(paymentRouter).toContain('category: "分包结算实际付款"');
    expect(paymentRouter).toContain('status: input.final ? "paid" : "partial"');
    expect(subcontract).toContain('approved: ["void"]');
    expect(subcontract).not.toContain('sourceType: "subcontract_payment_settlement"');
  });

  it("资金看板服务端按主单减有效付款和车辆有效抵扣重算余额，不返回账户或证据链接", () => {
    const paymentRouter = read("./routers/settlementPayments.ts");
    expect(paymentRouter).toContain("transportVehicleCarryForwardOffsets");
    expect(paymentRouter).toContain("buildPaymentTotals");
    expect(paymentRouter).toContain("offsetBySettlement");
    expect(paymentRouter).toContain("monthlyReconciliation");
    expect(paymentRouter).toContain("settlementPaymentRecords.status, \"active\"");
    expect(paymentRouter).toContain("默认不返回完整账户");
    expect(paymentRouter).toContain("付款台账月度内部对账：仅以实际 paymentDate 落月");
  });

  it("财务工作区同时提供待付款/待收补款看板、A4凭证批打和三表月度导出", () => {
    const admin = read("../client/src/pages/AdminPage.tsx");
    const panel = read("../client/src/components/SettlementPaymentFinancialBoard.tsx");
    const voucher = read("../client/src/components/SettlementPaymentVoucherBatchDialog.tsx");
    const printer = read("../client/src/lib/a4Print.ts");
    expect(admin).toContain("SettlementPaymentFinancialBoard");
    expect(panel).toContain("待付款 / 待收补款财务看板");
    expect(panel).toContain("付款凭证批打与月度内部对账");
    expect(panel).toContain("付款台账月度内部对账单（非银行账单自动对账）");
    expect(panel).toContain("月度汇总");
    expect(panel).toContain("付款明细");
    expect(voucher).toContain('orientation: "portrait"');
    expect(voucher).toContain("一笔一页 A4 纵向");
    expect(voucher).toContain("账户、支付参考号和凭证链接默认不打印");
    expect(printer).toContain("openA4PrintDocument");
    expect(printer).toContain("escapeSpreadsheetCell");
  });
});
