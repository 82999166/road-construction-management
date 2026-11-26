import { describe, expect, it } from "vitest";
import { getChinaBusinessDateRange, formatChinaBusinessDate } from "../shared/chinaBusinessDate";
import { siteChinaDayRange } from "./services/siteOperationsDashboard";
import { transportVehicleSettlements } from "../drizzle/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { gte, lte, and, sql } from "drizzle-orm";
import { format } from "mysql2";

const zones = ["UTC", "Asia/Shanghai", "America/Los_Angeles", "Pacific/Auckland"];
for (const zone of zones) {
  describe(`北京时间整天范围（进程时区 ${zone}）`, () => {
    const inZone = (run: () => void) => {
      const previous = process.env.TZ;
      process.env.TZ = zone;
      try { run(); } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    };
    it.each([
      ["2026-11-26", "2026-11-25T16:00:00.000Z", "2026-11-26T16:00:00.000Z"],
      ["2026-12-31", "2026-12-30T16:00:00.000Z", "2026-12-31T16:00:00.000Z"],
      ["2024-02-29", "2024-02-28T16:00:00.000Z", "2024-02-29T16:00:00.000Z"],
      ["2026-02-28", "2026-02-27T16:00:00.000Z", "2026-02-28T16:00:00.000Z"],
    ])("%s 的大屏与后台使用同一零点边界", (day, from, to) => inZone(() => {
      const range = getChinaBusinessDateRange(day);
      expect(range.start.toISOString()).toBe(from);
      expect(range.end.toISOString()).toBe(to);
      expect(siteChinaDayRange(day)).toEqual(range);
      expect(formatChinaBusinessDate(range.start)).toBe(day);
      expect(formatChinaBusinessDate(new Date(range.end.getTime() - 1))).toBe(day);
      expect(formatChinaBusinessDate(range.end)).not.toBe(day);
    }));
    it("覆盖零点、凌晨、08点和23:59:59全部毫秒，不包含前后相邻日", () => inZone(() => {
      const { start, end } = getChinaBusinessDateRange("2026-11-26");
      const inDay = (value: string) => new Date(value) >= start && new Date(value) < end;
      for (const value of [
        "2026-11-26T00:00:00.000+08:00",
        "2026-11-26T07:39:39.000+08:00",
        "2026-11-26T08:00:00.000+08:00",
        "2026-11-26T23:59:59.000+08:00",
        "2026-11-26T23:59:59.999+08:00",
      ]) expect(inDay(value)).toBe(true);
      expect(inDay("2026-11-25T23:59:59.999+08:00")).toBe(false);
      expect(inDay("2026-11-27T00:00:00.000+08:00")).toBe(false);
    }));
    it("结算DATE不存北京零点时间戳，保留原自然日期", () => inZone(() => {
      const column = transportVehicleSettlements.periodStart;
      const dateOnly = new Date("2026-11-26T00:00:00.000Z");
      // MySqlDate原样交驱动，并非MySqlDateTime的UTC字符串mapper，不能据此认定历史被错写。
      expect(column.mapToDriverValue(dateOnly)).toEqual(dateOnly);
      const predicate = and(
        gte(column, sql`${"2026-11-26"}`),
        lte(transportVehicleSettlements.periodEnd, sql`${"2026-11-26"}`)
      )!;
      const fixed = new MySqlDialect().sqlToQuery(predicate);
      expect(fixed.params).toEqual(["2026-11-26", "2026-11-26"]);
      expect(format(fixed.sql, fixed.params, false, "+08:00")).not.toMatch(/08:00|16:00/);
      const unsafe = new MySqlDialect().sqlToQuery(gte(column, dateOnly));
      expect(format(unsafe.sql, unsafe.params, false, "+08:00")).toContain("2026-11-26 08:00:00");
    }));
  });
}

it.each(["2026-02-29", "2026-11-31", "2026-13-01", "2026-11-26T12:00:00", "not-a-date"])(
  "拒绝无效自然日期 %s", value => expect(() => getChinaBusinessDateRange(value)).toThrow(RangeError)
);
