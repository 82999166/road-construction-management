import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输路线安全开关", () => {
  it("将最短时间和定位范围分别作为可保存的硬拦截开关", () => {
    const source = readFileSync(new URL("./TransportRouteSafetySettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("minimumTransitEnabled");
    expect(source).toContain("unloadGeofenceEnabled");
    expect(source).toContain("硬拦截");
    expect(source).toContain("仅提示");
  });

  it("将明细阈值设置收纳在摘要入口打开的弹窗内", () => {
    const source = readFileSync(new URL("./TransportRouteSafetySettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("settingsOpen");
    expect(source).toContain("<Dialog open={settingsOpen}");
    expect(source).toContain("compact = false");
    expect(source).toContain("canConfigure = true");
    expect(source).toContain("if (!canConfigure || !projectId) return null");
    expect(source).toContain("尚未配置启用运输路线");
    expect(source).toContain("请先在上方“路线配置”新增装土点、卸土点和运输路线");
  });

  it("提供项目级单次刷卡闭环开关，并明确继续强制同车最小开票间隔", () => {
    const source = readFileSync(new URL("./TransportRouteSafetySettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("getNfcSingleScanCloseSetting");
    expect(source).toContain("setNfcSingleScanCloseSetting");
    expect(source).toContain("刷卡发票即完成整车运输闭环（特殊场景）");
    expect(source).toContain("硬性拦截同车的连续刷卡开票");
    expect(source).toContain("默认关闭");
  });
});
