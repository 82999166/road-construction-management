import { describe, expect, it } from "vitest";
import { CHINA_DATABASE_TIMEZONE, withChinaDatabaseTimezone } from "./db";

describe("数据库北京时间连接配置", () => {
  it("保留既有连接参数并固定 mysql2 对无时区日期列按 +08:00 解析", () => {
    const url = withChinaDatabaseTimezone("mysql://example_user:example_password@db.example.test:3306/road_management?ssl=true&charset=utf8mb4");
    const parsed = new URL(url);

    expect(parsed.searchParams.get("ssl")).toBe("true");
    expect(parsed.searchParams.get("charset")).toBe("utf8mb4");
    expect(parsed.searchParams.get("timezone")).toBe(CHINA_DATABASE_TIMEZONE);
  });
});
