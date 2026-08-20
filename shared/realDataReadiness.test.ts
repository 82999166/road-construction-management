import { describe, expect, it } from "vitest";
import { evaluateRealDataReadiness } from "./realDataReadiness";

describe("真实项目数据验收预检", () => {
  it("在缺少劳务、考勤或工资真实数据时保持未就绪，不生成模拟记录", () => {
    const result = evaluateRealDataReadiness({ organizations: 1, projects: 1, roleAssignments: 1, departmentScopes: 1, laborWorkers: 0, attendanceRecords: 0, payrollStatements: 0 });
    expect(result.ready).toBe(false);
    expect(result.checks.find(check => check.key === "labor")?.ready).toBe(false);
    expect(result.checks.find(check => check.key === "print")?.ready).toBe(false);
  });

  it("仅在授权、现场、资源、采购、计量、分包、财务、通知与劳务真实记录齐备时允许进行完整复测", () => {
    const result = evaluateRealDataReadiness({ organizations: 2, projects: 3, roleAssignments: 4, departmentScopes: 5, laborWorkers: 6, attendanceRecords: 7, payrollStatements: 8, constructionDailyReports: 2, evidenceRecords: 3, machines: 1, transportVehicles: 2, dieselRefuelRecords: 3, transportTrips: 4, purchaseOrders: 2, inventoryTransactions: 3, measurementClaims: 2, measurementTakeoffRecords: 2, outsourceContracts: 1, subcontractPackages: 1, financialRecords: 4, officialAccountBindings: 2, officialAccountNotifications: 5 });
    expect(result.ready).toBe(true);
    expect(result.checks.every(check => check.ready)).toBe(true);
  });
});
