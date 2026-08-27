import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("工资发放确认对话框", () => {
  it("保留外部转账边界和付款凭证最小长度校验", () => {
    const source = readFileSync(new URL("./PayrollPaymentDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("系统不会发起银行转账");
    expect(source).toContain("付款凭证号 / 资金流水号");
    expect(source).toContain("paymentReference.trim().length < 4");
    expect(source).toContain("确认 ${target?.workerName ?? \"工资条\"} 发放");
  });
});
