import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("直拍车牌发票自动字段", () => {
  it("直拍模式不暴露手工时间或吨位输入，并按系统时间开票", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("const systemIssuedAt = new Date().toISOString()");
    expect(source).toContain('tripDraft.invoiceMode === "plate_photo" ? systemIssuedAt');
    expect(source).toContain('tripDraft.invoiceMode === "plate_photo" ? null : tripDraft.weightTons');
    expect(source).toContain("发票时间：系统开票时自动生成");
    expect(source).toContain("结算方量：车辆与路线自动带入");
  });
});
