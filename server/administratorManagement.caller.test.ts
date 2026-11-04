import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
const mock = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({
  getDb: async () => mock.db,
  getLoginRateLimitState: async () => null,
  recordLoginRateLimitFailure: async () => ({ locked: false }),
  clearLoginRateLimitState: async () => {},
  getLocalManagerByUsername: async (username: string) =>
    mock.db.rows(users).find((row: any) => row.localUsername === username),
  getUserByOpenId: async (openId: string) =>
    mock.db.rows(users).find((row: any) => row.openId === openId),
  upsertUser: async () => {},
}));
vi.mock("./_core/env", () => ({
  ENV: {
    appId: "isolated-test",
    cookieSecret: "isolated-fixture-jwt-secret-never-production",
    oAuthServerUrl: "https://never-request.invalid",
  },
}));
import {
  auditLogs,
  departmentBusinessScopes,
  organizations,
  projects,
  rolePermissions,
  systemPermissions,
  systemRoles,
  userPermissions,
  userProfiles,
  userRoleAssignments,
  users,
} from "../drizzle/schema";
import { administratorManagementRouter } from "./routers/administratorManagement";
import { AdministratorMockDb } from "./services/administratorManagement.mockDb";
import {
  getCurrentDataScope,
  getRoleOperationPermissionDecision,
  getSuperAdminAccess,
} from "./access";
import {
  createLocalManagerPasswordHash,
  loginLocalManager,
  resetTemporaryAdminLoginRateLimitForTests,
} from "./localAuth";
import { publicProcedure, router } from "./_core/trpc";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

const testTime = new Date("2026-11-04T12:00:00Z");
const originalPassword = "OriginalPass2026";
const context = (
  user: any = { id: 1, role: "admin", loginMethod: "temporary_local" }
): TrpcContext => ({
  user,
  req: { protocol: "https", headers: { "user-agent": "test pc" } } as never,
  res: { cookie: vi.fn(), clearCookie: vi.fn() } as never,
});
const caller = (user?: any) =>
  administratorManagementRouter.createCaller(context(user));
const targetUser = (id = 2) =>
  db()
    .rows(users)
    .find(row => row.id === id);
const db = (): AdministratorMockDb => mock.db;
const authRouter = router({
  localManagerLogin: publicProcedure
    .input(z.object({ username: z.string(), password: z.string() }))
    .mutation(({ ctx, input }) => loginLocalManager(ctx, input)),
});
const account = {
  username: " +86 139-0013-9000 ",
  displayName: "新管理员",
  initialPassword: "InitialPass2026",
  status: "active" as const,
  loginMode: "both" as const,
};
const update = {
  userId: 2,
  username: "13800138001",
  displayName: "更新管理员",
  status: "active" as const,
  loginMode: "pc" as const,
};

async function saveInput(
  assignments: any[] = [{ id: 1, roleId: 2, projectId: 10 }],
  permissionIds: number[] = []
) {
  const { revision } = await caller().authorization({ userId: 2 });
  return { userId: 2, revision, assignments, permissionIds };
}

