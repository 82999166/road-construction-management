import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("机械付款结算状态机", () => {
  it("将外租机械月结与月结快照、收款方式、凭证付款台账和不可逆结算状态绑定", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const paymentSource = readFileSync(new URL("./routers/settlementPayments.ts", import.meta.url), "utf8");

    expect(schema).toContain("machinePaymentSettlements");
    expect(schema).toContain("monthlyStatementId");
    expect(schema).toContain("machine_payment_settlements_statement_unique");
    expect(source).toContain("createPaymentSettlement");
    expect(source).toContain("transitionPaymentSettlement");
    expect(source).toContain("machine.ownership !== \"leased\"");
    expect(source).toContain("该机械结算单已完成付款，依据业务规则不能作废或回退");
    expect(source).toContain("machine_payment_settlement_${input.action}");
    expect(source).toContain("machineMonthlyStatements).set({ status: \"settled\" }");
    expect(source).toContain("旧的一次性付款入口已停用");
    expect(paymentSource).toContain('settlementType === "machine"');
    expect(paymentSource).toContain('"机械结算实际付款"');
    expect(paymentSource).toContain("付款日期已封存，须由财务负责人先授权反结账后再登记付款");
  });

  it("不允许机械月结绕过付款台账直接进入已结算状态", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

    expect(source).toContain("机械月结不得直接标记为已结算，请创建机械付款结算单");
    expect(source).toContain('approved: ["void"]');
  });
});
