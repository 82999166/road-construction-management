import { describe, expect, it } from "vitest";
import {
  getConstructionIssuePriorityLabel,
  getConstructionIssuePriorityBadge,
} from "../shared/constructionIssuePriority";
import {
  constructionFilterInput,
  constructionReviewDrillFilter,
  type ConstructionWorkspaceFilter,
} from "../shared/constructionWorkspace";

const filter: ConstructionWorkspaceFilter = {
  dateFrom: "2026-11-22",
  dateTo: "2026-11-22",
  createdBy: "all",
  keyword: "",
  status: "all",
  issueScope: "all",
};
describe("问题等级共享契约", () => {
  it("显式中文等级，NULL/undefined未分级不自动归一般", () => {
    expect(getConstructionIssuePriorityLabel("urgent")).toBe("紧急");
    expect(getConstructionIssuePriorityLabel("normal")).toBe("一般");
    expect(getConstructionIssuePriorityLabel(null)).toBe("未分级");
    expect(getConstructionIssuePriorityLabel(undefined)).toBe("未分级");
    expect(getConstructionIssuePriorityLabel()).toBe("未分级");
  });
  it.each([null, undefined, "", " \t\n"])(
    "空问题%j即使urgent也无badge",
    issueNotes => {
      expect(
        getConstructionIssuePriorityBadge(issueNotes, "urgent")
      ).toBeNull();
      expect(getConstructionIssuePriorityBadge(issueNotes, null)).toBeNull();
    }
  );
  it("真实问题红/黄/中性语义一致，不从自由文字推断紧急与整改", () => {
    expect(getConstructionIssuePriorityBadge("一般措辞", "urgent")).toEqual({
      priority: "urgent",
      label: "紧急",
      tone: "red",
    });
    expect(getConstructionIssuePriorityBadge("紧急需整改", "normal")).toEqual({
      priority: "normal",
      label: "一般",
      tone: "yellow",
    });
    expect(getConstructionIssuePriorityBadge("已整改", null)).toEqual({
      priority: null,
      label: "未分级",
      tone: "neutral",
    });
  });
  it("旧共享filter省略新字段仍接受，并明确发送默认all", () => {
    expect(constructionFilterInput(10, "ledger", filter)).toEqual({
      projectId: 10,
      scope: "ledger",
      dateFrom: "2026-11-22",
      dateTo: "2026-11-22",
      createdBy: undefined,
      keyword: undefined,
      status: undefined,
      issueScope: "all",
      issuePriority: "all",
    });
  });
  it.each(["all", "urgent", "normal", "unclassified"] as const)(
    "筛选%s跨栏目/审核下钻保留同一等级与旧安全协议",
    issuePriority => {
      const current = {
        ...filter,
        issuePriority,
        issueScope: "safety" as const,
      };
      expect(constructionFilterInput(10, "issues", current).issuePriority).toBe(
        issuePriority
      );
      const drill = constructionReviewDrillFilter("issues", current);
      expect(drill.issuePriority).toBe(issuePriority);
      expect(drill.issueScope).toBe("safety");
      expect(constructionFilterInput(10, "review", drill).issuePriority).toBe(
        issuePriority
      );
    }
  );
});
