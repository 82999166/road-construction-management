import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("渣土车按趟结算车辆档案", () => {
  it("PC和移动端都可选择按趟结算，并向现场说明不产生租金成本", () => {
    const adminPage = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const mobilePage = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");
    expect(adminPage).toContain('value="trip_settlement">渣土车（按趟结算）');
    expect(adminPage).toContain('车主/车队');
    expect(mobilePage).toContain('ownership: "trip_settlement"');
    expect(mobilePage).toContain('按趟结算渣土车不建立租赁日期、租金或租赁成本');
  });
});
