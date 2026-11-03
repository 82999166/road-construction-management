import React, { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node 环境沿用财务工作区的确定性 hook runner，无新增 DOM/renderer 依赖。
const hooks = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  const changed = (
    previous: unknown[] | undefined,
    next: unknown[] | undefined
  ) =>
    !previous ||
    !next ||
    previous.length !== next.length ||
    next.some((value, index) => !Object.is(value, previous[index]));
  return {
    reset() {
      slots.length = 0;
      cursor = 0;
      effects = [];
    },
    render<T>(callback: () => T) {
      cursor = 0;
      return callback();
    },
    commit() {
      const pending = effects;
      effects = [];
      pending.forEach(effect => effect());
    },
    state(initial: unknown) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (next: unknown) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    effect(callback: () => void, dependencies?: unknown[]) {
      const index = cursor++;
      if (changed(slots[index] as unknown[] | undefined, dependencies)) {
        slots[index] = dependencies;
        effects.push(callback);
      }
    },
    memo<T>(callback: () => T, dependencies?: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as
        | { dependencies?: unknown[]; value: T }
        | undefined;
      if (!previous || changed(previous.dependencies, dependencies))
        slots[index] = { dependencies, value: callback() };
      return (slots[index] as { value: T }).value;
    },
  };
});
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: hooks.state,
    useEffect: hooks.effect,
    useMemo: hooks.memo,
    useCallback: <T,>(callback: T, dependencies: unknown[]) =>
      hooks.memo(() => callback, dependencies),
    useId: () => "diesel-test",
  };
});

