import { describe, expect, it } from "vitest";
import { chinaBusinessDate, chinaBusinessMonth } from "./chinaBusinessTime";

describe("中国业务日期", () => {
  it("以中国标准时间裁切 UTC 时间戳，避免凌晨记录归入前一日", () => {
    expect(chinaBusinessDate("2026-08-27T00:10:00.000Z")).toBe("2026-08-27");
    expect(chinaBusinessDate("2026-08-26T16:10:00.000Z")).toBe("2026-08-27");
    expect(chinaBusinessMonth("2026-08-31T16:10:00.000Z")).toBe("2026-09");
  });
});
