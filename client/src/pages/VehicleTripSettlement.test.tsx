import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const readSource = (path: Parameters<typeof readFileSync>[0]) =>
  readFileSync(path, "utf8")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*}/g, " }");

describe("渣土车按趟结算车辆档案", () => {
  it("PC和移动端都可选择按趟结算，并向现场说明不产生租金成本", () => {
    const adminPage = readSource(
      new URL("./AdminPage.tsx", import.meta.url)
    ).replace(/\s+/g, " ");
    const mobilePage = readSource(
      new URL("./MobileTransportPage.tsx", import.meta.url)
    ).replace(/\s+/g, " ");
    const settlementManager = readSource(
      new URL(
        "../components/TransportVehicleSettlementManager.tsx",
        import.meta.url
      )
    ).replace(/\s+/g, " ");
    expect(adminPage).toContain('value="trip_settlement"');
    expect(adminPage).toContain("渣土车（按趟结算）");
    expect(adminPage).toContain("车主/车队");
    expect(mobilePage).toContain('ownership: "trip_settlement"');
    expect(mobilePage).toContain(
      "按趟结算渣土车不建立租赁日期、租金或租赁成本"
    );
    expect(settlementManager).toContain(
      'import { formatChinaDate, toDeviceDateInput } from "@/lib/businessTime"'
    );
    expect(settlementManager).toContain(
      "const today = () => toDeviceDateInput()"
    );
    expect(settlementManager).not.toContain(
      "new Date().toISOString().slice(0, 10)"
    );
  });
});
