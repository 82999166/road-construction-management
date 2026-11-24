import React from "react";
import { createRequire } from "node:module";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");
const mocks = vi.hoisted(() => ({ mutations: {} as Record<string, any>, callbacks: {} as Record<string, any>, invalidate: vi.fn(), toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast, error: mocks.toast } }));
vi.mock("@/lib/trpc", () => {
  const use = (name: string) => (options: any) => { mocks.callbacks[name] = options; return mocks.mutations[name]; };
  const utility = { invalidate: mocks.invalidate };
  return { trpc: { useUtils: () => ({ finance: { summary: utility, listRecords: utility, businessSummary: utility }, labor: { payroll: { list: utility }, dailyWage: { list: utility }, summary: utility } }), finance: { voidRecord: { useMutation: use("financeVoid") }, reverseRecord: { useMutation: use("reverse") } }, labor: { dailyWage: { submit: { useMutation: use("dailySubmit") }, review: { useMutation: use("dailyReview") } }, payroll: { submit: { useMutation: use("submit") }, approve: { useMutation: use("approve") }, void: { useMutation: use("payrollVoid") } } } } };
});
vi.mock("@/components/ui/button", () => ({ Button: (props: any) => <button {...props} /> }));
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }));
vi.mock("@/components/ui/label", () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: ({ checked, onCheckedChange, ...props }: any) => <input {...props} type="checkbox" checked={checked} onChange={(e: any) => onCheckedChange(e.target.checked)} /> }));
vi.mock("@/components/ui/dialog", () => { const Block = (props: any) => <div {...props} />; return { Dialog: ({ open, children, onOpenChange }: any) => open ? <div {...{ "data-dialog": true, onClose: () => onOpenChange(false) }}>{children}</div> : null, DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block, DialogFooter: Block }; });
import { FinanceRecordCorrectionActions, permittedFinanceCorrection, type FinanceCorrectionRow } from "./FinanceRecordCorrectionActions";
import { DailyWageCorrectionActions, permittedDailyWageActions } from "./DailyWageCorrectionActions";
import { PayrollCorrectionActions, permittedPayrollActions } from "./PayrollCorrectionActions";
const record: FinanceCorrectionRow = { id: 71, projectId: 10, recordNo: "原流水71", amount: "800", direction: "expense", category: "人工费用", occurredAt: "2026-11-01T08:00:00Z", settlementStatus: "paid", sourceType: null };
const payroll = { id: 9, workerName: "人员甲", period: "2026-11", actualAmount: "800", status: "reviewing" };
let tree: ReactTestRenderer | undefined;
const root = () => tree!.root;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
const button = (label: string) => root().findAllByType("button").find(node => text(node) === label)!;
const click = async (label: string, force = false) => { await act(async () => { const node = button(label); if (force || !node.props.disabled) node.props.onClick(); }); };
const edit = async (value: string) => { await act(async () => root().findByType("textarea").props.onChange({ target: { value } })); };
const check = async () => { await act(async () => root().findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } })); };
const finance = (patch: Partial<FinanceCorrectionRow> = {}, roles = ["FINANCE_MANAGER"]) => <FinanceRecordCorrectionActions record={{ ...record, ...patch }} roleCodes={roles} projectId={10} />;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mocks.invalidate.mockResolvedValue(undefined); for (const name of ["financeVoid", "reverse", "submit", "approve", "payrollVoid", "dailySubmit", "dailyReview"]) mocks.mutations[name] = { mutate: vi.fn(), isPending: false }; });
afterEach(async () => { if (tree) await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });

