import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DailyWageLedger", () => {
  it("保留带筛选条件的分类报表、付款专用清单、会计审核和付款登记入口", () => {
    const source = readFileSync(new URL("./DailyWageLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("导出当前筛选分类 Excel");
    expect(source).toContain("dateFrom");
    expect(source).toContain("dateTo");
    expect(source).toContain("人员 / 班组");
    expect(source).toContain("全部班组");
    expect(source).toContain("全部状态");
    expect(source).toContain("onExportWorkbook(exportFilter)");
    expect(source).toContain("生成付款专用 Excel");
    expect(source).toContain("退回草稿");
    expect(source).toContain("审核通过");
    expect(source).toContain("登记付款");
    expect(source).toContain("BusinessStatusBadge");
  });
});
