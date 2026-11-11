import React, { type HTMLAttributes, type ReactNode } from "react";
import { createRequire } from "node:module";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");

type CheckboxProps = {
  id?: string;
  checked?: boolean | "indeterminate";
  disabled?: boolean;
  onCheckedChange?: (checked: boolean | "indeterminate") => void;
};

// Mock DOM/Radix boundaries only. Real React owns state, effects, guards and pagination.
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: CheckboxProps) => <input
    {...props} type="checkbox" checked={checked === true}
    onChange={event => onCheckedChange?.(event.target.checked)} />,
}));
vi.mock("@/components/ui/dialog", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode; onOpenChange?: (open: boolean) => void }) =>
      open ? <div data-test="finance-dialog">{children}</div> : null,
    DialogContent: ({ showCloseButton, onEscapeKeyDown, onInteractOutside, ...props }: HTMLAttributes<HTMLDivElement> & {
      showCloseButton?: boolean;
      onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
      onInteractOutside?: (event: { preventDefault: () => void }) => void;
    }) => <div {...props} />,
    DialogDescription: Block,
    DialogFooter: Block,
    DialogHeader: Block,
    DialogTitle: Block,
  };
});

import FinanceApprovalCenter, { type FinanceApprovalCenterProps, type FinanceApprovalItem } from "./FinanceApprovalCenter";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const onApprove = vi.fn<FinanceApprovalCenterProps["onApprove"]>();
const onRefresh = vi.fn();
const approveLabel = "确认审核通过";
const item = (id = 1, patch: Partial<FinanceApprovalItem> = {}): FinanceApprovalItem => ({
  sourceType: "transport_vehicle",
  settlementId: id,
  settlementNo: `VEH-202611-${id}`,
  sourceLabel: "车辆运费业务台账",
  counterpartyDisplay: `湘A000${id} / 司机甲`,
  periodLabel: "2026-11-01 至 2026-11-09",
  businessStatus: "submitted",
  grossAmount: 1234.5,
  deductionAmount: 234.5,
  netAmount: 1000,
  submittedAt: "2026-11-09T01:30:00Z",
  canApprove: true,
  fingerprint: `server-snapshot-${id}`,
  ...patch,
});
let tree: ReactTestRenderer | undefined;
let mountedProps: FinanceApprovalCenterProps;
const root = () => {
  if (!tree) throw new Error("Render the real component first");
  return tree.root;
};
const text = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");
const allButtons = () => root().findAllByType("button");
const buttons = (label: string) => allButtons().filter(node => text(node) === label);
const button = (label: string, index = 0) => {
  const result = buttons(label)[index];
  if (!result) throw new Error(`Missing button ${label} #${index}`);
  return result;
};
const dialog = () => root().findByProps({ "data-test": "finance-dialog" });
const rows = () => root().findAllByType("tr").filter(node => node.props["data-finance-settlement"]);
const checkbox = () => root().findByProps({ type: "checkbox" });
const render = async (props: Partial<FinanceApprovalCenterProps> = {}) => {
  mountedProps = {
    items: [item(), item(2)], active: true, loading: false, fetching: false,
    pending: false, projectLabel: "测试道路项目", scopeKey: "project:10|month:2026-11",
    onRefresh, onApprove, ...props,
  };
  await act(async () => { tree = create(<FinanceApprovalCenter {...mountedProps} />); });
};
const rerender = async (props: Partial<FinanceApprovalCenterProps>) => {
  mountedProps = { ...mountedProps, ...props };
  await act(async () => { tree?.update(<FinanceApprovalCenter {...mountedProps} />); });
};
const clickNode = async (node: ReactTestInstance, force = false) => {
  await act(async () => {
    if (!node.props.disabled || force) node.props.onClick?.({});
  });
};
const click = (label: string, index = 0, force = false) => clickNode(button(label, index), force);
const check = async (value: boolean, force = false) => {
  const control = checkbox();
  await act(async () => {
    if (!control.props.disabled || force) control.props.onChange?.({ target: { checked: value } });
  });
};
const search = async (value: string) => {
  const control = root().findAllByType("input").find(node => node.props["aria-label"] === "检索待审结算");
  await act(async () => control?.props.onChange?.({ target: { value } }));
};
const category = (label: string) => allButtons().find(node => String(node.props["aria-label"] ?? "").startsWith(`${label}，待审`))!;
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  onApprove.mockReset().mockResolvedValue(undefined);
  onRefresh.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("FinanceApprovalCenter 真实组件审核行为", () => {
  it("默认未勾选不可提交；勾选后向父级传递 exact item（含 fingerprint），成功关闭并刷新", async () => {
    const exact = item(7);
    await render({ items: [exact] });
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
    await click("查看并审核");
    expect(text(dialog())).toContain("结算详情 · VEH-202611-7");
    expect(text(dialog())).toContain("车辆运费业务台账");
    expect(text(dialog())).toContain("VEH-202611-7 / 7");
    expect(text(dialog())).toContain("测试道路项目");
    expect(text(dialog())).toContain("湘A0007 / 司机甲");
    expect(text(dialog())).toContain("2026-11-01 至 2026-11-09");
    expect(text(dialog())).toContain("¥1,234.50");
    expect(text(dialog())).toContain("¥234.50");
    expect(text(dialog())).toContain("¥1,000.00");
    expect(text(dialog())).toContain("2026/11/9 09:30:00");
    expect(text(dialog())).toContain("更多原始凭证请到对应业务台账核对");
    expect(checkbox().props.checked).toBe(false);
    expect(button(approveLabel).props.disabled).toBe(true);
    await click(approveLabel, 0, true);
    expect(onApprove).not.toHaveBeenCalled();
    await check(true);
    await check(false);
    expect(button(approveLabel).props.disabled).toBe(true);
    await check(true);
    await click(approveLabel);
    expect(onApprove.mock.calls).toEqual([[exact]]);
    expect(onApprove.mock.calls[0][0]).toBe(exact);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
  });

  it("取消、重开及切换结算不沿用旧勾选", async () => {
    await render();
    await click("查看并审核");
    await check(true);
    await click("取消");
    await click("查看并审核");
    expect(checkbox().props.checked).toBe(false);
    await check(true);
    await click("查看并审核", 1);
    expect(text(dialog())).toContain("VEH-202611-2");
    expect(checkbox().props.checked).toBe(false);
    await click(approveLabel, 0, true);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("Radix 关闭路径重置勾选，indeterminate 不表示已确认", async () => {
    await render();
    await click("查看并审核");
    await check(true);
    await act(async () => root().findByType(Checkbox).props.onCheckedChange("indeterminate"));
    expect(checkbox().props.checked).toBe(false);
    await check(true);
    await act(async () => root().findAllByType(Dialog)[0].props.onOpenChange(false));
    await click("查看并审核");
    expect(checkbox().props.checked).toBe(false);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive", { active: false }],
    ["外部 pending", { pending: true }],
    ["fetching", { fetching: true }],
    ["loading", { loading: true }],
    ["查询 error", { error: "mysql secret credential" }],
  ] as const)("已有勾选时 %s 不提交，旧处理器与强制点击也不能绕过", async (_, patch) => {
    await render();
    await click("查看并审核");
    await check(true);
    const oldHandler = button(approveLabel).props.onClick;
    await rerender(patch);
    if (!("active" in patch && patch.active === false)) {
      expect(checkbox().props.checked).toBe(true);
      expect(checkbox().props.disabled).toBe(true);
      const blockedLabel = "pending" in patch ? "审核提交中…" : approveLabel;
      expect(button(blockedLabel).props.disabled).toBe(true);
      await click(blockedLabel, 0, true);
      await check(false, true);
      expect(checkbox().props.checked).toBe(true);
    }
    await act(async () => oldHandler());
    expect(onApprove).not.toHaveBeenCalled();
    expect(text(root())).not.toContain("mysql secret credential");
    await rerender({ active: true, pending: false, fetching: false, loading: false, error: null });
    await click(approveLabel);
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("无审批权限仍能查看全部来源信息，但没有提交按钮或勾选框", async () => {
    await render({ items: [item(9, { canApprove: false })] });
    expect(rows()).toHaveLength(1);
    expect(buttons("查看并审核")).toHaveLength(0);
    await click("查看详情");
    expect(text(dialog())).toContain("当前记录无审批权限，仅可查看详情");
    expect(text(dialog())).toContain("¥1,000.00");
    expect(buttons(approveLabel)).toHaveLength(0);
    expect(root().findAllByType(Checkbox)).toHaveLength(0);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it.each(["权限撤销", "fingerprint 更新", "items 引用替换", "scopeKey 改变", "记录删除"])(
    "%s 当帧清旧详情与确认，旧处理器不可误审", async reason => {
      const original = item();
      await render({ items: [original] });
      await click("查看并审核");
      await check(true);
      const oldHandler = button(approveLabel).props.onClick;
      const updated = reason === "权限撤销" ? { ...original, canApprove: false }
        : reason === "fingerprint 更新" ? { ...original, fingerprint: "new-snapshot", netAmount: 999 }
        : original;
      await rerender(reason === "scopeKey 改变" ? { scopeKey: "project:20" }
        : { items: reason === "记录删除" ? [] : [updated] });
      expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
      await act(async () => oldHandler());
      expect(onApprove).not.toHaveBeenCalled();
      if (reason !== "记录删除") {
        await click(updated.canApprove ? "查看并审核" : "查看详情");
        if (updated.canApprove) expect(checkbox().props.checked).toBe(false);
        else expect(buttons(approveLabel)).toHaveLength(0);
      }
    }
  );

  it("审核失败只显示安全消息，保留 exact record 和勾选，支持手动重试", async () => {
    const original = item();
    onApprove.mockRejectedValueOnce(new Error("mysql account=622200001234 password=SECRET"));
    await render({ items: [original] });
    await click("查看并审核");
    await check(true);
    await click(approveLabel);
    expect(text(dialog())).toContain("财务审核未完成");
    expect(text(dialog())).toContain(original.settlementNo);
    expect(text(dialog())).not.toMatch(/622200001234|SECRET|mysql/);
    expect(checkbox().props.checked).toBe(true);
    expect(button(approveLabel).props.disabled).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
    await click(approveLabel);
    expect(onApprove.mock.calls).toEqual([[original], [original]]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("本地同步锁阻止快速双击，并禁止提交中取消、Escape、遮罩及 Radix 关闭", async () => {
    const request = deferred();
    onApprove.mockReturnValue(request.promise);
    await render();
    await click("查看并审核");
    await check(true);
    const handler = button(approveLabel).props.onClick;
    await act(async () => { handler(); handler(); });
    expect(onApprove).toHaveBeenCalledOnce();
    expect(button("审核提交中…").props.disabled).toBe(true);
    expect(button("取消").props.disabled).toBe(true);
    expect(root().findByType(DialogContent).props.showCloseButton).toBe(false);
    await click("取消", 0, true);
    await act(async () => root().findAllByType(Dialog)[0].props.onOpenChange(false));
    const escape = vi.fn();
    const outside = vi.fn();
    await act(async () => {
      const content = root().findByType(DialogContent);
      content.props.onEscapeKeyDown({ preventDefault: escape });
      content.props.onInteractOutside({ preventDefault: outside });
    });
    expect(escape).toHaveBeenCalledOnce();
    expect(outside).toHaveBeenCalledOnce();
    expect(text(dialog())).toContain("VEH-202611-1");
    await act(async () => request.resolve());
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
  });

  it("外部 pending 也阻止弹窗取消及 Radix 关闭", async () => {
    await render();
    await click("查看并审核");
    await rerender({ pending: true });
    await click("取消", 0, true);
    await act(async () => root().findAllByType(Dialog)[0].props.onOpenChange(false));
    expect(text(dialog())).toContain("VEH-202611-1");
    expect(root().findByType(DialogContent).props.showCloseButton).toBe(false);
  });

  it.each(["成功", "失败"])("旧范围请求%s不会影响新范围详情或刷新新项目", async result => {
    const request = deferred();
    onApprove.mockReturnValue(request.promise);
    const newRefresh = vi.fn();
    await render();
    await click("查看并审核");
    await check(true);
    await click(approveLabel);
    await rerender({ scopeKey: "project:99", items: [item(99)], onRefresh: newRefresh });
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
    await act(async () => result === "成功" ? request.resolve() : request.reject(new Error("SECRET")));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(newRefresh).not.toHaveBeenCalled();
    await click("查看并审核");
    expect(checkbox().props.checked).toBe(false);
    expect(text(dialog())).toContain("VEH-202611-99");
    expect(text(dialog())).not.toContain("财务审核未完成");
  });

  it("父级刷新抛错不误报为审核失败，也不保留可重复审批弹窗", async () => {
    onRefresh.mockImplementation(() => { throw new Error("SECRET_REFRESH"); });
    await render();
    await click("查看并审核");
    await check(true);
    await click(approveLabel);
    expect(onApprove).toHaveBeenCalledOnce();
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
    expect(text(root())).toContain("列表刷新未完成");
    expect(text(root())).not.toMatch(/SECRET_REFRESH|财务审核未完成/);
  });

  it.each([-12.5, 0])("净额 %s 保留真实符号，并解释待收补款或无现金收付", async netAmount => {
    const original = item(1, { grossAmount: 50, deductionAmount: 50 - netAmount, netAmount });
    await render({ items: [original] });
    const note = netAmount < 0 ? "待收补款" : "无现金收付";
    expect(text(rows()[0])).toContain(note);
    await click("查看并审核");
    expect(text(dialog())).toContain(note);
    expect(text(dialog())).toContain(netAmount < 0 ? "¥-12.50" : "¥0.00");
    await check(true);
    await click(approveLabel);
    expect(onApprove.mock.calls[0][0]).toBe(original);
  });

  it("金额非有限数时不展示 NaN，强制提交也被拦截", async () => {
    await render({ items: [item(1, { netAmount: Number.NaN })] });
    await click("查看并审核");
    expect(text(dialog())).not.toContain("NaN");
    expect(text(dialog())).toContain("结算金额异常");
    expect(button(approveLabel).props.disabled).toBe(true);
    await check(true, true);
    await click(approveLabel, 0, true);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("FinanceApprovalCenter 筛选、完整分页、提醒与帮助", () => {
  it("五类待审数量不依赖审批权或当前页，草稿、已审、作废不进入队列", async () => {
    await render({ items: [
      item(1), item(2, { canApprove: false }),
      item(3, { sourceType: "machine" }),
      item(4, { sourceType: "payroll", businessStatus: "reviewing" }),
      item(5, { sourceType: "daily_wage", businessStatus: "reviewing" }),
      item(6, { sourceType: "subcontract" }),
      ...["draft", "approved", "paid", "void", "rejected"].map((businessStatus, index) => item(index + 20, { businessStatus })),
    ] });
    expect(rows()).toHaveLength(6);
    expect(text(root())).toContain("待审核 6 条");
    expect(category("全部").props["aria-label"]).toBe("全部，待审 6 条");
    expect(category("车辆运费").props["aria-label"]).toBe("车辆运费，待审 2 条");
    for (const label of ["机械结算", "人员工资", "临时日结", "分包结算"]) {
      expect(category(label).props["aria-label"]).toBe(`${label}，待审 1 条`);
      await clickNode(category(label));
      expect(rows()).toHaveLength(1);
      expect(text(rows()[0])).toContain(label);
    }
    await clickNode(category("车辆运费"));
    expect(rows()).toHaveLength(2);
    expect(buttons("查看详情")).toHaveLength(1);
    await search("司机甲");
    expect(category("全部").props["aria-label"]).toBe("全部，待审 6 条");
    expect(rows()).toHaveLength(2);
  });

  it("先筛选全部记录再分页，关键词可命中末页；类别、搜索、范围变化重置页码", async () => {
    const records = [
      ...Array.from({ length: 45 }, (_, index) => item(index + 1, { counterpartyDisplay: `车辆-${index + 1}` })),
      item(99, { sourceType: "machine", counterpartyDisplay: "机械对象" }),
    ];
    await render({ items: records });
    expect(rows()).toHaveLength(20);
    expect(category("全部").props["aria-label"]).toContain("46 条");
    await click("下一页");
    expect(rows()[0].props["data-finance-settlement"]).toBe("transport_vehicle:21");
    await click("末页");
    expect(rows()).toHaveLength(6);
    await search("车辆-45");
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])).toContain("VEH-202611-45");
    expect(text(root())).toContain("第 1 / 1 页");
    await search("  VEH-202611-44  ");
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])).toContain("VEH-202611-44");
    await search("2026-11-01");
    expect(rows()).toHaveLength(20);
    await click("下一页");
    await clickNode(category("机械结算"));
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])).toContain("机械对象");
    await search("不存在");
    expect(rows()).toHaveLength(0);
    expect(text(root())).toContain("当前筛选条件下没有待审结算");
    await rerender({ scopeKey: "new-scope" });
    expect(rows()).toHaveLength(20);
    expect(category("全部").props["aria-pressed"]).toBe(true);
    expect(text(root())).toContain("第 1 / 3 页");
  });

  it("每页 20/50/100 选择真实生效，记录缩短后当帧夹到有效页", async () => {
    const records = Array.from({ length: 105 }, (_, index) => item(index + 1));
    await render({ items: records });
    const size = () => root().findByType("select");
    await act(async () => size().props.onChange({ target: { value: "50" } }));
    expect(rows()).toHaveLength(50);
    await click("末页");
    expect(rows()).toHaveLength(5);
    await rerender({ items: records.slice(0, 55) });
    expect(text(root())).toContain("第 2 / 2 页");
    expect(rows()).toHaveLength(5);
    await act(async () => size().props.onChange({ target: { value: "100" } }));
    expect(rows()).toHaveLength(55);
    expect(text(root())).toContain("第 1 / 1 页");
  });

  it("加载与空队列有明确状态；未提供或非法提交日期不伪造日期", async () => {
    await render({ loading: true });
    expect(rows()).toHaveLength(0);
    expect(text(root())).toContain("正在加载待审结算");
    await rerender({ loading: false, items: [] });
    expect(text(root())).toContain("暂无已提交待审结算，草稿不计入待审数量");
    await rerender({ items: [item(1, { submittedAt: null }), item(2, { submittedAt: "not-a-date" })] });
    expect(text(rows()[0])).toContain("未提供");
    expect(text(rows()[1])).toContain("未提供");
  });

  it("刷新回调由父级执行；inactive/pending/fetching/loading 时直接处理器也不能调用", async () => {
    await render();
    await click("刷新");
    expect(onRefresh).toHaveBeenCalledOnce();
    const oldHandler = button("刷新").props.onClick;
    for (const patch of [{ active: false }, { pending: true }, { fetching: true }, { loading: true }]) {
      await rerender({ active: true, pending: false, fetching: false, loading: false, ...patch });
      await act(async () => oldHandler());
    }
    expect(onRefresh).toHaveBeenCalledOnce();
    await rerender({ active: true, pending: false, fetching: false, loading: false, error: "SECRET" });
    await click("刷新");
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("问号帮助解释待审、草稿、审核不付款、负数、零、只读与逐单核对", async () => {
    await render();
    await clickNode(allButtons().find(node => node.props["aria-label"] === "财务审核帮助")!);
    const copy = text(dialog());
    for (const phrase of ["财务审核帮助", "仅已提交待审", "草稿不算", "审核不等于付款", "不自动付款", "不自动提交草稿", "待收补款", "无现金收付", "无审批权限时只读", "逐单核对"]) {
      expect(copy).toContain(phrase);
    }
    expect(buttons(approveLabel)).toHaveLength(0);
    await click("知道了");
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("可选去业务台账只转交 exact item、不付款或审核，pending 不导航", async () => {
    const original = item(8, { canApprove: false });
    const navigate = vi.fn();
    await render({ items: [original], onNavigateToSource: navigate });
    await click("查看详情");
    await rerender({ pending: true });
    await click("去业务台账核对", 0, true);
    expect(navigate).not.toHaveBeenCalled();
    await rerender({ pending: false });
    await click("去业务台账核对");
    expect(navigate.mock.calls[0][0]).toBe(original);
    expect(root().findAllByProps({ "data-test": "finance-dialog" })).toHaveLength(0);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("FinanceApprovalCenter 父级审核详情开关通知", () => {
  it("onOpenChange 只通知审核详情，不通知帮助；取消、成功和卸载通知关闭", async () => {
    const notify = vi.fn();
    await render({ onOpenChange: notify });
    expect(notify).not.toHaveBeenCalled();
    await clickNode(allButtons().find(node => node.props["aria-label"] === "财务审核帮助")!);
    await click("知道了");
    expect(notify).not.toHaveBeenCalled();
    await click("查看并审核");
    expect(notify.mock.calls).toEqual([[true]]);
    await click("查看并审核", 1);
    expect(notify.mock.calls).toEqual([[true]]);
    await click("取消");
    expect(notify.mock.calls).toEqual([[true], [false]]);
    await click("查看并审核");
    await check(true);
    await click(approveLabel);
    expect(notify.mock.calls).toEqual([[true], [false], [true], [false]]);
    await click("查看并审核");
    await act(async () => tree?.unmount());
    tree = undefined;
    expect(notify.mock.calls).toEqual([[true], [false], [true], [false], [true], [false]]);
  });

  it.each(["items", "scopeKey"])("%s 变更清旧详情并通知父级 false", async changed => {
    const notify = vi.fn();
    await render({ onOpenChange: notify });
    await click("查看并审核");
    await check(true);
    await rerender(changed === "items" ? { items: [...mountedProps.items] } : { scopeKey: "another-project" });
    expect(notify.mock.calls).toEqual([[true], [false]]);
    await click("查看并审核");
    expect(checkbox().props.checked).toBe(false);
    expect(notify.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("失败和提交中尝试关闭不通知 false，避免父级静默离开", async () => {
    const notify = vi.fn();
    const request = deferred();
    onApprove.mockReturnValue(request.promise);
    await render({ onOpenChange: notify });
    await click("查看并审核");
    await check(true);
    await click(approveLabel);
    await click("取消", 0, true);
    await act(async () => root().findAllByType(Dialog)[0].props.onOpenChange(false));
    expect(notify.mock.calls).toEqual([[true]]);
    await act(async () => request.reject(new Error("fail")));
    expect(notify.mock.calls).toEqual([[true]]);
    expect(checkbox().props.checked).toBe(true);
    await click("取消");
    expect(notify.mock.calls).toEqual([[true], [false]]);
  });
});
