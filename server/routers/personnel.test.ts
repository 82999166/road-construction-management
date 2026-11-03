import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { getTableName } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ superAdmin: false, moduleAllowed: true, roles: ["TRANSPORT_MANAGER"], scope: { hasAllProjects: false, projectIds: [10], organizationIds: [] }, db: null as any, person: { id: 1, affiliation: "company", payrollEnabled: true, legacyProfileId: 5, projectId: 10 }, options: vi.fn(), list: vi.fn(), detail: vi.fn(), save: vi.fn(), preview: vi.fn(), insurancePreview: vi.fn(), insuranceSave: vi.fn(), payrollProfile: vi.fn(), upload: vi.fn(), adopt: vi.fn(), resource: vi.fn(), originalAdvance: vi.fn(), originalGenerate: vi.fn() }));
vi.mock("../localAuth", () => ({ assertLocalManagerTerminalAccess: vi.fn() }));
vi.mock("../access", () => ({
  assertSuperAdmin: async (ctx: any) => { if (!mocks.superAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员" }); return ctx.user; },
  getSuperAdminAccess: () => ({ canAccess: mocks.superAdmin }),
  getRoleOperationPermissionDecision: () => ({ allowed: false, hasDetailedPermissions: false }),
  assertDepartmentBusinessAccess: async () => { if (!mocks.moduleAllowed) throw new TRPCError({ code: "FORBIDDEN" }); },
  getDepartmentModuleDataScope: () => mocks.scope, getEffectiveRoleCodes: () => mocks.roles,
  hasUserSpecificOperationPermission: () => false, requireAuthenticatedUser: (ctx: any) => ctx.user,
}));
vi.mock("../services/personnelDirectory", () => ({ personnelOptions: mocks.options, listDirectoryPeople: mocks.list, directoryDetail: mocks.detail, saveDirectoryPerson: mocks.save, previewPersonnelDocument: mocks.preview, previewInsuranceDocument: mocks.insurancePreview, savePersonnelInsurance: mocks.insuranceSave, resolvePersonnelPayrollProfile: mocks.payrollProfile, uploadPersonnelDocument: mocks.upload, saveDirectoryPosition: vi.fn(), saveDirectoryTeam: vi.fn(), requirePersonnelDb: () => mocks.db, findPersonnel: () => mocks.person }));
vi.mock("../services/personnelLegacyBridge", () => ({ adoptLegacy: mocks.adopt, listLegacyCandidates: vi.fn(), saveResourceBinding: mocks.resource }));
vi.mock("./admin", () => ({ adminRouter: { createCaller: () => ({ employee: { saveAdvance: mocks.originalAdvance, generatePayrollDraft: mocks.originalGenerate } }) } }));
import { personnelRouter } from "./personnel";
function caller(extra: any = {}) { return personnelRouter.createCaller({ user: { id: 7, role: "user", loginMethod: "manus", ...extra }, req: { headers: {} }, res: {} } as any); }
const input = { name: "无需账号的工人", affiliation: "company" as const, primaryPositionId: null, employmentStatus: "active" as const, payrollEnabled: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.superAdmin = false; mocks.moduleAllowed = true; mocks.roles = ["TRANSPORT_MANAGER"]; mocks.scope = { hasAllProjects: false, projectIds: [10], organizationIds: [] }; mocks.person = { id: 1, affiliation: "company", payrollEnabled: true, legacyProfileId: 5, projectId: 10 };
  mocks.db = { select(selection: any) { let table: string; const chain: any = { from(t: any) { table = getTableName(t); return chain; }, where() { return chain; }, limit() { return chain; }, then(resolve: any) { const data = table === "projects" ? [{ id: 10, organizationId: 20 }] : table === "personnel_positions" ? [{ id: 1, name: "运输司机", category: "driver", status: "active" }, { id: 2, name: "会计", category: "business", status: "active" }, { id: 3, name: "操作员", category: "operator", status: "active" }] : table === "transport_vehicles" ? [{ projectId: 10 }] : [{ id: 1, personNo: "P-1", name: "司机", primaryPositionId: 1, secondaryPositionIds: [], affiliation: "external", projectId: 10, userId: null }, { id: 2, personNo: "P-2", name: "会计", primaryPositionId: 2, secondaryPositionIds: [], affiliation: "company", projectId: 10, userId: 3 }, { id: 3, personNo: "P-3", name: "兼岗", primaryPositionId: 2, secondaryPositionIds: [1], affiliation: "temporary", projectId: 10, userId: null }]; return Promise.resolve(data).then(resolve); } }; return chain; }, transaction: async (callback: any) => callback(mocks.db) };
  mocks.originalAdvance.mockResolvedValue({ success: true, id: 8 }); mocks.originalGenerate.mockResolvedValue({ status: "created", payrollStatementId: 9 }); mocks.payrollProfile.mockReset().mockResolvedValue(5);
});

describe("personnel API权限与最小选人投影", () => {
  it("普通账号无法读取人员、薪资或敏感附件，且未调用任何helper", async () => {
    const api = caller(); await expect(api.options()).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(api.list()).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(api.detail({ personId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(api.previewDocument({ personId: 1, documentId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.options).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("普通账号不能写核心、引入别人的source或绑定资源", async () => {
    const api = caller(); await expect(api.save(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(api.adoptLegacy({ sourceType: "user", sourceId: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(api.saveResourceBinding({ personId: 1, assetType: "vehicle", assetId: 2, effectiveFrom: "2026-11-03" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.adopt).not.toHaveBeenCalled(); expect(mocks.resource).not.toHaveBeenCalled();
  });
  it("超级管理员保存使用已验证actor，不给账号权限", async () => { mocks.superAdmin = true; mocks.save.mockResolvedValue({ success: true, id: 1, personNo: "P-1", version: 1 }); await caller().save(input); expect(mocks.save).toHaveBeenCalledWith(input, 7); });
  it("资源选人沿用模块read与模块项目边界，不返回工资电话证件", async () => {
    const rows = await caller().selectOptions({ projectId: 10, role: "driver" }); expect(rows.map(x => x.id)).toEqual([1, 3]); expect(Object.keys(rows[0]).sort()).toEqual(["id", "personNo", "name", "positionName", "affiliation", "projectId", "userId"].sort()); expect(JSON.stringify(rows)).not.toMatch(/phone|bank|salary|password/i);
    mocks.moduleAllowed = false; await expect(caller().selectOptions({ projectId: 10, role: "driver" })).rejects.toMatchObject({ code: "FORBIDDEN" }); mocks.moduleAllowed = true; mocks.scope.projectIds = []; await expect(caller().selectOptions({ projectId: 10, role: "driver" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("个人司机门户及只有司机岗位不能获取全项目人员选择", async () => { await expect(caller({ loginMethod: "local_driver" }).selectOptions({ projectId: 10, role: "driver" })).rejects.toMatchObject({ code: "FORBIDDEN" }); mocks.roles = ["DRIVER"]; await expect(caller().selectOptions({ projectId: 10, role: "driver" })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("未认证拒绝，版本缺失或任意sourceId不在save输入契约", async () => { const api = personnelRouter.createCaller({ user: null, req: {}, res: {} } as any); await expect(api.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" }); mocks.superAdmin = true; await expect(caller().save({ ...input, id: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); });
  it("预支只调用原审批入口并强制草稿", async () => { mocks.superAdmin = true; await caller().saveAdvance({ personId: 1, advanceDate: "2026-11-03", amount: 120, remarks: "真实预支" }); expect(mocks.originalAdvance).toHaveBeenCalledWith({ employeeProfileId: 5, advanceDate: "2026-11-03", amount: 120, remarks: "真实预支", status: "draft" }); });
  it("外部/临时历史资格由period helper拒绝，合法历史生成复用原草稿服务", async () => {
    mocks.superAdmin = true; mocks.person.affiliation = "external"; mocks.payrollProfile.mockRejectedValueOnce(new TRPCError({ code: "BAD_REQUEST" })); await expect(caller().generatePayrollDraft({ personId: 1, period: "2026-11" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); mocks.person.affiliation = "temporary"; mocks.payrollProfile.mockRejectedValueOnce(new TRPCError({ code: "BAD_REQUEST" })); await expect(caller().generatePayrollDraft({ personId: 1, period: "2026-11" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mocks.originalGenerate).not.toHaveBeenCalled(); await caller().generatePayrollDraft({ personId: 1, period: "2026-10", employeeProfileId: 5 }); expect(mocks.payrollProfile).toHaveBeenLastCalledWith({ personId: 1, period: "2026-10", employeeProfileId: 5 }); expect(mocks.originalGenerate).toHaveBeenCalledWith({ employeeProfileId: 5, period: "2026-10" });
  });
  it("跨项目资源绑定拒绝，无直接给账号权限的输入", async () => { mocks.superAdmin = true; mocks.person.projectId = 11; await expect(caller().saveResourceBinding({ personId: 1, assetType: "vehicle", assetId: 2, effectiveFrom: "2026-11-03" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mocks.resource).not.toHaveBeenCalled(); });
  it("新旧保单预览与保险登记仅超级管理员，普通用户不触达helper", async () => {
    await expect(caller().previewInsuranceDocument({ personId: 1, policyId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().saveInsurance({ personId: 1, version: 1, insuranceType: "accident", purchasedAt: "2026-01-01", expiresAt: "2026-12-31", status: "active" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.insurancePreview).not.toHaveBeenCalled(); expect(mocks.insuranceSave).not.toHaveBeenCalled();
  });
  it("新保单接口绑定已验证actor及CAS版本；portrait PDF在router即拒绝", async () => {
    mocks.superAdmin = true; await caller().previewInsuranceDocument({ personId: 1, policyId: 8 }); expect(mocks.insurancePreview).toHaveBeenCalledWith(1, 8, 7);
    const insurance = { personId: 1, version: 3, insuranceType: "accident" as const, purchasedAt: "2026-01-01", expiresAt: "2026-12-31", status: "active" as const };
    await caller().saveInsurance(insurance); expect(mocks.insuranceSave).toHaveBeenCalledWith(insurance, 7);
    await expect(caller().uploadDocument({ personId: 1, documentType: "portrait", name: "头像", fileName: "file.pdf", mimeType: "application/pdf", base64Data: "JVBERi0xLjQ=" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(mocks.upload).not.toHaveBeenCalled();
  });
});
