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

  it("装土成功和异常复核向已绑定司机账号写入幂等站内消息，不依赖服务号模板", () => {
    expect(source).toContain("async function notifyBoundDriverInApp");
    expect(source).toContain('channel: "in_app"');
    expect(source).toContain('eventCode: "transport_load_driver_notice"');
    expect(source).toContain('idempotencyKey: `inapp:transport-load:${event.id}:${vehicle.driverUserId ?? 0}`');
    expect(source).toContain('eventCode: "transport_card_event_exception"');
    expect(source).toContain('idempotencyKey: `inapp:transport-card-review:${event.id}:${vehicle.driverUserId ?? 0}`');
    expect(source).toContain('write.onDuplicateKeyUpdate({ set: { status: "sent", sentAt } })');
    expect(source).not.toContain('eventCode: `transport_${eventType}_driver_notice`');
  });

  it("列表投影返回两端实际确认管理员及时间", () => {
    expect(source).toContain('loadConfirmation: { administratorName: trip.loadConfirmedBy');
    expect(source).toContain('unloadConfirmation: { administratorName: trip.unloadConfirmedBy');
  });
});
