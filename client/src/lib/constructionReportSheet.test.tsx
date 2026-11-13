import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConstructionReportSheet } from "@/components/ConstructionReportSheet";
import {
  CONSTRUCTION_REPORT_SHEET_CSS,
  constructionPrintBody,
  constructionReportSheetHtml,
  type ConstructionWorkspaceReport,
} from "./constructionOutput";

function report(
  overrides: Partial<ConstructionWorkspaceReport> = {}
): ConstructionWorkspaceReport {
  return {
    id: 781,
    projectId: 9,
    reportDate: "2026-11-04",
    workArea: "K12+500—K13+200 路基作业面",
    weather: "cloudy",
    workContent: "完成路基填筑及压实检测。\n整平排水沟。",
    constructionPlan: "次日开展边坡修整。\n继续压实检测。",
    safetyNotes: "现场临边防护完整。",
    issueNotes: "雨后积水待协调排除。",
    progressPercent: "46.25",
    status: "approved",
    createdBy: 15,
    createdByName: "记录员甲",
    reviewReply: "同意；积水问题继续跟进。",
    reviewedBy: 27,
    reviewedByName: "审核员乙",
    reviewedAt: "2026-11-05T02:03:04.000Z",
    createdAt: "2026-11-04T01:02:03.000Z",
    updatedAt: "2026-11-05T03:04:05.000Z",
    ...overrides,
  };
}

function renderPrint(
  reports: readonly ConstructionWorkspaceReport[],
  metadata = {
    projectName: "示范道路工程",
    filterText: "状态：已审核；日期不限",
    total: 501,
    offset: 250,
    batchLabel: "第2批（251—500）",
  }
) {
  return renderToStaticMarkup(
    <main
      dangerouslySetInnerHTML={{
        __html: constructionPrintBody(reports, metadata),
      }}
    />
  );
}

afterEach(() => vi.useRealTimers());

