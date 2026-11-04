import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./TransportVehicleSettlementManager.tsx", import.meta.url),
  "utf8"
);

describe("车辆运输结算中文化与日期展示", () => {
  it("将支付方式和未知结算状态投影为中文，同时保持原始状态机枚举用于操作判断", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "const paymentMethodDisplay"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '?? "其他方式"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "const settlementStatusDisplay"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "{settlementStatusDisplay(item.status)}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "{settlementStatusLabel[item.status] ?? item.status}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '["approved", "partial", "receivable"].includes(item.status)'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("以统一中国日期格式展示结算期间和付款日期", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "formatChinaDate(item.periodStart)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "formatChinaDate(item.paymentDate)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "String(item.paymentDate).slice(0, 10)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