describe("工资与财务独立纠错入口真实React行为", () => {
  it("岗位、来源、终态及虚拟行投影不扩大", () => {
    expect(permittedFinanceCorrection(record, ["ACCOUNTANT"])).toBeNull();
    expect(permittedFinanceCorrection({ ...record, settlementStatus: "partial" }, ["ALL"])).toBeNull();
    expect(permittedFinanceCorrection({ ...record, sourceId: "1" }, ["ALL"])).toBeNull();
    expect(permittedFinanceCorrection({ ...record, id: "virtual" }, ["ALL"])).toBeNull();
    expect(permittedPayrollActions("reviewing", ["FINANCE_MANAGER"])).toEqual(["void"]);
    expect(permittedPayrollActions("reviewing", ["ACCOUNTANT"])).toEqual(["approve", "return", "void"]);
    expect(permittedPayrollActions("partial", ["ALL"])).toEqual([]);
    expect(permittedPayrollActions("paid", ["ALL"])).toEqual([]);
  });
  it("财务弹窗展示原单，原因+核对必填，同一帧重复点击只发一次", async () => {
    await act(async () => { tree = create(finance()); });
    await click("冲销人工流水");
    expect(text(root())).toContain("原流水71"); expect(text(root())).toContain("¥800.00");
    expect(root().findAllByType("div").some(n => String(n.props.className).includes("max-w-3xl"))).toBe(true);
    expect(button("确认办理").props.disabled).toBe(true);
    await edit("退款资金已核对"); await check();
    await act(async () => { const confirm = button("确认办理"); confirm.props.onClick(); confirm.props.onClick(); });
    expect(mocks.mutations.reverse.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutations.reverse.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 71, projectId: 10, reason: "退款资金已核对" }));
  });
  it("失败保留原因和日期，取消清空；处理中不能关闭", async () => {
    await act(async () => { tree = create(finance()); }); await click("冲销人工流水"); await edit("已核对原始资金"); await check(); await click("确认办理");
    await act(async () => mocks.callbacks.reverse.onError(new Error("该日已封账")));
    expect(root().findByType("textarea").props.value).toBe("已核对原始资金");
    expect(text(root())).toContain("该日已封账");
    mocks.mutations.reverse.isPending = true; await act(async () => tree?.update(finance()));
    expect(text(root())).toContain("等待服务器回执"); await act(async () => root().findByProps({ "data-dialog": true }).props.onClose());
    expect(root().findAllByProps({ "data-dialog": true })).toHaveLength(1);
    mocks.mutations.reverse.isPending = false; await act(async () => tree?.update(finance())); await click("取消"); await click("冲销人工流水");
    expect(root().findByType("textarea").props.value).toBe("");
  });
  it("打开后原金额或权限改变时旧确认不可提交", async () => {
    await act(async () => { tree = create(finance()); }); await click("冲销人工流水"); await edit("原单核对"); await check();
    await act(async () => tree?.update(finance({ amount: "801" })));
    expect(button("确认办理").props.disabled).toBe(true); await click("确认办理", true);
    expect(mocks.mutations.reverse.mutate).not.toHaveBeenCalled();
  });
  it("工资退回要求原因并调用真实approve returned，失败留输入，成功关窗刷新", async () => {
    await act(async () => { tree = create(<PayrollCorrectionActions row={payroll} roleCodes={["ACCOUNTANT"]} />); });
    await click("退回草稿"); expect(button("确认办理").props.disabled).toBe(true); await edit("依据录入错误待修正"); await click("确认办理");
    expect(mocks.mutations.approve.mutate).toHaveBeenCalledWith({ id: 9, decision: "returned", reason: "依据录入错误待修正" });
    await act(async () => mocks.callbacks.approve.onError(new Error("已有有效付款")));
    expect(root().findByType("textarea").props.value).toBe("依据录入错误待修正"); await click("确认办理");
    await act(async () => mocks.callbacks.approve.onSuccess());
    expect(root().findAllByProps({ "data-dialog": true })).toHaveLength(0); expect(mocks.invalidate).toHaveBeenCalled();
  });
  it("已付工资不显示撤销按钮，来源资金只有回原业务入口", async () => {
    await act(async () => { tree = create(<PayrollCorrectionActions row={{ ...payroll, status: "paid" }} roleCodes={["ALL"]} />); });
    expect(root().findAllByType("button")).toHaveLength(0); expect(text(root())).toContain("不能作废");
    const onOpenSource = vi.fn(); await act(async () => tree?.update(<FinanceRecordCorrectionActions record={{ ...record, sourceType: "settlement_payment", sourceId: "7" }} roleCodes={["ALL"]} projectId={10} onOpenSource={onOpenSource} />));
    await click("回来源业务"); expect(onOpenSource).toHaveBeenCalled(); expect(mocks.mutations.reverse.mutate).not.toHaveBeenCalled();
  });
  it("日结只接真实提交/审核退回，无作废或退款；退回原因进入RPC", async () => {
    expect(permittedDailyWageActions("paid", ["ALL"])).toEqual([]);
    expect(permittedDailyWageActions("draft", ["ACCOUNTANT"])).toEqual([]);
    expect(permittedDailyWageActions("reviewing", ["FINANCE_MANAGER"])).toEqual(["approve", "return"]);
    await act(async () => { tree = create(<DailyWageCorrectionActions row={{ id: 7, workerName: "临工甲", settlementDate: "2026-11-01", actualAmount: "100", status: "reviewing" }} roleCodes={["ACCOUNTANT"]} />); });
    await click("退回草稿"); expect(button("确认办理").props.disabled).toBe(true); await edit("日结依据待修正"); await click("确认办理");
    expect(mocks.mutations.dailyReview.mutate).toHaveBeenCalledWith({ id: 7, decision: "returned", reason: "日结依据待修正" });
  });

});
