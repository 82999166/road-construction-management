import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("机械费用说明与工程水印影像归档", () => {
  it("保存费用说明、校验同项目影像并在创建后回写成本来源编号", () => {
    const source = readFileSync(
      new URL("./routers/operations.ts", import.meta.url),
      "utf8"
    );

    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'costName: z.string().trim().min(1, "请填写费用名称").max(128)'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "remarks: z.string().trim().max(500).nullable().optional()"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "costName: input.costName.trim()"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "费用水印照片不存在或不属于当前项目"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "remarks: input.remarks?.trim() || null"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "sourceId: `machine-cost-${costId}`"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "已关联水印照片".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "fuelCostDefault".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getEffectiveDieselGuidelinePrice"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "当前加油发生时间未匹配到有效柴油指导价"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'const appliedUnitPrice = input.costType === "fuel" ? guideline!.price!.pricePerLiter : input.unitPrice'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "引用柴油指导价".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });
});
