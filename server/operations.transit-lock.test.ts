import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输一车一在途锁", () => {
  it("用数据库唯一锁和历史在途检查覆盖 NFC、手机路线确认与车牌直拍开票", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("createActiveVehicleTransitKey");
    expect(source).toContain("assertNoOpenTransportTrip");
    expect(source).toContain("还未卸土，请先完成当前运单");
    expect(source).toContain("activeVehicleTransitKey: input.endAt ? null");
    expect(source).toContain("activeVehicleTransitKey: null, endAt: occurredAt");
  });

  it("数据库模型为同一项目、同一车辆的在途锁建立唯一约束", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(schema).toContain("activeVehicleTransitKey");
    expect(schema).toContain("transport_trips_project_active_vehicle_transit_unique");
  });
});
