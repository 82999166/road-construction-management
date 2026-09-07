import { describe, expect, it } from "vitest";
import { ENGINEERING_CALCULATOR_BY_ID, ENGINEERING_CALCULATOR_SPECS } from "./index";

describe("工程自动计算器规格", () => {
  it("注册全部已审校的可执行计算器，并覆盖八个专业分卷", () => {
    expect(ENGINEERING_CALCULATOR_SPECS).toHaveLength(282);
    expect(new Set(ENGINEERING_CALCULATOR_SPECS.map(spec => spec.id)).size).toBe(282);
    expect(ENGINEERING_CALCULATOR_SPECS.some(spec => spec.id === "STR-VOL-001")).toBe(true);
    expect(ENGINEERING_CALCULATOR_SPECS.some(spec => spec.id === "M-001")).toBe(true);
    expect(ENGINEERING_CALCULATOR_SPECS.some(spec => spec.id.includes("SUB"))).toBe(true);
  });

  it("矩形基础土方按当前输入实时计算，不保留旧示例结果", () => {
    const spec = ENGINEERING_CALCULATOR_BY_ID.get("STR-VOL-001");
    expect(spec).toBeDefined();
    const first = spec!.calculate({ "基础底面长_a": 2, "基础底面宽_b": 1.5, "工作面宽度_c": 0.3, "放坡系数_k": 0.5, "开挖深度_H": 2 });
    const second = spec!.calculate({ "基础底面长_a": 4, "基础底面宽_b": 1.5, "工作面宽度_c": 0.3, "放坡系数_k": 0.5, "开挖深度_H": 2 });
    expect(first["开挖体积"]).toBeCloseTo(22.9867, 3);
    expect(second["开挖体积"]).toBeGreaterThan(first["开挖体积"]);
  });

  it("施工配合比换算按当前含水率重新计算用水量", () => {
    const spec = ENGINEERING_CALCULATOR_BY_ID.get("M-001");
    expect(spec).toBeDefined();
    const dry = spec!.calculate({ labWater: 180, labSand: 700, labStone: 1200, labCement: 300, sandWaterRate: 0, stoneWaterRate: 0 });
    const wet = spec!.calculate({ labWater: 180, labSand: 700, labStone: 1200, labCement: 300, sandWaterRate: 4, stoneWaterRate: 1 });
    expect(dry.siteWater).toBe(180);
    expect(wet.siteWater).toBe(140);
    expect(wet.siteSand).toBeCloseTo(728, 4);
  });

  it("全部自动计算工具均可用默认参数执行并返回有限数值", () => {
    const failures: string[] = [];
    for (const spec of ENGINEERING_CALCULATOR_SPECS) {
      const values = Object.fromEntries(spec.inputs.map(input => [input.key, input.defaultValue]));
      try {
        const result = spec.calculate(values);
        for (const output of spec.outputs) {
          if (!Number.isFinite(result[output.key])) failures.push(`${spec.id}:${output.key}`);
        }
      } catch {
        failures.push(`${spec.id}:运行异常`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("专业复核类规格保留明确安全标记，不自动输出合格判定", () => {
    const spec = ENGINEERING_CALCULATOR_BY_ID.get("STR-REB-004");
    expect(spec?.requiresProfessionalReview).toBe(true);
    expect(spec?.riskNotice).toMatch(/专业人员|规范复核/);
  });
});
