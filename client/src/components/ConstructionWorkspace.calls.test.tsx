import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => {
  let cursor = 0;
  const slots: any[] = [];
  let effects: Array<() => void> = [];
  let dirty = false;
  const data: Record<string, any> = {};
  const queries: Record<string, any[]> = {};
  const same = (a?: unknown[], b?: unknown[]) =>
    Boolean(
      a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
    );
  return {
    data,
    queries,
    manifest: vi.fn(),
    print: vi.fn(),
    export: vi.fn(),
    reset() {
      cursor = 0;
      slots.length = 0;
      effects = [];
      dirty = false;
      Object.keys(data).forEach(k => delete data[k]);
      Object.keys(queries).forEach(k => delete queries[k]);
    },
    render<T>(fn: () => T): T {
      let tree!: T;
      for (let i = 0; i < 8; i++) {
        cursor = 0;
        dirty = false;
        tree = fn();
        const pending = effects;
        effects = [];
        pending.forEach(f => f());
        if (!dirty) return tree;
      }
      throw new Error("测试hook未稳定");
    },
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (v: any) => {
          const next = typeof v === "function" ? v(slots[i]) : v;
          if (!Object.is(slots[i], next)) {
            slots[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps))
        slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          slots[i].cleanup = fn();
        });
      }
    },
    query(name: string, input: unknown, options: unknown) {
      (queries[name] ??= []).push({ input, options });
      return {
        data: data[name],
        isFetching: false,
        isLoading: false,
        isError: Boolean(data[`${name}Error`]),
        refetch: vi.fn(),
      };
    },
  };
});
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: harness.useState,
  useRef: harness.useRef,
  useMemo: harness.useMemo,
  useEffect: harness.useEffect,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      construction: {
        outputManifest: { fetch: harness.manifest },
        printReports: { fetch: harness.print },
        exportReports: { fetch: harness.export },
      },
    }),
    construction: new Proxy(
      {},
      {
        get: (_target, name: string) => ({
          useQuery: (input: unknown, options: unknown) =>
            harness.query(name, input, options),
        }),
      }
    ),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/a4Print", async original => ({
  ...(await original<typeof import("@/lib/a4Print")>()),
  openA4PrintDocument: vi.fn(),
}));
vi.mock("@/lib/constructionOutput", async original => ({
  ...(await original<typeof import("@/lib/constructionOutput")>()),
  downloadConstructionCsv: vi.fn(),
}));
vi.mock("./FinanceWorkspaceNavigation", () => ({
  FinancePagination: () => null,
  useFinancePagination: (rows: any[]) => {
    const [page, setPage] = harness.useState(1);
    const [pageSize, setPageSize] = harness.useState(20);
    return {
      page,
      pageSize,
      setPage,
      setPageSize,
      total: rows.length,
      pageRows: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  },
}));
import ConstructionWorkspace, {
  type ConstructionWorkspaceProps,
} from "./ConstructionWorkspace";
import { BusinessWorkspaceNavigation } from "./BusinessWorkspaceNavigation";
import { FinancePagination } from "./FinanceWorkspaceNavigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { openA4PrintDocument } from "@/lib/a4Print";
import {
  downloadConstructionCsv,
  type ConstructionWorkspaceReport,
} from "@/lib/constructionOutput";
import { constructionOutputBatches } from "@shared/constructionWorkspace";
import { toast } from "sonner";
type Node = ReactElement<any>;
function walk(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...walk(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value)
    return text((value as Node).props.children);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
function report(id: number): ConstructionWorkspaceReport {
  return {
    id,
    projectId: 10,
    reportDate: "2026-11-04T00:00:00Z",
    workArea: `工区${id}`,
    weather: "sunny",
    workContent: `施工正文${id}`,
    constructionPlan: "完成下一段路基施工计划",
    safetyNotes: "安全说明",
    issueNotes: "原问题",
    progressPercent: 25,
    status: "submitted",
    createdBy: 2,
    createdByName: "管理员乙",
    reviewReply: "审核回复",
    reviewedBy: 3,
    reviewedByName: "主管丙",
    reviewedAt: "2026-11-04T01:00:00Z",
    createdAt: "2026-11-04T01:00:00Z",
    updatedAt: "2026-11-04T01:00:00Z",
  };
}
const manifest = (ids = Array.from({ length: 501 }, (_, i) => i + 1)) => ({
  total: ids.length,
  generatedAt: new Date(),
  batches: constructionOutputBatches(ids),
});
let props: ConstructionWorkspaceProps;
const render = () => harness.render(() => ConstructionWorkspace(props));
function button(tree: Node, label: string) {
  const node = walk(tree).find(
    n => n.type === Button && text(n.props.children) === label
  );
  expect(node, label).toBeTruthy();
  return node!;
}
async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
async function click(tree: Node, label: string) {
  const node = button(tree, label);
  expect(node.props.disabled).not.toBe(true);
  node.props.onClick();
  await settle();
}
function fill(tree: Node, id: string, value: string) {
  const node = walk(tree).find(
    n => (n.type === Input || n.type === "select") && n.props.id === id
  );
  expect(node, id).toBeTruthy();
  node!.props.onChange({ target: { value } });
}
function tab(tree: Node, value: string) {
  const node = walk(tree).find(n => n.type === BusinessWorkspaceNavigation);
  node!.props.onValueChange(value);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  harness.reset();
  vi.clearAllMocks();
  props = {
    projectId: 10,
    projectName: "项目甲",
    active: true,
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onTransition: vi.fn(),
  };
  harness.data.listReports = Array.from({ length: 501 }, (_, i) =>
    report(i + 1)
  );
  harness.data.summary = {
    total: 501,
    submitted: 501,
    locked: 0,
    rejected: 0,
    averageProgressPercent: 25,
  };
  harness.data.reportSubmitterOptions = [{ id: 2, name: "管理员乙" }];
  harness.data.capabilities = {
    canCreate: true,
    canEdit: false,
    canSubmit: false,
    canReview: false,
    canArchive: false,
    canPrint: true,
    canExport: true,
  };
  harness.manifest.mockResolvedValue(manifest());
  harness.print.mockImplementation(async input =>
    input.reportIds.map(report).reverse()
  );
  harness.export.mockImplementation(async input =>
    input.reportIds.map(report).reverse()
  );
});
describe("施工真实组件回调调用级行为（不浏览器、不实际DB）", () => {
  it.each([0, 250])(
    "%i份实际点击边界准确，零份不输出，250份一次完整输出",
    async total => {
      harness.manifest.mockResolvedValue(
        manifest(Array.from({ length: total }, (_, i) => i + 1))
      );
      await click(render(), "导出当前筛选 CSV");
      expect(harness.export).toHaveBeenCalledTimes(total ? 1 : 0);
      expect(downloadConstructionCsv).toHaveBeenCalledTimes(total ? 1 : 0);
      if (total)
        expect(harness.export.mock.calls[0][0].reportIds).toHaveLength(250);
      else expect(toast.info).toHaveBeenCalledWith("当前筛选暂无可输出的日报");
      expect(text(render())).not.toContain("全筛选 501 份 / 3 批");
    }
  );
  it.each(["replace", "duplicate", "project"])(
    "即使回包数量相同，%s记录异常仍拒绝输出和完成标记",
    async invalid => {
      await click(render(), "导出当前筛选 CSV");
      const tree = render();
      const rows = Array.from({ length: 250 }, (_, i) => report(i + 1));
      if (invalid === "replace") rows[249] = report(999);
      if (invalid === "duplicate") rows[249] = report(1);
      if (invalid === "project") rows[249] = { ...report(250), projectId: 20 };
      harness.export.mockResolvedValue(rows);
      await click(tree, "导出第 1 批");
      expect(downloadConstructionCsv).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("总数或记录号已变化")
      );
    }
  );
  it.each(["print", "export"] as const)(
    "501份%s逐批250/250/1，没有自动调用或250截断，列表分页不改变清单",
    async action => {
      let tree = render();
      const pagination = walk(tree).find(n => n.type === FinancePagination)!;
      pagination.props.onPageSizeChange(50);
      pagination.props.onPageChange(2);
      tree = render();
      const input = harness.queries.listReports.at(-1).input;
      expect(input).toEqual(harness.queries.summary.at(-1).input);
      await click(
        tree,
        action === "print" ? "批量打印当前筛选日报" : "导出当前筛选 CSV"
      );
      tree = render();
      expect(harness.print).not.toHaveBeenCalled();
      expect(harness.export).not.toHaveBeenCalled();
      expect(text(tree)).toContain("全筛选 501 份 / 3 批；已生成 0 批");
      for (const range of ["第 1–250 份", "第 251–500 份", "第 501–501 份"])
        expect(text(tree)).toContain(range);
      for (let batch = 1; batch <= 3; batch++) {
        await click(
          tree,
          `${action === "print" ? "打印" : "导出"}第 ${batch} 批`
        );
        tree = render();
      }
      const fetch = action === "print" ? harness.print : harness.export;
      expect(
        fetch.mock.calls.map(([request]) => request.reportIds.length)
      ).toEqual([250, 250, 1]);
      expect(
        fetch.mock.calls.flatMap(([request]) => request.reportIds)
      ).toEqual(Array.from({ length: 501 }, (_, i) => i + 1));
      for (const [request] of fetch.mock.calls)
        expect(request).toMatchObject(input);
      for (const [request] of harness.manifest.mock.calls)
        expect(request).toEqual({ ...input, action });
      expect(harness.manifest).toHaveBeenCalledTimes(4);
      expect(text(tree)).toContain("已生成 3 批");
      const output =
        action === "print"
          ? vi
              .mocked(openA4PrintDocument)
              .mock.calls.map(([x]) => x.bodyHtml)
              .join("")
          : vi
              .mocked(downloadConstructionCsv)
              .mock.calls.map(([, csv]) => csv)
              .join("");
      expect(output).toContain("工区501");
      expect(output).toContain("501");
      if (action === "print")
        expect(output.indexOf("工区1</")).toBeLessThan(
          output.indexOf("工区250</")
        );
    }
  );
  it.each(["total", "ids"] as const)(
    "全清单%s变化明确CONFLICT，即使当前批次未变，也不输出伪完整批次",
    async changed => {
      await click(render(), "导出当前筛选 CSV");
      let tree = render();
      const ids = Array.from(
        { length: changed === "total" ? 502 : 501 },
        (_, i) => i + 1
      );
      if (changed === "ids") ids[500] = 999;
      harness.manifest.mockResolvedValue(manifest(ids));
      await click(tree, "导出第 1 批");
      tree = render();
      expect(harness.export).not.toHaveBeenCalled();
      expect(downloadConstructionCsv).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("总数或记录号已变化")
      );
      expect(text(tree)).not.toContain("全筛选 501 份 / 3 批");
    }
  );
  it.each(["CONFLICT", "FORBIDDEN"])(
    "清单校验后逐批读取发生%s时不下载且清空失效计划",
    async code => {
      await click(render(), "导出当前筛选 CSV");
      let tree = render();
      harness.export.mockRejectedValue({
        data: { code },
        message: "日报已变化或当前输出动作未授权",
      });
      await click(tree, "导出第 1 批");
      tree = render();
      expect(downloadConstructionCsv).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(text(tree)).not.toContain("全筛选 501 份 / 3 批");
    }
  );
  it("实际点击按当前日期/管理员/关键词/问题scope下钻，五种调用共用口径", async () => {
    let tree = render();
    tab(tree, "issues");
    tree = render();
    fill(tree, "construction-date-from", "2026-10-01");
    tree = render();
    fill(tree, "construction-date-to", "2026-10-31");
    tree = render();
    fill(tree, "construction-submitter", "2");
    tree = render();
    fill(tree, "construction-keyword", "  %_\\整改  ");
    tree = render();
    fill(tree, "construction-issue-scope", "unreplied");
    tree = render();
    walk(tree)
      .find(n => n.props["aria-label"] === "下钻当前筛选待审核日报")!
      .props.onClick();
    tree = render();
    const expected = {
      projectId: 10,
      scope: "review",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      createdBy: 2,
      keyword: "%_\\整改",
      issueScope: "unreplied",
      status: undefined,
    };
    expect(harness.queries.listReports.at(-1).input).toEqual(expected);
    expect(harness.queries.summary.at(-1).input).toEqual(expected);
    await click(tree, "批量打印当前筛选日报");
    tree = render();
    await click(tree, "打印第 1 批");
    expect(harness.manifest.mock.calls.at(-1)![0]).toEqual({
      ...expected,
      action: "print",
    });
    expect(harness.print.mock.calls[0][0]).toMatchObject(expected);
    expect(vi.mocked(openA4PrintDocument).mock.calls[0][0].bodyHtml).toContain(
      "管理员乙"
    );
  });
  it.each(["project", "keyword", "tab", "active", "permission", "aba"])(
    "迟到清单在%s变化时取消，A→B→A也不恢复旧快照",
    async change => {
      const pending = deferred<ReturnType<typeof manifest>>();
      harness.manifest.mockReturnValue(pending.promise);
      let tree = render();
      button(tree, "导出当前筛选 CSV").props.onClick();
      if (change === "project" || change === "aba") props.projectId = 20;
      if (change === "keyword") fill(tree, "construction-keyword", "新关键词");
      if (change === "tab") tab(tree, "archive");
      if (change === "active") props.active = false;
      if (change === "permission") harness.data.capabilities.canExport = false;
      tree = render();
      if (change === "aba") {
        props.projectId = 10;
        tree = render();
      }
      pending.resolve(manifest());
      await settle();
      tree = render();
      expect(harness.export).not.toHaveBeenCalled();
      expect(downloadConstructionCsv).not.toHaveBeenCalled();
      expect(text(tree)).not.toContain("全筛选 501 份 / 3 批");
      expect(toast.info).toHaveBeenCalled();
    }
  );
  it("迟到单批在切项目后取消；旧项目打印与下载都不生成", async () => {
    await click(render(), "导出当前筛选 CSV");
    let tree = render();
    const pending = deferred<ConstructionWorkspaceReport[]>();
    harness.export.mockReturnValue(pending.promise);
    button(tree, "导出第 1 批").props.onClick();
    await settle();
    expect(harness.export).toHaveBeenCalledTimes(1);
    props.projectId = 20;
    tree = render();
    pending.resolve(Array.from({ length: 250 }, (_, i) => report(i + 1)));
    await settle();
    expect(downloadConstructionCsv).not.toHaveBeenCalled();
    expect(openA4PrintDocument).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("批次快速双击只发一份调用；下载失败不标记完成且允许重试", async () => {
    await click(render(), "导出当前筛选 CSV");
    let tree = render();
    const pending = deferred<ReturnType<typeof manifest>>();
    harness.manifest.mockReturnValue(pending.promise);
    const node = button(tree, "导出第 1 批");
    node.props.onClick();
    node.props.onClick();
    expect(harness.manifest).toHaveBeenCalledTimes(2);
    pending.resolve(manifest());
    await settle();
    expect(harness.export).toHaveBeenCalledTimes(1);
    tree = render();
    harness.manifest.mockResolvedValue(manifest());
    vi.mocked(downloadConstructionCsv).mockImplementationOnce(() => {
      throw new Error("下载未能生成");
    });
    await click(tree, "导出第 2 批");
    tree = render();
    expect(text(tree)).toContain("已生成 1 批");
    await click(tree, "导出第 2 批");
    tree = render();
    expect(text(tree)).toContain("已生成 2 批");
  });
  it("权限收回后不保留分批入口；旧回调也不得继续请求", async () => {
    await click(render(), "导出当前筛选 CSV");
    const oldTree = render();
    const oldButton = button(oldTree, "导出第 1 批");
    harness.data.capabilities = {
      ...harness.data.capabilities,
      canExport: false,
    };
    const tree = render();
    oldButton.props.onClick();
    await settle();
    expect(harness.export).not.toHaveBeenCalled();
    expect(text(tree)).not.toContain("全筛选 501 份 / 3 批");
    expect(
      walk(tree).some(
        n => n.type === Button && text(n.props.children) === "导出当前筛选 CSV"
      )
    ).toBe(false);
  });
  it("错误权限即使有缓存能力也必须隐藏所有高影响操作", () => {
    harness.data.capabilities = {
      canCreate: true,
      canEdit: true,
      canSubmit: true,
      canReview: true,
      canArchive: true,
      canPrint: true,
      canExport: true,
    };
    harness.data.capabilitiesError = true;
    const tree = render();
    for (const label of [
      "新建施工日报",
      "编辑日报",
      "审核",
      "退回",
      "批量打印当前筛选日报",
      "导出当前筛选 CSV",
    ])
      expect(
        walk(tree).some(
          n => n.type === Button && text(n.props.children) === label
        ),
        label
      ).toBe(false);
  });
});

describe("施工详情单份竖版受控打印", () => {
  it("详情打印重读最新完整记录，勾选权限不改变状态，每份使用A4竖版", async () => {
    let tree = render();
    await click(tree, "查看详情 / 照片");
    tree = render();
    harness.print.mockResolvedValue([
      {
        ...report(1),
        constructionPlan: "最新施工计划",
        workContent: "服务端最新完整正文",
      },
    ]);
    await click(tree, "打印本份日报");
    expect(harness.print.mock.calls[0][0]).toMatchObject({
      projectId: 10,
      reportIds: [1],
    });
    const options = vi.mocked(openA4PrintDocument).mock.calls[0][0];
    expect(options.orientation).toBe("portrait");
    expect(options.bodyHtml).toContain("最新施工计划");
    expect(options.bodyHtml).toContain("服务端最新完整正文");
    expect(props.onTransition).not.toHaveBeenCalled();
  });
  it("快速双击只读取一次，读取失败不给假成功且可重试", async () => {
    await click(render(), "查看详情 / 照片");
    const tree = render();
    const pending = deferred<ConstructionWorkspaceReport[]>();
    harness.print.mockReturnValue(pending.promise);
    const node = button(tree, "打印本份日报");
    node.props.onClick();
    node.props.onClick();
    expect(harness.print).toHaveBeenCalledTimes(1);
    pending.resolve([report(1)]);
    await settle();
    expect(openA4PrintDocument).toHaveBeenCalledTimes(1);
  });
  it.each(["project", "permission", "close", "keyword", "active", "aba"])(
    "迟到单份请求在%s变化后不输出旧数据",
    async change => {
      await click(render(), "查看详情 / 照片");
      let tree = render();
      const pending = deferred<ConstructionWorkspaceReport[]>();
      harness.print.mockReturnValue(pending.promise);
      button(tree, "打印本份日报").props.onClick();
      if (change === "project" || change === "aba") props.projectId = 20;
      if (change === "permission") harness.data.capabilities.canPrint = false;
      if (change === "close") button(tree, "关闭详情").props.onClick();
      if (change === "keyword") fill(tree, "construction-keyword", "新范围");
      if (change === "active") props.active = false;
      tree = render();
      if (change === "aba") {
        props.projectId = 10;
        tree = render();
      }
      pending.resolve([report(1)]);
      await settle();
      expect(openA4PrintDocument).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    }
  );
  it("没有打印权限时详情仍可读，但不显示单份/批量打印按钮", async () => {
    harness.data.capabilities.canPrint = false;
    await click(render(), "查看详情 / 照片");
    const tree = render();
    expect(
      walk(tree).some(
        n => n.type === Button && text(n.props.children) === "打印本份日报"
      )
    ).toBe(false);
    expect(
      walk(tree).some(
        n =>
          n.type === Button && text(n.props.children) === "批量打印当前筛选日报"
      )
    ).toBe(false);
    expect(harness.print).not.toHaveBeenCalled();
  });
});
