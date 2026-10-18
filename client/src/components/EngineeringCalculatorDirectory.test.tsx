import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EngineeringCalculatorDirectory from "./EngineeringCalculatorDirectory";
import {
  ENGINEERING_CALCULATOR_GROUPS,
  ENGINEERING_CALCULATOR_SPECS,
} from "@/lib/engineering-calculators";

describe("全量工程自动计算工具目录", () => {
  it("提供282个可执行公式的独立搜索与默认折叠入口", () => {
    const html = renderToStaticMarkup(<EngineeringCalculatorDirectory />);
    expect(html).toContain("自动计算工具目录");
    expect(html).toContain("共 282 个已审校的可执行公式");
    expect(html).toContain("搜索全部自动计算工具");
    expect(html).toContain("矩形基础土方开挖体积");
    expect(html).toContain("继续加载 24 个工具");
  });

  it("可按专业接收计算器集合，避免在分类工作台展示全部公式", () => {
    expect(
      ENGINEERING_CALCULATOR_GROUPS.map(group => group.specs.length)
    ).toEqual([34, 23, 31, 27, 46, 45, 48, 28]);
    expect(
      ENGINEERING_CALCULATOR_GROUPS.flatMap(group => group.specs)
    ).toHaveLength(ENGINEERING_CALCULATOR_SPECS.length);

    const html = renderToStaticMarkup(
      <EngineeringCalculatorDirectory
        specs={ENGINEERING_CALCULATOR_GROUPS[6].specs}
        categoryLabel="机械运输"
        categoryDescription="机械、运输与成本"
      />
    );
    expect(html).toContain("机械运输 · 自动计算");
    expect(html).toContain("挖掘机土方开挖产能");
    expect(html).not.toContain("矩形基础土方开挖体积");
  });
});
