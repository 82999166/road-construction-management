import React from "react";
import { createRequire } from "node:module";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");
const mock = vi.hoisted(() => ({ preview: {} as any, query: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { admin: { masterData: { deletionImpact: { useQuery: (input: any, options: any) => { mock.query(input, options); return mock.preview; } } } } } }));
vi.mock("@/components/ui/button", () => ({ Button: (props: any) => <button {...props} /> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }));
vi.mock("@/components/ui/label", () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: ({ checked, onCheckedChange, ...props }: any) => <input {...props} type="checkbox" checked={checked} onChange={(e: any) => onCheckedChange(e.target.checked)} /> }));
vi.mock("@/components/ui/dialog", () => { const Block = (props: any) => <div {...props} />; return { Dialog: ({ open, children, onOpenChange }: any) => open ? <Block data-dialog onClose={() => onOpenChange(false)}>{children}</Block> : null, DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block, DialogFooter: Block }; });
import { IdentityDeletionImpactPreview, ScopeReactivationDialog, scopeReactivationInput, type ScopeReactivationTarget } from "./IdentityGovernanceControls";
import { EvidenceAssociationSummary, canRequestEvidenceDeletion, evidenceAssociationLabel } from "./EvidenceAssociationSummary";
const target: ScopeReactivationTarget = { scopeType: "project", scopeId: 10, module: "FINANCE", label: "项目甲 · 财务" };
let tree: ReactTestRenderer | undefined;
const root = () => tree!.root;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
const button = (label: string) => root().findAllByType("button").find(node => text(node) === label)!;
const mount = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const edit = async (value: string) => { await act(async () => root().findByType("textarea").props.onChange({ target: { value } })); };
const check = async () => { await act(async () => root().findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } })); };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mock.preview = { isLoading: false, isFetching: false, isError: false, refetch: vi.fn(), data: { name: "项目甲", status: "active", canHardDelete: false, references: [] } }; });
afterEach(async () => { if (tree) await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });

