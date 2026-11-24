import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { ProjectPermissionsMockDb } from "./services/projectPermissions.mockDb";
import { enumerateIdentityReferences } from "./services/projectDeletionGuard";
const mock = vi.hoisted(() => ({ db: null as ProjectPermissionsMockDb | null, notify: vi.fn(), storage: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => mock.db }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: mock.notify }));
vi.mock("./storage", () => ({ storagePut: mock.storage, storageGetSignedUrl: mock.storage }));
import { adminRouter } from "./routers/admin";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getCurrentDepartmentAccess, getDepartmentModuleDataScope } from "./access";

const ctx = (role: "admin" | "user" = "admin"): TrpcContext => ({ user: { id: role === "admin" ? 1 : 7, openId: "isolated-project-permissions", role, loginMethod: "manus" } as TrpcContext["user"], req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
let db: ProjectPermissionsMockDb;
const caller = () => adminRouter.createCaller(ctx());
const project = { id: 10, code: "TEST-P10", name: "隔离项目一", nodeType: "项目", status: "active", parentId: null, organizationId: null };
const scope = { id: 20, projectId: 10, organizationId: null, module: "FINANCE", status: "active", configuredBy: 1 };
const projectSave = { id: 10, code: "TEST-P10", name: "隔离项目一", nodeType: "项目", status: "active" as const, parentId: null, organizationId: null, sortOrder: 0 };
function seedRole(roleCode = "FINANCE_MANAGER", projectId = 10, roleId = 3) {
  db.seed(schema.systemRoles, { id: roleId, code: roleCode, name: roleCode, status: "active", category: "business" });
  db.seed(schema.userRoleAssignments, { id: roleId, userId: 7, roleId, projectId, organizationId: null, status: "active", validFrom: null, validTo: null });
}
beforeEach(() => { vi.clearAllMocks(); db = new ProjectPermissionsMockDb(); mock.db = db; db.seed(schema.projects, project); });
afterEach(() => { expect(mock.notify).not.toHaveBeenCalled(); expect(mock.storage).not.toHaveBeenCalled(); db.close(); });

describe("schema引用集与保守项目/组织硬删除", () => {
  it("从实际schema核对每个数值项目/组织身份列，包括fromProjectId及parentId", () => {
    for (const kind of ["project", "organization"] as const) {
      const expected: string[] = [];
      for (const table of Object.values(schema)) {
        if (!is(table, MySqlTable)) continue;
        for (const [field, col] of Object.entries(getTableColumns(table))) {
          if (col.dataType === "number" && (kind === "project" ? /^(?:projectId|.*ProjectId)$/ : /^(?:organizationId|.*OrganizationId)$/).test(field)) expected.push(`${getTableName(table)}.${field}`);
        }
        if (table === (kind === "project" ? schema.projects : schema.organizations)) expected.push(`${getTableName(table)}.parentId`);
      }
      expect(enumerateIdentityReferences(kind).map(ref => `${ref.tableName}.${ref.field}`).sort()).toEqual(expected.sort());
    }
    expect(enumerateIdentityReferences("project")).toContainEqual(expect.objectContaining({ tableName: "vehicle_assignments", field: "fromProjectId" }));
  });
  it.each(enumerateIdentityReferences("project").map(ref => [ref.tableName, ref.field, ref] as const))("阻止隐藏引用%s.%s，不按当前状态漏历史", async (_name, field, ref) => {
    db.seed(ref.table, { ...("id" in getTableColumns(ref.table) ? { id: 90 } : { vehicleId: 90 }), [field]: 10, ...(ref.tableName === "projects" ? { code: "CHILD", name: "子节点" } : {}) });
    const before = db.snapshot();
    const impact = await caller().masterData.deletionImpact({ resource: "project", id: 10 });
    expect(impact.references).toContainEqual({ table: ref.tableName, field, count: 1 });
    await expect(caller().masterData.remove({ resource: "project", id: 10 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.snapshot()).toEqual(before);
  });
  it.each([schema.suppliers, schema.officialAccountBroadcasts])("组织供应商/群发归属也受保护%s", async table => {
    db.seed(schema.organizations, { id: 30, name: "隔离组织", code: "ORG30", type: "department", status: "active" });
    db.seed(table, { id: 91, organizationId: 30 });
    await expect(caller().masterData.remove({ resource: "organization", id: 30 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(getTableName(table)) });
  });
  it("无引用误建项目仍因未有全域共同锁而收口，不伪称可安全删", async () => {
    const before = db.snapshot();
    expect(await caller().masterData.deletionImpact({ resource: "project", id: 10 })).toMatchObject({ canHardDelete: false, references: [], suggestedOperation: "archive" });
    await expect(caller().masterData.remove({ resource: "project", id: 10 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("共同锁") });
    expect(db.snapshot()).toEqual(before); expect(db.locks).toContain("projects:update");
  });
  it("多个资金/凭证/日结历史同时呈现，跨项目引用不误挡", async () => {
    db.seed(schema.financialRecords, [{ id: 1, projectId: 10, settlementStatus: "void" }, { id: 2, projectId: 11 }]);
    db.seed(schema.settlementPaymentRecords, { id: 1, projectId: 10, status: "reversed" });
    db.seed(schema.dailyAccountingClosureEvents, { id: 1, projectId: 10 });
    db.seed(schema.financialInvoices, { id: 1, projectId: 10, status: "void" });
    const impact = await caller().masterData.deletionImpact({ resource: "project", id: 10 });
    expect(impact.references).toEqual(expect.arrayContaining([expect.objectContaining({ table: "financial_records", count: 1 }), expect.objectContaining({ table: "settlement_payment_records", count: 1 }), expect.objectContaining({ table: "daily_accounting_closure_events", count: 1 }), expect.objectContaining({ table: "financial_invoices", count: 1 })]));
  });
  it("检查过程中迟到无锁写入也不会使身份被删；检查失败不当作零引用", async () => {
    let injected = false;
    db.beforeSelect = table => { if (table === "vehicle_changes" && !injected) { injected = true; db.seed(schema.financialRecords, { id: 1, projectId: 10 }); } };
    await expect(caller().masterData.remove({ resource: "project", id: 10 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.rows(schema.projects)).toHaveLength(1);
    db.beforeSelect = table => { if (table === "financial_records") throw new Error("模拟引用查询失败"); };
    await expect(caller().masterData.remove({ resource: "project", id: 10 })).rejects.toThrow("模拟引用查询失败");
    expect(db.rows(schema.projects)).toHaveLength(1);
  });
  it("不存在及普通管理员猜到治理接口均被拒绝", async () => {
    await expect(caller().masterData.remove({ resource: "project", id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(adminRouter.createCaller(ctx("user")).masterData.deletionImpact({ resource: "project", id: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminRouter.createCaller(ctx("user")).masterData.remove({ resource: "department_scope", id: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("最后项目配置收回、旧模式与角色/项目边界", () => {
  it("真实caller删除最后FINANCE配置保留disabled，菜单/模块范围/跨项目RPC不恢复", async () => {
    seedRole(); db.seed(schema.departmentBusinessScopes, scope);
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toContain("FINANCE");
    expect(await caller().masterData.remove({ resource: "department_scope", id: 20, reason: "管理员正式收回财务" })).toEqual({ success: true, operation: "disabled" });
    expect(db.rows(schema.departmentBusinessScopes)[0]).toMatchObject({ id: 20, status: "disabled", projectId: 10 });
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toEqual([]);
    await expect(getDepartmentModuleDataScope(ctx("user"), "FINANCE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertProjectInCurrentScope(ctx("user"), 11)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const audit = db.rows(schema.auditLogs).at(-1);
    expect(audit.targetId).toBe("project:10:FINANCE");
    expect(JSON.parse(audit.beforeJson)).toMatchObject({ scopeType: "project", scopeId: 10, scopeRecordId: 20, snapshot: { status: "active", projectId: 10 } });
    expect(JSON.parse(audit.afterJson)).toMatchObject({ configurationMode: "explicit-allowlist", snapshot: { status: "disabled" } });
  });
  it("未配置的旧项目保持历史兼容，仅对应项目可访问；active开关不扩角色上限", async () => {
    seedRole("LOGISTICS_MANAGER");
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toContain("PURCHASING");
    db.seed(schema.departmentBusinessScopes, [{ ...scope, module: "FINANCE" }, { ...scope, id: 21, module: "PURCHASING" }]);
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toEqual(["PURCHASING"]);
    await expect(assertDepartmentBusinessAccess(ctx("user"), "FINANCE")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("A项目收回不改变B项目范围，不能借B菜单访问A项目", async () => {
    seedRole(); db.seed(schema.projects, { ...project, id: 11, code: "P11" });
    db.seed(schema.userRoleAssignments, { id: 4, userId: 7, roleId: 3, projectId: 11, organizationId: null, status: "active" });
    db.seed(schema.departmentBusinessScopes, [scope, { ...scope, id: 21, projectId: 11 }]);
    await caller().masterData.remove({ resource: "department_scope", id: 20 });
    const c = ctx("user"); expect(await getDepartmentModuleDataScope(c, "FINANCE")).toMatchObject({ projectIds: [11], hasAllProjects: false });
    await expect(assertProjectInCurrentScope(c, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("组织级删除继续物理移除、无旧模式恢复；不将项目墓碑语义泛化到组织", async () => {
    db.seed(schema.organizations, { id: 30, code: "ORG30", name: "财务部", type: "department", status: "active" });
    db.seed(schema.systemRoles, { id: 3, code: "FINANCE_MANAGER", status: "active" });
    db.seed(schema.userRoleAssignments, { id: 3, userId: 7, roleId: 3, organizationId: 30, projectId: null, status: "active" });
    db.seed(schema.departmentBusinessScopes, { ...scope, organizationId: 30, projectId: null });
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toContain("FINANCE");
    expect(await caller().masterData.remove({ resource: "department_scope", id: 20 })).toEqual({ success: true, operation: "deleted" });
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toEqual([]);
    expect(db.rows(schema.auditLogs).at(-1).targetId).toBe("organization:30:FINANCE");
  });
  it("归档项目/停用组织仍可办理disabled收回，重新启用必须有效目标", async () => {
    db.seed(schema.departmentBusinessScopes, scope);
    await caller().project.save({ ...projectSave, status: "archived" });
    await expect(caller().department.saveScope({ scopeType: "project", scopeId: 10, module: "FINANCE", status: "disabled" })).resolves.toEqual({ success: true });
    await expect(caller().department.saveScope({ scopeType: "project", scopeId: 10, module: "FINANCE", status: "active", confirmReactivate: true, reason: "项目未恢复不能授权" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    db.seed(schema.organizations, { id: 30, name: "停用财务部", code: "ORG30", type: "department", status: "disabled" });
    await expect(caller().department.saveScope({ scopeType: "organization", scopeId: 30, module: "FINANCE", status: "disabled" })).resolves.toEqual({ success: true });
  });
  it("显式恢复单模块必须确认原因；不会恢复继承或其他模块", async () => {
    db.seed(schema.departmentBusinessScopes, { ...scope, status: "disabled" });
    const input = { scopeType: "project" as const, scopeId: 10, module: "FINANCE" as const, status: "active" as const };
    await expect(caller().department.saveScope(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await caller().department.saveScope({ ...input, expectedStatus: "disabled", confirmReactivate: true, reason: "交接已完成重新授予" });
    expect(db.rows(schema.departmentBusinessScopes)).toHaveLength(1);
    expect(JSON.parse(db.rows(schema.auditLogs).at(-1).beforeJson).snapshot.status).toBe("disabled");
  });
  it("审计失败/零更新回滚收回配置；并发最后配置删除始终留墓碑", async () => {
    db.seed(schema.departmentBusinessScopes, scope); const before = db.snapshot(); db.failInsertTable = "audit_logs";
    await expect(caller().masterData.remove({ resource: "department_scope", id: 20 })).rejects.toThrow("injected"); expect(db.snapshot()).toEqual(before);
    db.failInsertTable = undefined; db.zeroUpdateTable = "department_business_scopes";
    await expect(caller().masterData.remove({ resource: "department_scope", id: 20 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.snapshot()).toEqual(before);
    db.zeroUpdateTable = undefined;
    await Promise.all([caller().masterData.remove({ resource: "department_scope", id: 20 }), caller().masterData.remove({ resource: "department_scope", id: 20 })]);
    expect(db.rows(schema.departmentBusinessScopes)).toHaveLength(1); expect(db.rows(schema.departmentBusinessScopes)[0].status).toBe("disabled");
    expect(db.locks).toContain("projects:update");
  });
  it("并发首次开关使用共同父锁；并发恢复expectedStatus只有一笔成功", async () => {
    const input = { scopeType: "project" as const, scopeId: 10, module: "FINANCE" as const, status: "disabled" as const };
    await Promise.all([caller().department.saveScope(input), caller().department.saveScope(input)]);
    expect(db.rows(schema.departmentBusinessScopes)).toHaveLength(1);
    const results = await Promise.allSettled([caller().department.saveScope({ ...input, status: "active", expectedStatus: "disabled", confirmReactivate: true, reason: "重新启用财务模块" }), caller().department.saveScope({ ...input, status: "active", expectedStatus: "disabled", confirmReactivate: true, reason: "重新启用财务模块" })]);
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});

describe("项目归档恢复的历史与事务", () => {
  it("归档保留业务和授权事实；恢复档案不能暗中恢复旧直接授权", async () => {
    seedRole(); db.seed(schema.departmentBusinessScopes, scope); db.seed(schema.financialRecords, { id: 1, projectId: 10, settlementStatus: "paid", amount: "100.00" });
    await caller().project.save({ ...projectSave, status: "archived", expectedStatus: "active", reason: "本项目业务完成归档" });
    expect(db.rows(schema.userRoleAssignments)[0].status).toBe("revoked"); expect(db.rows(schema.financialRecords)[0].amount).toBe("100.00");
    await expect(caller().project.save(projectSave)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await caller().project.save({ ...projectSave, confirmRestore: true, reason: "批准恢复档案不恢复授权" });
    expect(db.rows(schema.userRoleAssignments)[0].status).toBe("revoked"); expect(db.rows(schema.departmentBusinessScopes)[0].status).toBe("disabled");
    expect((await getCurrentDepartmentAccess(ctx("user"))).moduleCodes).toEqual([]);
    expect(db.rows(schema.auditLogs).at(-1)).toMatchObject({ targetId: "10", action: "restore" });
  });
  it("旧归档尚留active配置与授权的恢复也先收回；audit失败整笔回滚", async () => {
    seedRole(); db.seed(schema.departmentBusinessScopes, scope);
    await db.update(schema.projects).set({ status: "archived" }).where((await import("drizzle-orm")).eq(schema.projects.id, 10));
    const before = db.snapshot(); db.failInsertTable = "audit_logs";
    await expect(caller().project.save({ ...projectSave, confirmRestore: true, reason: "恢复历史归档保留权限边界" })).rejects.toThrow("injected"); expect(db.snapshot()).toEqual(before);
    db.failInsertTable = undefined;
    await caller().project.save({ ...projectSave, confirmRestore: true, reason: "恢复历史归档保留权限边界" });
    expect(db.rows(schema.userRoleAssignments)[0].status).toBe("revoked"); expect(db.rows(schema.departmentBusinessScopes)[0].status).toBe("disabled");
  });
  it("归档不撤销全局SUPER_ADMIN，不改变组织级范围口径", async () => {
    seedRole("SUPER_ADMIN");
    await caller().project.save({ ...projectSave, status: "archived" });
    expect(db.rows(schema.userRoleAssignments)[0].status).toBe("active");
  });
  it("全新配置审计失败回滚插入，跨项目历史不被错误记作本项目引用", async () => {
    db.failInsertTable = "audit_logs";
    await expect(caller().department.saveScope({ scopeType: "project", scopeId: 10, module: "FINANCE", status: "active" })).rejects.toThrow("injected");
    expect(db.rows(schema.departmentBusinessScopes)).toEqual([]);
    db.failInsertTable = undefined;
    db.seed(schema.financialRecords, { id: 3, projectId: 11 });
    expect((await caller().masterData.deletionImpact({ resource: "project", id: 10 })).references).toEqual([]);
  });
  it("项目不存在/状态冲突不虚假成功，档案保存审计失败回滚", async () => {
    await expect(caller().project.save({ ...projectSave, id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().project.save({ ...projectSave, expectedStatus: "archived" })).rejects.toMatchObject({ code: "CONFLICT" });
    const before = db.snapshot(); db.failInsertTable = "audit_logs";
    await expect(caller().project.save({ ...projectSave, name: "不应成功的新名称" })).rejects.toThrow("injected"); expect(db.snapshot()).toEqual(before);
  });
});
