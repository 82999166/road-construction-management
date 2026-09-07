import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngineeringCalculatorPanel } from "./EngineeringCalculatorPanel";
import { ENGINEERING_CALCULATOR_BY_ID } from "@/lib/engineering-calculators";

describe("EngineeringCalculatorPanel", () => {
  it("展示真实数值输入、示例回填、清空与实时结果区域", () => {
    const spec = ENGINEERING_CALCULATOR_BY_ID.get("STR-VOL-001");
    const html = renderToStaticMarkup(<EngineeringCalculatorPanel spec={spec!} />);
    expect(html).toContain("实时输入与自动计算");
    expect(html).toContain("基础底面长");
    expect(html).toContain("自动计算结果");
    expect(html).toContain("示例回填");
    expect(html).toContain("清空");
    expect(html).toContain("开挖体积");
    expect(html).toContain("22.99");
  });
});
