import { describe, expect, it } from "vitest";
import { formatChinaDate, formatChinaDateTime, formatChinaTime, toChinaDateInput, toChinaMonthInput, toDeviceDateTimeInput } from "./businessTime";

describe("业务时间工具", () => {
  it("将 UTC 时间戳固定转换为中国标准时间展示", () => {
    const source = "2026-08-27T05:47:00.000Z";
    expect(formatChinaDateTime(source)).toBe("2026/8/27 13:47:00");
    expect(formatChinaDate(source)).toBe("2026-08-27");
    expect(formatChinaTime(source)).toBe("13:47");
    expect(toChinaDateInput(source)).toBe("2026-08-27");
    expect(toChinaMonthInput(source)).toBe("2026-08");
  });

  it("为 datetime-local 生成当前设备本地时钟值而非 UTC 截取值", () => {
    const date = new Date("2026-08-27T05:47:00.000Z");
    const expected = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    expect(toDeviceDateTimeInput(date)).toBe(expected);
  });
});
