import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/** 对象存储与加密实现属于外部基础设施；路由测试只验证其调用边界，不执行真实上传。 */
vi.mock("./storage", () => ({ storageGet: vi.fn(), storagePut: vi.fn() }));
vi.mock("./services/secretVault", () => ({
  encryptSecret: vi.fn((value: string) => `cipher:${value}`),
  decryptSecret: vi.fn((value: string) => value.replace(/^cipher:/, "")),
}));
vi.mock("./services/wecomNotifier", () => ({
  sendWecomTextNotification: vi.fn().mockResolvedValue({ delivered: false, reason: "not_configured" }),
}));
vi.mock("./routers/messages", () => ({
  createInAppMessage: vi.fn().mockResolvedValue({ created: true }),
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    assertProjectInCurrentScope: vi.fn(),
    getCurrentDataScope: vi.fn(),
    getEffectiveRoleCodes: vi.fn(),
  };
});

import { assertProjectInCurrentScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { laborRouter } from "./routers/labor";
import { createInAppMessage } from "./routers/messages";
import { sendWecomTextNotification } from "./services/wecomNotifier";
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

describe("labor tRPC 路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["LABOR_MANAGER"]);
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
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
    expect(vi.mocked(sendWecomTextNotification)).toHaveBeenCalledWith("【道路施工承包管理系统】2026-07 工资条已提交会计审核，请相关责任人在系统内处理。");
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
    };
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
    await expect(laborRouter.createCaller(createAuthContext()).payroll.approve({ id: 8, decision: "approved" })).resolves.toEqual({ success: true, status: "approved" });
    expect(updateSet).toHaveBeenLastCalledWith(expect.objectContaining({ status: "approved", accountantId: 1 }));

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
});
