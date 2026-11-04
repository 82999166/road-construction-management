import { afterEach, describe, expect, it } from "vitest";
import {
  dateTimeEpoch,
  vehicleDateTimeInput,
} from "./vehicleManagementWorkspace";
const originalZone = process.env.TZ;
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});
describe.each(["UTC", "America/Los_Angeles", "Asia/Shanghai"])(
  "车辆北京时间录入：设备时区 %s",
  zone => {
    it("默认录入值按中国时区展示，提交后保留同一个UTC分钟", () => {
      process.env.TZ = zone;
      const original = new Date("2026-11-03T23:55:00.000Z");
      const input = vehicleDateTimeInput(original);
      expect(input).toBe("2026-11-04T07:55");
      expect(dateTimeEpoch(input)).toBe(original.getTime());
    });
    it("显式UTC及显式偏移时间不再次附加时区，非法输入拒绝", () => {
      process.env.TZ = zone;
      const utc = "2026-11-03T23:55:00.000Z";
      expect(dateTimeEpoch(utc)).toBe(new Date(utc).getTime());
      expect(dateTimeEpoch("2026-11-04T07:55:00+08:00")).toBe(
        new Date(utc).getTime()
      );
      expect(() => dateTimeEpoch("无法解析的日期")).toThrow("有效发生时间");
    });
  }
);
