import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("临时日结分类 Excel 筛选数据范围", () => {
  it("仅收敛临时日结工作表，并把筛选条件写入汇总说明", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("getActiveDailyWageWorkbookFilter");
    expect(source).toContain('sheet.name === "临时日结"');
    expect(source).toContain("sheet.rows.filter(matchesDailyWageFilter)");
    expect(source).toContain("日结日期起");
    expect(source).toContain("日结人员/班组");
    expect(source).toContain("日结状态");
    expect(source).toContain("筛选条件 ·");
  });

});
