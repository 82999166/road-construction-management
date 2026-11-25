import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const admin = source("./AdminPage.tsx"); const mobile = source("./MobileMeasurementPage.tsx"); const editor = source("../components/TakeoffEditor.tsx");
describe("项目部收方真实入口接线", () => {
  it("PC /admin/subcontract实际使用共享Editor保存与详情打印，旧窗口彻底替换", () => {
    const part = admin.slice(admin.indexOf("const renderSubcontract ="), admin.indexOf("const renderSubcontract =") + 45000);
    expect(part).toContain("<TakeoffEditor"); expect(part).toContain("<TakeoffDetailDialog");
    expect(part).toContain("save={input => saveMeasurementTakeoff.mutateAsync(input)}"); expect(part).toContain("onSaved={refreshSubcontractWorkspace}");
    expect(part).toContain('title="项目部工程量收方台账"'); expect(part).toContain("rows={(subcontractTakeoffs.data ?? []).map");
    expect(part).toContain("维护草稿"); expect(part).toContain("A4 打印"); expect(part).not.toContain("measurementTakeoffForm");
    expect(admin).toContain("trpc.measurement.takeoffCapabilities.useQuery"); expect(part).toContain("measurementTakeoffCapabilities.data?.canSubmit");
  });
  it("PC保留分包关联只取已审核/已锁定，保留施工队、付款和批次流程", () => {
    expect(admin).toContain('["approved", "locked"].includes(item.status)');
    for (const entry of ["SubcontractPaymentSettlementManager", "施工队台账", "新建分包批次", "trpc.subcontract.savePackage.useMutation", "trpc.subcontract.transitionPackage.useMutation"]) expect(admin).toContain(entry);
    expect(admin).toContain('recordWorkspaceDirty("measurement-takeoff", dirty)'); expect(admin).toContain("onDirtyChange={onTakeoffDirtyChange}");
  });
  it("手机双录入按钮和编辑均走共享Editor，详情A4不复用列表缓存", () => {
    expect(mobile.match(/onClick=\{\(\) => openTakeoff\(\)\}/g)).toHaveLength(2);
    expect(mobile).toContain("onClick={() => openTakeoff(takeoff)}"); expect(mobile).toContain("<TakeoffEditor");
    expect(mobile).toContain("save={input => saveTakeoff.mutateAsync(input)}"); expect(mobile).toContain("onSaved={refreshData}");
    expect(mobile).toContain("<TakeoffDetailDialog"); expect(mobile).toContain("autoPrint: true");
    expect(mobile).toContain("takeoffCapabilities.data?.canSubmit"); expect(mobile).toContain("takeoffCapabilities.data?.canReview");
    expect(mobile).not.toContain("function submitTakeoff()");
  });
  it("手机原有submit/review/锁定和草稿退出安全不删除，图片独立拍照/相册", () => {
    for (const entry of ['targetStatus: "submitted"', '"reviewing"', '"approved"', '"rejected"', '"locked"', "linkTakeoffEvidence", "useMobileSafeNavigate", "useMobileFormProtection", "保存本机草稿"]) expect(mobile).toContain(entry);
    expect(editor).toContain("ordinaryTakeoffDraft(draft)"); expect(editor).toContain("restoreOrdinaryTakeoffDraft(local.value)"); expect(editor).toContain("protection.requestClose(closeNow)");
    expect(editor).toContain('capture="environment"'); expect(editor).toContain("选择相册照片"); expect(editor).toContain("现场拍照");
  });
  it("两页项目及登录身份切换销毁旧窗口，PC刷新只在成功回调执行", () => {
    expect(admin).toContain("[workspaceProjectId, user?.id, isAuthenticated]"); expect(mobile).toContain("[selectedProjectId, user?.id, isAuthenticated]");
    expect(admin).toContain("measurementTakeoffEditor.projectId === workspaceProjectId"); expect(mobile).toContain("takeoffEditor.projectId === selectedProjectId");
    expect(editor).toContain("if (!current(token, identity)) return;"); expect(editor).toContain("await onSaved()");
  });
});
