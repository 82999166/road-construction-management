import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A small deterministic hook runner keeps these state-machine tests in Vitest's node environment.
// Static markup is tested separately with real React; no new renderer/DOM dependency is required.
const hooks = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  function changed(
    previous: unknown[] | undefined,
    next: unknown[] | undefined
  ) {
    return (
      !previous ||
      !next ||
      previous.length !== next.length ||
      next.some((value, index) => !Object.is(value, previous[index]))
    );
  }
  return {
    reset() {
      slots.length = 0;
      cursor = 0;
      effects = [];
    },
    render<T>(render: () => T): T {
      cursor = 0;
      return render();
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
    memo<T>(callback: () => T, dependencies?: unknown[]): T {
      const index = cursor++;
      const previous = slots[index] as
        | { dependencies?: unknown[]; value: T }
        | undefined;
      if (!previous || changed(previous.dependencies, dependencies))
        slots[index] = { dependencies, value: callback() };
      return (slots[index] as { value: T }).value;
    },
    ref(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
});

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: hooks.state,
    useEffect: hooks.effect,
    useLayoutEffect: hooks.effect,
    useMemo: hooks.memo,
    useCallback: <T,>(callback: T, dependencies: unknown[]) =>
      hooks.memo(() => callback, dependencies),
    useRef: hooks.ref,
    useId: () => "finance-test",
  };
});

import {
  FinancePagination,
  FinanceRetainedPanel,
  FinanceWorkspaceNavigation,
  useFinancePagination,
} from "./FinanceWorkspaceNavigation";

interface TestNodeProps {
  children?: ReactElement<TestNodeProps> | ReactElement<TestNodeProps>[];
  ref?: { current: unknown } | ((element: unknown) => void);
  onClick?: () => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
  onChange?: (event: { target: { value: string } }) => void;
  hidden?: boolean;
  inert?: boolean;
  "aria-hidden"?: boolean;
  type?: string;
}

function node(element: unknown) {
  return element as ReactElement<TestNodeProps>;
}
function children(element: unknown) {
  const value = node(element).props.children;
  return Array.isArray(value) ? value : value ? [value] : [];
}
function descendants(element: unknown): ReactElement<TestNodeProps>[] {
  if (!element || typeof element !== "object" || !("props" in element))
    return [];
  return [
    node(element),
    ...children(element).flat(Infinity).flatMap(descendants),
  ];
}

beforeEach(() => hooks.reset());

describe("useFinancePagination state behavior", () => {
  it("stable key 翻页后保留页码，筛选 key 变化立即归 1", () => {
    const rows = Array.from({ length: 100 }, (_, i) => i);
    const render = (key: string) =>
      hooks.render(() => useFinancePagination(rows, key));
    let result = render("project1|2026-11|all");
    hooks.commit();
    result.setPage(4);
    result = render("project1|2026-11|all");
    expect(result.page).toBe(4);
    expect(result.pageRows).toEqual(rows.slice(60, 80));
    result = render("project1|2026-11|approved");
    expect(result.page).toBe(1); // Before effect commits: never show stale page rows.
    expect(result.pageRows).toEqual(rows.slice(0, 20));
    hooks.commit();
    expect(render("project1|2026-11|approved").page).toBe(1);
  });

  it("rows 缩短 clamp 当帧并保存边界，不因数量恢复跳回旧页", () => {
    let rows = Array.from({ length: 100 }, (_, i) => i);
    const render = () => hooks.render(() => useFinancePagination(rows, "same"));
    let result = render();
    hooks.commit();
    result.setPage(5);
    result = render();
    expect(result.page).toBe(5);
    rows = rows.slice(0, 25);
    result = render();
    expect(result.page).toBe(2);
    expect(result.pageRows).toEqual([20, 21, 22, 23, 24]);
    hooks.commit();
    rows = Array.from({ length: 100 }, (_, i) => i);
    expect(render().page).toBe(2);
  });

  it("20/50/100 size 变化回第一页，支持函数 setter 和 invalid 页", () => {
    const rows = Array.from({ length: 205 }, (_, i) => i);
    const render = () => hooks.render(() => useFinancePagination(rows, 1, 50));
    let result = render();
    hooks.commit();
    expect(result.pageSize).toBe(50);
    result.setPage(previous => previous + 1);
    result = render();
    expect(result.page).toBe(2);
    result.setPageSize(previous => previous * 2);
    result = render();
    expect(result.pageSize).toBe(100);
    expect(result.page).toBe(1);
    result.setPage(999);
    result = render();
    expect(result.page).toBe(3);
    expect(result.pageRows).toHaveLength(5);
    result.setPage(-2);
    result = render();
    expect(result.page).toBe(1);
    result.setPageSize(999);
    expect(render().pageSize).toBe(20);
  });

  it("项目/月变化与空行归 1，但 pageSize 保留", () => {
    let rows = Array.from({ length: 100 }, (_, i) => i);
    const render = (key: string) =>
      hooks.render(() => useFinancePagination(rows, key, 50));
    let result = render("project1|2026-11");
    hooks.commit();
    result.setPage(2);
    result = render("project2|2026-12");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    hooks.commit();
    rows = [];
    result = render("project2|2026-12");
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.total).toBe(0);
    expect(result.pageRows).toEqual([]);
  });
});

