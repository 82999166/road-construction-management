import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FINANCE_WORKSPACE_TABS,
  FinancePagination,
  FinanceRetainedPanel,
  FinanceWorkspaceNavigation,
} from "./FinanceWorkspaceNavigation";
import {
  clampFinancePage,
  FINANCE_PAGE_SIZES,
  getFinancePageCount,
  normalizeFinancePageSize,
  paginateFinanceRows,
} from "../lib/financePagination";

const rows = Array.from({ length: 105 }, (_, index) => ({
  id: index + 1,
  amount: 10,
}));

function renderPagination(page: number, total: number, pageSize = 20) {
  return renderToStaticMarkup(
    createElement(FinancePagination, {
      page,
      total,
      pageSize,
      onPageChange: () => {},
      onPageSizeChange: () => {},
    })
  );
}

function buttonMarkup(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? "";
}

describe("finance pure pagination", () => {
  it("按 20 条切分真实行，摘要和全量导出不改变原 rows", () => {
    const result = paginateFinanceRows(rows, 2);
    expect(result).toMatchObject({
      page: 2,
      pageSize: 20,
      total: 105,
      pageCount: 6,
    });
    expect(result.pageRows).toEqual(rows.slice(20, 40));
    expect(result.pageRows[0]).toBe(rows[20]);
    expect(result.pageRows).not.toBe(rows);
    expect(rows).toHaveLength(105);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(1050);
  });

  it.each([20, 50, 100])("支持每页 %i 条及不足一页的尾页", size => {
    const result = paginateFinanceRows(rows, Infinity, size);
    expect(result.pageCount).toBe(Math.ceil(rows.length / size));
    expect(result.page).toBe(result.pageCount);
    expect(result.pageRows).toEqual(rows.slice((result.pageCount - 1) * size));
  });

  it("页码过大或 rows 缩短时 clamp 最后一页，而不是展示空列表", () => {
    expect(paginateFinanceRows(rows, 999).page).toBe(6);
    const result = paginateFinanceRows(rows.slice(0, 25), 6);
    expect(result).toMatchObject({ page: 2, total: 25, pageCount: 2 });
    expect(result.pageRows).toHaveLength(5);
  });

  it("空数据维持安全第 1 页，支持 readonly 行", () => {
    const empty: readonly number[] = Object.freeze([]);
    expect(paginateFinanceRows(empty, 8)).toEqual({
      page: 1,
      pageSize: 20,
      pageRows: [],
      total: 0,
      pageCount: 1,
    });
    expect(paginateFinanceRows(Object.freeze([1, 2, 3]), 1).pageRows).toEqual([
      1, 2, 3,
    ]);
  });

  it("非法页码、数量与页大小采用安全边界", () => {
    expect(FINANCE_PAGE_SIZES).toEqual([20, 50, 100]);
    expect(normalizeFinancePageSize(0)).toBe(20);
    expect(normalizeFinancePageSize(NaN)).toBe(20);
    expect(normalizeFinancePageSize(50)).toBe(50);
    expect(getFinancePageCount(-5, 20)).toBe(1);
    expect(getFinancePageCount(NaN, 20)).toBe(1);
    expect(clampFinancePage(-Infinity, 5)).toBe(1);
    expect(clampFinancePage(0, 5)).toBe(1);
    expect(clampFinancePage(NaN, 5)).toBe(1);
    expect(clampFinancePage(2.9, 5)).toBe(2);
    expect(clampFinancePage(100, 5)).toBe(5);
    expect(clampFinancePage(Infinity, 5)).toBe(5);
  });
});

