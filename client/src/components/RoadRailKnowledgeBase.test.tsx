import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RoadRailKnowledgeBase from "./RoadRailKnowledgeBase";

describe("工程工具知识库兼容入口", () => {
  it("复用完整的专业知识库而非保留旧的轻量内容", () => {
    const markup = renderToStaticMarkup(<RoadRailKnowledgeBase />);

    expect(markup).toContain("工程工具知识库");
    expect(markup).toContain("建筑市政 45");
    expect(markup).toContain("公路 35");
    expect(markup).toContain("铁路 62");
    expect(markup).toContain("356");
  });
});
