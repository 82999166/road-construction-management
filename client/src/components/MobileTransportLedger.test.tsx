import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动运输运单台账", () => {
  it("使用真实运单与司机柴油接口展示日汇总、可点击详情和加油机表数", () => {
    const source = readFileSync(new URL("./MobileTransportLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("trpc.transport.listTrips.useQuery");
    expect(source).toContain("trpc.transport.driverFuelDeductionDetails.useQuery");
    expect(source).toContain("当日台账");
    expect(source).toContain("当月汇总");
    expect(source).toContain("运输总费用");
    expect(source).toContain("加油扣款");
    expect(source).toContain("柴油扣款明细");
    expect(source).toContain("加油机表数");
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
    expect(source).toContain("onClick={() => setSelectedTripId(trip.id)}");
    expect(source).toContain('trip.invoiceMode === "plate_photo"');
    expect(source).toContain("Boolean(trip.loadConfirmedAt)");
    expect(source).toContain("!trip.unloadConfirmedAt");
    expect(source).toContain('!["void", "settled"].includes(trip.status)');
    expect(source).toContain("确认卸土");
    expect(source).toContain("拍摄卸土现场并确认卸土");
    expect(source).toContain("onConfirmPlatePhotoUnload?.(tripId)");
    expect(source).toContain("运输运单详情");
    expect(source).toContain("查看受控加油凭证");
    expect(source).not.toContain("longitude");
    expect(source).not.toContain("latitude");
  });
});
