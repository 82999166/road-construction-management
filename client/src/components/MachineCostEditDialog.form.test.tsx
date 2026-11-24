import React from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as any).React = React;
const m = vi.hoisted(() => ({ cost: null as any, check: vi.fn(), save: vi.fn(), invalidate: vi.fn(), close: vi.fn(), toast: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ machinery: { invalidate: m.invalidate }, admin: { diesel: { invalidate: m.invalidate } }, diesel: { invalidate: m.invalidate }, finance: { invalidate: m.invalidate } }),
  auth: { me: { useQuery: () => ({ data: { id: 9, name: "合成管理员" } }) } },
  evidence: { captureConfig: { useQuery: () => ({ data: null }) }, upload: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  machinery: { getCostForEdit: { useQuery: () => ({ data: m.cost, isLoading: false }) }, fuelCostDefault: { useQuery: () => ({ data: { guidelinePrice: 8.64 } }) },
    checkCostEditDuplicate: { useMutation: () => ({ mutateAsync: m.check }) }, updateCostDraft: { useMutation: () => ({ mutateAsync: m.save }) } },
} }));
vi.mock("sonner", () => ({ toast: { success: m.toast, error: m.toast } }));
vi.mock("@/components/ui/button", () => ({ Button: ({ variant, ...props }: any) => <button {...props} /> }));
vi.mock("@/components/ui/dialog", () => { const Block = ({ children }: any) => <div>{children}</div>; return {
  Dialog: ({ open, onOpenChange, children }: any) => open ? <section {...({ "data-dialog": true, onOpenChange } as any)}>{children}</section> : null,
  DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block, DialogFooter: Block,
}; });
import MachineCostEditDialog from "./MachineCostEditDialog";
const target = { id: 7, projectId: 3, machineId: 13 };
let tree: any;
function button(text: string) { return tree.root.findAllByType("button").find((node: any) => node.children.join("").includes(text)); }
async function render() { await act(async () => { tree = create(<MachineCostEditDialog target={target} onClose={m.close} />); }); }
async function change(label: string, value: string) { await act(async () => { tree.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } }); }); }
async function save() { await act(async () => { button("保存草稿修改").props.onClick(); }); }
beforeEach(() => { vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  m.cost = { ...target, costType: "repair", costName: "原费用", quantity: "2.000", unitPrice: "10.00", amount: "20.00", occurredAt: new Date("2026-11-09T10:37:15.321Z"), evidenceId: 8, remarks: "原备注", version: "a".repeat(64), creatorId: 9, status: "draft" };
  m.check.mockResolvedValue({ candidates: [], hardConflict: false, confirmationToken: null, expiresAt: null }); m.save.mockResolvedValue({ success: true }); m.invalidate.mockResolvedValue(undefined);
  m.confirm.mockReturnValue(false); (globalThis as any).window = { confirm: m.confirm };
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
describe("草稿编辑完整表单真实行为", () => {
  it("原照片与未变时间秒毫秒保留，保存成功失效机械柴油财务缓存", async () => {
    await render(); await change("编辑费用数量", "3"); await save();
    expect(m.save.mock.calls[0][0]).toMatchObject({ id: 7, version: "a".repeat(64), quantity: 3, evidenceId: 8, occurredAt: "2026-11-09T10:37:15.321Z" });
    expect(m.invalidate).toHaveBeenCalledTimes(4); expect(m.close).toHaveBeenCalledOnce();
  });
  it("保存失败保留改动，后台刷新新版本不替换旧表单版本与输入", async () => {
    m.save.mockRejectedValueOnce(Error("network")); await render(); await change("编辑费用名称", "尚未保存修改"); await save(); expect(m.close).not.toHaveBeenCalled();
    m.cost = { ...m.cost, costName: "别人修改", version: "b".repeat(64) }; await act(async () => tree.update(<MachineCostEditDialog target={target} onClose={m.close} />));
    expect(tree.root.findByProps({ "aria-label": "编辑费用名称" }).props.value).toBe("尚未保存修改"); await save();
    expect(m.save.mock.calls[1][0]).toMatchObject({ costName: "尚未保存修改", version: "a".repeat(64) });
  });
  it("取消和外层关窗须确认放弃草稿，不确认不清空输入", async () => {
    await render(); await change("编辑费用备注", "新备注"); await act(async () => button("取消").props.onClick()); expect(m.close).not.toHaveBeenCalled();
    await act(async () => tree.root.findByProps({ "data-dialog": true }).props.onOpenChange(false)); expect(m.close).not.toHaveBeenCalled(); expect(tree.root.findByProps({ "aria-label": "编辑费用备注" }).props.value).toBe("新备注");
    m.confirm.mockReturnValue(true); await act(async () => button("取消").props.onClick()); expect(m.close).toHaveBeenCalledOnce(); expect(m.save).not.toHaveBeenCalled();
  });
  it("无效空时间不使渲染崩溃，不能发送保存", async () => { await render(); await change("编辑费用时间", ""); await save(); expect(m.check).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); });
});
