import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EngineeringCalculatorPanel, displayEngineeringResult } from "@/components/EngineeringCalculatorPanel";
import { formatRecognizedAmount } from "@shared/numberFormat";
import type { EngineeringCalculatorSpec } from "@/lib/engineering-calculators";

describe("common business presentation covers tools and evidence", () => {
  it("engineering quantities and monetary results always have 2 decimals", () => {
    expect(displayEngineeringResult(3, 0, "m³")).toBe("3.00");
    expect(displayEngineeringResult(19.035, 3, "m³")).toBe("19.04");
    expect(displayEngineeringResult(3706.02, 2, "元")).toBe("3,706.02");
    expect(displayEngineeringResult(5.5, 1, "h")).toBe("5.50");
  });
  it("counts, degrees and dimensionless scientific coefficients retain their existing policy", () => {
    expect(displayEngineeringResult(3, 0, "台")).toBe("3");
    expect(displayEngineeringResult(12.3, 1, "%")).toBe("12.3");
    expect(displayEngineeringResult(0.000123, 6, "无量纲")).toBe("0.000123");
  });
  it("real component retains precise parameter input and calculation but presents 2 decimals", () => {
    let calculatedInput = 0;
    const spec = {
      id: "synthetic-two-decimal", title: "合成方量测试", exampleSummary: "合成数据",
      formula: "Q=x", riskNotice: "测试", inputs: [{key:"x",label:"方量",unit:"m³",defaultValue:19.035,step:0.001,description:"原始精度"}],
      requiresProfessionalReview: false,
      outputs: [{key:"q",label:"计算方量",unit:"m³",precision:3}],
      calculate: (values:Record<string,number>) => { calculatedInput=values.x; return {q:values.x}; },
    } as EngineeringCalculatorSpec;
    const html = renderToStaticMarkup(<EngineeringCalculatorPanel spec={spec}/>);
    expect(html).toContain('value="19.035"');
    expect(html).toContain("19.04");
    expect(html).toContain("内部计算保留原精度");
    expect(calculatedInput).toBe(19.035);
  });
  it.each([
    ["200", "200.00"], ["¥1234.5", "¥1,234.50"], ["2,000.555元", "2,000.56元"],
    [0, "0.00"], [null, "未识别"], ["金额待核实", "金额待核实"], ["1.2.3", "1.2.3"],
  ] as const)("OCR only formats a complete recognized numeric amount %s", (value, expected) => {
    expect(formatRecognizedAmount(value)).toBe(expected);
  });
});
