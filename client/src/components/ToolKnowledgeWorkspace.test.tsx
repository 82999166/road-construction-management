import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ToolKnowledgeWorkspace from "./ToolKnowledgeWorkspace";
import { ENGINEERING_CALCULATOR_GROUPS } from "@/lib/engineering-calculators";
import { ENGINEERING_KNOWLEDGE_ITEMS } from "./EngineeringKnowledgeLibrary";

describe("分类工具知识工作台", () => {
  it("以八个专业和常用测算组织知识与计算器，并保持完整分类映射", () => {
    expect(ENGINEERING_CALCULATOR_GROUPS).toHaveLength(8);
    expect(ENGINEERING_CALCULATOR_GROUPS.map(group => group.label)).toEqual([
      "建筑市政",
      "材料配比",
      "土工路基",
      "公路",
      "铁路",
      "测量工程量",
      "机械运输",
      "计量结算",
    ]);
    expect(
      ENGINEERING_CALCULATOR_GROUPS.map(
        group =>
          ENGINEERING_KNOWLEDGE_ITEMS.filter(
            item => item.tab === group.knowledgeTab
          ).length
      )
    ).toEqual([45, 40, 40, 35, 62, 46, 48, 40]);

    const markup = renderToStaticMarkup(<ToolKnowledgeWorkspace />);
    expect(markup).toContain('data-testid="tool-knowledge-workspace"');
    expect(markup).toContain('data-testid="tool-knowledge-category-tabs"');
    expect(markup).toContain('data-testid="tool-knowledge-tab-building"');
    expect(markup).toContain('data-testid="tool-knowledge-tab-settlement"');
    expect(markup).toContain('data-testid="tool-knowledge-tab-common"');
    expect(markup).toContain("建筑市政专业区");

    const source = readFileSync(
      new URL("./ToolKnowledgeWorkspace.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("常用现场与商务测算");
    expect(source).toContain('data-testid="common-calculators-panel"');
  });

  it("仅在超级后台需要时挂载结算模板参考", () => {
    const source = String(ToolKnowledgeWorkspace);
    expect(source).toContain("includeSettlementTemplate");
    expect(source).toContain("SettlementTemplateCalculator");
  });
});
