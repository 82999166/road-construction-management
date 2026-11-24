import { withNumberingFixture } from "./services/businessDocumentNumber.fixtureAdapter";
import { BusinessDocumentCreationMockDb } from "./services/businessDocumentCreation.mockDb";
import { projects, outsourceContracts, subcontractPackages, subcontractPaymentSettlements } from "../drizzle/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { getDb } from "./db";
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

/** 按路由读取顺序返回真实状态机测试所需的最小行，避免测试依赖外部数据库。 */
const stores: BusinessDocumentCreationMockDb[] = [];
afterEach(() => stores.splice(0).forEach(db => db.close()));
/** 所有新增父单hint/快照读取按真实表和WHERE解析，不能消耗顺序响应。 */
function createSelectDb(...responses: Record<string, unknown>[][]) {
  const db = new BusinessDocumentCreationMockDb();
  stores.push(db);
  db.seed(projects, { id: 10, code: "P10", name: "测试项目", nodeType: "project", status: "active" });
  for (const row of responses.flat()) {
    if ("settlementNo" in row) db.seed(subcontractPaymentSettlements, { packageId: Number(row.id), subcontractTeamId: 1, packageNoSnapshot: "SP-LEGACY", workItemSnapshot: "路基", quantitySnapshot: "1", unitSnapshot: "m3", grossPayableAmount: "100", netPayableAmount: "100", payeeName: "施工队", createdBy: 2, ...row });
    else db.seed(subcontractPackages, { packageNo: `SP-LEGACY-${row.id}`, subcontractTeamId: 1, workItem: "路基", unit: "m3", quantity: "1", upstreamAmount: "100", subcontractAmount: "120", marginAmount: "-20", createdBy: 1, ...row });
  }
  return db;
}

describe("工程结算与分包路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("按职责分离投影分包草稿、复核确认、应付结算和付款能力", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: true, canConfirm: false, canSettle: false, canPay: false, canViewFullAccount: false });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MEASUREMENT_MANAGER"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: false, canConfirm: true, canSettle: false, canPay: false, canViewFullAccount: false });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: false, canConfirm: false, canSettle: true, canPay: false, canViewFullAccount: true });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CASHIER"]);
    await expect(subcontractRouter.createCaller(createAuthContext()).capabilities()).resolves.toEqual({ canMaintainDraft: false, canConfirm: false, canSettle: false, canPay: true, canViewFullAccount: true });
  });

  it("价格倒挂且未保留原因的已分配包件不能被计量岗位确认", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["MEASUREMENT_MANAGER"]);
    vi.mocked(getDb).mockResolvedValue(withNumberingFixture(createSelectDb([{ id: 8, projectId: 10, status: "allocated", marginAmount: "-20", priceExceptionReason: null, packageNo: "SP-TEST" }]) as never));

    await expect(subcontractRouter.createCaller(createAuthContext()).transitionPackage({ id: 8, projectId: 10, targetStatus: "confirmed" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("缺少原因") });
  });

  it("未完成双岗复核的倒挂包件不能建立应付结算单", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    vi.mocked(getDb).mockResolvedValue(withNumberingFixture(createSelectDb([{ id: 8, projectId: 10, status: "confirmed", marginAmount: "-20", priceExceptionReviewedBy: null, priceExceptionReviewedAt: null }]) as never));

    await expect(subcontractRouter.createCaller(createAuthContext()).createPaymentSettlement({ projectId: 10, packageId: 8, payeeName: "施工队", paymentMethod: "bank_transfer", manualDeductionAmount: 0, invoiceStatus: "missing" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("双岗复核") });
  });

  it("分包审核保留职责分离，实际付款强制交由统一凭证台账，已结清不可回退", async () => {
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
    vi.mocked(getDb).mockResolvedValue(withNumberingFixture(createSelectDb([{ id: 21, projectId: 10, status: "submitted", submittedBy: 1, approvedBy: null, settlementNo: "SPAY-1" }]) as never));
    await expect(subcontractRouter.createCaller(createAuthContext()).transitionPaymentSettlement({ projectId: 10, id: 21, targetStatus: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("职责分离") });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CASHIER"]);
    vi.mocked(getDb).mockResolvedValue(withNumberingFixture(createSelectDb([{ id: 22, projectId: 10, status: "approved", submittedBy: 2, approvedBy: 1, settlementNo: "SPAY-2" }]) as never));
    await expect(subcontractRouter.createCaller(createAuthContext()).transitionPaymentSettlement({ projectId: 10, id: 22, targetStatus: "paid" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("不允许") });

    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ALL"]);
    vi.mocked(getDb).mockResolvedValue(withNumberingFixture(createSelectDb([{ id: 23, projectId: 10, status: "paid", submittedBy: 2, approvedBy: 3, settlementNo: "SPAY-3" }]) as never));
    await expect(subcontractRouter.createCaller(createAuthContext()).transitionPaymentSettlement({ projectId: 10, id: 23, targetStatus: "void" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("不允许") });
  });
});
