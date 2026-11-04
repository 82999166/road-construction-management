import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transportSource = readFileSync(
  new URL("./MobileTransportPage.tsx", import.meta.url),
  "utf8"
);
const machinerySource = readFileSync(
  new URL("./MobileMachineryPage.tsx", import.meta.url),
  "utf8"
);
const purchasingSource = readFileSync(
  new URL("./MobilePurchasingPage.tsx", import.meta.url),
  "utf8"
);
const costSource = readFileSync(
  new URL("../components/MachineryCostWorkspace.tsx", import.meta.url),
  "utf8"
);
const purchaseWorkspaceSource = readFileSync(
  new URL("../components/PurchasingWorkspace.tsx", import.meta.url),
  "utf8"
);

describe("移动业务页面时间口径", () => {
  it("运输、机械和采购新建记录均使用设备系统时间而非 UTC 字符串截取", () => {
    expect(transportSource).toContain("startAt: toDeviceDateTimeInput()");
    expect(machinerySource).toContain("occurredAt: toDeviceDateTimeInput()");
    expect(purchasingSource).toContain("orderedAt: toDeviceDateTimeInput()");
    expect(purchasingSource).toContain("occurredAt: toDeviceDateTimeInput()");
  });

  it("运输、机械和采购的台账或打印时间均通过共享中国时区工具显示", () => {
    expect(transportSource).toContain("formatChinaDateTime(trip.startAt)");
    expect(machinerySource).toContain("MachineryCostWorkspace");
    expect(costSource).toContain("formatChinaDateTime(row.occurredAt)");
    expect(purchasingSource).toContain("PurchasingWorkspace");
    expect(purchaseWorkspaceSource).toContain(
      "formatChinaDateTime(o.orderedAt)"
    );
  });
});
