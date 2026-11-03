import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny deterministic hook runner tests form transitions without a browser or any RPC/DB writes.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<() => void>,
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (
      previous &&
      previous.length === deps.length &&
      previous.every((value, item) => Object.is(value, deps[item]))
    )
      return;
    hooks.slots[index] = deps;
    hooks.effects.push(() => {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    });
  },
}));
import {
  taxDraftChanged,
  taxScopeKey,
  taxWorkspaceQueryEnabled,
  useTaxDraft,
  useTaxDirtyReport,
  useTaxScopeAlive,
} from "./TaxAccountingDraftState";

function render<T>(fn: () => T) {
  hooks.cursor = 0;
  const result = fn();
  hooks.effects.splice(0).forEach(effect => effect());
  return result;
}
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
});

describe("财税分区与安全草稿", () => {
  it("仅当前子栏目启用读取，主栏目隐藏时全部关闭", () => {
    for (const section of ["materials", "batches", "review"] as const) {
      expect(taxWorkspaceQueryEnabled(false, 7, section, "handoff")).toBe(
        false
      );
      expect(taxWorkspaceQueryEnabled(false, 7, section, "review")).toBe(false);
      expect(taxWorkspaceQueryEnabled(true, 0, section, "handoff")).toBe(false);
      expect(taxWorkspaceQueryEnabled(true, 7, section, "handoff")).toBe(
        section !== "review"
      );
      expect(taxWorkspaceQueryEnabled(true, 7, section, "review")).toBe(
        section === "review"
      );
    }
  });
  it("未配置档案也读取主体/人员/合同依赖，不会产生死界面", () => {
    expect(taxWorkspaceQueryEnabled(true, 7, "materials", "handoff")).toBe(
      true
    );
    expect(taxWorkspaceQueryEnabled(true, 7, "review", "review")).toBe(true);
  });
  it("项目或月份改变都会生成新的草稿边界键", () => {
    expect(taxScopeKey(7, "2026-11")).not.toBe(taxScopeKey(8, "2026-11"));
    expect(taxScopeKey(7, "2026-11")).not.toBe(taxScopeKey(7, "2026-12"));
    expect(taxDraftChanged({ amount: "0" }, { amount: "" })).toBe(true);
  });
  it("跨子页重新渲染保留输入，显式放弃才回到原基线", () => {
    let form = render(() => useTaxDraft({ subject: "", amount: "" }));
    form.setDraft({ subject: "真实凭证", amount: "0" });
    form = render(() => useTaxDraft({ subject: "", amount: "" }));
    expect(form.dirty).toBe(true);
    expect(form.draft).toEqual({ subject: "真实凭证", amount: "0" });
    form.reset();
    form = render(() => useTaxDraft({ subject: "", amount: "" }));
    expect(form.dirty).toBe(false);
    expect(form.draft.subject).toBe("");
  });
  it("成功保存清空新建表单；保存期间继续编辑则仍保留为脏输入", () => {
    let form = render(() => useTaxDraft(""));
    form.setDraft("提交内容");
    form = render(() => useTaxDraft(""));
    form.capture();
    form.setDraft("提交后继续补充");
    form = render(() => useTaxDraft(""));
    form.commitAndReset();
    form = render(() => useTaxDraft(""));
    expect(form.draft).toBe("提交后继续补充");
    expect(form.dirty).toBe(true);
    form.capture();
    form.commitAndReset();
    form = render(() => useTaxDraft(""));
    expect(form.draft).toBe("");
    expect(form.dirty).toBe(false);
  });
  it("配置档案基线加载不报脏，真实改动才报脏，保存后回到干净", () => {
    let form = render(() => useTaxDraft({ location: "" }));
    form.load({ location: "原项目所在地" });
    form = render(() => useTaxDraft({ location: "" }));
    expect(form.dirty).toBe(false);
    form.setDraft({ location: "核验后所在地" });
    form = render(() => useTaxDraft({ location: "" }));
    form.capture();
    form.commit();
    form = render(() => useTaxDraft({ location: "" }));
    expect(form.dirty).toBe(false);
    expect(form.draft.location).toBe("核验后所在地");
  });
  it("父级回调包含隐藏区草稿并在作用域卸载时清理，不因回调变化误报干净", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(() => useTaxDirtyReport(true, first));
    render(() => useTaxDirtyReport(true, second));
    expect(first.mock.calls).toEqual([[true]]);
    expect(second.mock.calls).toEqual([[true]]);
    hooks.cleanups.forEach(cleanup => cleanup());
    expect(second).toHaveBeenLastCalledWith(false);
  });
  it("已卸载旧范围的异步结果不能触发下载或新范围状态变更", () => {
    const alive = render(() => useTaxScopeAlive());
    expect(alive.current).toBe(true);
    hooks.cleanups.forEach(cleanup => cleanup());
    expect(alive.current).toBe(false);
  });
});