describe("FinanceWorkspaceNavigation", () => {
  it("精确导出七个 literal 与中文栏目", () => {
    expect(FINANCE_WORKSPACE_TABS).toEqual([
      { value: "overview", label: "财务总览" },
      { value: "ledger", label: "收支账本" },
      { value: "settlements", label: "结算收付" },
      { value: "costs", label: "成本分析" },
      { value: "invoices", label: "发票管理" },
      { value: "closing", label: "日结对账" },
      { value: "tax", label: "财税交接" },
    ]);
  });

  it("选中 tab 有 aria 和唯一键盘入口，badge 0 不被漏掉", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceWorkspaceNavigation, {
        value: "ledger",
        onValueChange: () => {},
        badges: { ledger: 0 },
      })
    );
    expect(html.match(/role="tab"/g)).toHaveLength(7);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="收支账本，0"');
    expect(html).toContain('role="tablist"');
  });

  it("桌面七列、窄屏换行、内容可断行，字号继承且不全页横移", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceWorkspaceNavigation, {
        value: "overview",
        onValueChange: () => {},
        badges: { tax: "LongEnglishHandoffCount1234567890" },
      })
    );
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("sm:grid-cols-4");
    expect(html).toContain("lg:grid-cols-7");
    expect(html).toContain("flex-wrap");
    expect(html).toContain("min-w-0");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("text-[0.9em]");
    expect(html).not.toMatch(
      /overflow-x-auto|whitespace-nowrap|font-size:\s*\d+px/
    );
  });

  it("disabled 阻止所有 tab 点击并移除顺序焦点入口", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceWorkspaceNavigation, {
        value: "overview",
        onValueChange: () => {},
        disabled: true,
      })
    );
    expect(html.match(/ disabled=""/g)).toHaveLength(7);
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("FinanceRetainedPanel first render", () => {
  it("从未激活时不挂载子组件，不触发隐藏查询", () => {
    let mounted = false;
    function Child() {
      mounted = true;
      return createElement("span", null, "敏感内容");
    }
    expect(
      renderToStaticMarkup(
        createElement(FinanceRetainedPanel, {
          active: false,
          children: createElement(Child),
        })
      )
    ).toBe("");
    expect(mounted).toBe(false);
  });

  it("首次 active 当帧显示子组件，不依赖 effect 补帧", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceRetainedPanel, {
        active: true,
        label: "财税交接",
        children: createElement("input", { defaultValue: "草稿" }),
      })
    );
    expect(html).toContain('value="草稿"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-label="财税交接"');
    expect(html).not.toContain(' hidden=""');
    expect(html).not.toContain(' inert=""');
  });
});

describe("FinancePagination", () => {
  it("第一页禁用首页和上一页，显示数量和 20/50/100 选项", () => {
    const html = renderPagination(1, 105);
    expect(buttonMarkup(html, "首页")).toContain('disabled=""');
    expect(buttonMarkup(html, "上一页")).toContain('disabled=""');
    expect(buttonMarkup(html, "下一页")).not.toContain('disabled=""');
    expect(html).toContain("共 105 条 · 当前 1–20 条");
    expect(html).toContain("第 1 / 6 页");
    for (const size of [20, 50, 100]) expect(html).toContain(`value="${size}"`);
    expect(html).toContain('aria-live="polite"');
  });

  it("最后页禁用下一页和末页，显示实际尾页条数", () => {
    const html = renderPagination(6, 105);
    expect(buttonMarkup(html, "下一页")).toContain('disabled=""');
    expect(buttonMarkup(html, "末页")).toContain('disabled=""');
    expect(buttonMarkup(html, "上一页")).not.toContain('disabled=""');
    expect(html).toContain("共 105 条 · 当前 101–105 条");
  });

  it("空数据不出现第 0 页或负数边界，所有翻页键禁用", () => {
    const html = renderPagination(8, 0);
    expect(html).toContain("共 0 条 · 当前 0–0 条");
    expect(html).toContain("第 1 / 1 页");
    expect(html.match(/ disabled=""/g)).toHaveLength(4);
  });

  it("异常受控页码 clamp，中文状态、长标签和控件允许换行", () => {
    const html = renderPagination(99, 25, 50);
    expect(html).toContain("第 1 / 1 页");
    expect(html).toContain("共 25 条 · 当前 1–25 条");
    expect(html).toContain("flex-wrap");
    expect(html).toContain("max-w-full");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("whitespace-nowrap");
  });
});
