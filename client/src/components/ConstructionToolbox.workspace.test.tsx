import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConstructionToolbox from "./ConstructionToolbox";

describe("常用测算二级工作区", () => {
  it("以统一折叠条目组织四个高频工具且不重复嵌入知识库", () => {
    const markup = renderToStaticMarkup(<ConstructionToolbox />);

    expect(markup).toContain("常用测算工具");
    expect(markup).toContain("4 类高频工具");
    expect(markup).toContain("混凝土材料重量估算");
    expect(markup).toContain("材料采购与结算垫资测算");
    expect(markup).toContain("机械成本测算");
    expect(markup).toContain("运输运距运价测算");
    expect(markup).toContain("即时测算");
    expect(markup).not.toContain("工程工具知识库");
  });

  it("统一使用静态展开方式，避免输入页上下滑动动画", () => {
    const source = readFileSync(
      new URL("./ConstructionToolbox.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("data-[state=closed]:animate-none");
    expect(source).toContain("data-[state=open]:animate-none");
    expect(source).not.toContain("includeKnowledge");
  });
});
