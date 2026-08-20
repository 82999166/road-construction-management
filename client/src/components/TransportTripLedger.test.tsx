import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输车辆趟次完整台账", () => {
  it("提供单日、自然月、日期区间、车辆、路线和状态组合筛选", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain('value="day"');
    expect(source).toContain('value="month"');
    expect(source).toContain('value="custom"');
    expect(source).toContain("全部车辆");
    expect(source).toContain("全部路线");
    expect(source).toContain("核验/结算状态");
  });

  it("详情只输出中文地点与地址，不输出经纬度，并覆盖装卸时间和结算金额", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("地点只显示中文名称与地址，不显示装卸经纬度");
    expect(source).toContain("装土确认时间");
    expect(source).toContain("卸土确认时间");
    expect(source).toContain("柴油扣款 / 净结算");
    expect(source).not.toContain("latitude");
    expect(source).not.toContain("longitude");
  });

  it("提供按车辆汇总和当前筛选导出", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("按车辆汇总");
    expect(source).toContain("导出当前筛选");
    expect(source).toContain("柴油扣款");
    expect(source).toContain("净结算");
  });
});
