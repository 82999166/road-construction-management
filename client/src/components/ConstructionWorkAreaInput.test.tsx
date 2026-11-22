import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => ({ hook: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: { construction: { workAreaOptions: { useQuery: rpc.hook } } },
}));
// Portal shell only: keep the real controlled input, menu, asynchronous and keyboard logic.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open, onOpenChange }: any) => (
    <section data-open={open} data-toggle={onOpenChange}>
      {children}
    </section>
  ),
  PopoverTrigger: ({ children }: any) => children,
  PopoverContent: ({ children, onKeyDown }: any) => (
    <aside onKeyDown={onKeyDown}>{children}</aside>
  ),
}));
import {
  ConstructionWorkAreaInput,
  type ConstructionWorkAreaInputProps,
} from "./ConstructionWorkAreaInput";
let view: ReactTestRenderer | undefined;
let props: ConstructionWorkAreaInputProps;
const item = {
  workArea: "K12+500 路基填筑完整作业面",
  useCount: 8,
  lastUsedAt: "2026-11-10",
};
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(r => {
    resolve = r;
  });
  return { resolve, promise };
}
async function mount(overrides: Partial<ConstructionWorkAreaInputProps> = {}) {
  props = {
    value: "",
    projectId: 10,
    userId: 20,
    active: true,
    onChange: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    view = TestRenderer.create(<ConstructionWorkAreaInput {...props} />);
  });
}
async function update(overrides: Partial<ConstructionWorkAreaInputProps>) {
  props = { ...props, ...overrides };
  await act(async () => {
    view!.update(<ConstructionWorkAreaInput {...props} />);
  });
}
async function open(next = true) {
  await act(async () =>
    view!.root.findByType("section").props["data-toggle"](next)
  );
}
function text() {
  return JSON.stringify(view!.toJSON());
}
function options() {
  return view!.root
    .findAllByType("button")
    .filter(n => n.props.role === "option");
}
async function search(value: string) {
  await act(async () =>
    view!.root
      .findAllByType("input")
      .find(n => n.props["aria-label"] === "搜索常用作业面")!
      .props.onChange({ target: { value } })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpc.hook.mockReturnValue({ refetch: rpc.refetch });
  rpc.refetch.mockResolvedValue({ data: { items: [item] } });
});
afterEach(async () => {
  if (view) await act(async () => view!.unmount());
  view = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("常用作业面控件", () => {
  it("只打开下拉才读真实项目选项；选择完整回填，仍可手输", async () => {
    await mount();
    expect(rpc.refetch).not.toHaveBeenCalled();
    await open();
    expect(rpc.hook.mock.calls.at(-1)?.[0]).toEqual({
      projectId: 10,
      keyword: undefined,
    });
    expect(text()).toContain("已使用");
    expect(text()).toContain("8");
    await act(async () => options()[0].props.onClick());
    expect(props.onChange).toHaveBeenCalledWith(item.workArea);
    expect(view!.root.findByType("section").props["data-open"]).toBe(false);
    await act(async () =>
      view!.root
        .findAllByType("input")
        .find(n => n.props["aria-label"] === "施工部位 / 作业面")!
        .props.onChange({ target: { value: "手动新作业面" } })
    );
    expect(props.onChange).toHaveBeenLastCalledWith("手动新作业面");
    expect(rpc.refetch).toHaveBeenCalledTimes(1);
  });
  it("加载、错误重试、真实无历史与关键词无匹配清晰区分", async () => {
    const pending = deferred();
    rpc.refetch.mockReturnValueOnce(pending.promise);
    await mount();
    await open();
    expect(text()).toContain("正在读取");
    expect(text()).not.toContain("暂无已保存");
    await act(async () => pending.resolve({ data: { items: [] } }));
    expect(text()).toContain("当前项目暂无已保存");
    rpc.refetch.mockRejectedValueOnce(new Error("network error"));
    await open(false);
    await open();
    expect(text()).toContain("读取失败");
    expect(text()).not.toContain("当前项目暂无已保存");
    await act(async () =>
      view!.root
        .findAllByType("button")
        .find(n => n.children.join("") === "重试")!
        .props.onClick()
    );
    expect(options()).toHaveLength(1);
    rpc.refetch.mockResolvedValue({ data: { items: [] } });
    await search("不存在");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(text()).toContain("暂无匹配");
  });
  it("关键词300ms防抖最多100字符；旧关键词迟到不覆盖新结果", async () => {
    await mount();
    await open();
    const pending = deferred();
    rpc.refetch.mockReturnValueOnce(pending.promise);
    await search("路基");
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(rpc.refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(rpc.refetch).toHaveBeenCalledTimes(2);
    await search("新".repeat(120));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(rpc.hook.mock.calls.at(-1)?.[0].keyword).toHaveLength(100);
    await act(async () =>
      pending.resolve({
        data: { items: [{ ...item, workArea: "迟到旧关键词" }] },
      })
    );
    expect(text()).not.toContain("迟到旧关键词");
  });
  it.each([
    { projectId: 11 },
    { userId: 21 },
    { active: false },
    { disabled: true },
  ])("scope变化%j丢弃迟到选项且关闭菜单", async change => {
    const pending = deferred();
    rpc.refetch.mockReturnValueOnce(pending.promise);
    await mount();
    await open();
    await update(change);
    await act(async () =>
      pending.resolve({
        data: { items: [{ ...item, workArea: "旧范围迟到选项" }] },
      })
    );
    expect(text()).not.toContain("旧范围迟到选项");
    expect(view!.root.findByType("section").props["data-open"]).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("关窗和重新打开拒绝旧请求；同项目跨账号缓存独立，无keepPreviousData", async () => {
    const pending = deferred();
    rpc.refetch.mockReturnValueOnce(pending.promise);
    await mount();
    await open();
    const before = rpc.hook.mock.calls.at(-1)?.[1];
    await open(false);
    await open();
    await act(async () =>
      pending.resolve({
        data: { items: [{ ...item, workArea: "已关窗迟到" }] },
      })
    );
    expect(text()).not.toContain("已关窗迟到");
    await update({ userId: 21 });
    const after = rpc.hook.mock.calls.at(-1)?.[1];
    const key = [
      ["construction", "workAreaOptions"],
      { input: { projectId: 10 } },
    ];
    expect(before.queryKeyHashFn(key)).not.toBe(after.queryKeyHashFn(key));
    expect(after).not.toHaveProperty("keepPreviousData");
    expect(after.trpc.abortOnUnmount).toBe(true);
  });
  it("可用上下键Enter选择，Escape关闭；disabled既禁手输也禁触发", async () => {
    await mount();
    await open();
    const key = (key: string) =>
      view!.root
        .findByType("aside")
        .props.onKeyDown({ key, preventDefault: vi.fn() });
    await act(async () => key("ArrowDown"));
    await act(async () => key("Enter"));
    expect(props.onChange).toHaveBeenCalledWith(item.workArea);
    await open();
    await act(async () => key("Escape"));
    expect(view!.root.findByType("section").props["data-open"]).toBe(false);
    await update({ disabled: true });
    expect(
      view!.root
        .findAllByType("button")
        .find(n => n.props["aria-label"] === "常用作业面")!.props.disabled
    ).toBe(true);
    const main = view!.root
      .findAllByType("input")
      .find(n => n.props["aria-label"] === "施工部位 / 作业面")!;
    expect(main.props.disabled).toBe(true);
    (props.onChange as any).mockClear();
    await act(async () =>
      main.props.onChange({ target: { value: "禁止变更" } })
    );
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
