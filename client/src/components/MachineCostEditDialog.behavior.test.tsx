import React from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineCostEditDraft, MachineCostDuplicateCheck } from "@shared/machineCostDuplicate";
const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as any).React = React;
const m = vi.hoisted(() => ({ check: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { machinery: {
  checkCostEditDuplicate: { useMutation: () => ({ mutateAsync: m.check }) },
  updateCostDraft: { useMutation: () => ({ mutateAsync: m.save }) },
} } }));
vi.mock("sonner", () => ({ toast: { success: m.toast, error: m.toast } }));
vi.mock("@/components/ui/button", () => ({ Button: ({ variant, ...p }: any) => <button {...p} /> }));
vi.mock("@/components/ui/dialog", () => {
  const Block = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return { Dialog: ({ open, onOpenChange, children }: any) => open ? <section {...({ "data-dialog": true, onOpenChange } as any)}>{children}</section> : null,
    DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block, DialogFooter: Block };
});
import { useGuardedMachineCostEdit } from "./MachineCostEditDialog";
const base: MachineCostEditDraft = { id: 7, version: "a".repeat(64), projectId: 3, machineId: 13, costType: "repair", costName: "发动机维修", quantity: 23.15, unitPrice: 8.64, occurredAt: "2026-11-09T12:00:00Z", evidenceId: null };
const empty: MachineCostDuplicateCheck = { candidates: [], hardConflict: false, confirmationToken: null, expiresAt: null };
function check(ids = [1]): MachineCostDuplicateCheck {
  return { candidates: ids.map(id => ({ id, occurredAt: new Date("2026-11-09T10:37:00Z"), costType: "repair", costName: "发动机维修", quantity: "23.150", unitPrice: "8.64", amount: "200.02", status: "approved", sameSource: false, sameInstant: false })), hardConflict: false, confirmationToken: `token-${ids.join("-")}`, expiresAt: Date.now() + 600_000 };
}
const saved = { success: true, id: 7, dieselRefuelRecordId: null, amount: 200.02, unitPrice: 8.64, guidelinePriceId: null };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let tree: any;
let guard: ReturnType<typeof useGuardedMachineCostEdit>;
function Harness({ identity = "form-a", input = base, getInput }: { identity?: string; input?: MachineCostEditDraft; getInput?: Parameters<typeof guard.prepare>[0] }) {
  guard = useGuardedMachineCostEdit({ identity, onSuccess: m.success });
  return <><button data-submit disabled={guard.isPending} onClick={() => void guard.prepare(getInput ?? (() => input))}>保存费用</button>{guard.confirmationDialog}</>;
}
async function render(props: Parameters<typeof Harness>[0] = {}) { await act(async () => { tree = create(<Harness {...props} />); }); }
function buttons() { return tree.root.findAllByType("button"); }
function confirmButton() { return buttons().find((node: any) => node.children.join("").includes("二次确认保存") || node.children.join("").includes("重新核验并保存")); }
function cancelButton() { return buttons().find((node: any) => node.children.join("").includes("取消并检查")); }
async function submit() { await act(async () => { tree.root.findByProps({ "data-submit": true }).props.onClick(); }); }
async function reason(value = "第二次独立维修，供应商票据编号不同") { await act(async () => { tree.root.findByType("textarea").props.onChange({ target: { value } }); }); }
async function acknowledge(checked = true) { await act(async () => { tree.root.findByType("input").props.onChange({ target: { checked } }); }); }
async function confirm() { await act(async () => { confirmButton().props.onClick(); }); }
async function cancel() { await act(async () => { cancelButton().props.onClick(); }); }
beforeEach(() => { vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; m.check.mockResolvedValue(empty); m.save.mockResolvedValue(saved); });
afterEach(async () => { if (tree) await act(async () => { tree.unmount(); }); tree = null; vi.useRealTimers(); });

