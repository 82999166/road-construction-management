import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("司机绑定车辆账单门户", () => {
  it("同时支持微信短时令牌和手机号司机会话，但不展示运输管理功能", () => {
    const source = readFileSync(new URL("./DriverPortalPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("useAuth");
    expect(source).toContain("localDriverPortalSummary");
    expect(source).toContain("isLocalDriver");
    expect(source).toContain("当前账号绑定车辆强制过滤");
    expect(source).toContain("不提供车辆、路线、运价、运单或结算的新增、修改、审核权限");
    expect(source).not.toContain("MobileTransportPage");
  });

  it("提供真实日汇总、可点击运单详情及柴油表数详情", () => {
    const source = readFileSync(new URL("./DriverPortalPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("今日运输汇总");
    expect(source).toContain("setSelectedTripNo(item.tripNo)");
    expect(source).toContain("运输运单详情");
    expect(source).toContain("setSelectedDieselNo(item.recordNo)");
    expect(source).toContain("柴油扣款详情");
    expect(source).toContain("加油机表数");
  });
});