describe("FinanceRetainedPanel state behavior", () => {
  it("首次 inactive 不挂载，active 当帧可见，之后 hidden+inert 保留同一 children", () => {
    const child = { draft: "保留未保存内容" };
    const render = (active: boolean) =>
      hooks.render(() =>
        FinanceRetainedPanel({ active, children: child as never })
      );
    expect(render(false)).toBeNull();
    hooks.commit();
    const first = node(render(true));
    expect(first.props.children).toBe(child);
    expect(first.props.hidden).toBe(false);
    hooks.commit();
    const hidden = node(render(false));
    expect(hidden.props.children).toBe(child);
    expect(hidden.props.hidden).toBe(true);
    expect(hidden.props.inert).toBe(true);
    expect(hidden.props["aria-hidden"]).toBe(true);
    hooks.commit();
    const reopened = node(render(true));
    expect(reopened.props.children).toBe(child);
    expect(reopened.props.inert).toBe(false);
  });

  it("隐藏保留面板释放其中的焦点，但不触碰外部当前焦点", () => {
    const blur = vi.fn();
    const focused = { blur };
    const fakePanel = {
      ownerDocument: { activeElement: focused },
      contains: vi.fn(() => true),
    };
    const render = (active: boolean) =>
      hooks.render(() => FinanceRetainedPanel({ active, children: "草稿" }));
    const visible = node(render(true));
    (visible.props.ref as { current: unknown }).current = fakePanel;
    hooks.commit();
    render(false);
    hooks.commit();
    expect(blur).toHaveBeenCalledOnce();
    render(true);
    hooks.commit();
    fakePanel.contains.mockReturnValue(false);
    render(false);
    hooks.commit();
    expect(blur).toHaveBeenCalledOnce();
  });
});

describe("finance keyboard and callbacks", () => {
  it.each([
    ["ArrowRight", 0, "ledger"],
    ["ArrowLeft", 0, "tax"],
    ["ArrowDown", 6, "overview"],
    ["ArrowUp", 0, "tax"],
    ["Home", 4, "overview"],
    ["End", 2, "tax"],
  ] as const)("%s 切换栏目并转移焦点", (key, index, expected) => {
    const onValueChange = vi.fn();
    const focus = vi.fn();
    const preventDefault = vi.fn();
    const nav = hooks.render(() =>
      FinanceWorkspaceNavigation({ value: "overview", onValueChange })
    );
    const tabs = children(nav);
    for (const tab of tabs)
      (tab.props.ref as (element: unknown) => void)({ focus });
    tabs[index].props.onKeyDown?.({ key, preventDefault });
    expect(onValueChange).toHaveBeenCalledWith(expected);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("普通按键不劫持，disabled 不触发切换", () => {
    const onValueChange = vi.fn();
    const preventDefault = vi.fn();
    let nav = hooks.render(() =>
      FinanceWorkspaceNavigation({ value: "overview", onValueChange })
    );
    children(nav)[0].props.onKeyDown?.({ key: "Tab", preventDefault });
    nav = hooks.render(() =>
      FinanceWorkspaceNavigation({
        value: "overview",
        onValueChange,
        disabled: true,
      })
    );
    children(nav)[0].props.onKeyDown?.({ key: "ArrowRight", preventDefault });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("分页的首页/上一页/下一页/末页回调与数量选择正确", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const rendered = hooks.render(() =>
      FinancePagination({
        page: 3,
        pageSize: 20,
        total: 105,
        onPageChange,
        onPageSizeChange,
      })
    );
    const all = descendants(rendered);
    const buttons = all.filter(element => element.type === "button");
    buttons.forEach(button => button.props.onClick?.());
    expect(onPageChange.mock.calls.map(call => call[0])).toEqual([1, 2, 4, 6]);
    all
      .find(element => element.type === "select")
      ?.props.onChange?.({ target: { value: "50" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});
