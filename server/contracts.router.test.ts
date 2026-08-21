import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertDepartmentBusinessAccess: vi.fn(),
    assertRoleOperationPermission: vi.fn(),
    assertProjectInCurrentScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { assertDepartmentBusinessAccess, assertRoleOperationPermission, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { contractRouter } from "./routers/contracts";

function createAuthContext(): TrpcContext {
  return {
    user: { id: 1, openId: "contract-test", email: "contract@test.local", name: "合同测试人员", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function createSelectDb(...responses: unknown[][]) {
  let index = 0;
  return {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => responses[index++] ?? []), orderBy: vi.fn(async () => responses[index++] ?? []) })) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => [{ affectedRows: 1 }]) })) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  };
}

describe("外包合同统一权限守卫", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertRoleOperationPermission).mockResolvedValue({ hasDetailedPermissions: false, allowed: true });
  });

  it("读取合同能力时同时要求合同部门范围与查看操作权限", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["PROJECT_MANAGER"]);
    await expect(contractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintain: true, canClose: true });
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(expect.anything(), "CONTRACT");
    expect(assertRoleOperationPermission).toHaveBeenCalledWith(expect.anything(), "CONTRACT", "read");
  });

  it("岗位职责继续区分合同维护与最终关闭能力", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    await expect(contractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintain: true, canClose: false });
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    await expect(contractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintain: false, canClose: true });
  });

  it("用户专属合同详细权限可授予非标准岗位进入合同模块", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["LOGISTICS_MANAGER"]);
    vi.mocked(assertRoleOperationPermission).mockResolvedValue({ hasDetailedPermissions: true, allowed: true });
    await expect(contractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintain: false, canClose: false });
  });

  it("禁止登记结束日期早于开始日期的合同草稿", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["PROJECT_MANAGER"]);
    await expect(contractRouter.createCaller(createAuthContext()).save({ projectId: 10, contractType: "transport", counterpartyName: "运输队", pricingMethod: "trip", contractAmount: 1000, startDate: "2026-08-22", endDate: "2026-08-21" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("结束日期") });
  });

  it("合同关闭仅限项目或财务关闭职责，关闭后不允许再次作废或变更状态", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["TRANSPORT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 5, projectId: 10, status: "active" }]) as never);
    await expect(contractRouter.createCaller(createAuthContext()).transition({ id: 5, projectId: 10, targetStatus: "closed" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("关闭") });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ALL"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 6, projectId: 10, status: "closed" }]) as never);
    await expect(contractRouter.createCaller(createAuthContext()).transition({ id: 6, projectId: 10, targetStatus: "void" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("不允许") });
  });

  it("非草稿或非暂停合同内容受锁定，防止执行中合同被直接改写", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["PROJECT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{ id: 7, projectId: 10, status: "active" }]) as never);
    await expect(contractRouter.createCaller(createAuthContext()).save({ id: 7, projectId: 10, contractType: "transport", counterpartyName: "运输队", pricingMethod: "trip", contractAmount: 1000 })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("仅草稿或已暂停") });
  });
});
