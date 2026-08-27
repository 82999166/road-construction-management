import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("独立移动考勤页安全提示与时间展示", () => {
  it("打卡失败不回显原始服务端错误，时间统一使用中国时区工具", () => {
    const source = readFileSync(new URL("./MobileAttendancePage.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { formatChinaDateTime } from "@/lib/businessTime"');
    expect(source).toContain("考勤打卡提交失败，请稍后重试");
    expect(source).toContain('formatChinaDateTime(value, "—")');
    expect(source).not.toContain("toast.error(error.message)");
    expect(source).not.toContain("toLocaleTimeString(");
  });
});
