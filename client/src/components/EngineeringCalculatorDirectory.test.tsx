import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EngineeringCalculatorDirectory from "./EngineeringCalculatorDirectory";

describe("全量工程自动计算工具目录", () => {
  it("提供282个可执行公式的独立搜索与默认折叠入口", () => {
    const html = renderToStaticMarkup(<EngineeringCalculatorDirectory />);
    expect(html).toContain("自动计算工具目录");
    expect(html).toContain("共 282 个已审校的可执行公式");
    expect(html).toContain("搜索全部自动计算工具");
    expect(html).toContain("矩形基础土方开挖体积");
    expect(html).toContain("继续加载 24 个工具");
  });
});
