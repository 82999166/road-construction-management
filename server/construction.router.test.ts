import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 施工日报路由测试隔离数据范围与数据库，专注验证项目范围、审计与状态机不可回退边界。 */
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertDepartmentBusinessAccess: vi.fn(),
    assertExistingBusinessRecordChangeAccess: vi.fn(),
    assertProjectInCurrentScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, assertProjectInCurrentScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { constructionRouter } from "./routers/construction";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "construction-test-user",
    email: "construction-test@example.com",
    name: "施工测试人员",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function createSelectDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => rows),
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
  };
}

describe("施工日报 tRPC 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue({ departments: [], moduleCodes: ["CONSTRUCTION"], hasAllDepartments: false });
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
    vi.mocked(assertExistingBusinessRecordChangeAccess).mockResolvedValue(createAuthContext().user!);
  });

  it("施工日报列表在查询前强制校验施工模块权限与项目范围", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);

    await expect(constructionRouter.createCaller(createAuthContext()).listReports({ projectId: 10 })).resolves.toEqual([]);
    expect(vi.mocked(assertDepartmentBusinessAccess)).toHaveBeenCalledWith(expect.anything(), "CONSTRUCTION");
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("新建施工日报由服务端保存项目归属、业务日期和最小化审计记录", async () => {
    const auditValues = vi.fn(async () => undefined);
    const reportValues = vi.fn(() => ({ $returningId: async () => [{ id: 88 }] }));
    const db = {
      insert: vi.fn()
        .mockImplementationOnce(() => ({ values: reportValues }))
        .mockImplementationOnce(() => ({ values: auditValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(constructionRouter.createCaller(createAuthContext()).saveReport({
      projectId: 10,
      reportDate: "2026-07-28",
      workArea: "K12+500 路基填筑作业面",
      weather: "sunny",
      workContent: "完成路基填筑与碾压检测。",
      safetyNotes: null,
      issueNotes: null,
      progressPercent: 35.5,
    })).resolves.toEqual({ id: 88, created: true });

    expect(reportValues).toHaveBeenCalledWith(expect.objectContaining({ projectId: 10, createdBy: 1, progressPercent: "35.5" }));
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "construction", action: "create_daily_report", targetId: "88" }));
  });

  it("已归档施工日报不允许回退，且拒绝发生在写库之前", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ALL", "SUPER_ADMIN"]);
    const db = { ...createSelectDb([{ id: 91, projectId: 10, status: "locked" }]), update: vi.fn(), insert: vi.fn() };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(constructionRouter.createCaller(createAuthContext()).transitionReport({ id: 91, projectId: 10, nextStatus: "draft" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("日报状态条件更新冲突时不追加审计记录", async () => {
    const auditValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => [{ affectedRows: 0 }]);
    const db = {
      ...createSelectDb([{ id: 92, projectId: 10, status: "submitted" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      insert: vi.fn(() => ({ values: auditValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(constructionRouter.createCaller(createAuthContext()).transitionReport({ id: 92, projectId: 10, nextStatus: "approved" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(auditValues).not.toHaveBeenCalled();
  });
});
