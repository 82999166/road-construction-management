import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("微信绑定司机门户", () => {
  it("使用工作台式布局，并明确司机无系统账号的受限访问边界", () => {
    const source = readFileSync(new URL("./DriverPortalPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("微信司机运输工作台");
    expect(source).toContain("运输提醒说明");
    expect(source).toContain("司机不需要也没有系统登录账号");
    expect(source).toContain("不读取其他车辆或系统账号的站内消息");
    expect(source).not.toContain("useAuth");
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
