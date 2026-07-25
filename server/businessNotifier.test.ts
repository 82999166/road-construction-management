import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDb, mockSendWecom } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockSendWecom: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mockGetDb }));
vi.mock("./services/wecomNotifier", () => ({ sendWecomTextNotification: mockSendWecom }));

import { notifyWecomBusinessEvent } from "./services/businessNotifier";

describe("统一企业微信业务节点通知", () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({ insert });
  });

  it("仅投递模块、状态、单据标识和深链，并记录未配置原因", async () => {
    mockSendWecom.mockResolvedValue({ delivered: false, reason: "not_configured" });

    await expect(notifyWecomBusinessEvent({
      userId: 9,
      module: "finance",
      eventCode: "financial_expense",
      targetType: "financial_record",
      targetId: "material_cost",
      title: "项目支出流水已登记",
      deepLink: "/mobile/finance",
    })).resolves.toEqual({ delivered: false, reason: "not_configured" });

    const content = mockSendWecom.mock.calls[0]?.[0] as string;
    expect(content).toContain("项目支出流水已登记");
    expect(content).toContain("/mobile/finance");
    expect(content).not.toMatch(/\d+(?:\.\d+)?元|身份证|银行卡|Webhook/i);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9,
      module: "finance",
      action: "wecom_delivery",
      targetId: "material_cost",
      summary: "企业微信业务提醒 financial_expense：not_configured",
    }));
  });

  it("企业微信投递失败仍返回结果并留下可追溯审计", async () => {
    mockSendWecom.mockResolvedValue({ delivered: false, reason: "delivery_failed" });

    const result = await notifyWecomBusinessEvent({
      userId: 7,
      module: "transport",
      eventCode: "transport_trip_settled",
      targetType: "transport_trip",
      targetId: "42",
      title: "运输趟次已结算",
      deepLink: "/mobile/transport",
    });

    expect(result).toEqual({ delivered: false, reason: "delivery_failed" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ summary: "企业微信业务提醒 transport_trip_settled：delivery_failed" }));
  });
});
