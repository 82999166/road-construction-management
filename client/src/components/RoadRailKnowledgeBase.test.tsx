import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RoadRailKnowledgeBase from "./RoadRailKnowledgeBase";

describe("公路铁路施工知识库", () => {
  it("按通用、公路、铁路、计量造价和试验检测提供术语与公式参考", () => {
    const markup = renderToStaticMarkup(<RoadRailKnowledgeBase />);

    expect(markup).toContain("公路铁路施工知识库");
    expect(markup).toContain("公路专项");
    expect(markup).toContain("铁路专项");
    expect(markup).toContain("工程量清单与变更");
    expect(markup).toContain("K30、Evd、Ev2");
    expect(markup).toContain("平均断面法");
  });
});