beforeEach(() => {
  resetTemporaryAdminLoginRateLimitForTests();
  mock.db = new AdministratorMockDb();
  db().seed(users, [
    {
      id: 1,
      openId: "super-test",
      name: "正式超管",
      loginMethod: "local_manager",
      role: "admin",
      localUsername: "13800138009",
      localPasswordHash: createLocalManagerPasswordHash(originalPassword),
      localAccountStatus: "active",
      localLoginMode: "both",
    },
    {
      id: 2,
      openId: "local-manager:13800138000",
      name: "普通管理",
      loginMethod: "local_manager",
      role: "user",
      localUsername: "13800138000",
      localPasswordHash: createLocalManagerPasswordHash(originalPassword),
      localAccountStatus: "active",
      localLoginMode: "both",
    },
    {
      id: 3,
      openId: "local-driver:test",
      name: "隔离司机",
      loginMethod: "local_driver",
      role: "user",
      localUsername: "13800138003",
      localAccountStatus: "active",
      localLoginMode: "mobile",
    },
    {
      id: 4,
      openId: "other-manager",
      name: "其他管理",
      loginMethod: "local_manager",
      role: "user",
      localUsername: "13800138004",
      localAccountStatus: "active",
      localLoginMode: "both",
    },
    {
      id: 5,
      openId: "oauth-test",
      name: "OAuth",
      loginMethod: "manus",
      role: "user",
    },
  ]);
  db().seed(userProfiles, {
    id: 1,
    userId: 2,
    status: "active",
    employeeNo: "STABLE-REF",
    organizationId: 7,
    phoneEncrypted: "existing-encrypted",
  });
  db().seed(systemRoles, [
    {
      id: 1,
      code: "SUPER_ADMIN",
      name: "超管",
      category: "system",
      status: "active",
    },
    {
      id: 2,
      code: "CONSTRUCTION_MANAGER",
      name: "施工管理员",
      category: "business",
      status: "active",
    },
    {
      id: 3,
      code: "DRIVER",
      name: "司机",
      category: "business",
      status: "active",
    },
    {
      id: 4,
      code: "LABOR_MANAGER",
      name: "劳资",
      category: "business",
      status: "active",
    },
    {
      id: 5,
      code: "DISABLED_ROLE",
      name: "停用岗位",
      category: "business",
      status: "disabled",
    },
    {
      id: 6,
      code: "SYSTEM_ROLE",
      name: "系统岗位",
      category: "system",
      status: "active",
    },
  ]);
  db().seed(organizations, [
    { id: 7, name: "部门", type: "department", status: "active" },
    { id: 8, name: "公司", type: "company", status: "active" },
    { id: 9, name: "停用部门", type: "project_department", status: "disabled" },
  ]);
  db().seed(projects, [
    { id: 10, name: "范围甲", status: "active", organizationId: 7 },
    { id: 11, name: "归档乙", status: "archived", organizationId: 7 },
    { id: 12, name: "范围丙", status: "active", organizationId: 8 },
  ]);
  db().seed(systemPermissions, [
    {
      id: 1,
      code: "construction:read",
      module: "construction",
      action: "read",
    },
    {
      id: 2,
      code: "construction:edit",
      module: "construction",
      action: "edit",
    },
    { id: 3, code: "labor:read", module: "labor", action: "read" },
    { id: 4, code: "admin:role:manage", module: "admin", action: "manage" },
    { id: 5, code: "driver:read", module: "driver", action: "read" },
    {
      id: 6,
      code: "construction:publish",
      module: "construction",
      action: "publish",
    },
    { id: 7, code: "finance:read", module: "finance", action: "read" },
  ]);
  db().seed(userRoleAssignments, [
    {
      id: 1,
      userId: 2,
      roleId: 2,
      projectId: 10,
      status: "active",
      grantedBy: 1,
    },
    { id: 2, userId: 4, roleId: 2, projectId: 12, status: "active" },
    { id: 3, userId: 2, roleId: 2, projectId: 12, status: "revoked" },
    { id: 4, userId: 2, roleId: 2, projectId: 12, status: "expired" },
  ]);
  db().seed(rolePermissions, [
    { roleId: 2, permissionId: 1 },
    { roleId: 2, permissionId: 2 },
  ]);
});
afterEach(() => db().close());

