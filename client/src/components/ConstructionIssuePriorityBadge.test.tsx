import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConstructionIssuePriorityBadge } from "./ConstructionIssuePriorityBadge";
import {
  constructionCsv,
  constructionOutputRows,
  constructionReportSheetHtml,
  constructionPrintBody,
  CONSTRUCTION_OUTPUT_HEADERS,
  type ConstructionWorkspaceReport,
} from "@/lib/constructionOutput";

const report: ConstructionWorkspaceReport = {
  id: 16,
  projectId: 10,
  reportDate: "2026-11-22",
  workArea: "K12+500 路基作业面",
  weather: "sunny",
  workContent: "当日施工完整内容\n施工正文末尾",
  constructionPlan: "下一步施工计划\n计划正文末尾",
  safetyNotes: null,
  issueNotes: "协调问题完整内容\n问题正文末尾",
  issuePriority: "urgent",
  progressPercent: "25.00",
  status: "draft",
  createdBy: 1,
  createdByName: "现场管理员",
  reviewReply: "原审核回复",
  reviewedBy: null,
  reviewedAt: null,
  createdAt: "2026-11-22T02:00:00Z",
  updatedAt: "2026-11-22T02:00:00Z",
};
const meta = { projectName: "施工项目", filterText: "问题等级紧急", total: 1 };

describe("问题等级真实标签与详情打印CSV关联", () => {
  it.each([
    ["urgent", "紧急", "bg-red-100", "text-red-900"],
    ["normal", "一般", "bg-yellow-100", "text-yellow-900"],
    [null, "未分级", "bg-muted", "text-muted-foreground"],
    [undefined, "未分级", "bg-muted", "text-muted-foreground"],
  ] as const)(
    "%s同时展示准确文字和颜色且兼容历史",
    (priority, label, bg, text) => {
      const html = renderToStaticMarkup(
        <ConstructionIssuePriorityBadge
          priority={priority}
          issueNotes="实际问题"
        />
      );
      expect(html).toContain(`aria-label="问题等级：${label}"`);
      expect(html).toContain(label);
      expect(html).toContain(bg);
      expect(html).toContain(text);
      expect(html).toContain(
        `data-issue-priority="${priority ?? "unclassified"}"`
      );
      expect(html).not.toContain("已整改");
    }
  );
  it.each(["", " \n\t ", null, undefined])(
    "空问题%s不显示虚构等级",
    issueNotes => {
      expect(
        renderToStaticMarkup(
          <ConstructionIssuePriorityBadge
            priority="urgent"
            issueNotes={issueNotes}
          />
        )
      ).toBe("");
      const empty = { ...report, issueNotes: issueNotes ?? null };
      expect(
        constructionReportSheetHtml(empty, meta.projectName)
      ).not.toContain("data-issue-priority=");
      expect(
        constructionOutputRows([empty])[0][
          CONSTRUCTION_OUTPUT_HEADERS.indexOf("问题等级")
        ]
      ).toBe("—");
    }
  );
  it.each(["urgent", "normal", null, undefined] as const)(
    "%s跨详情A4和CSV等级一致且不猜历史",
    issuePriority => {
      const item = { ...report, issuePriority };
      const label =
        issuePriority === "urgent"
          ? "紧急"
          : issuePriority === "normal"
            ? "一般"
            : "未分级";
      const detail = constructionReportSheetHtml(item, meta.projectName);
      const print = constructionPrintBody([item], meta);
      for (const html of [detail, print]) {
        expect(html).toContain(`问题等级：${label}`);
        expect(html).toContain(`>${label}</span>`);
        expect(html).toContain(item.issueNotes!);
        expect(html.indexOf(item.workContent)).toBeLessThan(
          html.indexOf(item.constructionPlan!)
        );
        expect(html).not.toContain("历史安全记录");
        expect(html).toContain("审核通过或归档不等同于问题已整改");
      }
      const rows = constructionOutputRows([item]);
      expect(rows[0]).toHaveLength(CONSTRUCTION_OUTPUT_HEADERS.length);
      expect(rows[0][CONSTRUCTION_OUTPUT_HEADERS.indexOf("问题等级")]).toBe(
        label
      );
      expect(rows[0][CONSTRUCTION_OUTPUT_HEADERS.indexOf("施工内容")]).toBe(
        item.workContent
      );
      expect(rows[0][CONSTRUCTION_OUTPUT_HEADERS.indexOf("施工计划")]).toBe(
        item.constructionPlan
      );
      expect(constructionCsv([item], meta)).toContain(`"${label}"`);
    }
  );
  it("历史安全原文只在有内容时保留，空白不再占安全表格行", () => {
    const legacy = {
      ...report,
      issuePriority: null,
      safetyNotes: "历史安全原文\n不能被编辑其他字段清空",
    };
    const html = constructionReportSheetHtml(legacy, meta.projectName);
    expect(html).toContain("历史安全记录");
    expect(html).toContain(legacy.safetyNotes);
    expect(constructionCsv([legacy], meta)).toContain(legacy.safetyNotes);
    expect(
      constructionReportSheetHtml(
        { ...legacy, safetyNotes: " \n " },
        meta.projectName
      )
    ).not.toContain("历史安全记录");
  });
  it("等级不改变原问题与回复安全转义，完整长文本和公式防护继续有效", () => {
    const item = {
      ...report,
      issueNotes: "<script>alert(1)</script>\n" + "问".repeat(990),
      reviewReply: "@SUM(1+1)",
    };
    const html = constructionPrintBody([item], meta);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("问".repeat(990));
    expect(constructionCsv([item], meta)).toContain("'@SUM(1+1)");
    expect(html).toContain("size: A4 portrait");
    expect(html).toContain("break-before: page");
  });
});
