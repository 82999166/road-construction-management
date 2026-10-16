import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", () => ({ assertSuperAdmin: vi.fn(), requireAuthenticatedUser: vi.fn((ctx: TrpcContext) => ctx.user) }));
vi.mock("./services/officialAccountNotifier", () => ({ sendOfficialAccountNotification: vi.fn() }));

import { assertSuperAdmin, requireAuthenticatedUser } from "./access";
import { getDb } from "./db";
import { canDirectSendBroadcastStatus, getBroadcastDeliveryReasonLabel, getBroadcastFailureGuidance, broadcastRouter } from "./routers/broadcast";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = { id: 1, openId: "broadcast-test-user", email: "broadcast@example.com", name: "群发测试管理员", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 仅实现群发审批所需的最小 Drizzle 链，避免单测触达真实数据库或微信接口。 */
function createReviewDb(existing: { id: number; status: string }) {
  const auditValues = vi.fn(async () => undefined);
  const updateWhere = vi.fn(async () => undefined);
  return {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [existing]) })) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    insert: vi.fn(() => ({ values: auditValues })),
    auditValues,
    updateWhere,
  };
}

function createAcknowledgementDb() {
  const auditValues = vi.fn(async () => undefined);
  const updateWhere = vi.fn(async () => [{ affectedRows: 1 }]);
  const delivery = { broadcastId: 88, deliveryStatus: "sent", acknowledgementStatus: "pending", requiresAcknowledgement: true, title: "本周施工通知" };
  const tx = {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 1 }]) })) })),
    insert: vi.fn(() => ({ values: auditValues })),
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [delivery]) })) })) })) })),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    auditValues,
    updateWhere,
  };
}

describe("服务号群发审批状态机", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAuthContext().user);
    vi.mocked(requireAuthenticatedUser).mockImplementation(ctx => ctx.user!);
  });

  it("草稿仅可提交审批，并写入状态审计", async () => {
    const db = createReviewDb({ id: 11, status: "draft" });
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(broadcastRouter.createCaller(createAuthContext()).review({ id: 11, action: "submit", reviewNote: null })).resolves.toEqual({ success: true, status: "submitted" });
    expect(db.updateWhere).toHaveBeenCalledTimes(1);
    expect(db.auditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "notification", action: "broadcast_submit", targetId: "11" }));
  });

  it("退回群发必须给出修改说明，避免无依据地阻塞发布", async () => {
    const db = createReviewDb({ id: 12, status: "submitted" });
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(broadcastRouter.createCaller(createAuthContext()).review({ id: 12, action: "reject", reviewNote: null })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "退回群发单必须填写修改说明" });
    expect(db.updateWhere).not.toHaveBeenCalled();
    expect(db.auditValues).not.toHaveBeenCalled();
  });

  it("已发布群发单不可再次进入审批状态，防止终态记录被回退", async () => {
    const db = createReviewDb({ id: 13, status: "published" });
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(broadcastRouter.createCaller(createAuthContext()).review({ id: 13, action: "submit", reviewNote: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.updateWhere).not.toHaveBeenCalled();
  });

  it("仅实际收件人可确认收到，并以条件更新和审计记录防止重复确认", async () => {
    const db = createAcknowledgementDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(broadcastRouter.createCaller(createAuthContext()).acknowledgeReceipt({ deliveryId: 25 })).resolves.toEqual({ success: true, alreadyAcknowledged: false });
    expect(db.updateWhere).toHaveBeenCalledTimes(2);
    expect(db.auditValues).toHaveBeenCalledWith(expect.objectContaining({ module: "notification", action: "broadcast_receipt_acknowledged", targetId: "25" }));
  });

  it("将常见微信投递失败转为可执行说明且不暴露敏感收件人信息或原始编码", () => {
    expect(getBroadcastFailureGuidance("40037", "40037")).toContain("模板不可下发");
    expect(getBroadcastFailureGuidance("not_bound", null)).toContain("尚未完成服务号绑定");
    expect(getBroadcastFailureGuidance("network_timeout", null)).toContain("网络请求失败");
    expect(getBroadcastFailureGuidance("unexpected_error", null)).not.toContain("unexpected_error");
    expect(getBroadcastDeliveryReasonLabel("sent", "in_app_scope_notification", null)).toBe("站内通知已送达");
    expect(getBroadcastDeliveryReasonLabel("failed", "unexpected_error", null)).toBe("投递失败");
    expect(getBroadcastDeliveryReasonLabel("pending", "unexpected_internal_status", null)).toBeNull();
  });

  it("获授权管理员可直接发送草稿和历史审批中群发，但终态记录不能重复发送", () => {
    expect(canDirectSendBroadcastStatus("draft")).toBe(true);
    expect(canDirectSendBroadcastStatus("submitted")).toBe(true);
    expect(canDirectSendBroadcastStatus("approved")).toBe(true);
    expect(canDirectSendBroadcastStatus("published")).toBe(false);
    expect(canDirectSendBroadcastStatus("publishing")).toBe(false);
  });
});
