import { describe, expect, it } from "vitest";
import { evaluateRealDataReadiness } from "../shared/realDataReadiness";

describe("全业务真实项目数据健康预检", () => {
  it("缺少资源、采购、计量、分包、财务或服务号任一链路时，不允许标记为完整生产复测", () => {
    const result = evaluateRealDataReadiness({
      organizations: 1, projects: 1, roleAssignments: 1, departmentScopes: 1,
      laborWorkers: 1, attendanceRecords: 1, payrollStatements: 1,
      constructionDailyReports: 1, evidenceRecords: 1, machines: 1, transportVehicles: 1,
      dieselRefuelRecords: 0, transportTrips: 1, purchaseOrders: 1, inventoryTransactions: 1,
      measurementClaims: 1, measurementTakeoffRecords: 1, outsourceContracts: 1, subcontractPackages: 1,
      financialRecords: 1, officialAccountBindings: 1, officialAccountNotifications: 1,
      officialAccountTemplateGaps: 1,
    });

    expect(result.ready).toBe(false);
    expect(result.checks.find(check => check.key === "resources")?.ready).toBe(false);
    expect(result.checks.find(check => check.key === "resources")?.actionPath).toBe("/admin/diesel");
    expect(result.checks.find(check => check.key === "resources")?.ownerRole).toContain("机务");
    expect(result.findings.map(item => item.id)).toEqual(expect.arrayContaining(["resource_without_consumption", "official_template_not_bound"]));
  });

  it("仅在各业务域均有真实聚合记录时标记为可安排完整复测", () => {
    const result = evaluateRealDataReadiness({
      organizations: 2, projects: 3, roleAssignments: 4, departmentScopes: 5,
      laborWorkers: 6, attendanceRecords: 7, payrollStatements: 8,
      constructionDailyReports: 2, evidenceRecords: 3, machines: 1, transportVehicles: 2,
      dieselRefuelRecords: 3, transportTrips: 4, purchaseOrders: 2, inventoryTransactions: 3,
      measurementClaims: 2, measurementTakeoffRecords: 2, outsourceContracts: 1, subcontractPackages: 1,
      financialRecords: 4, officialAccountBindings: 2, officialAccountNotifications: 5,
      officialAccountTemplateGaps: 0,
    });

    expect(result.ready).toBe(true);
    expect(result.checks.every(check => check.ready)).toBe(true);
    expect(result.checks.find(check => check.key === "notification")?.actionLabel).toBe("检查模板投递");
    expect(result.findings).toEqual([]);
  });
});
