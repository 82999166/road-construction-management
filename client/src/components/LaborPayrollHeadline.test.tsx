import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("劳务工资汇总展示", () => {
  it("展示当前筛选的应发、待处理与已结算口径", () => {
    const source = readFileSync(new URL("./LaborPayrollHeadline.tsx", import.meta.url), "utf8");
    expect(source).toContain("当前筛选应发总额");
    expect(source).toContain("草稿及会计审核中");
    expect(source).toContain("已审核待付款");
    expect(source).toContain("summary.payable");
    expect(source).toContain("summary.pending");
    expect(source).toContain("summary.approved");
  });
});
