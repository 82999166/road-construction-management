import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DailyWageLedger", () => {
  it("保留分类报表、付款专用清单、会计审核和付款登记的受控入口", () => {
    const source = readFileSync(new URL("./DailyWageLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("导出分类 Excel");
    expect(source).toContain("生成付款专用 Excel");
    expect(source).toContain("退回草稿");
    expect(source).toContain("审核通过");
    expect(source).toContain("登记付款");
    expect(source).toContain("BusinessStatusBadge");
  });
});
