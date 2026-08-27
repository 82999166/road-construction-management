import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("临时日结付款确认对话框", () => {
  it("保留付款日期必填、参考说明和最终结算提示", () => {
    const source = readFileSync(new URL("./DailyWagePaymentDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("实际付款日期");
    expect(source).toContain("付款参考说明（可选）");
    expect(source).toContain("不能作废或回写");
    expect(source).toContain("确认 ${target?.workerName ?? \"日结\"} 已付款");
  });
});
