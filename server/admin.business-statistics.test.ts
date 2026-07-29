import type { TrpcContext } from "./_core/context";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});
vi.mock("./services/adminBusinessBackup", () => ({
  createBusinessDataBackup: vi.fn(),
  getBusinessDataBackupDownload: vi.fn(),
  getBusinessModuleStatistics: vi.fn(),
  listBusinessDataBackups: vi.fn(),
}));

import { assertSuperAdmin } from "./access";
import { adminRouter } from "./routers/admin";
import { getBusinessModuleStatistics } from "./services/adminBusinessBackup";

function createAdminContext(): TrpcContext {
  const user = {
    id: 1,
    openId: "statistics-admin",
    email: "admin@example.com",
    name: "统计管理员",
    loginMethod: "manus" as const,
    role: "admin" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("超级管理业务统计筛选", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
    vi.mocked(getBusinessModuleStatistics).mockResolvedValue([]);
  });

  it("将已校验的项目和自然月筛选交给受控统计服务", async () => {
    await expect(adminRouter.createCaller(createAdminContext()).business.statistics({ projectId: 27, period: "2026-07" })).resolves.toEqual([]);
    expect(getBusinessModuleStatistics).toHaveBeenCalledWith({ projectId: 27, period: "2026-07" });
  });

  it("拒绝非法期间，避免模糊日期直接进入聚合查询", async () => {
    await expect(adminRouter.createCaller(createAdminContext()).business.statistics({ period: "2026-7" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getBusinessModuleStatistics).not.toHaveBeenCalled();
  });
});
