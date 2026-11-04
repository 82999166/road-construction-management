import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: vi.fn(),
  assertProjectInCurrentScope: vi.fn(),
  getEffectiveRoleCodes: vi.fn(),
  getSuperAdminAccess: vi.fn(),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: vi.fn(),
}));
vi.mock("./routers/messages", () => ({ createInAppMessage: vi.fn() }));
import { getDb } from "./db";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
  getSuperAdminAccess,
} from "./access";
import { constructionRouter } from "./routers/construction";
import { TRPCError } from "@trpc/server";
const context = {
  user: { id: 1, role: "user", loginMethod: "manus" },
  req: {},
  res: {},
} as TrpcContext;
function record(id: number) {
  return {
    id,
    projectId: 10,
    status: "submitted",
    createdBy: 1,
    createdByName: "甲",
    reviewedBy: 2,
    reviewedByName: "乙",
    reportDate: new Date(),
    progressPercent: "25.5",
    workArea: "工区",
    workContent: "施工内容",
    issueNotes: "现场问题",
    safetyNotes: "",
    reviewReply: null,
  };
}
function selectDb(rows: unknown[]) {
  const predicates: Array<ReturnType<MySqlDialect["sqlToQuery"]>> = [];
  const projections: unknown[] = [];
  const terminal: any = {
    orderBy: vi.fn(() => terminal),
    limit: vi.fn(() => terminal),
    then: (resolve: any) => Promise.resolve(rows).then(resolve),
  };
  const where = vi.fn((predicate: SQL) => {
    predicates.push(new MySqlDialect().sqlToQuery(predicate));
    return terminal;
  });
  const base: any = { where, leftJoin: vi.fn(() => base) };
  return {
    db: {
      select: vi.fn((projection: unknown) => {
        projections.push(projection);
        return { from: vi.fn(() => base) };
      }),
    },
    predicates,
    projections,
    limit: terminal.limit,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue({
    departments: [],
    moduleCodes: ["CONSTRUCTION"],
    hasAllDepartments: false,
  });
  vi.mocked(assertProjectInCurrentScope).mockResolvedValue();
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
  vi.mocked(getSuperAdminAccess).mockResolvedValue({
    user: context.user!,
    canAccess: false,
  });
});
describe("施工工作区服务端统一筛选与授权", () => {
  it("列表/统计/打印/导出/清单使用完全一致的SQL谓词（含状态、问题scope、回复关键词）", async () => {
    const mock = selectDb([record(1)]);
    vi.mocked(getDb).mockResolvedValue(mock.db as never);
    const caller = constructionRouter.createCaller(context);
    const filter = {
      projectId: 10,
      scope: "issues" as const,
      status: "submitted" as const,
      issueScope: "unreplied" as const,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      createdBy: 1,
      keyword: "%_\\整改",
    };
    await caller.listReports(filter);
    await caller.summary(filter);
    await caller.printReports(filter);
    await caller.exportReports(filter);
    await caller.outputManifest({ ...filter, action: "export" });
    expect(mock.predicates).toHaveLength(5);
    for (const predicate of mock.predicates)
      expect(predicate).toEqual(mock.predicates[0]);
    expect(mock.predicates[0].sql).toContain(
      "`construction_daily_reports`.`status` = ?"
    );
    expect(mock.predicates[0].sql).toContain("CHAR_LENGTH(TRIM(COALESCE");
    expect(mock.predicates[0].sql).toContain("NOT (");
    expect(mock.predicates[0].sql).toContain("reviewReply");
    expect(mock.predicates[0].params).toContain("%\\%\\_\\\\整改%");
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
      expect.anything(),
      "CONSTRUCTION",
      "export"
    );
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
      expect.anything(),
      "CONSTRUCTION",
      "print"
    );
    expect(assertProjectInCurrentScope).toHaveBeenCalledTimes(5);
  });
  it.each([
    ["review", "submitted"],
    ["archive", "locked"],
  ] as const)(
    "%s栏目在服务端追加唯一状态，用户状态不能扩大栏目范围",
    async (scope, expected) => {
      const mock = selectDb([]);
      vi.mocked(getDb).mockResolvedValue(mock.db as never);
      await constructionRouter
        .createCaller(context)
        .listReports({ projectId: 10, scope, status: "draft" });
      expect(mock.predicates[0].params).toContain(expected);
      expect(mock.predicates[0].params).toContain("draft");
      expect(mock.predicates[0].sql.match(/`status` = \?/g)).toHaveLength(2);
    }
  );
  it("范围或输出动作未授权时，在数据读取前拒绝", async () => {
    vi.mocked(assertProjectInCurrentScope).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      constructionRouter.createCaller(context).exportReports({ projectId: 10 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDb).not.toHaveBeenCalled();
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue();
    vi.mocked(assertDepartmentBusinessAccess).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      constructionRouter
        .createCaller(context)
        .outputManifest({ projectId: 10, action: "print" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("拒绝非法状态、日期倒置、问题scope及超长关键词", async () => {
    const caller = constructionRouter.createCaller(context);
    for (const input of [
      { projectId: 0 },
      { projectId: 10, status: "settled" },
      { projectId: 10, issueScope: "resolved" },
      { projectId: 10, dateFrom: "2026-11-02", dateTo: "2026-11-01" },
      { projectId: 10, keyword: "字".repeat(101) },
    ])
      await expect(caller.listReports(input as never)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("只投影审核人显示名和业务字段，不导出账户或存储凭证", async () => {
    const mock = selectDb([record(1)]);
    vi.mocked(getDb).mockResolvedValue(mock.db as never);
    const output = await constructionRouter
      .createCaller(context)
      .exportReports({ projectId: 10 });
    expect(output[0]).toMatchObject({
      reviewedByName: "乙",
      createdByName: "甲",
    });
    const keys = Object.keys(mock.projections[0] as object);
    expect(keys).toContain("reviewedByName");
    for (const field of [
      "email",
      "openId",
      "fileKey",
      "url",
      "passwordHash",
      "longitude",
      "latitude",
    ])
      expect(keys).not.toContain(field);
  });
  it("所有当前筛选记录纳入统计，补齐退回、问题与未回复，不能把归档视为已整改", async () => {
    const mock = selectDb([
      { ...record(1), status: "locked", reviewReply: "" },
      {
        ...record(2),
        status: "rejected",
        reviewReply: "要求修改",
        progressPercent: "74.5",
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(mock.db as never);
    expect(
      await constructionRouter.createCaller(context).summary({ projectId: 10 })
    ).toMatchObject({
      total: 2,
      locked: 1,
      rejected: 1,
      issues: 2,
      unreplied: 1,
      averageProgressPercent: 50,
    });
  });
  it("普通PC管理人员不获得历史编辑/状态流转能力，新增/打印/导出按原动作鉴权", async () => {
    const result = await constructionRouter
      .createCaller(context)
      .capabilities({ projectId: 10 });
    expect(result).toMatchObject({
      canCreate: true,
      canEdit: false,
      canSubmit: false,
      canReview: false,
      canArchive: false,
      canPrint: true,
      canExport: true,
      canSupervisorReview: false,
    });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("超级管理员仍受施工各动作权限判定，缺少动作时不显示入口", async () => {
    vi.mocked(getSuperAdminAccess).mockResolvedValue({
      user: context.user!,
      canAccess: true,
    });
    vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
      async (_ctx, _module, action) => {
        if (action === "export" || action === "review")
          throw new TRPCError({ code: "FORBIDDEN" });
        return {
          departments: [],
          moduleCodes: ["CONSTRUCTION"],
          hasAllDepartments: false,
        };
      }
    );
    expect(
      await constructionRouter
        .createCaller(context)
        .capabilities({ projectId: 10 })
    ).toMatchObject({
      canEdit: true,
      canSubmit: true,
      canReview: false,
      canArchive: true,
      canExport: false,
    });
  });
});
describe("施工输出完整性边界", () => {
  it.each([0, 250, 251, 501])(
    "%i份清单覆盖全量，无静默250截断",
    async total => {
      const mock = selectDb(
        Array.from({ length: total }, (_, index) => ({ id: index + 1 }))
      );
      vi.mocked(getDb).mockResolvedValue(mock.db as never);
      const manifest = await constructionRouter
        .createCaller(context)
        .outputManifest({ projectId: 10, action: "print" });
      expect(manifest.total).toBe(total);
      expect(manifest.batches.flatMap(batch => batch.ids)).toEqual(
        Array.from({ length: total }, (_, index) => index + 1)
      );
      expect(manifest.batches.every(batch => batch.ids.length <= 250)).toBe(
        true
      );
      expect(mock.limit).not.toHaveBeenCalled();
    }
  );
  it("旧全量打印与导出在251条时显式拒绝，不返回250条伪完整输出", async () => {
    vi.mocked(getDb).mockResolvedValue(
      selectDb(Array.from({ length: 251 }, (_, index) => record(index + 1)))
        .db as never
    );
    const caller = constructionRouter.createCaller(context);
    await expect(caller.printReports({ projectId: 10 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("输出清单"),
    });
    await expect(caller.exportReports({ projectId: 10 })).rejects.toMatchObject(
      { code: "BAD_REQUEST" }
    );
  });
  it("合法250条批次全部返回，并在完整筛选SQL上增加ID交集", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);
    const mock = selectDb(ids.map(record));
    vi.mocked(getDb).mockResolvedValue(mock.db as never);
    expect(
      await constructionRouter
        .createCaller(context)
        .printReports({ projectId: 10, scope: "review", reportIds: ids })
    ).toHaveLength(250);
    expect(mock.predicates[0].sql).toContain(" in (");
    expect(mock.predicates[0].params).toContain("submitted");
    expect(mock.limit).toHaveBeenCalledWith(251);
  });
  it.each(
    [
      [1, 2],
      [1, 1],
      [],
      Array.from({ length: 251 }, (_, index) => index + 1),
    ].map(ids => [ids])
  )("批次丢失记录/重复/空/超限明确失败 (%j)", async reportIds => {
    vi.mocked(getDb).mockResolvedValue(selectDb([record(1)]).db as never);
    await expect(
      constructionRouter
        .createCaller(context)
        .exportReports({ projectId: 10, reportIds })
    ).rejects.toMatchObject({
      code:
        reportIds.length === 2 && reportIds[1] === 2
          ? "CONFLICT"
          : "BAD_REQUEST",
    });
  });
  it("清单内记录号被替换时，即便数量相同也拒绝不完整或越界批次", async () => {
    vi.mocked(getDb).mockResolvedValue(selectDb([record(999)]).db as never);
    await expect(
      constructionRouter
        .createCaller(context)
        .printReports({ projectId: 10, reportIds: [1] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
