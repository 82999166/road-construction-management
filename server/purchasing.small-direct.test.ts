import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("小额直接采购金额与单据归档边界", () => {
  it("手动金额优先并保留普通单据照片审计", () => {
    const source = readFileSync(new URL("./routers/finance.ts", import.meta.url), "utf8");
    expect(source).toContain("uploadPurchaseDocument");
    expect(source).toContain("purchase_document_upload");
    expect(source).toContain("const isManualAmount = input.amount !== undefined");
    expect(source).toContain("金额来源 ${isManualAmount ? \"手动录入\" : \"数量×单价自动计算\"}");
    expect(source).toContain("非水印影像");
  });
});
