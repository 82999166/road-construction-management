import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输路线安全开关", () => {
  it("将最短时间和定位范围分别作为可保存的硬拦截开关", () => {
    const source = readFileSync(
      new URL("./TransportRouteSafetySettings.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "minimumTransitEnabled".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "unloadGeofenceEnabled".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "硬拦截".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "仅提示".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("将明细阈值设置收纳在摘要入口打开的弹窗内", () => {
    const source = readFileSync(
      new URL("./TransportRouteSafetySettings.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "settingsOpen".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "<Dialog open={settingsOpen}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "compact = false".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "canConfigure = true".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "if (!canConfigure || !projectId) return null"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "尚未配置启用运输路线".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "请先配置装卸土点、有效运价与路线"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("提供项目级单次刷卡闭环开关，并明确继续强制同车最小开票间隔", () => {
    const source = readFileSync(
      new URL("./TransportRouteSafetySettings.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getNfcSingleScanCloseSetting"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "setNfcSingleScanCloseSetting"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "刷卡发票即完成整车运输闭环（特殊场景）"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "硬性拦截同车连续开票".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "默认关闭".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("提供默认关闭的路线级卸土补刷卡开关，并明确复用最短时间和定位范围的组合规则", () => {
    const source = readFileSync(
      new URL("./TransportRouteSafetySettings.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "unloadOnlyCloseEnabled".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "卸土点补刷卡完成闭环".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "连续间隔和定位仍由卸土点统一校验"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "不伪造实际装土时间".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("将超级管理员配置入口固定放在 PC 路线配置卡片内，而非运输台账区域之后", () => {
    const routeEditor = readFileSync(
      new URL("./TransportRouteConfigurationEditor.tsx", import.meta.url),
      "utf8"
    );
    const adminPage = readFileSync(
      new URL("../pages/AdminPage.tsx", import.meta.url),
      "utf8"
    );

    expect(
      routeEditor.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'import { TransportRouteSafetySettings } from "@/components/TransportRouteSafetySettings"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routeEditor.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "<TransportRouteSafetySettings projectId={projectId} active={active} canConfigure={canConfigureSafety} onDirtyChange={setSafetyDirty} />"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routeEditor.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "canConfigure={canConfigureSafety}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      adminPage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "<TransportRouteSafetySettings projectId={workspaceProjectId} />"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
