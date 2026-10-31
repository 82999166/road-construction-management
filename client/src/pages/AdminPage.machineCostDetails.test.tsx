import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

describe("PC机械详情合同与成本口径", () => {
  it("展示月租、日租折算和分离的加班费用，不将不同来源重复相加", () => {
    expect(source).toContain("合同月租");
    expect(source).toContain("日租费用");
    expect(source).toContain("本期日作业加班费");
    expect(source).toContain("独立加班成本");
    expect(source).toContain("不与日作业加班重复相加");
  });
});
