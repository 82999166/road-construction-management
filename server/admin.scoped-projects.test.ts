import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, getCurrentDataScope: vi.fn(), getSuperAdminAccess: vi.fn() };
});

import { getCurrentDataScope, getSuperAdminAccess } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";

function createContext(): TrpcContext {
  return {
    user: {
      id: 41,
      openId: "scoped-project-reader",
      name: "项目范围管理员",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function createProjectListDb(rows: Array<{ id: number; organizationId: number | null; name: string }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(async () => rows),
      })),
    })),
  };
}

describe("admin.project.listAccessible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("普通管理员仅取得直接项目授权和组织范围内项目", async () => {
    vi.mocked(getDb).mockResolvedValue(createProjectListDb([
      { id: 11, organizationId: 7, name: "组织范围项目" },
      { id: 12, organizationId: 8, name: "直接授权项目" },
      { id: 13, organizationId: 9, name: "未授权项目" },
    ]) as never);
    vi.mocked(getSuperAdminAccess).mockResolvedValue({ user: createContext().user!, canAccess: false });
    vi.mocked(getCurrentDataScope).mockResolvedValue({ userId: 41, hasAllProjects: false, projectIds: [12], organizationIds: [7] });

    const result = await adminRouter.createCaller(createContext()).project.listAccessible();

    expect(result.map(project => project.id)).toEqual([11, 12]);
  });

  it("超级管理员仍可取得全量项目，且不查询普通管理员范围", async () => {
    vi.mocked(getDb).mockResolvedValue(createProjectListDb([
      { id: 11, organizationId: 7, name: "项目一" },
      { id: 13, organizationId: 9, name: "项目二" },
    ]) as never);
    vi.mocked(getSuperAdminAccess).mockResolvedValue({ user: createContext().user!, canAccess: true });

    const result = await adminRouter.createCaller(createContext()).project.listAccessible();

    expect(result.map(project => project.id)).toEqual([11, 13]);
    expect(getCurrentDataScope).not.toHaveBeenCalled();
  });
});
