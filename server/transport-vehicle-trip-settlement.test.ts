import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canUseVehicleTripSettlement,
  emptyVehicleFinanceSources,
  projectVehicleFinance,
  type VehicleFinanceSources,
} from "./services/vehicleFinance";

describe("渣土车按趟结算", () => {
  const schema = readFileSync(
    new URL("../drizzle/schema.ts", import.meta.url),
    "utf8"
  );
  const adminRouter = readFileSync(
    new URL("./routers/admin.ts", import.meta.url),
    "utf8"
  );
  const operations = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );

  it("在车辆资源性质中持久化按趟结算类型，同时保留自有和外租历史值", () => {
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'mysqlEnum("ownership", ["owned", "leased", "trip_settlement"])'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'z.enum(["owned", "leased", "trip_settlement"])'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("按趟车辆没有租赁规则、使用或租赁结算依据时不凭空产生租金", () => {
    const vehicle = { id: 7, projectId: 2, ownership: "trip_settlement" };
    const sources = emptyVehicleFinanceSources();
    sources.trips = [
      {
        id: 1,
        vehicleId: 7,
        projectId: 2,
        status: "verified",
        startAt: "2026-08-02",
        tripNo: "TR-1",
        calculatedAmount: "1000",
        netSettlementAmount: "1000",
      },
    ];
    for (const profile of [
      null,
      { vehicleId: 7, propertyType: "partner", settlementMode: "trip" },
    ]) {
      const analysis = projectVehicleFinance(
        vehicle,
        2,
        "2026-08",
        sources,
        profile
      );
      expect(analysis.leaseRule).toBeNull();
      for (const row of [
        analysis.summary,
        analysis.cumulative,
        ...analysis.daily,
        ...analysis.monthly,
      ]) {
        expect(row).toMatchObject({
          leaseEstimatedAmount: 0,
          unconfirmedLeaseEstimateAmount: 0,
          confirmedLeaseAmount: 0,
          pendingLeaseAmount: 0,
        });
      }
      expect(analysis.summary).toMatchObject({
        financialNature: "outsourced",
        outsourcedTransportCostAmount: 1000,
        operatingContributionAmount: null,
      });
    }
    expect(
      adminRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'input.ownership === "trip_settlement" ? "，渣土车按趟结算且不计租金"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("当前自有或按趟分类不能抹除旧项目租赁规则、使用依据或已核定原金额快照", () => {
    const sources = emptyVehicleFinanceSources();
    sources.leaseRules = [
      {
        id: 1,
        vehicleId: 7,
        projectId: 2,
        billingType: "monthly",
        rate: "3000",
        effectiveFrom: "2026-08-01",
        effectiveTo: "2026-08-02",
        status: "disabled",
      },
    ];
    sources.settlements = [
      {
        id: 8,
        settlementNo: "LEASE-OLD",
        vehicleId: 7,
        projectId: 2,
        status: "approved",
        settlementKind: "lease",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-02",
        grossFreightAmount: "100.01",
        netPayableAmount: "100.01",
      },
    ];
    const original = JSON.stringify(sources);
    for (const ownership of ["leased", "owned", "trip_settlement"]) {
      for (const currentProjectId of [2, 3]) {
        const result = projectVehicleFinance(
          { id: 7, projectId: currentProjectId, ownership },
          2,
          "2026-08",
          sources,
          {
            vehicleId: 7,
            propertyType: "company_owned",
            settlementMode: "none",
          }
        );
        // 停用月租不再推算新费用；已核定历史租赁快照不可因当前分类而归零。
        expect(result.summary).toMatchObject({
          leaseEstimatedAmount: 0,
          unconfirmedLeaseEstimateAmount: 0,
          confirmedLeaseAmount: 100.01,
          coveredCostAmount: 100.01,
          remainingPayableAmount: 100.01,
        });
        expect(result.cumulative.confirmedLeaseAmount).toBe(100.01);
        expect(
          result.daily.map(row => [row.date, row.confirmedLeaseAmount])
        ).toEqual([
          ["2026-08-02", 50],
          ["2026-08-01", 50.01],
        ]);
        expect(result.monthly[0].confirmedLeaseAmount).toBe(100.01);
        if (currentProjectId === 3)
          expect(result.summary.financialNature).toBe("leased");
        const activeHistory = {
          ...sources,
          leaseRules: sources.leaseRules.map(rule => ({
            ...rule,
            status: "active",
          })),
        };
        expect(
          projectVehicleFinance(
            { id: 7, projectId: currentProjectId, ownership },
            2,
            "2026-08",
            activeHistory,
            {
              vehicleId: 7,
              propertyType: "company_owned",
              settlementMode: "none",
            }
          ).summary
        ).toMatchObject({
          leaseEstimatedAmount: 200,
          unconfirmedLeaseEstimateAmount: 0,
          confirmedLeaseAmount: 100.01,
          coveredCostAmount: 100.01,
        });
      }
    }
    expect(JSON.stringify(sources)).toBe(original);
    const hourly: VehicleFinanceSources = {
      ...emptyVehicleFinanceSources(),
      leaseRules: [
        { ...sources.leaseRules[0], billingType: "hourly", rate: "80" },
      ],
      usage: [
        {
          id: 1,
          vehicleId: 7,
          projectId: 2,
          usageDate: "2026-08-01",
          usageType: "hourly",
          quantity: "2.5",
          status: "confirmed",
          settlementId: null,
        },
      ],
    };
    expect(
      projectVehicleFinance(
        { id: 7, projectId: 2, ownership: "trip_settlement" },
        2,
        "2026-08",
        hourly
      ).summary
    ).toMatchObject({
      leaseEstimatedAmount: 200,
      unconfirmedLeaseEstimateAmount: 200,
      confirmedLeaseAmount: 0,
      sourceCounts: { leaseUsage: 1 },
    });
  });

  it("新结算资格使用明确按趟、吨、方分类而不改写历史车辆兼容性质", () => {
    const vehicle = { id: 7, projectId: 2, ownership: "owned" };
    expect(canUseVehicleTripSettlement(vehicle)).toBe(false);
    expect(
      canUseVehicleTripSettlement({ ...vehicle, ownership: "trip_settlement" })
    ).toBe(true);
    for (const settlementMode of ["trip", "ton", "volume"])
      expect(
        canUseVehicleTripSettlement(vehicle, {
          vehicleId: 7,
          propertyType: "partner",
          settlementMode,
        })
      ).toBe(true);
    expect(
      canUseVehicleTripSettlement(
        { ...vehicle, ownership: "trip_settlement" },
        { vehicleId: 7, propertyType: "rented", settlementMode: "monthly" }
      )
    ).toBe(false);
    expect(operations.replace(/\s+/g, "")).toContain(
      "canUseVehicleTripSettlement(vehicle,classification)"
    );
  });
});
