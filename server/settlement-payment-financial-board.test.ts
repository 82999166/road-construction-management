import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("结算财务看板、月度内部对账与凭证批打", () => {
  it("将分包纳入统一逐笔凭证付款，而不是旧的一次性付款流水", () => {
    const schema = read("../drizzle/schema.ts");
    const paymentRouter = read("./routers/settlementPayments.ts");
    const subcontract = read("./routers/subcontract.ts");
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"daily_wage", "subcontract"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"approved", "partial", "paid", "void"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "settlement_payment_records_project_date_type_status_index"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'input.settlementType === "subcontract"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'category: "分包结算实际付款"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'status: input.final ? "paid" : "partial"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      subcontract.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'approved: ["void"]'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      subcontract.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      'sourceType: "subcontract_payment_settlement"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("资金看板服务端按主单减有效付款和车辆有效抵扣重算余额，不返回账户或证据链接", () => {
    const paymentRouter = read("./routers/settlementPayments.ts");
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "transportVehicleCarryForwardOffsets"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "buildPaymentTotals".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "offsetBySettlement".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "monthlyReconciliation".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'settlementPaymentRecords.status, "active"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "默认不返回完整账户".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      paymentRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "付款台账月度内部对账：仅以实际 paymentDate 落月"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("财务工作区同时提供待付款/待收补款看板、A4凭证批打和三表月度导出", () => {
    const admin = read("../client/src/pages/AdminPage.tsx");
    const panel = read(
      "../client/src/components/SettlementPaymentFinancialBoard.tsx"
    );
    const voucher = read(
      "../client/src/components/SettlementPaymentVoucherBatchDialog.tsx"
    );
    const printer = read("../client/src/lib/a4Print.ts");
    expect(admin.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "SettlementPaymentFinancialBoard"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(panel.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "待付款 / 待收补款财务看板"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(panel.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "付款凭证批打与月度内部对账"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(panel.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "付款台账月度内部对账单（非银行账单自动对账）"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(panel.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "月度汇总".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(panel.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "付款明细".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(voucher.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'orientation: "portrait"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(voucher.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "一笔一页 A4 纵向".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(voucher.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "账户、支付参考号和凭证链接默认不打印"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(printer.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "openA4PrintDocument".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(printer.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "escapeSpreadsheetCell".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });
});
