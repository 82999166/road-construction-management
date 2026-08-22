import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("运输卸土成功站内通知", () => {
  const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

  it("以卸土刷卡事件和收件人为幂等键写入站内通知，不回滚运输条件更新", () => {
    expect(source).toContain('eventCode: "transport_unload_completed"');
    expect(source).toContain('idempotencyKey: `inapp:transport-unload:${event.id}:${recipientUserId}`');
    expect(source).toContain('trip.loadConfirmedBy, user.id, siteAdministratorUserId, vehicle.driverUserId');
    expect(source).toContain('onDuplicateKeyUpdate({ set: { status: "sent", sentAt: notificationTime } })');
  });

  it("列表投影返回两端实际确认管理员及时间", () => {
    expect(source).toContain('loadConfirmation: { administratorName: trip.loadConfirmedBy');
    expect(source).toContain('unloadConfirmation: { administratorName: trip.unloadConfirmedBy');
  });
});
