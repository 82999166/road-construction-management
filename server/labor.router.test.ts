import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 对象存储与加密实现属于外部基础设施；路由测试只验证其调用边界，不执行真实上传。 */
vi.mock("./storage", () => ({ storageGet: vi.fn(), storagePut: vi.fn() }));
vi.mock("./services/secretVault", () => ({
  encryptSecret: vi.fn((value: string) => `cipher:${value}`),
  decryptSecret: vi.fn((value: string) => value.replace(/^cipher:/, "")),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: vi.fn().mockResolvedValue([]),
}));
vi.mock("./services/auditIntegrity", () => ({
  appendIntegrityProtectedAudit: vi.fn().mockResolvedValue({ auditLogId: 1, sequenceNo: 1, entryHash: "test" }),
  recordSensitiveDataAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./routers/messages", () => ({
  createInAppMessage: vi.fn().mockResolvedValue({ created: true }),
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertDepartmentBusinessAccess: vi.fn(),
    assertProjectInCurrentScope: vi.fn(),
    getCurrentDataScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { laborRouter } from "./routers/labor";
import { createInAppMessage } from "./routers/messages";
import { notifyOfficialAccountBusinessEventSafely } from "./services/businessNotifier";
import { storagePut } from "./storage";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/** 生成仅含当前会话必要字段的 tRPC 上下文，避免测试依赖真实登录态。 */
function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "labor-test-user",
    email: "labor-test@example.com",
    name: "劳务测试人员",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 构造 Drizzle 查询链，返回指定的单次查询结果。 */
function createSelectDb(rows: unknown[]) {
  const terminalQuery = {
    orderBy: vi.fn(async () => rows),
    limit: vi.fn(async () => rows),
  };
  const chain = {
    where: vi.fn(() => terminalQuery),
    innerJoin: vi.fn(),
  };
  chain.innerJoin.mockReturnValue(chain);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => chain),
    })),
  };
}

