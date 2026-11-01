import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, assertSuperAdmin, getCurrentDataScope, getCurrentDepartmentAccess, getDepartmentModuleDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, getSuperAdminAccess, isRoleOperationGranted } from "./access";
import { getDb } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: "admin" | "user" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 7,
    openId: "access-guard-user",
    email: "access-guard@example.com",
    name: "权限测试人员",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 轻量模拟 Drizzle 查询链，按业务查询顺序返回指定行。 */
function createSelectDbSequence(...responses: unknown[][]) {
  let index = 0;
  const next = () => responses[index++] ?? [];
  const result = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {
    limit: vi.fn(async () => rows),
  });
  const queryChain = (fields?: Record<string, unknown>) => ({
    innerJoin: vi.fn(() => queryChain(fields)),
    where: vi.fn(() => result(fields && "action" in fields ? [] : next())),
  });
  return {
    select: vi.fn((fields?: Record<string, unknown>) => ({
      from: vi.fn(() => queryChain(fields)),
    })),
  };
}

describe("后台与项目范围访问控制", () => {
  beforeEach(() => vi.clearAllMocks());

  it("模板管理员直接具备后台访问与全部项目范围，不依赖前端菜单", async () => {
    const ctx = createContext("admin");

    await expect(getSuperAdminAccess(ctx)).resolves.toMatchObject({ canAccess: true });
    await expect(getEffectiveRoleCodes(ctx)).resolves.toEqual(["ALL", "SUPER_ADMIN"]);
    await expect(getCurrentDataScope(ctx)).resolves.toMatchObject({ hasAllProjects: true, projectIds: [] });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("普通管理人员即使猜到全局治理路由也会被服务端拒绝", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([]) as never);

    await expect(assertSuperAdmin(createContext())).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "仅超级管理员可访问 PC 管理后台",
    });
  });

  it("普通账号的有效业务角色由服务端授权记录返回，未配置时不能伪装获得菜单权限", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([]) as never);

    await expect(getEffectiveRoleCodes(createContext())).resolves.toEqual([]);
  });

  it("无项目或组织范围的普通账号被拒绝访问业务项目", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([]) as never);

    await expect(assertProjectInCurrentScope(createContext(), 101)).rejects.toMatchObject({ code: "FORBIDDEN", message: "当前账号未获授权访问该项目数据" });
  });

  it("有效组织范围可覆盖其直属项目，但不能将空项目范围解释为全量访问", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [],
      [{ projectId: null, organizationId: 88, roleCode: "PROJECT_MANAGER", module: "CONSTRUCTION" }],
      [],
      [{ organizationId: 88 }],
    ) as never);

    await expect(assertProjectInCurrentScope(createContext(), 101)).resolves.toMatchObject({ organizationIds: [88], hasAllProjects: false });
  });

  it("部门成员只能获得其已启用部门业务模块，不会因单独角色记录获得跨部门入口", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([], [
      { organizationId: 31, organizationName: "劳务管理部", organizationType: "department", roleCode: "LABOR_MANAGER", module: "LABOR" },
      { organizationId: 31, organizationName: "劳务管理部", organizationType: "department", roleCode: "LABOR_MANAGER", module: "EVIDENCE" },
    ]) as never);

    await expect(getCurrentDepartmentAccess(createContext())).resolves.toEqual({
      departments: [{ id: 31, name: "劳务管理部", type: "department" }],
      moduleCodes: ["LABOR", "EVIDENCE"],
      hasAllDepartments: false,
    });
  });

  it("部门未启用的财务模块即使拥有登录会话也被服务端拒绝", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([], [
      { organizationId: 31, organizationName: "劳务管理部", organizationType: "department", roleCode: "LABOR_MANAGER", module: "LABOR" },
    ]) as never);

    await expect(assertDepartmentBusinessAccess(createContext(), "FINANCE")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前账号所属部门未获授权办理“财务成本”业务",
    });
  });

  it("历史角色未配置详细操作权限时保持既有业务授权，配置后仅允许勾选的操作", async () => {
    expect(isRoleOperationGranted([], "create")).toBe(true);
    expect(isRoleOperationGranted(["read"], "read")).toBe(true);
    expect(isRoleOperationGranted(["read"], "create")).toBe(false);
    expect(isRoleOperationGranted(["manage"], "settle")).toBe(true);
  });

  it("已配置劳务模块详细权限的角色不能绕过未勾选的新增动作", async () => {
    let permissionQueryCount = 0;
    const db = {
      select: vi.fn((fields?: Record<string, unknown>) => {
        const rows = fields && "action" in fields ? permissionQueryCount++ === 0 ? [] : [{ action: "read" }] : [];
        const result = Object.assign(Promise.resolve(rows), { limit: vi.fn(async () => rows) });
        const chain = { innerJoin: vi.fn(), where: vi.fn(() => result) };
        chain.innerJoin.mockReturnValue(chain);
        return { from: vi.fn(() => chain) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(getRoleOperationPermissionDecision(createContext(), "LABOR", "create")).resolves.toEqual({ hasDetailedPermissions: true, allowed: false });
  });

  it("用户专属权限在已配置模块覆盖角色矩阵，可单独授予审核并拒绝未勾选的新增", async () => {
    let permissionQueryCount = 0;
    const db = {
      select: vi.fn((fields?: Record<string, unknown>) => {
        const rows = fields && "action" in fields ? (permissionQueryCount++, [{ action: "review" }]) : [];
        const result = Object.assign(Promise.resolve(rows), { limit: vi.fn(async () => rows) });
        const chain = { innerJoin: vi.fn(), where: vi.fn(() => result) };
        chain.innerJoin.mockReturnValue(chain);
        return { from: vi.fn(() => chain) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(getRoleOperationPermissionDecision(createContext(), "LABOR", "review")).resolves.toEqual({ hasDetailedPermissions: true, allowed: true });
    await expect(getRoleOperationPermissionDecision(createContext(), "LABOR", "create")).resolves.toEqual({ hasDetailedPermissions: true, allowed: false });
    expect(permissionQueryCount).toBe(2);
  });

  it("部门业务范围只返回该部门授权的项目，不能扩大为所有项目", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [],
      [{ organizationId: 31, organizationName: "劳务管理部", organizationType: "department", roleCode: "LABOR_MANAGER", module: "LABOR" }],
      [],
      [],
      [{ projectId: 101, organizationId: 31, roleCode: "LABOR_MANAGER", module: "LABOR" }],
    ) as never);

    await expect(getDepartmentModuleDataScope(createContext(), "LABOR")).resolves.toMatchObject({
      hasAllProjects: false,
      projectIds: [101],
      organizationIds: [31],
    });
  });

  it("部门业务上下文生效后，跨部门项目即使猜到项目编号也会被拒绝", async () => {
    const ctx = createContext();
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [],
      [{ organizationId: 31, organizationName: "劳务管理部", organizationType: "department", roleCode: "LABOR_MANAGER", module: "LABOR" }],
      [],
      [],
    ) as never);

    await expect(assertDepartmentBusinessAccess(ctx, "LABOR")).resolves.toMatchObject({ moduleCodes: ["LABOR"] });
    await expect(assertProjectInCurrentScope(ctx, 999)).rejects.toMatchObject({ code: "FORBIDDEN", message: "当前账号未获授权访问该项目数据" });
  });

  it("多个部门与岗位并存时，财务模块不能借用劳务岗位在另一部门的项目范围", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [],
      [
        { organizationId: 31, organizationName: "劳务管理部", organizationType: "department", roleCode: "LABOR_MANAGER", module: "LABOR" },
        { organizationId: 41, organizationName: "财务管理部", organizationType: "department", roleCode: "FINANCE_MANAGER", module: "FINANCE" },
      ],
      [],
      [],
      [
        { projectId: 101, organizationId: 31, roleCode: "LABOR_MANAGER", module: "FINANCE" },
        { projectId: 202, organizationId: 41, roleCode: "FINANCE_MANAGER", module: "FINANCE" },
      ],
    ) as never);

    await expect(getDepartmentModuleDataScope(createContext(), "FINANCE")).resolves.toMatchObject({ projectIds: [202], organizationIds: [41] });
  });

  it("项目级业务角色授权仅投影角色可办理模块且严格限制到被选项目", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [],
      [],
      [{ projectId: 101, roleCode: "LOGISTICS_MANAGER" }],
    ) as never);

    await expect(getCurrentDepartmentAccess(createContext())).resolves.toEqual({
      departments: [],
      moduleCodes: ["PURCHASING", "EVIDENCE"],
      hasAllDepartments: false,
    });

    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence(
      [],
      [],
      [{ projectId: 101, roleCode: "LOGISTICS_MANAGER" }],
      [],
      [],
      [],
      [{ projectId: 101, roleCode: "LOGISTICS_MANAGER" }],
      [],
      [],
      [],
    ) as never);

    await expect(getDepartmentModuleDataScope(createContext(), "PURCHASING")).resolves.toMatchObject({
      hasAllProjects: false,
      projectIds: [101],
      organizationIds: [],
    });
  });

  it("项目菜单白名单只能收紧已有项目角色授权，不能漏出旧模块或向项目增加新模块", async () => {
    const result = (rows: unknown[]) =>
      Object.assign(Promise.resolve(rows), { limit: vi.fn(async () => rows) });
    const db = {
      select: vi.fn((fields?: Record<string, unknown>) => {
        let rows: unknown[] = [];
        if (fields && "roleId" in fields && "projectId" in fields) {
          rows = [{ projectId: 101, roleId: 9, roleCode: "LOGISTICS_MANAGER" }];
        } else if (
          fields &&
          "projectId" in fields &&
          "module" in fields &&
          "status" in fields &&
          !("organizationName" in fields)
        ) {
          rows = [
            { projectId: 101, module: "PURCHASING", status: "disabled" },
            { projectId: 101, module: "CONSTRUCTION", status: "active" },
          ];
        }
        const chain = { innerJoin: vi.fn(), where: vi.fn(() => result(rows)) };
        chain.innerJoin.mockReturnValue(chain);
        return { from: vi.fn(() => chain) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(getCurrentDepartmentAccess(createContext())).resolves.toEqual({
      departments: [],
      moduleCodes: [],
      hasAllDepartments: false,
    });
    await expect(assertDepartmentBusinessAccess(createContext(), "PURCHASING")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前账号所属部门未获授权办理“采购仓储”业务",
    });
  });

  it("角色细分查看权限可在既有项目范围内补充非标准业务模块，不再被旧菜单角色白名单拦截", async () => {
    const result = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { limit: vi.fn(async () => rows) });
    const db = {
      select: vi.fn((fields?: Record<string, unknown>) => {
        let rows: unknown[] = [];
        if (fields && "permissionModule" in fields) rows = [{ roleCode: "LOGISTICS_MANAGER", permissionModule: "contract", action: "read" }];
        else if (fields && "projectId" in fields && "roleId" in fields && !("module" in fields)) rows = [{ projectId: 101, roleId: 9, roleCode: "LOGISTICS_MANAGER" }];
        const chain = { innerJoin: vi.fn(), where: vi.fn(() => result(rows)) };
        chain.innerJoin.mockReturnValue(chain);
        return { from: vi.fn(() => chain) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(getCurrentDepartmentAccess(createContext())).resolves.toEqual({
      departments: [],
      moduleCodes: ["PURCHASING", "EVIDENCE", "CONTRACT"],
      hasAllDepartments: false,
    });
  });

});
