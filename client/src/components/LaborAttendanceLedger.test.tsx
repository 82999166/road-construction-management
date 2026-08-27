import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LaborAttendanceLedger", () => {
  it("保留姓名、班组、人员类型、状态筛选和父级受控导出入口", () => {
    const source = readFileSync(new URL("./LaborAttendanceLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("全部人员类型");
    expect(source).toContain("全部状态");
    expect(source).toContain("categoryLabel");
    expect(source).toContain("onExport");
  });
});
