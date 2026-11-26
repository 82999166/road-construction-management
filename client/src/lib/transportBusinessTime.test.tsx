import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toChinaDateInput } from "./businessTime";
import {
  formatTransportBusinessDate,
  formatTransportBusinessDateRange,
  formatTransportBusinessMonthRange,
  TRANSPORT_BUSINESS_DAY_NOTICE,
} from "./transportBusinessTime";

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

afterEach(() => vi.useRealTimers());

describe("运输北京时间日期及整日范围展示", () => {
  it.each([
    ["2026-10-31T15:59:59.999Z", "2026-10-31"],
    ["2026-10-31T16:00:00.000Z", "2026-11-01"],
    ["2026-12-31T16:00:00.000Z", "2027-01-01"],
  ])("默认当天在北京零点正确切换：%s", (instant, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    expect(toChinaDateInput()).toBe(expected);
  });

  it("DATE 标签不做时区偏移，时间戳则沿用现有北京时间转换", () => {
    expect(formatTransportBusinessDate("2026-11-01")).toBe("2026-11-01");
    expect(formatTransportBusinessDate("2026-10-31T16:00:00Z")).toBe("2026-11-01");
    expect(formatTransportBusinessDate(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11-01");
  });

  it("同日及跨月范围明确从00点到末日23:59:59并含末秒毫秒", () => {
    expect(formatTransportBusinessDateRange("2026-11-01", "2026-11-01"))
      .toBe("北京时间 2026-11-01 00:00:00 至 2026-11-01 23:59:59（含该秒内全部毫秒）");
    expect(formatTransportBusinessDateRange("2026-10-31", "2026-11-01"))
      .toBe("北京时间 2026-10-31 00:00:00 至 2026-11-01 23:59:59（含该秒内全部毫秒）");
    expect(TRANSPORT_BUSINESS_DAY_NOTICE).toContain("起止当天均包含");
  });

  it.each([
    ["2024-02", "2024-02-29"],
    ["2026-02", "2026-02-28"],
    ["2026-12", "2026-12-31"],
  ])("自然月完整覆盖首日到末日：%s", (month, lastDay) => {
    expect(formatTransportBusinessMonthRange(month)).toBe(
      formatTransportBusinessDateRange(`${month}-01`, lastDay)
    );
    expect(formatTransportBusinessMonthRange("2026-13")).toBe("未选择月份");
  });

  it("移动与后台运输默认复用北京时间，不改变录单设备系统时间", () => {
    const mobile = source("../pages/MobileTransportPage.tsx");
    expect(mobile).toContain("return toChinaDateInput();");
    expect(mobile).toContain("startAt: toDeviceDateTimeInput()");
    const admin = source("../pages/AdminPage.tsx");
    const transportDefaults = admin.slice(
      admin.indexOf("const [transportLedgerFilter"),
      admin.indexOf("const [dailyWagePaymentTarget")
    );
    expect(transportDefaults).not.toContain("toLocalDateInput()");
    expect(transportDefaults).toContain("dateFrom: toChinaDateInput()");
    expect(transportDefaults).toContain("dateTo: toChinaDateInput()");
    expect(transportDefaults).toContain("onsiteFocus?.businessDate || toChinaDateInput()");
  });

  it("运输台账、结算预览与打印显示统一整日范围", () => {
    for (const component of [
      "MobileTransportLedger", "TransportTripLedger", "TransportFreightPrintDialog",
      "VehicleSettlementSelection", "TransportVehicleSettlementManager",
    ]) {
      expect(source(`../components/${component}.tsx`)).toContain("formatTransportBusinessDateRange");
    }
    const selection = source("../components/VehicleSettlementSelection.tsx");
    expect(selection).toContain("html(periodDescription)");
    expect(selection).toContain('"生成前预览",\n          plateNo,\n          periodDescription,');
    const settlements = source("../components/TransportVehicleSettlementManager.tsx");
    expect(settlements).toContain("${formatTransportBusinessDate(row.periodStart)} 00:00:00");
    expect(settlements).toContain("${formatTransportBusinessDate(row.periodEnd)} 23:59:59");
  });
});
