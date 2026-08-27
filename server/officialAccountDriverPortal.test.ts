import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("微信绑定司机门户汇总", () => {
  it("始终以签名令牌对应的当前绑定车辆作为数据范围", () => {
    const source = readFileSync(new URL("./services/officialAccountDriverBinding.ts", import.meta.url), "utf8");

    expect(source).toContain("eq(officialAccountDriverBindings.id, session.bindingId)");
    expect(source).toContain("eq(officialAccountDriverBindings.vehicleId, session.vehicleId)");
    expect(source).toContain("eq(transportTrips.vehicleId, vehicle.id)");
    expect(source).toContain("eq(dieselRefuelRecords.vehicleId, vehicle.id)");
  });

  it("仅投影绑定车辆的真实日汇总、路线、柴油表数和受控运单金额", () => {
    const source = readFileSync(new URL("./services/officialAccountDriverBinding.ts", import.meta.url), "utf8");

    expect(source).toContain("chinaBusinessDate");
    expect(source).toContain("todayTrips");
    expect(source).toContain("transportSites");
    expect(source).toContain("routeLabel");
    expect(source).toContain("meterReading");
    expect(source).toContain("receiptNo");
  });
});
