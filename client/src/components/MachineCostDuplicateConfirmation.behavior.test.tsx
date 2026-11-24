import React from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineCostDraft, MachineCostDuplicateCheck } from "@shared/machineCostDuplicate";
const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as any).React = React;
const m = vi.hoisted(() => ({ check: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { machinery: {
  checkCostDuplicate: { useMutation: () => ({ mutateAsync: m.check }) },
  saveCost: { useMutation: () => ({ mutateAsync: m.save }) },
} } }));
vi.mock("sonner", () => ({ toast: { success: m.toast, error: m.toast } }));
vi.mock("@/components/ui/button", () => ({ Button: ({ variant, ...p }: any) => <button {...p} /> }));
vi.mock("@/components/ui/dialog", () => {
  const Block = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return { Dialog: ({ open, onOpenChange, children }: any) => open ? <section {...({ "data-dialog": true, onOpenChange } as any)}>{children}</section> : null,
    DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block, DialogFooter: Block };
});
import { useGuardedMachineCost } from "./MachineCostDuplicateConfirmation";
const base: MachineCostDraft = { projectId: 3, machineId: 13, costType: "repair", costName: "发动机维修", quantity: 23.15, unitPrice: 8.64, occurredAt: "2026-11-09T12:00:00Z", evidenceId: null };
const empty: MachineCostDuplicateCheck = { candidates: [], hardConflict: false, confirmationToken: null, expiresAt: null };
function check(ids = [1]): MachineCostDuplicateCheck {
  return { candidates: ids.map(id => ({ id, occurredAt: new Date("2026-11-09T10:37:00Z"), costType: "repair", costName: "发动机维修", quantity: "23.150", unitPrice: "8.64", amount: "200.02", status: "approved", sameSource: false, sameInstant: false })), hardConflict: false, confirmationToken: `token-${ids.join("-")}`, expiresAt: Date.now() + 600_000 };
}
const saved = { success: true, id: 7, dieselRefuelRecordId: null, amount: 200.02, unitPrice: 8.64, guidelinePriceId: null };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let tree: any;
let guard: ReturnType<typeof useGuardedMachineCost>;
function Harness({ identity = "form-a", input = base, getInput }: { identity?: string; input?: MachineCostDraft; getInput?: Parameters<typeof guard.prepare>[0] }) {
  guard = useGuardedMachineCost({ identity, onSuccess: m.success, onError: m.error });
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

describe("机械费用防重窗口真实行为（真实组件/hook，仅RPC和UI底层mock）", () => {
  it("疑似仅展示，不自动保存；取消后重新获取输入、凭证和requestId，不复用旧草稿", async () => {
    m.check.mockResolvedValue(check()); const getInput = vi.fn().mockResolvedValueOnce({ ...base, evidenceId: 8 }).mockResolvedValueOnce({ ...base, evidenceId: 9, remarks: "新核对依据" });
    await render({ getInput }); await submit(); const first = m.check.mock.calls[0][0]; expect(m.save).not.toHaveBeenCalled();
    await cancel(); expect(tree.root.findAllByType("section")).toHaveLength(0); await submit();
    const second = m.check.mock.calls[1][0]; expect(second.evidenceId).toBe(9); expect(second.remarks).toBe("新核对依据"); expect(second.requestId).not.toBe(first.requestId); expect(getInput).toHaveBeenCalledTimes(2); expect(m.save).not.toHaveBeenCalled();
  });
  it("真实五个同文费用ID完整显示，日期状态和两位金额未隐藏去重", async () => {
    m.check.mockResolvedValue(check([1, 2, 3, 4, 5])); await render(); await submit();
    const records = tree.root.findByProps({ "aria-label": "已存在费用记录" }); expect(records.children).toHaveLength(5);
    const text = JSON.stringify(tree.toJSON());
    expect(records.findAllByType("p").filter((node: any) => node.children.join("").startsWith("记录 #")).map((node: any) => node.children.join(""))).toEqual([1, 2, 3, 4, 5].map(id => `记录 #${id} · 发动机维修`));
    expect(text).toContain("北京时间"); expect(text).toContain("200.02"); expect(text).toContain("23.15"); expect(text).toContain("8.64");
  });
  it("确认必须足够理由及逐笔勾选，发送trim理由与服务端token", async () => {
    m.check.mockResolvedValue(check()); await render(); await submit(); expect(confirmButton().props.disabled).toBe(true);
    await reason("不足十字"); await acknowledge(); expect(confirmButton().props.disabled).toBe(true); await confirm(); expect(m.save).not.toHaveBeenCalled();
    await reason("  第二次独立维修，供应商票据编号不同  "); await acknowledge(false); expect(confirmButton().props.disabled).toBe(true);
    await acknowledge(); expect(confirmButton().props.disabled).toBe(false); await confirm();
    expect(m.save).toHaveBeenCalledOnce(); expect(m.save.mock.calls[0][0]).toMatchObject({ duplicateConfirmation: { token: "token-1", reason: "第二次独立维修，供应商票据编号不同" } }); expect(m.success).toHaveBeenCalledOnce();
  });
  it("硬冲突不提供确认按钮，只能核对取消", async () => {
    m.check.mockResolvedValue({ ...check(), hardConflict: true, confirmationToken: null, expiresAt: null }); await render(); await submit();
    expect(confirmButton()).toBeUndefined(); expect(tree.root.findByProps({ role: "alert" }).children.join("")).toContain("不能重复入账"); await cancel(); expect(m.save).not.toHaveBeenCalled();
  });
  it("确认TTL到期按钮失效，不能通过过期onClick提交", async () => {
    vi.useFakeTimers(); const initial = check(); m.check.mockResolvedValue(initial); await render(); await submit(); await reason(); await acknowledge(); const oldClick = confirmButton().props.onClick;
    await act(async () => { vi.advanceTimersByTime(600_001); }); expect(confirmButton().props.disabled).toBe(true);
    await act(async () => { oldClick(); }); expect(m.save).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain("已超时");
  });
  it("提交时新候选要求重新核对，清空旧理由及勾选并使用新token", async () => {
    m.check.mockResolvedValue(check()); m.save.mockResolvedValueOnce({ success: false, duplicateCheck: check([1, 2]) }).mockResolvedValueOnce(saved);
    await render(); await submit(); await reason(); await acknowledge(); await confirm();
    expect(tree.root.findByType("textarea").props.value).toBe(""); expect(tree.root.findByType("input").props.checked).toBe(false); expect(confirmButton().props.disabled).toBe(true);
    expect(tree.root.findByProps({ "aria-label": "已存在费用记录" }).children).toHaveLength(2); await reason(); await acknowledge(); await confirm();
    expect(m.save.mock.calls[1][0].duplicateConfirmation.token).toBe("token-1-2"); expect(m.success).toHaveBeenCalledOnce();
  });
  it.each(["表单变化", "换项目", "关窗"])("%s取消迟到预检，不保存旧输入", async kind => {
    const late = deferred<MachineCostDuplicateCheck>(); m.check.mockReturnValueOnce(late.promise); await render(); await submit();
    await act(async () => { tree.update(<Harness identity={kind} input={{ ...base, projectId: kind === "换项目" ? 4 : 3 }} />); });
    await act(async () => { late.resolve(check()); }); expect(tree.root.findAllByType("section")).toHaveLength(0); expect(m.save).not.toHaveBeenCalled(); expect(m.error).not.toHaveBeenCalled();
    await submit(); expect(m.check.mock.calls[1][0].requestId).not.toBe(m.check.mock.calls[0][0].requestId);
  });
  it("照片定位迟到后guard阻止后续上传、预检及旧费用保存", async () => {
    const photo = deferred<void>(); const upload = vi.fn(); await render({ getInput: async ({ assertCurrent }) => { await photo.promise; assertCurrent(); upload(); return { ...base, evidenceId: 8 }; } }); await submit();
    await act(async () => { tree.update(<Harness identity="closed" />); }); await act(async () => { photo.resolve(); });
    expect(upload).not.toHaveBeenCalled(); expect(m.check).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); expect(m.error).not.toHaveBeenCalled();
  });
  it("上传已经发出，迟到结果也不能触发预检或保存", async () => {
    const upload = deferred<number>(); await render({ getInput: async ({ assertCurrent }) => { const id = await upload.promise; assertCurrent(); return { ...base, evidenceId: id }; } }); await submit();
    await act(async () => { tree.update(<Harness identity="project-changed" />); }); await act(async () => { upload.resolve(8); });
    expect(m.check).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("卸载取消迟到预检及错误，无保存/回调/toast", async () => {
    const late = deferred<MachineCostDuplicateCheck>(); m.check.mockReturnValueOnce(late.promise); await render(); await submit(); await act(async () => { tree.unmount(); }); tree = null;
    await act(async () => { late.reject(Error("network")); }); expect(m.save).not.toHaveBeenCalled(); expect(m.error).not.toHaveBeenCalled(); expect(m.toast).not.toHaveBeenCalled();
  });
  it("同tick双击保存同步ref只发一个预检及一次save", async () => {
    const late = deferred<MachineCostDuplicateCheck>(); m.check.mockReturnValueOnce(late.promise); const getInput = vi.fn(() => base); await render({ getInput });
    const click = tree.root.findByProps({ "data-submit": true }).props.onClick; await act(async () => { click(); click(); }); expect(getInput).toHaveBeenCalledOnce(); expect(m.check).toHaveBeenCalledOnce();
    await act(async () => { late.resolve(empty); }); expect(m.save).toHaveBeenCalledOnce();
  });
  it("同tick双击二次确认只发一次save", async () => {
    const late = deferred<typeof saved>(); m.check.mockResolvedValue(check()); m.save.mockReturnValue(late.promise); await render(); await submit(); await reason(); await acknowledge();
    const click = confirmButton().props.onClick; await act(async () => { click(); click(); }); expect(m.save).toHaveBeenCalledOnce(); await act(async () => { late.resolve(saved); }); expect(m.success).toHaveBeenCalledOnce();
  });
  it("同输入保存网络错误保留requestId与照片，跳过新预检直接replay", async () => {
    const getInput = vi.fn(() => ({ ...base, evidenceId: 8 })); m.save.mockRejectedValueOnce(Error("lost response")).mockResolvedValueOnce({ ...saved, duplicate: true });
    await render({ getInput }); await submit(); const first = m.save.mock.calls[0][0]; expect(m.error).toHaveBeenCalledOnce(); await submit();
    expect(m.save.mock.calls[1][0]).toEqual(first); expect(m.check).toHaveBeenCalledOnce(); expect(getInput).toHaveBeenCalledOnce(); expect(m.success).toHaveBeenCalledOnce();
  });
  it("确认保存网络错误重试保持同请求和授权", async () => {
    m.check.mockResolvedValue(check()); m.save.mockRejectedValueOnce(Error("lost confirmed response")).mockResolvedValueOnce({ ...saved, duplicate: true });
    await render(); await submit(); await reason(); await acknowledge(); await confirm(); const first = m.save.mock.calls[0][0]; await confirm(); expect(m.save.mock.calls[1][0]).toEqual(first); expect(m.success).toHaveBeenCalledOnce();
  });
  it("确认网络失败后关闭疑似窗口，重新检查不借用旧确认和request", async () => {
    m.check.mockResolvedValue(check()); m.save.mockRejectedValueOnce(Error("lost confirmed response"));
    await render(); await submit(); await reason(); await acknowledge(); await confirm(); const previous = m.save.mock.calls[0][0];
    await act(async () => { tree.root.findByProps({ "data-dialog": true }).props.onOpenChange(false); });
    await submit(); expect(m.check).toHaveBeenCalledTimes(2); expect(m.check.mock.calls[1][0].requestId).not.toBe(previous.requestId);
    expect(tree.root.findByType("textarea").props.value).toBe(""); expect(m.save).toHaveBeenCalledOnce();
  });
  it("保存已发出后改输入，迟到成功不清新表单，仅提示检查上笔台账", async () => {
    const late = deferred<typeof saved>(); m.save.mockReturnValueOnce(late.promise); await render(); await submit(); await act(async () => { tree.update(<Harness identity="new-form" input={{ ...base, quantity: 2 }} />); });
    await act(async () => { late.resolve(saved); }); expect(m.success).not.toHaveBeenCalled(); expect(m.toast).toHaveBeenCalledWith(expect.stringContaining("当前新输入未提交"));
  });
});
