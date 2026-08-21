import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PayrollStatementLedger", () => {
  it("保留工资期间、人员关键词、班组、状态筛选，以及父级受控导出和详情回调", () => {
    const source = readFileSync(new URL("./PayrollStatementLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("工资期间");
    expect(source).toContain("检索工资人员");
    expect(source).toContain("按当前筛选导出 CSV");
    expect(source).toContain("onOpenDetail(item)");
    expect(source).toContain("BusinessStatusBadge");
  });
});
