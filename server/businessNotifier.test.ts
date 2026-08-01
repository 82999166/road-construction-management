import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNotifyOfficialAccountBusinessEvent } = vi.hoisted(() => ({
  mockNotifyOfficialAccountBusinessEvent: vi.fn(),
}));

vi.mock("./services/officialAccountNotifier", () => ({ notifyOfficialAccountBusinessEvent: mockNotifyOfficialAccountBusinessEvent }));

import { notifyOfficialAccountBusinessEventSafely } from "./services/businessNotifier";

describe("统一公众号业务节点通知", () => {
  beforeEach(() => vi.clearAllMocks());

  it("仅将最小化业务事件转交给公众号投递服务", async () => {
    const expected = [{ recipientUserId: 9, delivered: false, reason: "not_configured" }];
    mockNotifyOfficialAccountBusinessEvent.mockResolvedValue(expected);
    const event = {
      userId: 9,
      module: "finance" as const,
      eventCode: "financial_expense",
      targetType: "financial_record",
      targetId: "material_cost",
      title: "项目支出流水已登记",
      deepLink: "/mobile/finance",
    };

    await expect(notifyOfficialAccountBusinessEventSafely(event)).resolves.toEqual(expected);
    expect(mockNotifyOfficialAccountBusinessEvent).toHaveBeenCalledWith(expect.objectContaining({
      module: "finance",
      eventCode: "financial_expense",
      targetType: "financial_record",
      targetId: "material_cost",
      deepLink: "/mobile/finance",
    }));
    expect(JSON.stringify(mockNotifyOfficialAccountBusinessEvent.mock.calls)).not.toMatch(/身份证|银行卡|Webhook/i);
  });

  it("公众号投递服务异常会向调用方抛出，由业务路由的非阻塞调用边界负责吞没", async () => {
    mockNotifyOfficialAccountBusinessEvent.mockRejectedValue(new Error("delivery_failed"));

    await expect(notifyOfficialAccountBusinessEventSafely({
      userId: 7,
      module: "transport",
      eventCode: "transport_trip_settled",
      targetType: "transport_trip",
      targetId: "42",
      title: "运输趟次已结算",
      deepLink: "/mobile/transport",
    })).rejects.toThrow("delivery_failed");
  });
});
