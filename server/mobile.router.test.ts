import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { mockGetCurrentDataScope, mockGetCurrentDepartmentAccess, mockGetCurrentUserSpecificMenuModules, mockGetEffectiveRoleCodes, mockGetRoleOperationPermissionDecision } = vi.hoisted(() => ({
  mockGetCurrentDataScope: vi.fn(),
  mockGetCurrentDepartmentAccess: vi.fn().mockResolvedValue({ departments: [], moduleCodes: [], hasAllDepartments: true }),
  mockGetCurrentUserSpecificMenuModules: vi.fn().mockResolvedValue([]),
  mockGetEffectiveRoleCodes: vi.fn(),
  mockGetRoleOperationPermissionDecision: vi.fn().mockResolvedValue({ hasDetailedPermissions: false, allowed: false }),
}));

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    getCurrentDataScope: mockGetCurrentDataScope,
    getCurrentDepartmentAccess: mockGetCurrentDepartmentAccess,
    getCurrentUserSpecificMenuModules: mockGetCurrentUserSpecificMenuModules,
    getEffectiveRoleCodes: mockGetEffectiveRoleCodes,
    getRoleOperationPermissionDecision: mockGetRoleOperationPermissionDecision,
  };
});

import { getDb } from "./db";
import { mobileRouter } from "./routers/mobile";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 为移动工作台构造最小认证上下文，避免测试依赖真实 OAuth 会话或数据库用户。 */
function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 7,
    openId: "mobile-workbench-test-user",
    email: "mobile-workbench-test@example.com",
    name: "移动工作台测试人员",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 按调用顺序返回 Drizzle 查询结果，验证统计查询不跳过项目范围和岗位类别。 */
function createSelectDbSequence(...responses: unknown[][]) {
  let queryIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => responses[queryIndex++] ?? []),
      })),
    })),
  };
}

describe("移动工作台 tRPC 路由", () => {
  it("仅汇总当前项目范围内且当前岗位可见的真实待办、运输与工资记录", async () => {
    mockGetEffectiveRoleCodes.mockResolvedValue(["FINANCE_MANAGER"]);
    mockGetCurrentDataScope.mockResolvedValue({ userId: 7, hasAllProjects: false, projectIds: [88], organizationIds: [] });
    const db = createSelectDbSequence(
      [{ id: 1 }],
      [{ id: 11 }],
      [{ id: 21 }, { id: 22 }],
      [{ id: 31 }],
      [{ id: 41 }, { id: 42 }, { id: 43 }],
      [{ id: 51 }],
    );
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await mobileRouter.createCaller(createAuthContext()).workbench();

    expect(result.statistics).toEqual({ pendingApprovals: 4, unreadMessages: 1, todayTrips: 3, pendingPayroll: 1 });
    expect(db.select).toHaveBeenCalledTimes(6);
    expect(result.menus.some(menu => menu.code === "FINANCE")).toBe(true);
  });

  it("没有任何项目授权时不读取业务单据，仅返回站内未读数", async () => {
    mockGetEffectiveRoleCodes.mockResolvedValue(["FINANCE_MANAGER"]);
    mockGetCurrentDataScope.mockResolvedValue({ userId: 7, hasAllProjects: false, projectIds: [], organizationIds: [] });
    const db = createSelectDbSequence([{ id: 1 }, { id: 2 }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await mobileRouter.createCaller(createAuthContext()).workbench();

    expect(result.statistics).toEqual({ pendingApprovals: 0, unreadMessages: 2, todayTrips: 0, pendingPayroll: 0 });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("移动菜单必须同时满足岗位与部门业务范围，不能因拥有财务岗位而越过劳务部门授权", async () => {
    mockGetEffectiveRoleCodes.mockResolvedValue(["LABOR_MANAGER", "FINANCE_MANAGER"]);
    mockGetCurrentDataScope.mockResolvedValue({ userId: 7, hasAllProjects: false, projectIds: [], organizationIds: [] });
    mockGetCurrentDepartmentAccess.mockResolvedValueOnce({
      departments: [{ id: 31, name: "劳务管理部", type: "department" }],
      moduleCodes: ["LABOR"],
      hasAllDepartments: false,
    });
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([{ id: 1 }]) as never);

    const result = await mobileRouter.createCaller(createAuthContext()).workbench();

    expect(result.user.departments).toEqual([{ id: 31, name: "劳务管理部", type: "department" }]);
    expect(result.menus.some(menu => menu.code === "LABOR")).toBe(true);
    expect(result.menus.some(menu => menu.code === "FINANCE")).toBe(false);
  });

  it("项目范围内的用户专属查看权限应补充业务菜单，但不把未授权部门模块一并开放", async () => {
    mockGetEffectiveRoleCodes.mockResolvedValue(["MACHINERY_MANAGER"]);
    mockGetCurrentDataScope.mockResolvedValue({ userId: 7, hasAllProjects: false, projectIds: [88], organizationIds: [] });
    mockGetCurrentDepartmentAccess.mockResolvedValueOnce({ departments: [], moduleCodes: ["MACHINERY", "CONSTRUCTION"], hasAllDepartments: false });
    mockGetCurrentUserSpecificMenuModules.mockResolvedValueOnce(["CONSTRUCTION"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([{ id: 1 }]) as never);

    const result = await mobileRouter.createCaller(createAuthContext()).workbench();

    expect(result.user.userSpecificModules).toEqual(["CONSTRUCTION"]);
    expect(result.menus.some(menu => menu.code === "CONSTRUCTION")).toBe(true);
    expect(result.menus.some(menu => menu.code === "TRANSPORT")).toBe(false);
  });

  it("已授予柴油查看细分权限时，移动工作台必须返回柴油管理入口", async () => {
    mockGetEffectiveRoleCodes.mockResolvedValue(["MACHINERY_MANAGER"]);
    mockGetCurrentDataScope.mockResolvedValue({ userId: 7, hasAllProjects: false, projectIds: [88], organizationIds: [] });
    mockGetCurrentDepartmentAccess.mockResolvedValueOnce({ departments: [], moduleCodes: ["MACHINERY"], hasAllDepartments: false });
    mockGetRoleOperationPermissionDecision.mockResolvedValueOnce({ hasDetailedPermissions: true, allowed: true }).mockResolvedValueOnce({ hasDetailedPermissions: true, allowed: false });
    vi.mocked(getDb).mockResolvedValue(createSelectDbSequence([{ id: 1 }]) as never);

    const result = await mobileRouter.createCaller(createAuthContext()).workbench();

    expect(result.menus.some(menu => menu.code === "DIESEL" && menu.title === "柴油管理")).toBe(true);
  });
});
