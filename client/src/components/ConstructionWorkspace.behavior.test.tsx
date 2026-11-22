import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  constructionFilterInput,
  constructionReviewDrillFilter,
  constructionOutputBatches,
  constructionRowActions,
  CONSTRUCTION_WORKSPACE_TABS,
} from "@shared/constructionWorkspace";
import {
  assertConstructionOutputManifest,
  assertConstructionOutputSnapshot,
  constructionCsv,
  constructionPrintBody,
  type ConstructionWorkspaceReport,
} from "@/lib/constructionOutput";
import { paginateFinanceRows } from "@/lib/financePagination";
import { toChinaDateInput } from "@/lib/businessTime";
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  submitters: vi.fn(),
  capabilities: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ construction: {} }),
    construction: {
      listReports: { useQuery: mock.list },
      summary: { useQuery: mock.summary },
      reportSubmitterOptions: { useQuery: mock.submitters },
      capabilities: { useQuery: mock.capabilities },
      reportEvidence: { useQuery: mock.evidence },
    },
  },
}));
import ConstructionWorkspace, {
  ConstructionReportDetail,
} from "./ConstructionWorkspace";
function report(id = 1): ConstructionWorkspaceReport {
  return {
    id,
    projectId: 10,
    reportDate: "2026-11-04T00:00:00Z",
    workArea: `工区${id}`,
    weather: "sunny",
    workContent: "完成真实施工作业",
    constructionPlan: "完成下一段路基施工计划",
    safetyNotes: "安全说明",
    issueNotes: "现场完整问题",
    progressPercent: "25",
    status: "draft",
    createdBy: 1,
    createdByName: "填报人",
    reviewReply: "完整审核回复",
    reviewedBy: 2,
    reviewedByName: "主管乙",
    reviewedAt: "2026-11-04T02:00:00Z",
    createdAt: "2026-11-04T01:00:00Z",
    updatedAt: "2026-11-04T02:00:00Z",
  };
}
const result = (data: unknown) => ({
  data,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mock.list.mockReturnValue(
    result(Array.from({ length: 55 }, (_, index) => report(index + 1)))
  );
  mock.summary.mockReturnValue(
    result({
      total: 55,
      submitted: 8,
      locked: 4,
      rejected: 2,
      averageProgressPercent: 25,
    })
  );
  mock.submitters.mockReturnValue(result([{ id: 1, name: "填报人" }]));
  mock.capabilities.mockReturnValue(
    result({
      canCreate: true,
      canEdit: false,
      canSubmit: false,
      canReview: false,
      canArchive: false,
      canPrint: true,
      canExport: true,
      canSupervisorReview: false,
    })
  );
  mock.evidence.mockReturnValue(result([]));
});
describe("施工真实组件及屏幕分页行为", () => {
  it("真实台账默认当天且全部状态、全部问题scope，不因问题记录将日报搬走", () => {
    const html = renderToStaticMarkup(<ConstructionWorkspace projectId={10} />);
    expect(mock.list.mock.calls[0][0]).toMatchObject({
      scope: "ledger",
      dateFrom: toChinaDateInput(),
      dateTo: toChinaDateInput(),
      status: undefined,
      issueScope: "all",
    });
    expect(mock.list.mock.calls[0][0]).toEqual(mock.summary.mock.calls[0][0]);
    expect(html).toContain(
      "日报台账包含全部符合条件日报，现场问题只是子视图，不搬走原日报"
    );
    expect(html).toContain("日报台账列表");
    expect(html).toContain('aria-label="施工管理帮助教程"');
    expect(html).toContain("全部符合条件日报（含草稿、问题及安全记录）");
  });
  it("PC真实正文与计划仅为有界摘要、容器内横滚，按真实日期倒序且不修改输入记录", () => {
    const old = {
      ...report(1),
      workContent: "施工开头" + "施".repeat(8000) + "施工末尾",
      constructionPlan: "计划开头" + "计".repeat(1000) + "计划末尾",
    };
    const latest = { ...report(2), reportDate: "2026-11-22T00:00:00Z" };
    const inputRows = [old, latest];
    mock.list.mockReturnValue(result(inputRows));
    const html = renderToStaticMarkup(<ConstructionWorkspace projectId={10} />);
    expect(html).toContain("施工内容摘要 / 施工计划");
    expect(html).toContain("施工开头");
    expect(html).toContain("施工计划：计划开头");
    expect(html).not.toContain("施工末尾");
    expect(html).not.toContain("计划末尾");
    expect(html).toContain("max-w-full overflow-x-auto");
    expect(html).toContain("contain:inline-size");
    expect(html).toContain("table-fixed");
    expect(html.indexOf("工区2")).toBeLessThan(html.indexOf("工区1"));
    expect(inputRows).toEqual([old, latest]);
  });
  it.each(["isLoading", "isFetching", "isError"])(
    "真实汇总%s时不显示缓存55或假0，成功列表仍显示",
    state => {
      mock.summary.mockReturnValue({
        ...result({
          total: 55,
          submitted: 8,
          locked: 0,
          rejected: 0,
          averageProgressPercent: 0,
        }),
        [state]: true,
      });
      const html = renderToStaticMarkup(
        <ConstructionWorkspace projectId={10} />
      );
      expect(html).toMatch(/当前筛选日报<\/p><p[^>]*>—<\/p>/);
      expect(html).toMatch(/已归档 \/ 已退回<\/p><p[^>]*>— \/ —<\/p>/);
      expect(html).toContain("工区1");
      if (state === "isError") {
        expect(html).toContain("汇总读取失败");
        expect(html).toContain("重试汇总");
      }
    }
  );
  it("真实列表加载不渲染缓存正文及假零分页，空态以当前日期筛选解释且给显式历史入口", () => {
    mock.list.mockReturnValue({ ...result([report()]), isFetching: true });
    let html = renderToStaticMarkup(<ConstructionWorkspace projectId={10} />);
    expect(html).not.toContain("工区1");
    expect(html).not.toContain("共 0 条");
    expect(html).toContain("正在读取当前栏目真实施工日报");
    expect(html).toContain("当前 — 份");
    mock.list.mockReturnValue(result([]));
    html = renderToStaticMarkup(<ConstructionWorkspace projectId={10} />);
    expect(html).toContain(toChinaDateInput());
    expect(html).toContain("不代表其他日期没有日报");
    expect(html).toContain("查看历史日报（不限日期）");
    expect(html).toContain("不会自动切换日期");
  });
  it("真实权限未知即使有缓存也不开放操作或显示旧列表，未选择项目不显示缓存汇总", () => {
    mock.capabilities.mockReturnValue({
      ...result({ canCreate: true, canPrint: true, canExport: true }),
      isLoading: true,
    });
    let html = renderToStaticMarkup(
      <ConstructionWorkspace projectId={10} onCreate={vi.fn()} />
    );
    for (const label of [
      "新建施工日报",
      "导出当前筛选 CSV",
      "批量打印当前筛选日报",
      "工区1",
    ])
      expect(html).not.toContain(label);
    expect(html).toContain("未确认前不显示旧项目数据或开放操作");
    html = renderToStaticMarkup(<ConstructionWorkspace projectId={0} />);
    expect(html).toContain("请先选择已授权项目");
    expect(html).not.toContain("当前筛选日报");
    expect(html).not.toContain("工区1");
  });
  it("实际React工作区渲染四栏目、可下钻指标和20/50/100分页，55条仅显示前20条", () => {
    const html = renderToStaticMarkup(
      <ConstructionWorkspace
        projectId={10}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onTransition={vi.fn()}
      />
    );
    for (const tab of CONSTRUCTION_WORKSPACE_TABS)
      expect(html).toContain(tab.label);
    expect(html).toContain('aria-label="施工工作区栏目"');
    expect(html).toContain('aria-label="下钻当前筛选待审核日报"');
    expect(html).toContain("共 55 条");
    expect(html).toContain("工区20");
    expect(html).not.toContain("工区21");
    expect(html).toContain('value="20"');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="100"');
    expect(html).toContain("导出当前筛选 CSV");
    expect(html).toContain("批量打印当前筛选日报");
    expect(html).not.toContain("编辑日报");
    expect(html).not.toContain(">提交<");
    expect(html).toContain("PC 历史编辑");
    expect(mock.list.mock.calls[0][0]).toEqual(mock.summary.mock.calls[0][0]);
    expect(mock.evidence).not.toHaveBeenCalled();
  });
  it("无条件调用全部hooks，active=false及projectId=0只关闭enabled，不分支调用hook", () => {
    renderToStaticMarkup(
      <ConstructionWorkspace projectId={10} active={false} />
    );
    for (const hook of [
      mock.list,
      mock.summary,
      mock.submitters,
      mock.capabilities,
    ]) {
      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook.mock.calls[0][1].enabled).toBe(false);
    }
    renderToStaticMarkup(<ConstructionWorkspace projectId={0} active />);
    for (const hook of [
      mock.list,
      mock.summary,
      mock.submitters,
      mock.capabilities,
    ])
      expect(hook.mock.calls[1][1].enabled).toBe(false);
    expect(mock.evidence).not.toHaveBeenCalled();
  });
  it("手机真实渲染保留8000字施工内容、1000字问题及回复，不截断、不依赖横向大表", () => {
    const item = {
      ...report(),
      workContent: "施".repeat(7990) + "施工末尾",
      issueNotes: "问".repeat(990) + "问题末尾",
      reviewReply: "复".repeat(990) + "回复末尾",
    };
    mock.list.mockReturnValue(result([item]));
    const html = renderToStaticMarkup(
      <ConstructionWorkspace projectId={10} mobile />
    );
    expect(html).toContain(item.workContent);
    expect(html).toContain(item.issueNotes);
    expect(html).toContain(item.reviewReply);
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("line-clamp");
    expect(html).not.toContain("<table");
    expect(mock.capabilities.mock.calls[0][0].surface).toBe("mobile");
  });
  it("详情集中展示审核结果、审核人时间、完整问题和回复，且影像有独立enabled门控", () => {
    const html = renderToStaticMarkup(
      <ConstructionReportDetail report={report()} active={false} />
    );
    for (const text of [
      "审核结果与回复",
      "主管乙",
      "审核时间",
      "现场完整问题",
      "完整审核回复",
      "关联现场照片",
    ])
      expect(html).toContain(text);
    expect(mock.evidence.mock.calls[0][0]).toEqual({
      projectId: 10,
      reportIds: [1],
    });
    expect(mock.evidence.mock.calls[0][1].enabled).toBe(false);
  });
  it("详情说明明确打印重新核验全部关联照片，CSV仅文字，不再提示照片不进入打印", () => {
    const html = renderToStaticMarkup(
      <ConstructionReportDetail report={report()} />
    );
    expect(html).toContain("打印会重新核验并包含全部关联照片；CSV仅文字");
    expect(html).not.toContain("不进入打印或导出");
    expect(html).toContain("站内预览");
  });
  it("照片或列表错误必须真实提示，不以空记录掩盖错误", () => {
    mock.evidence.mockReturnValue({ ...result([]), isError: true });
    expect(
      renderToStaticMarkup(<ConstructionReportDetail report={report()} />)
    ).toContain("不能视为无照片");
    mock.list.mockReturnValue({ ...result([]), isError: true });
    expect(
      renderToStaticMarkup(<ConstructionWorkspace projectId={10} />)
    ).toContain("不能视为空台账");
  });
});
describe("施工筛选、动作和输出纯行为", () => {
  const filter = {
    dateFrom: "2026-11-01",
    dateTo: "2026-11-04",
    createdBy: "2",
    keyword: "  整改  ",
    status: "rejected" as const,
    issueScope: "unreplied" as const,
  };
  it("切换栏目保留同一筛选构造，下钻保留问题scope交集，普通归档重置为全部", () => {
    expect(constructionFilterInput(10, "issues", filter)).toEqual({
      projectId: 10,
      scope: "issues",
      dateFrom: "2026-11-01",
      dateTo: "2026-11-04",
      createdBy: 2,
      keyword: "整改",
      status: "rejected",
      issueScope: "unreplied",
      issuePriority: "all",
    });
    expect(
      constructionFilterInput(10, "archive", {
        ...filter,
        status: "all",
        issueScope: "all",
      })
    ).toMatchObject({ scope: "archive", status: undefined, issueScope: "all" });
    expect(
      constructionFilterInput(10, "review", {
        ...filter,
        createdBy: "all",
        dateFrom: "",
        dateTo: "",
        keyword: "",
      })
    ).toMatchObject({
      createdBy: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      keyword: undefined,
    });
  });
  it("问题栏待审指标下钻保留recorded或原问题scope交集与当前日期管理员关键词", () => {
    const allIssue = {
      ...filter,
      status: "all" as const,
      issueScope: "all" as const,
    };
    expect(constructionReviewDrillFilter("issues", allIssue)).toEqual({
      ...allIssue,
      issueScope: "recorded",
    });
    expect(constructionReviewDrillFilter("issues", filter)).toEqual({
      ...filter,
      status: "all",
    });
    expect(constructionReviewDrillFilter("ledger", allIssue)).toEqual(allIssue);
    expect(
      constructionFilterInput(
        10,
        "review",
        constructionReviewDrillFilter("issues", allIssue)
      )
    ).toMatchObject({
      scope: "review",
      issueScope: "recorded",
      dateFrom: filter.dateFrom,
      createdBy: 2,
      keyword: "整改",
    });
  });
  it.each(["draft", "submitted", "approved", "rejected", "locked"] as const)(
    "%s状态未授权不得显示高影响入口",
    status => {
      expect(
        Object.values(
          constructionRowActions(status, {
            canEdit: false,
            canTransition: false,
          })
        ).some(Boolean)
      ).toBe(false);
    }
  );
  it("已锁定终态即便授权也不能编辑或流转，退回只可编辑不直接再审", () => {
    expect(
      Object.values(
        constructionRowActions("locked", { canEdit: true, canTransition: true })
      ).some(Boolean)
    ).toBe(false);
    expect(
      constructionRowActions("rejected", { canEdit: true, canTransition: true })
    ).toMatchObject({ edit: true, submit: false, approve: false });
  });
  it.each([20, 50, 100])(
    "每页%i不修改原集合，输出仍包含全部501份（第251以后也完整）",
    size => {
      const rows = Array.from({ length: 501 }, (_, index) => report(index + 1));
      expect(paginateFinanceRows(rows, 2, size).pageRows).toHaveLength(size);
      const batches = constructionOutputBatches(rows.map(item => item.id));
      expect(batches.map(batch => batch.ids.length)).toEqual([250, 250, 1]);
      expect(batches.flatMap(batch => batch.ids)).toEqual(
        rows.map(item => item.id)
      );
      const csv = constructionCsv(rows, {
        projectName: "测试项目",
        filterText: "不限日期",
        total: 501,
      });
      expect(csv).toContain("工区251");
      expect(csv).toContain("工区501");
      expect(rows).toHaveLength(501);
    }
  );
  it("打印问题与回复严格独立列，保留最长正文换行并转义XSS，不暴露附件路径或账户", () => {
    const item = {
      ...report(),
      workContent: "施".repeat(8000) + "\n正文末尾<script>alert(1)</script>",
      issueNotes: "原问题尾部",
      reviewReply: "审核回复尾部",
      url: "https://secret.example",
      fileKey: "/secret/file",
      email: "private@example.com",
    };
    const html = constructionPrintBody([item], {
      projectName: "项目",
      filterText: "状态筛选",
      total: 1,
    });
    expect(html).toContain("施".repeat(8000));
    expect(html).toContain("正文末尾&lt;script&gt;");
    expect(html).toContain("问题记录");
    expect(html).toContain("审核结果与回复");
    expect(html).toContain("原问题尾部</div></td></tr>");
    expect(html).toContain("审核回复尾部</div></td></tr>");
    expect(html).not.toContain("https://secret.example");
    expect(html).not.toContain("/secret/file");
    expect(html).not.toContain("private@example.com");
    expect(html).toContain("break-inside:auto");
  });
  it("CSV保留换行完整内容、包含输出口径/总数，并阻止前导空白公式注入", () => {
    const item = {
      ...report(),
      workContent: "第一行\n第二行完整",
      issueNotes: ' =HYPERLINK("恶意")',
      reviewReply: "@SUM(1+1)",
    };
    const csv = constructionCsv([item], {
      projectName: "项目",
      filterText: "状态待审核",
      total: 251,
      batchLabel: "第2批",
      offset: 250,
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"第一行\n第二行完整"');
    expect(csv).toContain("' =HYPERLINK");
    expect(csv).toContain("'@SUM");
    expect(csv).toContain('"全筛选记录数","251"');
    expect(csv).toContain('"输出范围","第2批"');
    expect(csv).toContain('"251","2026-11-04"');
  });
  it("输出分批大小非法时明确拒绝，250边界和空集合准确", () => {
    expect(constructionOutputBatches([])).toEqual([]);
    expect(
      constructionOutputBatches(Array.from({ length: 250 }, (_, i) => i + 1))
    ).toHaveLength(1);
    for (const size of [0, -1, 251, 1.5])
      expect(() => constructionOutputBatches([1], size)).toThrow();
  });
  it("清单结构和快照严格校验total/ids/连续范围，不因同数量或同批数误判完整", () => {
    const original = {
      total: 501,
      batches: constructionOutputBatches(
        Array.from({ length: 501 }, (_, i) => i + 1)
      ),
    };
    expect(assertConstructionOutputManifest(original)).toHaveLength(501);
    expect(() =>
      assertConstructionOutputSnapshot(original, structuredClone(original))
    ).not.toThrow();
    expect(assertConstructionOutputManifest({ total: 0, batches: [] })).toEqual(
      []
    );
    for (const mutate of [
      (value: typeof original) => {
        value.total = 502;
      },
      (value: typeof original) => {
        value.batches[2].ids = [999];
      },
      (value: typeof original) => {
        value.batches[2].ids = [1];
      },
      (value: typeof original) => {
        value.batches[0].from = 2;
      },
      (value: typeof original) => {
        value.batches[0].to = 249;
      },
      (value: typeof original) => {
        value.batches[0].batch = 2;
      },
      (value: typeof original) => {
        value.batches[0].ids[0] = 0;
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      try {
        assertConstructionOutputSnapshot(original, changed);
        throw new Error("错误清单不应通过");
      } catch (error) {
        expect(error).toMatchObject({ code: "CONFLICT" });
      }
    }
  });
});
