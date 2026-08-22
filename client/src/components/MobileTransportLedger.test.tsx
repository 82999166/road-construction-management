import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动运输运单台账", () => {
  it("使用真实运单接口展示日月、车辆、进度、汇总和详情", () => {
    const source = readFileSync(new URL("./MobileTransportLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("trpc.transport.listTrips.useQuery");
    expect(source).toContain("当日台账");
    expect(source).toContain("当月汇总");
    expect(source).toContain("运输中");
    expect(source).toContain("已卸土");
    expect(source).toContain("净结算");
    expect(source).toContain("运输运单详情");
    expect(source).toContain("loadLocation.address");
    expect(source).toContain("unloadLocation.address");
    expect(source).toContain("装土发票管理员");
    expect(source).toContain("卸土确认管理员");
    expect(source).toContain("装土确认时间");
    expect(source).toContain("卸土确认时间");
    expect(source).not.toContain("longitude");
    expect(source).not.toContain("latitude");
  });
});
