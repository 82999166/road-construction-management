import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PayrollStatementLedger", () => {
  it("保留工资期间、人员关键词、班组、状态筛选，以及父级受控导出和详情回调", () => {
    const source = readFileSync(new URL("./PayrollStatementLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("工资期间");
    expect(source).toContain("检索工资人员");
    expect(source).toContain("CurrentFilterPrintActions");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain('import { formatChinaDateTime } from "@/lib/businessTime"');
    expect(source).toContain("生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}");
    expect(source).not.toContain('new Date().toLocaleString("zh-CN", { hour12: false })');
    expect(source).toContain("劳务工资明细表");
    expect(source).toContain("合计：工资条");
    expect(source).toContain("全部（不含作废）");
    expect(source).toContain("onOpenDetail(item)");
    expect(source).toContain("BusinessStatusBadge");
  });
});
