import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输车辆趟次完整台账", () => {
  it("提供单日、自然月、日期区间、车辆、路线和状态组合筛选", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain('value="day"');
    expect(source).toContain('value="month"');
    expect(source).toContain('value="custom"');
    expect(source).toContain("全部车辆");
    expect(source).toContain("全部路线");
    expect(source).toContain("核验/结算状态");
  });

  it("详情只输出中文地点与地址，不输出经纬度，并覆盖装卸时间和结算金额", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("地点只显示中文名称与地址，不显示装卸经纬度");
    expect(source).toContain("装土确认时间");
    expect(source).toContain("卸土确认时间");
    expect(source).toContain("柴油扣款 / 净结算");
    expect(source).not.toContain("latitude");
    expect(source).not.toContain("longitude");
  });

  it("为表格、导出和打印复用中文状态回退与中国时区格式", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge"');
    expect(source).toContain('import { formatChinaDateTime } from "@/lib/businessTime"');
    expect(source).toContain("labels[status] ?? getBusinessStatusLabel(status)");
    expect(source).toContain("getBusinessStatusLabel(item.status)");
    expect(source).toContain("getBusinessStatusLabel(selectedTrip.status)");
    expect(source).toContain("getCardValidationStatusLabel(event.validationStatus)");
    expect(source).toContain("getSafeCardValidationReason(event.validationReason)");
    expect(source).not.toContain("statusLabel[item.status] ?? item.status");
    expect(source).not.toContain("statusLabel[selectedTrip.status] ?? selectedTrip.status");
    expect(source).toContain("formatChinaDateTime(value, \"未记录\")");
    expect(source).not.toContain('toLocaleString("zh-CN", { hour12: false })');
  });

  it("提供按车辆汇总和当前筛选导出", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("按车辆汇总");
    expect(source).toContain("导出当前筛选");
    expect(source).toContain("柴油扣款");
    expect(source).toContain("净结算");
  });

  it("将单次刷卡闭环明确标记为待核验，不伪称卸土确认", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("isNfcSingleScanClosed");
    expect(source).toContain("单次刷卡闭环 · 待核验");
    expect(source).toContain("单次闭环时间（非卸土确认）");
    expect(source).toContain("未记录实际卸土确认");
  });

  it("将卸土补刷卡闭环与普通卸土和发票单次闭环明确区分，并提示未记录装土刷卡", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("isNfcUnloadOnlyClosed");
    expect(source).toContain("卸土补刷卡闭环 · 待核验");
    expect(source).toContain("但未记录装土点刷卡，系统不会伪造实际装土时间");
    expect(source).toContain("卸土补刷卡时间");
    expect(source).toContain("tripStatusVisualRules");
    expect(source).toContain("#2f8051");
    expect(source).toContain("#c97816");
    expect(source).toContain("transport-trip-table");
  });

  it("按后台当前筛选提供 A4 横向运费明细 PDF，并在最末行汇总金额、趟数和车辆数", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("打印当前筛选明细与汇总");
    expect(source).toContain("CurrentFilterPrintActions");
    expect(source).toContain("freightPrintOpen");
    expect(source).toContain("@page { size: A4 landscape");
    expect(source).toContain("printableTrips");
    expect(source).toContain("去重车辆数");
    expect(source).toContain("运单趟数");
    expect(source).toContain("打印 / 保存 PDF");
    expect(source).toContain("全部状态”打印仍默认排除作废单");
  });
});


  it("将发票类型列与责任人、受控影像入口收敛到运单详情", () => {
    const source = readFileSync(new URL("./TransportTripLedger.tsx", import.meta.url), "utf8");
    expect(source).toContain("<TableHead>发票类型</TableHead>");
    expect(source).toContain("invoiceTypeLabel(item)");
    expect(source).toContain("装土发票管理员 / 执行时间");
    expect(source).toContain("卸土确认管理员 / 执行时间");
    expect(source).not.toContain("<img");
  });
