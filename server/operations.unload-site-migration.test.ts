import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("卸土点统一安全阈值迁移", () => {
  it("将既有卸土路线的最新规则写入对应卸土点，并保留安全默认值", () => {
    const sql = readFileSync(new URL("../drizzle/0058_sweet_corsair.sql", import.meta.url), "utf8");
    expect(sql).toContain("ALTER TABLE `transport_sites`");
    expect(sql).toContain("minimumTransitMinutes");
    expect(sql).toContain("unloadGeofenceMeters");
    expect(sql).toContain("MAX(`id`) AS `latestRouteId`");
    expect(sql).toContain("WHERE site.`siteType` = 'unload'");
  });
});