describe("真实引用预览 / 显式重新启用专项行为", () => {
  it("调用真实只读预览契约，空引用也不提供删除入口", async () => {
    await mount(<IdentityDeletionImpactPreview resource="project" id={10} />);
    expect(mock.query).toHaveBeenCalledWith({ resource: "project", id: 10 }, { retry: false });
    expect(text(root())).toContain("这不是删除许可"); expect(text(root())).toContain("硬删除已关闭");
    expect(root().findAllByType("button")).toHaveLength(0);
  });
  it("实际引用展示 table field count，并明确包含历史引用", async () => {
    mock.preview.data.references = [{ table: "financial_records", field: "projectId", count: 8 }];
    await mount(<IdentityDeletionImpactPreview resource="organization" id={30} />);
    expect(text(root())).toContain("financial_records.projectId：8 条"); expect(text(root())).toContain("停用并保存"); expect(text(root())).toContain("历史记录也计入");
  });
  it("失败不伪造空结果，重试仍是只读查询", async () => {
    mock.preview = { isError: true, error: new Error("引用扫描失败"), refetch: vi.fn() };
    await mount(<IdentityDeletionImpactPreview resource="project" id={10} />);
    expect(text(root())).toContain("引用扫描失败"); expect(text(root())).not.toContain("暂未发现本次扫描");
    await act(async () => button("重新读取引用").props.onClick()); expect(mock.preview.refetch).toHaveBeenCalledTimes(1);
  });
  it("载入中不展示旧引用结果为空", async () => {
    mock.preview.isFetching = true;
    await mount(<IdentityDeletionImpactPreview resource="project" id={10} />);
    expect(text(root())).toContain("正在读取实际引用"); expect(text(root())).not.toContain("暂未发现本次扫描");
  });
  it.each([["123", true], ["原配置核对", false], ["x".repeat(201), true]])("原因长度和确认缺一不可 %s %s", (reason, confirmed) => {
    expect(scopeReactivationInput(target, reason, confirmed)).toBeNull();
  });
  it("4/200字边界有效，发送disabled CAS及confirmReactivate不夹带label", () => {
    expect(scopeReactivationInput(target, "  核对授权  ", true)).toEqual({ scopeType: "project", scopeId: 10, module: "FINANCE", status: "active", expectedStatus: "disabled", confirmReactivate: true, reason: "核对授权" });
    expect(scopeReactivationInput(target, "x".repeat(200), true)).not.toBeNull();
  });
  it("重新启用失败保留输入，修正原因后须重新确认；模态适配窄屏与大PC", async () => {
    const onClose = vi.fn(); const onConfirm = vi.fn().mockRejectedValue(new Error("业务配置已变化"));
    await mount(<ScopeReactivationDialog target={target} onClose={onClose} onConfirm={onConfirm} />);
    expect(button("确认重新启用").props.disabled).toBe(true);
    await edit("审批依据已经核对"); await check(); await act(async () => { await button("确认重新启用").props.onClick(); });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ expectedStatus: "disabled", confirmReactivate: true }));
    expect(root().findByType("textarea").props.value).toBe("审批依据已经核对"); expect(text(root())).toContain("业务配置已变化"); expect(onClose).not.toHaveBeenCalled();
    await edit("新的审批依据已核对"); expect(button("确认重新启用").props.disabled).toBe(true);
    const content = root().findAllByType("div").find(node => String(node.props.className).includes("max-w-3xl"))!;
    expect(content.props.className).toContain("w-[calc(100vw-2rem)]"); expect(content.props.className).toContain("max-h-[90dvh]"); expect(content.props.className).toContain("overflow-x-hidden");
  });
  it("同帧重复提交只发一次，pending不能取消或关闭，成功后才关闭", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })); const onClose = vi.fn();
    await mount(<ScopeReactivationDialog target={target} onClose={onClose} onConfirm={onConfirm} />);
    await edit("核对原项目授权"); await check();
    await act(async () => { button("确认重新启用").props.onClick(); button("确认重新启用").props.onClick(); });
    expect(onConfirm).toHaveBeenCalledTimes(1); expect(button("取消").props.disabled).toBe(true);
    await act(async () => root().findByProps({ "data-dialog": true }).props.onClose()); expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish()); expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("附件真实来源状态与删除投影", () => {
  it.each(["referenced", "unverified_marker", undefined] as const)("%s即便旧canDelete=true也不能删除", sourceAssociationStatus => {
    expect(canRequestEvidenceDeletion({ sourceAssociationStatus, canDelete: true, sourceId: "自由标记" })).toBe(false);
  });
  it("未关联也必须有真实canDelete且无阻断原因", () => {
    expect(canRequestEvidenceDeletion({ sourceAssociationStatus: "unassigned", canDelete: true })).toBe(true);
    expect(canRequestEvidenceDeletion({ sourceAssociationStatus: "unassigned", canDelete: false })).toBe(false);
    expect(canRequestEvidenceDeletion({ sourceAssociationStatus: "unassigned", canDelete: true, deletionBlockedReason: "保留期未届满" })).toBe(false);
  });
  it("自由sourceId只显示待核验，阻断原因可见，不说随单审核", async () => {
    await mount(<EvidenceAssociationSummary record={{ sourceAssociationStatus: "unverified_marker", sourceId: "construction-report-77", deletionBlockedReason: "来源标记尚未核验", canDelete: false }} />);
    expect(text(root())).toContain("来源标记待核验"); expect(text(root())).toContain("来源标记尚未核验"); expect(text(root())).not.toContain("随单审核");
  });
  it("引用状态不能冒充审核状态，missing状态保守显示核验", async () => {
    await mount(<EvidenceAssociationSummary record={{ sourceAssociationStatus: "referenced", canDelete: false }} />);
    expect(text(root())).toContain("不代表当前已审核"); expect(evidenceAssociationLabel(undefined)).toBe("来源状态待核验");
  });
});