import {
  DieselPriceHistory,
  DieselSupplierReport,
  type DieselPriceHistoryProps,
  type DieselPriceHistoryRow,
  type DieselSupplierReportProps,
  type DieselSupplierReportRow,
} from "./DieselSupportingReports";
import { FinancePagination } from "./FinanceWorkspaceNavigation";
import { FinancialLedgerPrintPreviewDialog } from "./FinancialLedgerPrintPreviewDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Node = ReactElement<Record<string, unknown>>;
function descendants(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...descendants(value.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (React.isValidElement<Record<string, unknown>>(value))
    return text(value.props.children);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
function pagination(tree: unknown) {
  return descendants(tree).find(node => node.type === FinancePagination)!;
}
function reportTable(tree: unknown) {
  return descendants(tree).find(
    node => "columns" in node.props && "message" in node.props
  )!;
}
function preview(tree: unknown) {
  return descendants(tree).find(
    node => node.type === FinancialLedgerPrintPreviewDialog
  );
}
function button(tree: unknown, label: string) {
  return descendants(tree).find(
    node => node.type === Button && text(node).includes(label)
  )!;
}
function click(node: Node) {
  (node.props.onClick as () => void)();
}
function change(node: Node, value: string) {
  (node.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });
}
const supplierRow = (index: number): DieselSupplierReportRow => ({
  supplierName: `独立供应商-${index}`,
  liters: 10,
  amount: 60,
  averageUnitPrice: 6,
  minUnitPrice: 5,
  maxUnitPrice: 7,
  priceSpread: 2,
  recordCount: 2,
  receiptCount: 1,
  alertCount: index % 2,
});
const priceRow = (id: number): DieselPriceHistoryRow => ({
  id,
  pricePerLiter: "6.50",
  effectiveFrom: "2026-11-01",
  effectiveTo: null,
  status: id % 2 ? "active" : "draft",
  remarks: `独立指导价备注-${id}`,
});
const supplierProps = (
  rows: DieselSupplierReportRow[]
): DieselSupplierReportProps => ({
  rows,
  loading: false,
  projectName: "道路项目甲",
  period: "2026-11",
});
const priceProps = (
  rows: DieselPriceHistoryRow[]
): DieselPriceHistoryProps => ({
  rows,
  loading: false,
  projectName: "道路项目甲",
});
function supplierView(props: DieselSupplierReportProps) {
  return hooks.render(() => DieselSupplierReport(props));
}
function priceView(props: DieselPriceHistoryProps) {
  return hooks.render(() => DieselPriceHistory(props));
}
beforeEach(() => {
  hooks.reset();
  vi.stubGlobal("React", React);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("柴油供应商汇总", () => {
  it("默认20行，20/50/100复用公共分页；打印保留全部25行与凭证异常列", () => {
    const props = supplierProps(
      Array.from({ length: 25 }, (_, index) => supplierRow(index + 1))
    );
    let tree = supplierView(props);
    hooks.commit();
    expect(reportTable(tree).props.rows).toHaveLength(20);
    expect(pagination(tree).props.total).toBe(25);
    expect(text(tree)).toContain("25 家供应商");
    expect(text(tree)).toContain("合计 250.000 L");
    expect(text(tree)).toContain("金额 ¥1,500.00");
    (pagination(tree).props.onPageChange as (value: number) => void)(2);
    tree = supplierView(props);
    hooks.commit();
    expect(reportTable(tree).props.rows).toHaveLength(5);
    click(button(tree, "汇总打印"));
    tree = supplierView(props);
    expect(preview(tree)?.props.rows).toHaveLength(25);
    const columns = preview(tree)?.props.columns as Array<{ label: string }>;
    expect(columns.map(column => column.label)).toEqual(
      expect.arrayContaining([
        "最低价（元/L）",
        "最高价（元/L）",
        "价差（元/L）",
        "凭证笔数",
        "价格异常笔数",
      ])
    );
    expect(preview(tree)?.props.period).toContain(
      "供应商汇总月份 2026-11（非加油台账日期筛选）"
    );
    for (const size of [50, 100, 20]) {
      (pagination(tree).props.onPageSizeChange as (value: number) => void)(
        size
      );
      tree = supplierView(props);
      hooks.commit();
      expect(pagination(tree).props.pageSize).toBe(size);
      expect(pagination(tree).props.page).toBe(1);
      expect(reportTable(tree).props.rows).toHaveLength(Math.min(size, 25));
    }
  });
  it("按合计金额/升数计算加权价，不平均供应商行均价；零升数不猜价格", () => {
    const props = supplierProps([
      { ...supplierRow(1), liters: 1, amount: 10, averageUnitPrice: 10 },
      { ...supplierRow(2), liters: 9, amount: 54, averageUnitPrice: 6 },
    ]);
    expect(text(supplierView(props))).toContain("加权价 ¥6.40/L");
    expect(
      text(
        supplierView({
          ...props,
          rows: [{ ...supplierRow(1), liters: 0, amount: 0 }],
        })
      )
    ).toContain("加权价 —");
  });
  it("供应商/异常本地筛选收敛汇总并重置分页，异常只依据 alertCount", () => {
    const props = supplierProps(
      Array.from({ length: 45 }, (_, index) => supplierRow(index + 1))
    );
    let tree = supplierView(props);
    hooks.commit();
    (pagination(tree).props.onPageChange as (value: number) => void)(3);
    tree = supplierView(props);
    hooks.commit();
    change(descendants(tree).find(node => node.type === "select")!, "alert");
    tree = supplierView(props);
    hooks.commit();
    expect(pagination(tree).props.page).toBe(1);
    expect(pagination(tree).props.total).toBe(23);
    change(
      descendants(tree).find(node => node.type === Input)!,
      "独立供应商-45"
    );
    tree = supplierView(props);
    hooks.commit();
    expect(pagination(tree).props.total).toBe(1);
    click(button(tree, "汇总打印"));
    tree = supplierView(props);
    expect(preview(tree)?.props.rows).toHaveLength(1);
    change(descendants(tree).find(node => node.type === "select")!, "normal");
    tree = supplierView(props);
    expect(pagination(tree).props.total).toBe(0);
    expect(button(tree, "CSV").props.disabled).toBe(true);
    expect(preview(tree)).toBeUndefined();
  });
});

describe("指导价历史", () => {
  it("分页20条，全量打印25条；启用状态不猜当前有效且不按会计月份", () => {
    const props = priceProps(
      Array.from({ length: 25 }, (_, index) => priceRow(index + 1))
    );
    let tree = priceView(props);
    hooks.commit();
    expect(reportTable(tree).props.rows).toHaveLength(20);
    expect(text(tree)).toContain("不按会计月份");
    expect(text(tree)).toContain("启用不等于当前有效");
    click(button(tree, "汇总打印"));
    tree = priceView(props);
    expect(preview(tree)?.props.rows).toHaveLength(25);
    expect(preview(tree)?.props.period).toContain("不适用");
    expect(preview(tree)?.props.summaryLabel).toContain("启用 13 条");
    expect(preview(tree)?.props.summaryLabel).toContain("草稿 12 条");
    expect(preview(tree)?.props.summaryLabel).toContain("不合计或平均指导价");
  });
  it("按状态、关键词、生效开始日期本地筛选，兼容Date/null及未知状态", () => {
    const props = priceProps([
      {
        ...priceRow(1),
        effectiveFrom: new Date("2026-10-31T16:00:00Z"),
        effectiveTo: "2026-11-30",
        remarks: "核准柴油",
      },
      { ...priceRow(2), effectiveFrom: "2026-12-01", status: "disabled" },
      { ...priceRow(3), effectiveFrom: "2026-10-01", status: "reviewing" },
    ]);
    let tree = priceView(props);
    hooks.commit();
    expect(
      text(descendants(tree).find(node => node.type === "select"))
    ).toContain("reviewing");
    change(descendants(tree).find(node => node.type === "select")!, "active");
    tree = priceView(props);
    hooks.commit();
    const inputs = descendants(tree).filter(node => node.type === Input);
    change(inputs[0], "核准");
    change(inputs[1], "2026-11-01");
    change(inputs[2], "2026-11-30");
    tree = priceView(props);
    hooks.commit();
    expect(pagination(tree).props.total).toBe(1);
    click(button(tree, "汇总打印"));
    tree = priceView(props);
    expect(preview(tree)?.props.rows).toEqual([
      {
        id: 1,
        cells: [1, "6.50", "2026-11-01", "2026-11-30", "启用", "核准柴油"],
      },
    ]);
    expect(preview(tree)?.props.filterLabel).toContain(
      "生效开始日期：2026-11-01 至 2026-11-30"
    );
  });
});

describe.each(["供应商", "指导价"] as const)("%s范围与输出隔离", report => {
  function setup() {
    return report === "供应商"
      ? {
          props: supplierProps([supplierRow(1)]),
          render: (
            props: DieselSupplierReportProps | DieselPriceHistoryProps
          ) => supplierView(props as DieselSupplierReportProps),
        }
      : {
          props: priceProps([priceRow(1)]),
          render: (
            props: DieselSupplierReportProps | DieselPriceHistoryProps
          ) => priceView(props as DieselPriceHistoryProps),
        };
  }
  it.each(["loading", "error", "enabled"] as const)(
    "%s变化立即隐藏缓存/portal并阻断输出，恢复不复活旧预览",
    state => {
      const { props, render } = setup();
      let tree = render(props);
      hooks.commit();
      click(button(tree, "汇总打印"));
      tree = render(props);
      expect(preview(tree)).toBeDefined();
      const blocked = { ...props, [state]: state !== "enabled" };
      tree = render(blocked);
      expect(preview(tree)).toBeUndefined();
      if (state === "enabled") expect(tree).toBeNull();
      else {
        expect(reportTable(tree).props.rows).toHaveLength(0);
        expect(button(tree, "CSV").props.disabled).toBe(true);
        expect(button(tree, "汇总打印").props.disabled).toBe(true);
        expect(text(tree)).not.toContain(
          report === "供应商" ? "1 家供应商" : "1 条指导价记录"
        );
      }
      hooks.commit();
      tree = render(props);
      hooks.commit();
      expect(preview(tree)).toBeUndefined();
    }
  );
  it("项目、数据或筛选变化时同步卸载旧打印；仅当前scope能重新打开", () => {
    const { props, render } = setup();
    let tree = render(props);
    hooks.commit();
    click(button(tree, "汇总打印"));
    tree = render(props);
    expect(preview(tree)).toBeDefined();
    const next = { ...props, projectName: "道路项目乙" };
    tree = render(next);
    expect(preview(tree)).toBeUndefined();
    hooks.commit();
    click(button(tree, "汇总打印"));
    tree = render(next);
    expect(preview(tree)?.props.projectName).toBe("道路项目乙");
    const refreshed = { ...next, rows: [...next.rows] } as typeof next;
    tree = render(refreshed);
    expect(preview(tree)).toBeUndefined();
    hooks.commit();
    click(button(tree, "汇总打印"));
    tree = render(refreshed);
    expect(preview(tree)).toBeDefined();
    change(descendants(tree).find(node => node.type === Input)!, "不存在");
    tree = render(refreshed);
    expect(preview(tree)).toBeUndefined();
  });
});

it("供应商月份变化关闭旧打印并重置列表页码", () => {
  const props = supplierProps(
    Array.from({ length: 45 }, (_, index) => supplierRow(index + 1))
  );
  let tree = supplierView(props);
  hooks.commit();
  (pagination(tree).props.onPageChange as (value: number) => void)(3);
  tree = supplierView(props);
  hooks.commit();
  click(button(tree, "汇总打印"));
  tree = supplierView(props);
  expect(preview(tree)).toBeDefined();
  tree = supplierView({ ...props, period: "2026-12" });
  expect(preview(tree)).toBeUndefined();
  expect(pagination(tree).props.page).toBe(1);
});

it("供应商 CSV 导出全部filteredRows，保留汇总及范围元数据，阻止公式注入并正确转义", async () => {
  let blob: Blob | undefined;
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("document", {
    createElement: () => anchor,
    body: { appendChild: vi.fn() },
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(value => {
    blob = value as Blob;
    return "blob:diesel";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const props = supplierProps(
    Array.from({ length: 25 }, (_, index) => ({
      ...supplierRow(index + 1),
      supplierName:
        index === 24
          ? '  =HYPERLINK("evil")'
          : supplierRow(index + 1).supplierName,
    }))
  );
  props.projectName = "+项目公式";
  let tree = supplierView(props);
  hooks.commit();
  click(button(tree, "CSV"));
  const csv = await blob!.text();
  expect(csv).toContain("独立供应商-21");
  expect(csv).toContain('"导出记录数","25"');
  expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
  expect(csv).toContain('"\'+项目公式"');
  expect(csv).toContain("25 家供应商");
  expect(csv).toContain("非加油台账日期筛选");
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diesel");
  tree = supplierView({ ...props, loading: true });
  click(button(tree, "CSV"));
  expect(anchor.click).toHaveBeenCalledOnce();
});

it("指导价CSV关键词筛选按全部结果导出，备注防注入且包含生效日期/状态口径", async () => {
  let blob: Blob | undefined;
  vi.stubGlobal("document", {
    createElement: () => ({ click: vi.fn(), remove: vi.fn() }),
    body: { appendChild: vi.fn() },
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(value => {
    blob = value as Blob;
    return "blob:diesel";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const props = priceProps(
    Array.from({ length: 30 }, (_, index) => ({
      ...priceRow(index + 1),
      remarks: index < 25 ? "@核准指导价" : "其他",
    }))
  );
  let tree = priceView(props);
  hooks.commit();
  change(descendants(tree).find(node => node.type === Input)!, "核准");
  tree = priceView(props);
  hooks.commit();
  click(button(tree, "CSV"));
  const csv = await blob!.text();
  expect(csv).toContain('"导出记录数","25"');
  expect(csv).toContain('"25","6.50"');
  expect(csv).not.toContain('"26","6.50"');
  expect(csv).toContain('"\'@核准指导价"');
  expect(csv).toContain("不按会计月份");
});
