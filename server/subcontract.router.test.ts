import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertDepartmentBusinessAccess: vi.fn(),
    assertProjectInCurrentScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { getEffectiveRoleCodes } from "./access";
import { subcontractRouter } from "./routers/subcontract";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 构造最小登录上下文，避免分包路由测试依赖真实账号或 OAuth 会话。 */
function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "subcontract-test-user",
    email: "subcontract-test@example.com",
    name: "分包测试人员",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("工程结算与分包路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("按职责分离投影分包草稿、复核确认和最终结算能力", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: true, canConfirm: false, canSettle: false });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MEASUREMENT_MANAGER"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: false, canConfirm: true, canSettle: false });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: false, canConfirm: false, canSettle: true });
  });
});
