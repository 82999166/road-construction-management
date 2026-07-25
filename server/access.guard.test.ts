import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, getSuperAdminAccess } from "./access";
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
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => result(next())),
        })),
        where: vi.fn(() => result(next())),
      })),
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
      [{ projectId: null, organizationId: 88 }],
      [{ organizationId: 88 }],
    ) as never);

    await expect(assertProjectInCurrentScope(createContext(), 101)).resolves.toMatchObject({ organizationIds: [88], hasAllProjects: false });
  });
});
