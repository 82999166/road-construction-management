import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输卸土点补刷卡闭环", () => {
  const routerSource = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );
  const supportSource = readFileSync(
    new URL("./services/transportNfcSupport.ts", import.meta.url),
    "utf8"
  );
  const schemaSource = readFileSync(
    new URL("../drizzle/schema.ts", import.meta.url),
    "utf8"
  );

  it("将路线级开关默认关闭，并纳入超级管理员安全配置边界", () => {
    expect(
      schemaSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'unloadOnlyCloseEnabled: boolean("unloadOnlyCloseEnabled").default(false).notNull()'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "unloadOnlyCloseEnabled: z.boolean().default(false)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "Boolean(existingRoute?.unloadOnlyCloseEnabled ?? false) !== input.unloadOnlyCloseEnabled"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "运输安全阈值仅超级管理员可在后台维护"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("仅在卸土点无在途运单且唯一启用路线显式开启时允许补刷卡，不猜测装土路线", () => {
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "eq(transportRoutePresets.unloadOnlyCloseEnabled, true)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "当前卸土点存在多条开启补刷卡的路线，无法安全判断装土路线"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "本路线未开启“卸土点补刷卡完成闭环”"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "await assertNoOpenTransportTrip"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("不伪造装土时间，并分别强制或留痕最短间隔与卸土围栏校验", () => {
    expect(
      supportSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "assertVehicleMinimumUnloadOnlyScanInterval"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      supportSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "首笔不凭空计算时长".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "unloadOnlyCardClose: true"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "loadCardRecorded: false".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "safety.minimumTransitEnabled"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "safety.unloadGeofenceEnabled"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "initialSafetyNotice".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "运输闭环已按卸土点补刷卡规则记录，实际装土起点仍待核验"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("仅以条件写入关闭新建趟次，保留事件、审计、风险扫描和待核验状态", () => {
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "nfc_unload_only_create_and_close_trip"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "isNull(transportTrips.unloadConfirmedAt)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'status: trip.status === "draft" ? "submitted" : trip.status'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "triggerTransportRiskScan(input.projectId)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "卸土点补刷卡闭环完成".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("在手机 NFC 预览中仅将已开启补刷卡的在途路线标记为卸土优先，仍由确认接口执行定位与间隔校验", () => {
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "unloadOnlyCloseEnabled: Boolean(activeRoute?.unloadOnlyCloseEnabled)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "recordTransportCardEvent(ctx, { tripId: trip.id"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      routerSource.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain('}, "unload")'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
  });
});
