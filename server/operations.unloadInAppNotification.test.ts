import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("运输卸土成功站内通知", () => {
  const source = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );

  it("以卸土刷卡事件和收件人为幂等键写入站内通知，不回滚运输条件更新", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'eventCode: "transport_unload_completed"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "idempotencyKey: `inapp:transport-unload:${event.id}:${recipientUserId}`"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "trip.loadConfirmedBy, user.id, siteAdministratorUserId, vehicle.driverUserId"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'onDuplicateKeyUpdate({ set: { status: "sent", sentAt: notificationTime } })'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("装土成功和异常复核向已绑定司机账号写入幂等站内消息，不依赖服务号模板", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "async function notifyBoundDriverInApp"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'channel: "in_app"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'eventCode: "transport_load_driver_notice"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "idempotencyKey: `inapp:transport-load:${event.id}:${vehicle.driverUserId ?? 0}`"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'eventCode: "transport_card_event_exception"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "idempotencyKey: `inapp:transport-card-review:${event.id}:${vehicle.driverUserId ?? 0}`"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'write.onDuplicateKeyUpdate({ set: { status: "sent", sentAt } })'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "eventCode: `transport_${eventType}_driver_notice`"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("所有装土、卸土成功通知均携带服务端计算的车辆当日阶段车次", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车${eventLabel}成功"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车装土成功"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "const mobileNfcTripOrdinal = event.success && !event.needsReview"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "车辆 ${vehicle.plateNo} 今日第 ${mobileNfcTripOrdinal} 车装土成功"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '车辆 ${vehicle.plateNo} 今日第 ${dailyVehicleTripOrdinal} 车卸土成功，${trip.invoiceMode === "plate_photo" ? "拍照发票" : "刷卡发票"}已通过卸土现场拍照确认'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("列表投影返回两端实际确认管理员及时间", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "loadConfirmation: { administratorName: trip.loadConfirmedBy"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "unloadConfirmation: { administratorName: trip.unloadConfirmedBy"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