describe("administratorManagement真实caller隔离回归", () => {
  it("list仅返回local_manager白名单并保留只读super", async () => {
    const rows = await caller().list();
    expect(rows.map(row => row.id).sort()).toEqual([1, 2, 4]);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "id",
        "name",
        "localUsername",
        "localAccountStatus",
        "localLoginMode",
        "role",
        "lastSignedIn",
        "createdAt",
      ].sort()
    );
    expect(rows.some(row => row.role === "admin")).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/scrypt|openId|localPasswordHash/);
  });

  it.each(["ordinary", "driver", "anonymous"])(
    "%s不能读取或写入所有六个API",
    async kind => {
      const actor =
        kind === "anonymous"
          ? null
          : kind === "ordinary"
            ? targetUser()
            : { ...targetUser(3), localLoginMode: "both" };
      const api = caller(actor);
      const code = kind === "anonymous" ? "UNAUTHORIZED" : "FORBIDDEN";
      for (const operation of [
        () => api.list(),
        () => api.create(account),
        () => api.update(update),
        () => api.resetPassword({ userId: 4, newPassword: "NewPassword2026" }),
        () => api.authorization({ userId: 4 }),
        () =>
          api.saveAuthorization({
            userId: 4,
            revision: "0".repeat(64),
            assignments: [],
            permissionIds: [],
          }),
      ]) {
        await expect(operation()).rejects.toMatchObject({ code });
      }
      expect(db().rows(auditLogs)).toEqual([]);
    }
  );

  it("司机历史异常超级角色仍不得跨目标管理账号", async () => {
    db().seed(userRoleAssignments, { userId: 3, roleId: 1, status: "active" });
    const actor = { ...targetUser(3), localLoginMode: "both" };
    await expect(
      caller(actor).resetPassword({ userId: 2, newPassword: "NewPassword2026" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(actor).list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("沿用access允许有效SUPER_ADMIN授权主体但仍不能由此入口任命", async () => {
    db().seed(userRoleAssignments, { userId: 5, roleId: 1, status: "active" });
    expect((await getSuperAdminAccess(context(targetUser(5)))).canAccess).toBe(
      true
    );
    await expect(caller(targetUser(5)).list()).resolves.toHaveLength(3);
    await expect(
      caller(targetUser(5)).saveAuthorization(
        await saveInput([{ id: 1, roleId: 1, projectId: 10 }])
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("创建规范化手机号/scrypt/role=user及profile和审计，无明文凭据", async () => {
    const result = await caller().create(account);
    const created = targetUser(result.userId);
    expect(result).toEqual({ success: true, userId: created.id });
    expect(created).toMatchObject({
      localUsername: "13900139000",
      openId: "local-manager:13900139000",
      role: "user",
      loginMethod: "local_manager",
    });
    expect(created.localPasswordHash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(
      db()
        .rows(userProfiles)
        .find(row => row.userId === created.id)
    ).toMatchObject({ status: "pending" });
    expect(db().rows(auditLogs)).toHaveLength(1);
    expect(JSON.stringify(db().snapshot())).not.toContain(
      account.initialPassword
    );
    expect(JSON.stringify(db().rows(auditLogs))).not.toMatch(
      /scrypt|localPasswordHash|initialPassword/
    );
  });

  it("手机号格式、密码边界、未知role注入由真实输入schema拒绝", async () => {
    for (const patch of [
      { username: "old-name" },
      { initialPassword: "1234567" },
      { initialPassword: "x".repeat(129) },
      { role: "admin" },
    ]) {
      await expect(
        caller().create({ ...account, ...patch } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(db().rows(users)).toHaveLength(5);
  });

  it("重置新密码8至128边界、未知身份字段均拒绝，摘要不改变", async () => {
    const before = targetUser().localPasswordHash;
    for (const newPassword of ["1234567", "x".repeat(129)]) {
      await expect(
        caller().resetPassword({ userId: 2, newPassword })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      caller().update({ ...update, openId: "injected-open-id" } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(targetUser().localPasswordHash).toBe(before);
  });

  it("重复手机号预检、driver占用、唯一索引竞态均友好CONFLICT且不残留", async () => {
    for (const username of [" +86 138-0013-8000 ", "13800138003"])
      await expect(
        caller().create({ ...account, username })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    db().forceDuplicateUser = true;
    await expect(caller().create(account)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db().rows(users)).toHaveLength(5);
    expect(db().rows(auditLogs)).toHaveLength(0);
  });

  it("并发创建同一手机号仅一个成功", async () => {
    const result = await Promise.allSettled([
      caller().create(account),
      caller().create(account),
    ]);
    expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(result.find(row => row.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect(db().rows(auditLogs)).toHaveLength(1);
  });

  it.each(["user_profiles", "audit_logs"])(
    "创建%s写入故障回滚整个事务",
    async failTable => {
      const before = db().snapshot();
      db().failInsertTable = failTable;
      await expect(caller().create(account)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(db().snapshot()).toEqual(before);
    }
  );

  it("更新锁定普通目标，保留openId/userId/profile身份与既有授权", async () => {
    const identity = targetUser().openId;
    const grants = db().rows(userRoleAssignments);
    await expect(caller().update(update)).resolves.toEqual({ success: true });
    expect(targetUser()).toMatchObject({
      id: 2,
      openId: identity,
      localUsername: update.username,
      role: "user",
      localLoginMode: "pc",
    });
    expect(db().rows(userProfiles)[0]).toMatchObject({
      employeeNo: "STABLE-REF",
      phoneEncrypted: "existing-encrypted",
      organizationId: 7,
      status: "active",
    });
    expect(db().rows(userRoleAssignments)).toEqual(grants);
    expect(db().locks).toContain("users:update");
    await expect(
      caller().update({ ...update, username: "13800138004" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("停用/再启用同步profile状态但保留员工主档，缺profile时补映射", async () => {
    await caller().update({ ...update, status: "disabled" });
    expect(db().rows(userProfiles)[0]).toMatchObject({
      status: "disabled",
      employeeNo: "STABLE-REF",
    });
    await expect(caller(targetUser()).list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await caller().update(update);
    expect(db().rows(userProfiles)[0].status).toBe("pending");
    await caller().update({ ...update, userId: 4, username: "13800138004" });
    expect(
      db()
        .rows(userProfiles)
        .find(row => row.userId === 4)
    ).toMatchObject({ status: "pending" });
  });

  it.each([1, 3, 5, 999])(
    "super/driver/OAuth/不存在目标 %s禁止编辑重置与授权",
    async userId => {
      const code = userId === 1 ? "FORBIDDEN" : "NOT_FOUND";
      const before = db().snapshot();
      await expect(
        caller().update({ ...update, userId })
      ).rejects.toMatchObject({ code });
      await expect(
        caller().resetPassword({ userId, newPassword: "NewPassword2026" })
      ).rejects.toMatchObject({ code });
      await expect(caller().authorization({ userId })).rejects.toMatchObject({
        code,
      });
      await expect(
        caller().saveAuthorization({
          userId,
          revision: "0".repeat(64),
          assignments: [],
          permissionIds: [],
        })
      ).rejects.toMatchObject({ code });
      expect(db().snapshot()).toEqual(before);
    }
  );

  it("历史active超级角色账号不得通过普通入口重置或撤销来降权", async () => {
    db().seed(userRoleAssignments, { userId: 2, roleId: 1, status: "active" });
    await expect(
      caller().resetPassword({ userId: 2, newPassword: "NewPassword2026" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().authorization({ userId: 2 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it.each(["update", "resetPassword", "saveAuthorization"])(
    "%s审计失败时回滚账号/授权",
    async action => {
      const input = await saveInput([{ roleId: 2, projectId: 12 }], [1]);
      const before = db().snapshot();
      db().failInsertTable = "audit_logs";
      const operation =
        action === "update"
          ? caller().update(update)
          : action === "resetPassword"
            ? caller().resetPassword({
                userId: 2,
                newPassword: "NewPassword2026",
              })
            : caller().saveAuthorization(input);
      await expect(operation).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(db().snapshot()).toEqual(before);
    }
  );

  it("旧密码真实登录失败、新密码成功；真实旧JWT仍有效准确暴露限制", async () => {
    const oldToken = await sdk.createSessionToken(targetUser().openId, {
      name: "普通管理",
      expiresInMs: 60_000,
    });
    await expect(
      caller().resetPassword({ userId: 2, newPassword: "ChangedPassword2026" })
    ).resolves.toEqual({ success: true });
    const authContext = context(null);
    const authCaller = authRouter.createCaller(authContext);
    await expect(
      authCaller.localManagerLogin({
        username: "13800138000",
        password: originalPassword,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      authCaller.localManagerLogin({
        username: "13800138000",
        password: "ChangedPassword2026",
      })
    ).resolves.toMatchObject({ success: true });
    const authenticated = await sdk.authenticateRequest({
      headers: { cookie: `${COOKIE_NAME}=${oldToken}` },
    } as never);
    expect(authenticated.id).toBe(2);
    expect(JSON.stringify(db().rows(auditLogs))).not.toContain(
      "ChangedPassword2026"
    );
  });

  it("停用账号现有JWT真实sdk认证失败，不借重置session限制绕过停用", async () => {
    const oldToken = await sdk.createSessionToken(targetUser().openId, {
      name: "普通管理",
      expiresInMs: 60_000,
    });
    await caller().update({ ...update, status: "disabled" });
    await expect(
      sdk.authenticateRequest({
        headers: { cookie: `${COOKIE_NAME}=${oldToken}` },
      } as never)
    ).rejects.toThrow("Local manager account is disabled");
  });

  it("authorization白名单保留已到期active授予，排除revoked/expired且revision稳定", async () => {
    db().seed(userRoleAssignments, {
      userId: 2,
      roleId: 2,
      projectId: 12,
      status: "active",
      validFrom: new Date("2020-01-01Z"),
      validTo: new Date("2021-01-01Z"),
    });
    db().seed(userPermissions, { userId: 2, permissionId: 1, grantedBy: 1 });
    const facts = await caller().authorization({ userId: 2 });
    expect(Object.keys(facts).sort()).toEqual([
      "assignments",
      "permissionIds",
      "revision",
    ]);
    expect(facts.assignments).toHaveLength(2);
    expect(Object.keys(facts.assignments[0]).sort()).toEqual(
      [
        "id",
        "roleId",
        "organizationId",
        "projectId",
        "validFrom",
        "validTo",
      ].sort()
    );
    expect(facts.assignments[1].validTo).toBeInstanceOf(Date);
    expect(facts.permissionIds).toEqual([1]);
    expect(facts.revision).toMatch(/^[a-f0-9]{64}$/);
    expect((await caller().authorization({ userId: 2 })).revision).toBe(
      facts.revision
    );
  });

  it("保存撤销未提交active、保留历史，只替换单人权限不影响角色模板或其他人", async () => {
    db().seed(userPermissions, [
      { userId: 2, permissionId: 2 },
      { userId: 4, permissionId: 7 },
    ]);
    const roleTemplate = db().rows(rolePermissions);
    await caller().saveAuthorization(
      await saveInput(
        [
          {
            roleId: 2,
            organizationId: 7,
            projectId: 12,
            validFrom: "2026-01-01T00:00:00+08:00",
            validTo: "2027-01-01T00:00:00+08:00",
          },
        ],
        [1, 1]
      )
    );
    expect(
      db()
        .rows(userRoleAssignments)
        .find(row => row.id === 1).status
    ).toBe("revoked");
    expect(
      db()
        .rows(userRoleAssignments)
        .find(row => row.id === 3).status
    ).toBe("revoked");
    expect(
      db()
        .rows(userRoleAssignments)
        .find(row => row.id === 4).status
    ).toBe("expired");
    const facts = await caller().authorization({ userId: 2 });
    expect(facts.assignments).toHaveLength(1);
    expect(facts.assignments[0]).toMatchObject({
      organizationId: null,
      projectId: 12,
    });
    expect(facts.permissionIds).toEqual([1]);
    expect(
      db()
        .rows(userPermissions)
        .find(row => row.userId === 4)
    ).toMatchObject({ permissionId: 7 });
    expect(db().rows(rolePermissions)).toEqual(roleTemplate);
    expect(db().rows(auditLogs)[0]).toMatchObject({
      action: "save_administrator_authorization",
      userId: 1,
    });
  });

  it("保留id编辑原active授予及有效期，不误生成新授予或改变其他历史", async () => {
    await caller().saveAuthorization(
      await saveInput([
        {
          id: 1,
          roleId: 2,
          organizationId: 7,
          validFrom: "2026-01-01T00:00:00Z",
          validTo: "2027-01-01T00:00:00Z",
        },
      ])
    );
    expect(db().rows(userRoleAssignments)).toHaveLength(4);
    expect(
      db()
        .rows(userRoleAssignments)
        .find(row => row.id === 1)
    ).toMatchObject({
      userId: 2,
      organizationId: 7,
      projectId: null,
      status: "active",
      grantedBy: 1,
    });
    expect(
      (await caller().authorization({ userId: 2 })).assignments[0].validTo
    ).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it.each([
    { assignments: [{ id: 2, roleId: 2, projectId: 10 }], label: "他人记录" },
    {
      assignments: [{ id: 3, roleId: 2, projectId: 10 }],
      label: "revoked记录",
    },
    {
      assignments: [{ id: 4, roleId: 2, projectId: 10 }],
      label: "expired记录",
    },
    {
      assignments: [
        { id: 1, roleId: 2, projectId: 10 },
        { id: 1, roleId: 2, projectId: 12 },
      ],
      label: "重复id",
    },
    { assignments: [{ roleId: 99, projectId: 10 }], label: "不存在角色" },
    { assignments: [{ roleId: 5, projectId: 10 }], label: "停用角色" },
    { assignments: [{ roleId: 6, projectId: 10 }], label: "系统角色" },
    { assignments: [{ roleId: 3, projectId: 10 }], label: "司机角色" },
    { assignments: [{ roleId: 2 }], label: "空范围" },
    { assignments: [{ roleId: 2, organizationId: 8 }], label: "company组织" },
    { assignments: [{ roleId: 2, organizationId: 9 }], label: "停用部门" },
    { assignments: [{ roleId: 2, organizationId: 999 }], label: "不存在部门" },
    { assignments: [{ roleId: 2, projectId: 11 }], label: "归档项目" },
    { assignments: [{ roleId: 2, projectId: 999 }], label: "不存在项目" },
    {
      assignments: [
        {
          roleId: 2,
          projectId: 10,
          validFrom: "2027-01-01T00:00:00Z",
          validTo: "2026-01-01T00:00:00Z",
        },
      ],
      label: "倒置有效期",
    },
    {
      assignments: [{ roleId: 2, projectId: 10, validFrom: "not-date" }],
      label: "无效日期",
    },
    {
      assignments: [
        { roleId: 2, projectId: 10 },
        { roleId: 2, projectId: 10 },
      ],
      label: "重复范围",
    },
  ])("拒绝$label且无部分更新", async ({ assignments }) => {
    const input = await saveInput(assignments);
    const before = db().snapshot();
    await expect(caller().saveAuthorization(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(db().snapshot()).toEqual(before);
  });

  it("允许劳务岗位与真实labor动作，仅维护授权、不自动授予财务", async () => {
    await expect(
      caller().saveAuthorization(
        await saveInput([{ roleId: 4, projectId: 10 }], [3])
      )
    ).resolves.toEqual({ success: true });
    const facts = await caller().authorization({ userId: 2 });
    expect(facts.assignments[0]).toMatchObject({ roleId: 4, projectId: 10 });
    expect(facts.permissionIds).toEqual([3]);
    expect(facts.permissionIds).not.toContain(7);
    expect(
      (
        await getRoleOperationPermissionDecision(
          context(targetUser()),
          "LABOR",
          "read"
        )
      ).allowed
    ).toBe(true);
    expect(
      (
        await getRoleOperationPermissionDecision(
          context(targetUser()),
          "LABOR",
          "edit"
        )
      ).allowed
    ).toBe(false);
    expect(
      db()
        .snapshot()
        .every(([name]) => !String(name).includes("payroll"))
    ).toBe(true);
  });

  it.each([4, 5, 6, 999])("拒绝不适用permissionId=%s", async permissionId => {
    await expect(
      caller().saveAuthorization(await saveInput(undefined, [permissionId]))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db().rows(auditLogs)).toEqual([]);
  });

  it("disabled目标可读授权但不可保存，权限不能脱离范围", async () => {
    await expect(
      caller().saveAuthorization(await saveInput([], [1]))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller().update({ ...update, status: "disabled" });
    const facts = await caller().authorization({ userId: 2 });
    await expect(
      caller().saveAuthorization({ userId: 2, ...facts, assignments: [] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("revision双并发仅一成功；空到空保存也不能重复旧revision", async () => {
    const input = await saveInput([], []);
    const results = await Promise.allSettled([
      caller().saveAuthorization(input),
      caller().saveAuthorization(input),
    ]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find(row => row.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    const emptyInput = await saveInput([], []);
    await caller().saveAuthorization(emptyInput);
    await expect(caller().saveAuthorization(emptyInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db().rows(auditLogs)).toHaveLength(2);
  });

  it("认证刷新lastSignedIn/updatedAt不会把授权编辑误判为冲突", async () => {
    const input = await saveInput();
    await db()
      .update(users)
      .set({
        lastSignedIn: new Date("2026-11-04T12:10:00Z"),
        updatedAt: new Date("2026-11-04T12:10:00Z"),
      })
      .where(eq(users.id, 2));
    expect((await caller().authorization({ userId: 2 })).revision).toBe(
      input.revision
    );
    await expect(caller().saveAuthorization(input)).resolves.toEqual({
      success: true,
    });
  });

  it("revision覆盖历史事实变更，过时版本不覆盖外部授权", async () => {
    const input = await saveInput();
    db().seed(userPermissions, { userId: 2, permissionId: 7 });
    await expect(caller().saveAuthorization(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db().rows(userPermissions)).toHaveLength(1);
  });

  it("真实access权限继承：专属覆盖单模块，清空回退岗位；无范围不扩全库", async () => {
    const managerContext = () => context(targetUser());
    expect(
      await getRoleOperationPermissionDecision(
        managerContext(),
        "CONSTRUCTION",
        "edit"
      )
    ).toEqual({ allowed: true, hasDetailedPermissions: true });
    await caller().saveAuthorization(await saveInput(undefined, [1]));
    expect(
      await getRoleOperationPermissionDecision(
        managerContext(),
        "CONSTRUCTION",
        "edit"
      )
    ).toEqual({ allowed: false, hasDetailedPermissions: true });
    await caller().saveAuthorization(await saveInput(undefined, []));
    expect(
      await getRoleOperationPermissionDecision(
        managerContext(),
        "CONSTRUCTION",
        "edit"
      )
    ).toEqual({ allowed: true, hasDetailedPermissions: true });
    expect(await getCurrentDataScope(managerContext())).toMatchObject({
      hasAllProjects: false,
      projectIds: [10],
    });
    await caller().saveAuthorization(await saveInput([], []));
    expect(await getCurrentDataScope(managerContext())).toEqual({
      userId: 2,
      hasAllProjects: false,
      projectIds: [],
      organizationIds: [],
    });
    expect(db().rows(rolePermissions)).toHaveLength(2);
  });
});
