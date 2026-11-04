import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("../components/MachineryWorkspace.tsx", import.meta.url),
  "utf8"
);
const rules = readFileSync(
  new URL("../lib/machineryWorkspace.ts", import.meta.url),
  "utf8"
);
describe("PC机械详情合同与成本口径", () => {
  it("展示月租、日租折算和分离的加班来源，不将不同来源重复相加", () => {
    expect(source).toContain("合同月租");
    expect(source).toContain("日租费用");
    expect(source).toContain("月租按自然日折算，仅供查看");
    expect(source).toContain("MACHINERY_COST_SCOPE_NOTE");
    expect(rules).toContain("独立加班成本");
    expect(rules).toContain("司机加班与独立加班成本分别核对，不重复计工资");
    expect(source).toContain("历史产值/工资");
    expect(rules).toContain("应付租金与实际付款分开列示，不合并为同一成本");
  });
});
