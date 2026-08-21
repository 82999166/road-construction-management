import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("装卸土点与路线编辑", () => {
  it("为既有装卸土点提供坐标补录和编辑入口", () => {
    const source = readFileSync(new URL("./TransportRouteConfigurationEditor.tsx", import.meta.url), "utf8");
    expect(source).toContain("补录详细地址");
    expect(source).toContain("编辑装土点");
    expect(source).toContain("编辑卸土点");
    expect(source).toContain("saveSite.mutate");
    expect(source).toContain("中文详细地址");
    expect(source).toContain("新增装土点");
    expect(source).toContain("新增卸土点");
    expect(source).toContain("装卸土点与运输路线配置");
    expect(source).toContain("openNewSite");
    expect(source).toContain("utils.transport.listSites.invalidate()");
    expect(source).toContain("utils.transport.listRoutePresets.invalidate()");
    expect(source).toContain("activeLoadSites.map");
    expect(source).toContain("activeUnloadSites.map");
    expect(source).not.toContain("纬度 Latitude");
    expect(source).not.toContain("经度 Longitude");
  });

  it("为既有路线提供线路与安全参数编辑入口", () => {
    const source = readFileSync(new URL("./TransportRouteConfigurationEditor.tsx", import.meta.url), "utf8");
    expect(source).toContain("编辑路线");
    expect(source).toContain("新建运输路线");
    expect(source).toContain("openNewRoute");
    expect(source).toContain("saveRoute.mutate");
    expect(source).toContain("id: routeDraft.id ?? undefined");
    expect(source).toContain("minimumTransitEnabled");
    expect(source).toContain("unloadGeofenceEnabled");
  });
});