describe("施工日志共享表单与A4打印", () => {
  it("真实React渲染只展示同一安全报告HTML，含真实日报编号和所有原明细", () => {
    const item = report();
    const html = renderToStaticMarkup(
      <ConstructionReportSheet report={item} projectName="示范道路工程" />
    );
    expect(html).toContain(constructionReportSheetHtml(item, "示范道路工程"));
    expect(html).toContain('<h1 class="daily-report-title">施工日志</h1>');
    expect(html).toContain("日期：2026-11-04");
    expect(html).toContain("日报编号：781");
    expect(html).toContain(
      '<th scope="row">工程名称</th><td colspan="3">示范道路工程</td>'
    );
    for (const text of [
      "K12+500—K13+200 路基作业面",
      "多云",
      "46.25%",
      "已审核",
      "完成路基填筑及压实检测。\n整平排水沟。",
      "次日开展边坡修整。\n继续压实检测。",
      "现场临边防护完整。",
      "雨后积水待协调排除。",
      "同意；积水问题继续跟进。",
      "记录员甲",
      "审核员乙",
      "2026/11/5 10:03:04",
      "2026/11/4 09:02:03",
      "2026/11/5 11:04:05",
      "施工进度情况",
      "施工计划",
      "安全情况",
      "质量/协调问题",
      "审核结果与回复",
      "审核时间",
      "创建时间",
      "更新时间",
    ])
      expect(html).toContain(text);
    expect(html.indexOf("施工进度情况")).toBeLessThan(html.indexOf("施工计划"));
    expect(html).not.toContain('<footer class="daily-report-output-metadata">');
    expect(html).not.toContain("筛选：");
    expect(html).not.toContain("输出范围：");
    expect(html).not.toContain("生成时间：");
    for (const fabricated of [
      "工程编号",
      "施工单位",
      "气温",
      "风力",
      "材料记录",
    ])
      expect(html).not.toContain(fabricated);
  });

  it("两份日报独立起页，保留总数/本批数/范围/份数/生成时间及筛选元数据", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T13:14:15.000Z"));
    const html = renderPrint([
      report(),
      report({ id: 809, workArea: "第二份独有作业面" }),
    ]);
    expect(html.match(/<section class="daily-report-sheet"/g)).toHaveLength(2);
    expect(
      html.match(/<h1 class="daily-report-title">施工日志<\/h1>/g)
    ).toHaveLength(2);
    expect(
      html.match(/<footer class="daily-report-output-metadata">/g)
    ).toHaveLength(2);
    expect(html).toContain("日报编号：781");
    expect(html).toContain("日报编号：809");
    expect(html).toContain("第二份独有作业面");
    for (const text of [
      "项目：示范道路工程",
      "筛选：状态：已审核；日期不限",
      "全筛选记录数：501",
      "本批记录数：2",
      "输出范围：第2批（251—500）",
      "第251份 / 共501份",
      "第252份 / 共501份",
      "生成时间：2026/11/13 21:14:15",
    ])
      expect(html).toContain(text);
    expect(html).toContain(
      "@page daily-construction-report { size: A4 portrait; margin: 12mm; }"
    );
    expect(html).toContain("page: daily-construction-report");
    expect(html).toMatch(
      /\.daily-report-sheet \+ \.daily-report-sheet\s*\{\s*break-before: page;\s*page-break-before: always;/
    );
  });

  it("超长内容和所有末尾完整保留、跨页允许、不锁定页面高度或裁切正文", () => {
    const progress = "路基施工过程记录".repeat(1500) + "\n进度正文最后一行-END";
    const plan = "后续施工计划".repeat(1000) + "\n施工计划末尾-END";
    const html = renderPrint([
      report({ workContent: progress, constructionPlan: plan }),
      report({ id: 982, reviewReply: "第二份审核末尾-END" }),
    ]);
    expect(html).toContain(progress);
    expect(html).toContain(plan);
    expect(html).toContain("第二份审核末尾-END");
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toMatch(
      /\.daily-report-sheet \.daily-report-table > tbody > tr\s*\{[^}]*break-inside: auto;[^}]*page-break-inside: auto;/
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain(
      "max-height: none !important;"
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain(
      "overflow: visible !important;"
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toMatch(
      /(?:^|[;{])\s*overflow(?:-y)?:\s*(?:hidden|clip|auto|scroll)/m
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toMatch(
      /(?:^|[;{])\s*(?:height|max-height):\s*\d/m
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toContain("break-inside: avoid");
  });

  it("换行及XSS均安全转义，明细与元数据不执行HTML，不带影像URL或账户属性", () => {
    const hostile =
      '第一行\n第二行 & <script>alert("x")</script>\r\n末尾<img src=x onerror=alert(1)>\'"';
    const item = {
      ...report({
        workContent: hostile,
        constructionPlan: hostile,
        safetyNotes: hostile,
        issueNotes: hostile,
        reviewReply: hostile,
        workArea: hostile,
        createdByName: hostile,
        reviewedByName: hostile,
      }),
      url: "https://secret.example/evidence.jpg",
      imageUrls: ["https://secret.example/second.jpg"],
      fileKey: "/private/evidence.jpg",
      email: "private@example.com",
    };
    const html = renderPrint([item], {
      projectName: hostile,
      filterText: hostile,
      batchLabel: hostile,
      total: 1,
      offset: 0,
    });
    expect(html).toContain(
      "第一行\n第二行 &amp; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;\r\n末尾&lt;img src=x onerror=alert(1)&gt;&#39;&quot;"
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("secret.example");
    expect(html).not.toContain("/private/evidence.jpg");
    expect(html).not.toContain("private@example.com");
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toMatch(
      /> :is\(th, td\)\s*\{[^}]*white-space: pre-wrap !important;/
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toMatch(
      /\.daily-report-content\s*\{[^}]*white-space: pre-wrap !important;/
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain(
      "border: 1px solid #000 !important;"
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain('"SimSun", "Songti SC"');
  });

  it("旧null或缺省计划显示未填写，未审核显示真实状态和审核人回退", () => {
    for (const constructionPlan of [null, undefined, ""] as const) {
      const item = report({
        constructionPlan,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        status: "draft",
      });
      const html = renderToStaticMarkup(
        <ConstructionReportSheet report={item} projectName="旧数据项目" />
      );
      expect(html).toContain('daily-report-plan-content">未填写</div>');
      expect(html).toContain("审核结果：草稿");
      expect(html).toContain('<th scope="row">审核人</th><td>未审核</td>');
      expect(html).toContain(
        '<th scope="row">审核时间</th><td colspan="3">未审核</td>'
      );
    }
    expect(renderPrint([report({ reviewedByName: null })])).toContain(
      "管理员 #27"
    );
  });

  it("手机无固定整页宽度且CSS仅限定到日报作用域，不改变其他打印表格或默认页", () => {
    const html = renderToStaticMarkup(
      <ConstructionReportSheet
        report={report()}
        projectName={"长项目名".repeat(100)}
      />
    );
    expect(html).toContain('style="min-width:0;width:100%"');
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain(
      "@media screen and (max-width: 480px)"
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain("min-width: 0 !important;");
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toMatch(/@page\s*\{/);
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toMatch(
      /(?:^|\n)\s*(?:body|html|table|th|td|tr|h1)\s*\{/
    );
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toMatch(
      /(?:^|\n)\s*(?:width|min-width):\s*\d+(?:mm|cm|px)/
    );
  });

  it("空筛选仍输出完整说明，默认全量输出范围与生成时间不丢失", () => {
    const html = renderToStaticMarkup(
      <div
        dangerouslySetInnerHTML={{
          __html: constructionPrintBody([], {
            projectName: "空项目",
            filterText: "日期：今天",
            total: 0,
          }),
        }}
      />
    );
    expect(html).toContain("当前筛选暂无日报");
    for (const text of [
      "项目：空项目",
      "筛选：日期：今天",
      "全筛选记录数：0",
      "本批记录数：0",
      "输出范围：完整当前筛选",
      "生成时间：",
    ])
      expect(html).toContain(text);
  });
});
