import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输车辆趟次完整台账", () => {
  it("提供单日、自然月、日期区间、车辆、路线和状态组合筛选", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'value="day"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'value="month"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'value="custom"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "全部车辆".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "全部路线".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "核验/结算状态".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("详情只输出中文地点与地址，不输出经纬度，并覆盖装卸时间和结算金额", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "地点只显示中文名称与地址，不显示装卸经纬度"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "装土确认时间".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "卸土确认时间".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "柴油扣款 / 净结算".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain("latitude".replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "longitude".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("为表格、导出和打印复用中文状态回退与中国时区格式", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'import { formatChinaDateTime } from "@/lib/businessTime"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "labels[status] ?? getBusinessStatusLabel(status)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getBusinessStatusLabel(item.status)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getBusinessStatusLabel(selectedTrip.status)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getCardValidationStatusLabel(event.validationStatus)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getSafeCardValidationReason(event.validationReason)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "statusLabel[item.status] ?? item.status"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "statusLabel[selectedTrip.status] ?? selectedTrip.status"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'formatChinaDateTime(value, "未记录")'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      'toLocaleString("zh-CN", { hour12: false })'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("提供按车辆汇总和当前筛选导出", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "按车辆汇总".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "导出当前筛选".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "柴油扣款".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "净结算".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("将单次刷卡闭环明确标记为待核验，不伪称卸土确认", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "isNfcSingleScanClosed".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "单次刷卡闭环 · 待核验".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "单次闭环时间（非卸土确认）"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "未记录实际卸土确认".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("将卸土补刷卡闭环与普通卸土和发票单次闭环明确区分，并提示未记录装土刷卡", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "isNfcUnloadOnlyClosed".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "卸土补刷卡闭环 · 待核验".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "但未记录装土点刷卡，系统不会伪造实际装土时间"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "卸土补刷卡时间".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "tripStatusVisualRules".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "#2f8051".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "#c97816".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "transport-trip-table".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("按后台当前筛选提供 A4 横向运费明细 PDF，并在最末行汇总金额、趟数和车辆数", () => {
    const source = readFileSync(
      new URL("./TransportTripLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "打印当前筛选明细与汇总".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "CurrentFilterPrintActions"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "freightPrintOpen".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "@page { size: A4 landscape"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "printableTrips".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "去重车辆数".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "运单趟数".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "打印 / 保存 PDF".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "全部状态”打印仍默认排除作废单"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});

it("将发票类型列与责任人、受控影像入口收敛到运单详情", () => {
  const source = readFileSync(
    new URL("./TransportTripLedger.tsx", import.meta.url),
    "utf8"
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "<TableHead>发票类型</TableHead>"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "invoiceTypeLabel(item)".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "装土发票管理员 / 执行时间".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "卸土确认管理员 / 执行时间".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).not.toContain(
    "<img".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
});
