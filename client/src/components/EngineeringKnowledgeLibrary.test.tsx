import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EngineeringKnowledgeLibrary, {
  ENGINEERING_KNOWLEDGE_ITEMS,
  ENGINEERING_KNOWLEDGE_TOTAL,
} from "./EngineeringKnowledgeLibrary";

describe("工程工具知识库", () => {
  it("完整接入八个专业分卷且每个条目保留核心说明字段", () => {
    expect(ENGINEERING_KNOWLEDGE_TOTAL).toBe(356);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "建筑市政")
    ).toHaveLength(45);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "材料配比")
    ).toHaveLength(40);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "土工路基")
    ).toHaveLength(40);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "公路")
    ).toHaveLength(35);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "铁路")
    ).toHaveLength(62);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "测量工程量")
    ).toHaveLength(46);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "机械运输")
    ).toHaveLength(48);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.filter(item => item.tab === "计量结算")
    ).toHaveLength(40);
    expect(
      ENGINEERING_KNOWLEDGE_ITEMS.every(
        item =>
          item.id &&
          item.name &&
          item.definition &&
          item.caution &&
          item.standard
      )
    ).toBe(true);
    const automaticItems = ENGINEERING_KNOWLEDGE_ITEMS.filter(
      item => item.form === "自动计算器"
    );
    expect(automaticItems).toHaveLength(261);
  });

  it("提供专业 Tab、检索入口、详情字段和高风险统一提示", () => {
    const markup = renderToStaticMarkup(<EngineeringKnowledgeLibrary />);
    expect(markup).toContain("工程工具知识库");
    expect(markup).toContain("建筑市政 45");
    expect(markup).toContain("铁路 62");
    expect(markup).toContain("计量结算术语 40");
    expect(markup).toContain("全局搜索：名称、公式、变量、示例、标准或术语");
    expect(markup).toContain("自动计算条目可展开输入参数并实时查看结果");
    expect(markup).toContain("统一使用边界");
    expect(markup).toContain("不能替代试验室试配");
  });

  it("支持分类工作台固定专业并隐藏重复的内部分类导航", () => {
    const markup = renderToStaticMarkup(
      <EngineeringKnowledgeLibrary
        tab="机械运输"
        hideTabNavigation
        showCalculatorPanels={false}
        testId="knowledge-category-machinery"
      />
    );
    expect(markup).toContain("机械运输成本 · 知识与标准");
    expect(markup).toContain("机械、运输与成本相关资料共 48 项");
    expect(markup).toContain("搜索机械运输成本知识、标准、术语或示例");
    expect(markup).toContain('data-testid="knowledge-category-machinery"');
    expect(markup).not.toContain("全部 356");
  });
});
