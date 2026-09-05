import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输卸土点补刷卡闭环", () => {
  const routerSource = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
  const supportSource = readFileSync(new URL("./services/transportNfcSupport.ts", import.meta.url), "utf8");
  const schemaSource = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");

  it("将路线级开关默认关闭，并纳入超级管理员安全配置边界", () => {
    expect(schemaSource).toContain('unloadOnlyCloseEnabled: boolean("unloadOnlyCloseEnabled").default(false).notNull()');
    expect(routerSource).toContain("unloadOnlyCloseEnabled: z.boolean().default(false)");
    expect(routerSource).toContain("existingRoute.unloadOnlyCloseEnabled !== input.unloadOnlyCloseEnabled");
    expect(routerSource).toContain("运输安全阈值仅超级管理员可在后台维护");
  });

  it("仅在卸土点无在途运单且唯一启用路线显式开启时允许补刷卡，不猜测装土路线", () => {
    expect(routerSource).toContain('eq(transportRoutePresets.unloadOnlyCloseEnabled, true)');
    expect(routerSource).toContain("当前卸土点存在多条开启补刷卡的路线，无法安全判断装土路线");
    expect(routerSource).toContain("本路线未开启“卸土点补刷卡完成闭环”");
    expect(routerSource).toContain("await assertNoOpenTransportTrip");
  });

  it("不伪造装土时间，并分别强制或留痕最短间隔与卸土围栏校验", () => {
    expect(supportSource).toContain("assertVehicleMinimumUnloadOnlyScanInterval");
    expect(supportSource).toContain("首笔不凭空计算时长");
    expect(routerSource).toContain("unloadOnlyCardClose: true");
    expect(routerSource).toContain("loadCardRecorded: false");
    expect(routerSource).toContain("route.minimumTransitEnabled");
    expect(routerSource).toContain("route.unloadGeofenceEnabled");
    expect(routerSource).toContain("initialSafetyNotice");
    expect(routerSource).toContain("运输闭环已按卸土点补刷卡规则记录，实际装土起点仍待核验");
  });

  it("仅以条件写入关闭新建趟次，保留事件、审计、风险扫描和待核验状态", () => {
    expect(routerSource).toContain("nfc_unload_only_create_and_close_trip");
    expect(routerSource).toContain("isNull(transportTrips.unloadConfirmedAt)");
    expect(routerSource).toContain("status: \"submitted\"");
    expect(routerSource).toContain("triggerTransportRiskScan(input.projectId)");
    expect(routerSource).toContain("卸土点补刷卡闭环完成");
  });

  it("在手机 NFC 预览中仅将已开启补刷卡的在途路线标记为卸土优先，仍由确认接口执行定位与间隔校验", () => {
    expect(routerSource).toContain("unloadOnlyCloseEnabled: Boolean(activeRoute?.unloadOnlyCloseEnabled)");
    expect(routerSource).toContain("recordTransportCardEvent(ctx, { tripId: trip.id");
    expect(routerSource).toContain('}, "unload")');
  });
});
