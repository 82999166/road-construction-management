import { describe, expect, it } from "vitest";
import { DEFAULT_ATTENDANCE_DEVICE_LIMIT, normalizeAttendanceDeviceLimit } from "./attendanceDevicePolicy";

describe("考勤设备绑定上限", () => {
  it("缺失或非法配置安全回退为默认3台", () => {
    expect(normalizeAttendanceDeviceLimit(undefined)).toBe(DEFAULT_ATTENDANCE_DEVICE_LIMIT);
    expect(normalizeAttendanceDeviceLimit("0")).toBe(DEFAULT_ATTENDANCE_DEVICE_LIMIT);
    expect(normalizeAttendanceDeviceLimit("51")).toBe(DEFAULT_ATTENDANCE_DEVICE_LIMIT);
    expect(normalizeAttendanceDeviceLimit("abc")).toBe(DEFAULT_ATTENDANCE_DEVICE_LIMIT);
  });

  it("接受1至50台的整数配置", () => {
    expect(normalizeAttendanceDeviceLimit("1")).toBe(1);
    expect(normalizeAttendanceDeviceLimit("5")).toBe(5);
    expect(normalizeAttendanceDeviceLimit("50")).toBe(50);
  });
});
