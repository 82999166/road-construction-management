import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("经营数据大屏", () => {
  it("服务端聚合真实资金、发票、计量、进度与资源台账", () => {
    const service = readFileSync(new URL("./services/adminBusinessBackup.ts", import.meta.url), "utf8");
    const router = readFileSync(new URL("./routers/admin.ts", import.meta.url), "utf8");
    expect(service).toContain("getOperatingDashboardStatistics");
    expect(service).toContain("financialRecords");
    expect(service).toContain("financialInvoices");
    expect(service).toContain("measurementClaims");
    expect(service).toContain("constructionDailyReports");
    expect(service).toContain("temporaryDailyWageSettlements");
    expect(service).toContain("paymentRatio");
    expect(service).toContain("settlementRatio");
    expect(router).toContain("operatingDashboard");
    expect(router).toContain("assertSuperAdmin(ctx)");
  });
});
