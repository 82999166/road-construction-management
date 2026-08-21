import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("手机端装卸土点管理", () => {
  it("提供新增装土点、新增卸土点、编辑和跨端路线刷新入口", () => {
    const source = readFileSync(new URL("./MobileTransportSiteManager.tsx", import.meta.url), "utf8");
    expect(source).toContain("新增装土点");
    expect(source).toContain("新增卸土点");
    expect(source).toContain("编辑");
    expect(source).toContain("装土点名称");
    expect(source).toContain("卸土点名称");
    expect(source).toContain("自动获取定位不会修改此名称");
    expect(source).toContain("transport.saveSite");
    expect(source).toContain("utils.transport.listSites.invalidate()");
    expect(source).toContain("utils.transport.listRoutePresets.invalidate()");
    expect(source).toContain("中文详细地址");
    expect(source).toContain("自动获取定位");
    expect(source).toContain("navigator.geolocation.getCurrentPosition");
    expect(source).toContain("trpc.location.reverseGeocode.useMutation");
    expect(source).toContain("enableHighAccuracy: true");
  });
});
