import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动采购清单费用录入", () => {
  it("支持普通单据照片上传与自动/手动金额两种方式", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("uploadPurchaseDocument");
    expect(source).toContain("拍摄并上传单据照片");
    expect(source).toContain("不使用水印相机");
    expect(source).toContain("数量 × 单价自动计算");
    expect(source).toContain("手动填写金额");
    expect(source).toContain("amount: useManualAmount");
  });
});
