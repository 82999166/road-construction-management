import React from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personnelInsuranceInput } from "@shared/personnel";
const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as any).React = React;
const m = vi.hoisted(() => ({ mutate: vi.fn(), options: null as any }));
vi.mock("@/lib/trpc", () => ({ trpc: { personnel: { saveInsurance: { useMutation: (options: any) => { m.options = options; return { mutate: m.mutate, isPending: false }; } } } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/ui/input", () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock("@/components/ui/button", () => ({ Button: (p: any) => <button {...p} /> }));
vi.mock("@/components/ui/dialog", () => { const Block = ({ children }: any) => <div>{children}</div>; return { Dialog: Block, DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block }; });
import { PersonnelInsuranceEditor } from "./PersonnelInsuranceEditor";
let tree: any;
beforeEach(() => { vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
async function render(policy?: any) { const onSaved = vi.fn(async () => {}); const onClose = vi.fn(); await act(async () => { tree = create(<PersonnelInsuranceEditor personId={1} version={3} policy={policy} onSaved={onSaved} onClose={onClose} />); }); return { onSaved, onClose }; }
function field(name: string) { return tree.root.findAllByType("label").find((x: any) => x.findByType("span").children.join("") === name).findByType("input"); }
async function change(name: string, value: string) { await act(async () => field(name).props.onChange({ target: { value } })); }
async function submit() { await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} })); }
describe("真实保险编辑器行为", () => {
  it("128字段限制和接口129负边界，登记保存刷新后关闭", async () => { const callbacks = await render(); expect(field("保险公司").props.maxLength).toBe(128); expect(field("保单号（可替换，留空保留原值）").props.maxLength).toBe(128); await change("保险公司", "甲".repeat(128)); await change("到期日期", "2027-12-31"); await submit(); const data = m.mutate.mock.calls[0][0]; expect(personnelInsuranceInput.safeParse(data).success).toBe(true); expect(personnelInsuranceInput.safeParse({ ...data, providerName: "甲".repeat(129) }).success).toBe(false); expect(personnelInsuranceInput.safeParse({ ...data, policyReference: "号".repeat(129) }).success).toBe(false); await act(async () => m.options.onSuccess()); expect(callbacks.onSaved).toHaveBeenCalledOnce(); expect(callbacks.onClose).toHaveBeenCalledOnce(); });
  it("修改保费日期，留空保单号不提交，不清旧附件，失败保留输入", async () => { await render({ id: 8, insuranceType: "accident", providerName: "原公司", premiumAmount: "12.34", coverageAmount: null, purchasedAt: "2026-01-01", expiresAt: "2027-01-01", status: "active", evidenceId: 9, remarks: null }); await change("保费（元）", "23.45"); await change("到期日期", "2028-01-01"); await submit(); expect(m.mutate.mock.calls[0][0]).toMatchObject({ id: 8, version: 3, premiumAmount: 23.45, coverageAmount: null, expiresAt: "2028-01-01" }); expect(m.mutate.mock.calls[0][0]).not.toHaveProperty("policyReference"); expect(m.mutate.mock.calls[0][0]).not.toHaveProperty("evidenceId"); await act(async () => m.options.onError({ message: "版本冲突", data: { code: "CONFLICT" } })); expect(field("保费（元）").props.value).toBe("23.45"); expect(tree.root.findByProps({ role: "alert" })).toBeTruthy(); });
});
