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
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./services/supervisorReview", () => ({ isSupervisorReviewAutoApprove: vi.fn() }));
vi.mock("./routers/messages", () => ({ createInAppMessage: vi.fn().mockResolvedValue({ created: true }) }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn().mockResolvedValue("https://signed.example/evidence-photo.jpg") }));

import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, assertProjectInCurrentScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { constructionRouter } from "./routers/construction";
import { notifyOfficialAccountBusinessEventSafely } from "./services/businessNotifier";
import { isSupervisorReviewAutoApprove } from "./services/supervisorReview";
import { createInAppMessage } from "./routers/messages";
import { storageGetSignedUrl } from "./storage";

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
  const terminal: {
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (resolve: (value: unknown[]) => unknown) => Promise<unknown>;
  } = {
    orderBy: vi.fn(),
    limit: vi.fn(async () => rows),
    then: resolve => Promise.resolve(rows).then(resolve),
  };
  terminal.orderBy.mockReturnValue(terminal);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => terminal),
        leftJoin: vi.fn(() => ({ where: vi.fn(() => terminal) })),
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
    vi.mocked(isSupervisorReviewAutoApprove).mockResolvedValue(false);
  });

  it("施工日报列表在查询前强制校验施工模块权限与项目范围", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);

    await expect(constructionRouter.createCaller(createAuthContext()).listReports({ projectId: 10 })).resolves.toEqual([]);
    expect(vi.mocked(assertDepartmentBusinessAccess)).toHaveBeenCalledWith(expect.anything(), "CONSTRUCTION", "read");
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
  });

  it("列表只投影提交管理员显示名，并支持日期、管理员和关键词组合筛选", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{
      id: 71,
      projectId: 10,
      reportDate: new Date("2026-10-31T00:00:00.000Z"),
      createdBy: 7,
      createdByName: "现场管理员",
      workArea: "K12+500",
      weather: "sunny",
      workContent: "完成碾压作业",
      safetyNotes: null,
      issueNotes: null,
      progressPercent: "12.50",
      status: "submitted",
      reviewReply: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]) as never);

    await expect(constructionRouter.createCaller(createAuthContext()).listReports({ projectId: 10, dateFrom: "2026-10-01", dateTo: "2026-10-31", createdBy: 7, keyword: "碾压" })).resolves.toEqual([expect.objectContaining({ createdBy: 7, createdByName: "现场管理员" })]);
    await expect(constructionRouter.createCaller(createAuthContext()).listReports({ projectId: 10, dateFrom: "2026-11-01", dateTo: "2026-10-31" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("打印日报需单独校验print权限，并仅返回当前筛选的受控投影", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{
      id: 72,
      projectId: 10,
      reportDate: new Date(),
      createdBy: 1,
      createdByName: null,
      workArea: "拌合站",
      weather: "cloudy",
      workContent: "完成试拌",
      safetyNotes: null,
      issueNotes: null,
      progressPercent: "5.00",
      status: "locked",
      reviewReply: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]) as never);

    await expect(constructionRouter.createCaller(createAuthContext()).printReports({ projectId: 10 })).resolves.toEqual([expect.objectContaining({ createdByName: "管理员 #1" })]);
    expect(vi.mocked(assertDepartmentBusinessAccess)).toHaveBeenCalledWith(expect.anything(), "CONSTRUCTION", "print");
  });

  it("日报关联影像仅按日报来源编号返回当前项目内的短时签名照片", async () => {
    vi.mocked(getDb).mockResolvedValue(createSelectDb([{
      id: 601,
      projectId: 10,
      sourceType: "site_photo",
      sourceId: "construction-report-95",
      fileKey: "evidence/10/photo.jpg",
      fileName: "日报现场照片.jpg",
      watermarkJson: JSON.stringify({ description: "K12+500 填筑碾压完成" }),
      capturedAt: new Date("2026-08-16T08:30:00.000Z"),
      createdAt: new Date("2026-08-16T08:31:00.000Z"),
    }]) as never);

    await expect(constructionRouter.createCaller(createAuthContext()).reportEvidence({ projectId: 10, reportIds: [95] })).resolves.toEqual([expect.objectContaining({
      id: 601,
      reportId: 95,
      fileName: "日报现场照片.jpg",
      description: "K12+500 填筑碾压完成",
      url: "https://signed.example/evidence-photo.jpg",
    })]);
    expect(vi.mocked(assertDepartmentBusinessAccess)).toHaveBeenCalledWith(expect.anything(), "CONSTRUCTION", "read");
    expect(vi.mocked(assertProjectInCurrentScope)).toHaveBeenCalledWith(expect.anything(), 10);
    expect(vi.mocked(storageGetSignedUrl)).toHaveBeenCalledWith("evidence/10/photo.jpg");
  });

  it("新建日报可按当前定位自动解析天气，天气服务异常时安全回退为手动选择", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ current: { weather_code: 63, wind_speed_10m: 3, time: "2026-08-16T05:00" } }) })
      .mockRejectedValueOnce(new Error("weather unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(constructionRouter.createCaller(createAuthContext()).resolveCurrentWeather({ latitude: 30.1234, longitude: 120.5678 })).resolves.toEqual({ weather: "rainy", observedAt: "2026-08-16T05:00", source: "auto" });
    await expect(constructionRouter.createCaller(createAuthContext()).resolveCurrentWeather({ latitude: 30.1234, longitude: 120.5678 })).resolves.toMatchObject({ weather: "other", source: "fallback" });
    expect(vi.mocked(assertDepartmentBusinessAccess)).toHaveBeenCalledWith(expect.anything(), "CONSTRUCTION", "read");
    vi.unstubAllGlobals();
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
    expect(notifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ projectId: 10, eventCode: "construction_daily_report_created", targetId: "88" }));
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
    expect(notifyOfficialAccountBusinessEventSafely).not.toHaveBeenCalled();
  });

  it("填报人提交草稿会通知本项目有效主管，且不改变项目范围", async () => {
    const auditValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => [{ affectedRows: 1 }]);
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) return { from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 93, projectId: 10, status: "draft", createdBy: 1 }]) })) })) };
        return { from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(async () => [{ userId: 2 }]) })) })) };
      }),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      insert: vi.fn(() => ({ values: auditValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(constructionRouter.createCaller(createAuthContext()).submitReportForReview({ id: 93, projectId: 10 })).resolves.toEqual({ success: true, supervisorCount: 1, autoApproved: false });
    expect(createInAppMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 2, eventCode: "construction_daily_report_review_requested" }));
    expect(notifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(expect.objectContaining({ userId: 2, projectId: 10, eventCode: "construction_daily_report_review_requested" }));
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("统一审核开关开启时，日报直接自动归档并记录为自动审核，不查询主管名单", async () => {
    vi.mocked(isSupervisorReviewAutoApprove).mockResolvedValue(true);
    const auditValues = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => [{ affectedRows: 1 }]) }));
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 95, projectId: 10, status: "draft", createdBy: 1 }]) })) })) })),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: auditValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(constructionRouter.createCaller(createAuthContext()).submitReportForReview({ id: 95, projectId: 10 })).resolves.toEqual({ success: true, supervisorCount: 0, autoApproved: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "locked", reviewedBy: 1 }));
    expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({ action: "auto_approve_daily_report_by_supervisor_setting" }));
    expect(createInAppMessage).not.toHaveBeenCalled();
  });

  it("项目主管填写回复确认后会直接归档并通知填报人", async () => {
    const auditValues = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => [{ affectedRows: 1 }]) }));
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) return { from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 94, projectId: 10, status: "submitted", createdBy: 2 }]) })) })) };
        return { from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(async () => [{ userId: 1 }]) })) })) };
      }),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: auditValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(constructionRouter.createCaller(createAuthContext()).reviewReport({ id: 94, projectId: 10, decision: "confirm", reply: "日报内容属实，确认归档。" })).resolves.toEqual({ success: true, status: "locked" });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "locked", reviewReply: "日报内容属实，确认归档。", reviewedBy: 1 }));
    expect(createInAppMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 2, eventCode: "construction_daily_report_locked" }));
  });
});
