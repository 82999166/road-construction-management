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
import { contractRouter } from "./routers/contracts";

function createAuthContext(): TrpcContext {
  return {
    user: { id: 1, openId: "contract-test", email: "contract@test.local", name: "合同测试人员", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
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
});
