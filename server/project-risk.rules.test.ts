import { describe, expect, it } from "vitest";
import { buildRiskOverdueEscalationCron, classifyFinanceCategory, detectTransportRisk } from "./routers/projectRisk";

describe("AI 项目风险规则", () => {
  it("按权威业务类别归集生活、柴油、工资、机械、车辆运输与采购成本", () => {
    expect(classifyFinanceCategory({ category: "生活餐费" })).toBe("living");
    expect(classifyFinanceCategory({ sourceType: "diesel_refuel" })).toBe("diesel");
    expect(classifyFinanceCategory({ category: "工资发放" })).toBe("payroll");
    expect(classifyFinanceCategory({ assetType: "machine", costType: "repair" })).toBe("machinery");
    expect(classifyFinanceCategory({ assetType: "vehicle" })).toBe("vehicle_transport");
    expect(classifyFinanceCategory({ sourceType: "purchase_order_settlement" })).toBe("purchasing");
  });

  it("运输里程与时长不匹配时生成可解释的速度和滞留风险", () => {
    const rule = { enabled: true, maxFuelFillRatio: 1.1, maxTransportSpeedKmh: 80, maxTransportDurationMinutes: 180, maxOpenCheckInHours: 14, maxPendingReportHours: 24, overdueEscalationEnabled: false, overdueEscalationHourChina: 9, overdueEscalationCronTaskUid: null };
    const highSpeedTrip = { id: 31, status: "submitted", startAt: new Date("2026-08-17T00:00:00.000Z"), endAt: new Date("2026-08-17T00:10:00.000Z"), actualDistanceKm: "30" } as unknown as Parameters<typeof detectTransportRisk>[0];
    const longDurationTrip = { id: 32, status: "submitted", startAt: new Date("2026-08-17T00:00:00.000Z"), endAt: new Date("2026-08-17T04:30:00.000Z"), actualDistanceKm: "18" } as unknown as Parameters<typeof detectTransportRisk>[0];

    expect(detectTransportRisk(highSpeedTrip, rule).map(item => item.ruleCode)).toContain("TRANSPORT_SPEED_HIGH");
    expect(detectTransportRisk(longDurationTrip, rule).map(item => item.ruleCode)).toContain("TRANSPORT_DURATION_LONG");
  });

  it("将中国标准时间的每日整改升级检查转换为 UTC 六段 cron", () => {
    expect(buildRiskOverdueEscalationCron(9)).toBe("0 0 1 * * *");
    expect(buildRiskOverdueEscalationCron(0)).toBe("0 0 16 * * *");
    expect(() => buildRiskOverdueEscalationCron(24)).toThrow("逾期升级检查时间");
  });
});
