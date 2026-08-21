import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("机械付款结算状态机", () => {
  it("将外租机械月结付款与月结快照、收款方式和不可逆付款审计绑定", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

    expect(schema).toContain("machinePaymentSettlements");
    expect(schema).toContain("monthlyStatementId");
    expect(schema).toContain("machine_payment_settlements_statement_unique");
    expect(source).toContain("createPaymentSettlement");
    expect(source).toContain("transitionPaymentSettlement");
    expect(source).toContain("machine.ownership !== \"leased\"");
    expect(source).toContain("该机械结算单已完成付款，依据业务规则不能作废或回退");
    expect(source).toContain("machine_payment_settlement_${input.action}");
    expect(source).toContain("machineMonthlyStatements).set({ status: \"settled\" }");
  });

  it("不允许机械月结绕过付款台账直接进入已结算状态", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

    expect(source).toContain("机械月结不得直接标记为已结算，请创建机械付款结算单");
    expect(source).toContain('approved: ["void"]');
  });
});