describe("labor tRPC 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["LABOR_MANAGER"]);
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
    vi.mocked(getCurrentDataScope).mockResolvedValue({ userId: 1, hasAllProjects: true, projectIds: [], organizationIds: [] });
  });

  it("后台全员考勤台账按管理员授权项目范围汇总当天移动打卡，不强制绑定单一工作区项目", async () => {
    const checkIn = {
      id: 51,
      userId: 9,
      userName: "登录人员",
      projectId: 1,
      projectName: "项目部",
      businessDate: new Date("2026-08-24T00:00:00.000Z"),
      checkedInAt: new Date("2026-08-24T00:05:00.000Z"),
      checkedOutAt: null,
      deviceLabel: "已绑定设备",
      checkInAddress: "中文详细地址",
      locationAccuracyMeters: "15",
      status: "normal",
      checkoutAddress: null,
      checkoutLocationAccuracyMeters: null,
      checkoutStatus: null,
    };
    vi.mocked(getDb).mockResolvedValue(createSelectDb([checkIn]) as never);

    await expect(laborRouter.createCaller(createAuthContext()).attendance.listCheckIns({ businessDate: "2026-08-24" })).resolves.toMatchObject([{
      id: 51,
      projectId: 1,
      projectName: "项目部",
      checkedInAt: checkIn.checkedInAt,
    }]);
    expect(assertProjectInCurrentScope).not.toHaveBeenCalled();
  });

  it("人员台账仅返回脱敏投影和实名审核状态，不返回加密原字段", async () => {
    const db = createSelectDb([{
      id: 7,
      projectId: 10,
      teamName: "沥青班组",
      realName: "张三",
      identityNoEncrypted: "cipher:110101199001011234",
      phoneEncrypted: "cipher:13800138000",
      bankAccountEncrypted: "cipher:6222021234567890",
      bankName: "建设银行",
      identityVerificationStatus: "verified",
      identityVerificationNote: "证照齐全",
      identityVerifiedAt: new Date("2026-07-25T00:00:00.000Z"),
      identityVerifiedBy: 1,
      attendanceStatus: "active",
      entryDate: new Date("2026-07-01T00:00:00.000Z"),
      exitDate: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-25T00:00:00.000Z"),
    }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await laborRouter.createCaller(createAuthContext()).listWorkers({ projectId: 10, includeLeft: true });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      realName: "张三",
      identityNoMasked: "**************1234",
      phoneMasked: "*******8000",
      bankAccountMasked: "************7890",
      identityVerificationStatus: "verified",
      identityVerificationNote: "证照齐全",
    });
    expect(result[0]).not.toHaveProperty("identityNoEncrypted");
    expect(result[0]).not.toHaveProperty("phoneEncrypted");
    expect(result[0]).not.toHaveProperty("bankAccountEncrypted");
  });

  it("工资草稿只能流转为待会计审核状态", async () => {
    const payroll = { id: 8, projectId: 10, period: "2026-07", status: "draft" };
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      ...createSelectDb([payroll]),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(laborRouter.createCaller(createAuthContext()).payroll.submit({ id: 8 })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "reviewing", submittedBy: 1 }));
    expect(vi.mocked(createInAppMessage)).toHaveBeenCalledWith(expect.objectContaining({
      eventCode: "PAYROLL_SUBMITTED",
      idempotencyKey: "payroll-submitted:8",
      recipientUserId: 1,
      deepLink: "/mobile/labor",
    }));
    const submissionMessage = vi.mocked(createInAppMessage).mock.calls[0]?.[0];
    expect(submissionMessage?.content).not.toMatch(/金额|银行卡|张三|13800138000/);
    expect(vi.mocked(notifyOfficialAccountBusinessEventSafely)).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "payroll_submitted", targetType: "payroll_statement", deepLink: "/mobile/labor" }));
  });

  it("工资状态条件更新发生冲突时不写审计或投递站内及企业微信消息", async () => {
    const auditValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => [{ affectedRows: 0 }]);
    vi.mocked(getDb).mockResolvedValue({
      ...createSelectDb([{ id: 18, projectId: 10, period: "2026-07", status: "draft" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      insert: vi.fn(() => ({ values: auditValues })),
    } as never);

    await expect(laborRouter.createCaller(createAuthContext()).payroll.submit({ id: 18 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(auditValues).not.toHaveBeenCalled();
    expect(vi.mocked(createInAppMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyOfficialAccountBusinessEventSafely)).not.toHaveBeenCalled();
  });

  it("实名核验完成会写入无身份信息的幂等站内消息", async () => {
    const worker = { id: 7, projectId: 10, identityNoEncrypted: "cipher:110101199001011234", identityVerificationStatus: "pending" };
    const db = {
      ...createSelectDb([worker]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(laborRouter.createCaller(createAuthContext()).saveWorker({ id: 7, projectId: 10, realName: "王五", attendanceStatus: "active", identityVerificationStatus: "verified" })).resolves.toEqual({ success: true, id: 7 });

    expect(vi.mocked(createInAppMessage)).toHaveBeenCalledWith(expect.objectContaining({
      eventCode: "IDENTITY_VERIFIED",
      idempotencyKey: "identity-verified:7",
      recipientUserId: 1,
      deepLink: "/mobile/labor",
    }));
    expect(vi.mocked(createInAppMessage).mock.calls[0]?.[0]?.content).not.toMatch(/王五|110101199001011234/);
  });

  it("证照归档会写入无证照名称和人员信息的幂等站内消息", async () => {
    const worker = { id: 7, projectId: 10, realName: "王五" };
    const db = {
      ...createSelectDb([worker]),
      insert: vi.fn(() => ({ values: vi.fn(async () => [{ insertId: 44 }]) })),
      transaction: vi.fn(),
    };
    db.transaction.mockImplementation(async callback => callback(db));
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(storagePut).mockResolvedValue({ key: "labor-certificates/project-10/worker-7/id-card.jpg", url: "https://storage.example/certificate.jpg" } as never);

    await expect(laborRouter.createCaller(createAuthContext()).certificates.upload({ workerId: 7, projectId: 10, certificateName: "身份证正面", fileName: "id-card.jpg", mimeType: "image/jpeg", base64Data: "/9j/2Q==" })).resolves.toMatchObject({ success: true, id: 44 });

    expect(vi.mocked(createInAppMessage)).toHaveBeenCalledWith(expect.objectContaining({
      eventCode: "WORKER_CERTIFICATE_ARCHIVED",
      idempotencyKey: "worker-certificate:44",
      recipientUserId: 1,
      deepLink: "/mobile/labor",
    }));
    expect(vi.mocked(createInAppMessage).mock.calls[0]?.[0]?.content).not.toMatch(/王五|身份证/);
  });

  it("仅会计岗位可审核，且会计可以将审核中工资条通过或退回草稿", async () => {
    const payroll = { id: 8, projectId: 10, period: "2026-07", status: "reviewing" };
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      ...createSelectDb([payroll]),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(laborRouter.createCaller(createAuthContext()).payroll.approve({ id: 8, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    vi.mocked(notifyOfficialAccountBusinessEventSafely).mockResolvedValueOnce([]);
    await expect(laborRouter.createCaller(createAuthContext()).payroll.approve({ id: 8, decision: "approved" })).resolves.toEqual({ success: true, status: "approved" });
    expect(updateSet).toHaveBeenLastCalledWith(expect.objectContaining({ status: "approved", accountantId: 1 }));
    expect(vi.mocked(notifyOfficialAccountBusinessEventSafely)).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "payroll_approved", targetType: "payroll_statement", deepLink: "/mobile/labor" }));
    expect(db.insert).toHaveBeenCalled();

    await expect(laborRouter.createCaller(createAuthContext()).payroll.approve({ id: 8, decision: "returned" })).resolves.toEqual({ success: true, status: "draft" });
    expect(updateSet).toHaveBeenLastCalledWith(expect.objectContaining({ status: "draft", accountantId: 1 }));

    const finalizedDb = {
      ...createSelectDb([{ ...payroll, status: "approved" }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(finalizedDb as never);
    await expect(laborRouter.createCaller(createAuthContext()).payroll.approve({ id: 8, decision: "approved" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("工资付款凭证仅向会计、财务负责人和系统级应急角色返回", async () => {
    const payrollRow = {
      id: 18,
      workerId: 7,
      workerName: "张三",
      teamName: "沥青班组",
      projectId: 10,
      period: "2026-07",
      payableAmount: "12000.00",
      deductionAmount: "0.00",
      actualAmount: "12000.00",
      bankAccountMasked: "****7890",
      status: "paid",
      accountantId: 9,
      paidAt: new Date("2026-07-25T00:00:00.000Z"),
      paymentReference: "PAY-202607-0001",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-25T00:00:00.000Z"),
    };
    vi.mocked(getDb).mockResolvedValue(createSelectDb([payrollRow]) as never);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["LABOR_MANAGER"]);

    const restrictedRows = await laborRouter.createCaller(createAuthContext()).payroll.list({ projectId: 10, period: "2026-07" });
    expect(restrictedRows[0]?.paymentReference).toBeNull();

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    const financeRows = await laborRouter.createCaller(createAuthContext()).payroll.list({ projectId: 10, period: "2026-07" });
    expect(financeRows[0]?.paymentReference).toBe("PAY-202607-0001");
  });

  it("旧工资一次性发放接口已封存，任何岗位均须改走带凭证的统一付款台账", async () => {
    const payroll = { id: 8, projectId: 10, period: "2026-07", status: "approved", submittedBy: 7 };
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const insertValues = vi.fn(async () => undefined);
    const db = {
      ...createSelectDb([payroll]),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(laborRouter.createCaller(createAuthContext()).payroll.pay({ id: 8, paymentReference: "PAY-202607-0001" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "工资实际发放已统一至PC财务台账，请上传本次付款凭证后分笔登记" });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    await expect(laborRouter.createCaller(createAuthContext()).payroll.pay({ id: 8, paymentReference: "PAY-202607-0001" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateSet).not.toHaveBeenCalled();
    expect(vi.mocked(createInAppMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyOfficialAccountBusinessEventSafely)).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("工资条只能在发放确认前由会计或财务负责人作废，已发放记录保持终态锁定", async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const insertValues = vi.fn(async () => undefined);
    const db = {
      ...createSelectDb([{ id: 9, projectId: 10, period: "2026-07", status: "approved", submittedBy: 7 }]),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    await expect(laborRouter.createCaller(createAuthContext()).payroll.void({ id: 9, reason: "考勤口径调整" })).resolves.toEqual({ success: true, status: "void" });
    expect(updateSet).toHaveBeenCalledWith({ status: "void" });
    expect(vi.mocked(createInAppMessage)).toHaveBeenCalledWith(expect.objectContaining({ eventCode: "PAYROLL_VOIDED", recipientUserId: 7, deepLink: "/mobile/labor" }));

    const paidDb = {
      ...createSelectDb([{ id: 10, projectId: 10, period: "2026-07", status: "paid", submittedBy: 7 }]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    vi.mocked(getDb).mockResolvedValue(paidDb as never);
    await expect(laborRouter.createCaller(createAuthContext()).payroll.void({ id: 10, reason: "不可回退验证" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("下班打卡必须先完成上班打卡，并仅写入一次下班时间和定位状态", async () => {
    const fingerprint = "a".repeat(64);
    vi.mocked(getDb).mockResolvedValue({} as never);
    await expect(laborRouter.createCaller(createAuthContext()).attendance.checkIn({ projectId: 10, punchType: "in", deviceFingerprintHash: fingerprint, deviceLabel: "测试设备" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "上下班打卡必须上传实时定位信息，请允许浏览器定位后重试" });

    vi.mocked(getDb).mockResolvedValue(createSelectDb([]) as never);
    await expect(laborRouter.createCaller(createAuthContext()).attendance.checkIn({ projectId: 10, punchType: "out", deviceFingerprintHash: fingerprint, deviceLabel: "测试设备" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const existing = { id: 44, checkedInAt: new Date("2026-08-16T01:00:00.000Z"), checkedOutAt: null, status: "normal", checkoutStatus: null };
    const binding = { id: 9, status: "active" };
    const results = [[existing], [binding]];
    const checkoutSet = vi.fn(() => ({ where: vi.fn(async () => [{ affectedRows: 1 }]) }));
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => results.shift() ?? []) })) })) })),
      update: vi.fn(() => ({ set: checkoutSet })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    Object.assign(db, { transaction: vi.fn(async callback => callback(db)) });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(laborRouter.createCaller(createAuthContext()).attendance.checkIn({ projectId: 10, punchType: "out", deviceFingerprintHash: fingerprint, deviceLabel: "测试设备", longitude: 120.1, latitude: 30.2, locationAccuracyMeters: 12 })).resolves.toMatchObject({ success: true, duplicate: false, punchType: "out", id: 44, status: "normal" });
    expect(checkoutSet).toHaveBeenCalledWith(expect.objectContaining({ checkedOutAt: expect.any(Date), checkoutLongitude: "120.1", checkoutLatitude: "30.2", checkoutStatus: "normal" }));

    const zeroWriteResults = [[existing], [binding]];
    const zeroWriteDb = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => zeroWriteResults.shift() ?? []) })) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => [{ affectedRows: 0 }]) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    Object.assign(zeroWriteDb, { transaction: vi.fn(async callback => callback(zeroWriteDb)) });
    vi.mocked(getDb).mockResolvedValue(zeroWriteDb as never);
    await expect(laborRouter.createCaller(createAuthContext()).attendance.checkIn({ projectId: 10, punchType: "out", deviceFingerprintHash: fingerprint, deviceLabel: "未命中测试设备", longitude: 120.1, latitude: 30.2, locationAccuracyMeters: 12 })).rejects.toMatchObject({ code: "CONFLICT", message: "未确认到可更新的今日上班记录，请刷新考勤状态后重试下班打卡" });
  });

  it("上班打卡遇到已禁用设备时保留明确业务错误，不泛化为保存失败", async () => {
    const fingerprint = "b".repeat(64);
    const results: unknown[][] = [[], [{ id: 12, status: "disabled" }]];
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => results.shift() ?? []) })) })) })),
      insert: vi.fn(),
    };
    Object.assign(db, { transaction: vi.fn(async callback => callback(db)) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(laborRouter.createCaller(createAuthContext()).attendance.checkIn({ projectId: 10, punchType: "in", deviceFingerprintHash: fingerprint, deviceLabel: "已停用设备", longitude: 120.1, latitude: 30.2, locationAccuracyMeters: 10 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "当前考勤设备已被禁用，请联系管理员核验后重新绑定" });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