describe("费用草稿编辑guard真实组件行为", () => {
  it("同tick双击仅预检和保存一次，固定id/version且不带创建requestId", async () => {
    const late = deferred<MachineCostDuplicateCheck>(); m.check.mockReturnValueOnce(late.promise); await render();
    const click = tree.root.findByProps({ "data-submit": true }).props.onClick; await act(async () => { click(); click(); });
    expect(m.check).toHaveBeenCalledOnce(); await act(async () => { late.resolve(empty); }); expect(m.save).toHaveBeenCalledOnce();
    expect(m.save.mock.calls[0][0]).toMatchObject({ id: 7, version: "a".repeat(64) }); expect(m.save.mock.calls[0][0].requestId).toBeUndefined();
  });
  it.each(["换项目", "换费用", "关窗", "修改输入"])("%s取消迟到预检和上传", async kind => {
    const late = deferred<MachineCostDuplicateCheck>(); m.check.mockReturnValueOnce(late.promise); await render(); await submit();
    await act(async () => { tree.update(<Harness identity={kind} />); }); await act(async () => { late.resolve(check()); });
    expect(m.save).not.toHaveBeenCalled(); expect(tree.root.findAllByType("section")).toHaveLength(0);
  });
  it("照片准备迟到取消后不能上传或预检", async () => {
    const late = deferred<void>(); const upload = vi.fn(); await render({ getInput: async assertCurrent => { await late.promise; assertCurrent(); upload(); return base; } }); await submit();
    await act(async () => { tree.update(<Harness identity="new-object" />); }); await act(async () => { late.resolve(); }); expect(upload).not.toHaveBeenCalled(); expect(m.check).not.toHaveBeenCalled();
  });
  it("疑似不同业务必须勾选与10字理由，cancel不触发保存且再提交重新准备", async () => {
    m.check.mockResolvedValue(check()); const getInput = vi.fn(() => base); await render({ getInput }); await submit(); expect(m.save).not.toHaveBeenCalled();
    await reason("太短"); await acknowledge(); await confirm(); expect(m.save).not.toHaveBeenCalled(); await cancel(); await submit(); expect(getInput).toHaveBeenCalledTimes(2);
    await reason(); await acknowledge(); await confirm(); expect(m.save.mock.calls[0][0].duplicateConfirmation).toMatchObject({ token: "token-1", reason: expect.stringContaining("供应商") });
  });
  it("硬冲突不能二次确认，输入变更后旧确认不可提交", async () => {
    m.check.mockResolvedValue({ ...check(), hardConflict: true, confirmationToken: null }); await render(); await submit(); expect(confirmButton()).toBeUndefined(); await cancel();
    m.check.mockResolvedValue(check()); await submit(); await reason(); await acknowledge(); const oldClick = confirmButton().props.onClick;
    await act(async () => { tree.update(<Harness identity="changed" />); });
    await act(async () => { oldClick(); }); expect(m.save).not.toHaveBeenCalled();
  });
  it("保存失败不重置输入，已上传证据复用；网络成功迟到不能清新对象", async () => {
    const getInput = vi.fn(() => ({ ...base, evidenceId: 8 })); m.save.mockRejectedValueOnce(Error("network")); await render({ getInput }); await submit(); expect(m.success).not.toHaveBeenCalled();
    await submit(); expect(getInput).toHaveBeenCalledOnce(); expect(m.save.mock.calls[1][0].evidenceId).toBe(8);
    const late = deferred<typeof saved>(); m.save.mockReturnValueOnce(late.promise); await act(async () => { tree.update(<Harness identity="another" />); }); await submit();
    const count = m.success.mock.calls.length; await act(async () => { tree.update(<Harness identity="new-input" />); }); await act(async () => { late.resolve(saved); }); expect(m.success).toHaveBeenCalledTimes(count);
  });
  it("超时与卸载后的预检都不能保存", async () => {
    vi.useFakeTimers(); m.check.mockResolvedValue(check()); await render(); await submit(); await reason(); await acknowledge(); const oldClick = confirmButton().props.onClick;
    await act(async () => { vi.advanceTimersByTime(600001); oldClick(); }); expect(m.save).not.toHaveBeenCalled();
    vi.useRealTimers(); await cancel(); const late = deferred<MachineCostDuplicateCheck>(); m.check.mockReturnValueOnce(late.promise); await submit(); await act(async () => { tree.unmount(); }); tree = null;
    await act(async () => { late.resolve(empty); }); expect(m.save).not.toHaveBeenCalled();
  });
});
