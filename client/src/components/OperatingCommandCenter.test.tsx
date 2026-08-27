import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("交通施工指挥中心大屏", () => {
  it("呈现道路铁路施工布局并保持真实台账、资金、进度和运输业务跳转", () => {
    const source = readFileSync(new URL("./OperatingCommandCenter.tsx", import.meta.url), "utf8");
    expect(source).toContain("交通施工指挥中心");
    expect(source).toContain("施工线路与工程进度");
    expect(source).toContain("运输与现场动态");
    expect(source).toContain("资金结算态势");
    expect(source).toContain("各类成本、付款与结算明细");
    expect(source).toContain("真实台账汇总");
    expect(source).toContain("/admin/transport");
    expect(source).toContain("/admin/construction");
    expect(source).toContain("/admin/finance");
  });
});
