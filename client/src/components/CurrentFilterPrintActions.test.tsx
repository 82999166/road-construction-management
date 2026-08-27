import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CurrentFilterPrintActions", () => {
  it("固定使用当前筛选导出与打印文案，并保持打印按钮在打印时隐藏", () => {
    const source = readFileSync(new URL("./CurrentFilterPrintActions.tsx", import.meta.url), "utf8");
    expect(source).toContain("打印当前筛选明细与汇总");
    expect(source).toContain("导出当前筛选");
    expect(source).toContain("print:hidden");
    expect(source).toContain("onPrint");
    expect(source).toContain("onExport");
  });
});
