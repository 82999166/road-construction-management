import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MobileFinancePage.tsx", import.meta.url), "utf8");

describe("MobileFinancePage 时间、中文化与打印", () => {
  it("以设备日期建立默认期间和发生时间，不截取 UTC ISO 值", () => {
    expect(source).toContain("function currentPeriod() { return toChinaMonthInput(); }");
    expect(source).toContain("function currentDate() { return toChinaDateInput(); }");
    expect(source).toContain("occurredAt: toDeviceDateTimeInput()");
  });

  it("票据未知状态使用中文回退，汇总打印使用独立 A4 文档", () => {
    expect(source).toContain('?? "其他票据"');
    expect(source).toContain('?? "待处理"');
    expect(source).toContain("function printFinanceSummary()");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("onClick={printFinanceSummary}");
    expect(source).not.toContain("onClick={() => window.print()}");
  });
});
