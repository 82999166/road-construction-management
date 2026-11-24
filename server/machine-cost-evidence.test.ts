import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { machineCostSaveSchema } from "../shared/machineCostDuplicate";

const validExpense = {
  machineId: 1,
  projectId: 2,
  costType: "repair" as const,
  costName: "  发动机维修  ",
  quantity: 1,
  unitPrice: 100,
  occurredAt: "2026-11-09T10:37:00.000Z",
  remarks: "  原始票据说明  ",
};

describe("机械费用说明与工程水印影像归档", () => {
  it("共享费用协议仍修剪名称和备注，并保持原长度限制", () => {
    const parsed = machineCostSaveSchema.parse(validExpense);
    expect(parsed.costName).toBe("发动机维修");
    expect(parsed.remarks).toBe("原始票据说明");
    expect(machineCostSaveSchema.safeParse({ ...validExpense, costName: "  " }).success).toBe(false);
    expect(machineCostSaveSchema.safeParse({ ...validExpense, costName: "名".repeat(129) }).success).toBe(false);
    expect(machineCostSaveSchema.safeParse({ ...validExpense, remarks: "备".repeat(501) }).success).toBe(false);
    expect(machineCostSaveSchema.safeParse({ ...validExpense, remarks: null }).success).toBe(true);
    expect(machineCostSaveSchema.safeParse({ ...validExpense, remarks: undefined }).success).toBe(true);
    expect(machineCostSaveSchema.safeParse({ ...validExpense, evidenceId: 0 }).success).toBe(false);
    expect(machineCostSaveSchema.safeParse({ ...validExpense, evidenceId: 3 }).success).toBe(true);
  });

  it("路由沿用共享费用校验，校验同项目影像并在创建后回写成本来源编号", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const compact = (value: string) => value.replace(/\s+/g, "").replace(/,([})\]])/g, "$1");
    for (const expected of [
      "const machineCostInput = machineCostSaveSchema",
      "costName: input.costName.trim()",
      "费用水印照片不存在或不属于当前项目",
      "remarks: input.remarks?.trim() || null",
      "sourceId: `machine-cost-${costId}`",
      "已关联水印照片",
      "fuelCostDefault",
      "getEffectiveDieselGuidelinePrice",
      "当前加油发生时间未匹配到有效柴油指导价",
      'const appliedUnitPrice = input.costType === "fuel" ? guideline!.price!.pricePerLiter : input.unitPrice',
      "引用柴油指导价",
    ]) {
      expect(compact(source)).toContain(compact(expected));
    }
  });
});
