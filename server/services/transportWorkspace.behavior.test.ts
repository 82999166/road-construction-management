import { describe, expect, it } from "vitest";
import {
  classifyTransportSettlement,
  effectiveTransportSafety,
  getTransportReviewEligibility,
  projectTransportSafetySnapshot,
} from "./transportWorkspace";
import { buildTransportSettlementBasis } from "./transportSettlementBasis";
const time = new Date("2026-11-03T17:00:00Z");
const normal = () => ({
  id: 1,
  status: "submitted",
  invoiceMode: "nfc_card",
  loadConfirmedAt: time,
  unloadConfirmedAt: new Date(time.getTime() + 600000),
  endAt: new Date(time.getTime() + 600000),
  loadConfirmedBy: 2,
  unloadConfirmedBy: 3,
  loadEventId: 10,
  unloadEventId: 11,
  routeSnapshot: {},
  exceptionStatus: "none",
});
const events = [
  { id: 10, tripId: 1, eventType: "load", validationStatus: "accepted" },
  { id: 11, tripId: 1, eventType: "unload", validationStatus: "accepted" },
];
const evidence = { load: false, unload: false };
describe("运输真实闭环核验资格", () => {
  it("有效双刷可以核验，无卸土证据即使有endAt也不可放行", () => {
    expect(
      getTransportReviewEligibility(normal(), events, evidence).eligible
    ).toBe(true);
    expect(
      getTransportReviewEligibility(
        { ...normal(), unloadConfirmedAt: null },
        events,
        evidence
      ).eligible
    ).toBe(false);
    expect(
      getTransportReviewEligibility(
        normal(),
        events.filter(event => event.eventType !== "unload"),
        evidence
      ).eligible
    ).toBe(false);
  });
  it("错单、needs_review和手填事件ID不能伪造闭环", () => {
    expect(
      getTransportReviewEligibility(
        normal(),
        events.map(event => ({ ...event, tripId: 99 })),
        evidence
      ).eligible
    ).toBe(false);
    expect(
      getTransportReviewEligibility(
        normal(),
        events.map(event => ({ ...event, validationStatus: "needs_review" })),
        evidence
      ).eligible
    ).toBe(false);
  });
  it("拍照装卸必须有对应项目证据与有效卸土确认，不能只认照片ID", () => {
    const trip = {
      ...normal(),
      invoiceMode: "plate_photo",
      routeSnapshot: { unloadConfirmationMode: "photo" },
    };
    expect(
      getTransportReviewEligibility(trip, events, { load: true, unload: true })
        .eligible
    ).toBe(true);
    expect(
      getTransportReviewEligibility(trip, events, { load: false, unload: true })
        .eligible
    ).toBe(false);
    expect(
      getTransportReviewEligibility(trip, events, { load: true, unload: false })
        .eligible
    ).toBe(false);
  });
  it("单次特殊闭环要求真实服务器来源，但不要求虚构卸土事件", () => {
    const trip = {
      ...normal(),
      unloadEventId: null,
      unloadConfirmedBy: null,
      routeSnapshot: {
        nfcSingleScanClosed: true,
        nfcSingleScanClosedAt: time.toISOString(),
        nfcSingleScanClosedBy: 2,
      },
    };
    const result = getTransportReviewEligibility(
      trip,
      events.slice(0, 1),
      evidence
    );
    expect(result).toMatchObject({
      eligible: true,
      closureKind: "single_scan",
    });
    expect(
      getTransportReviewEligibility(
        { ...trip, routeSnapshot: { nfcSingleScanClosed: true } },
        events,
        evidence
      ).eligible
    ).toBe(false);
  });
  it("卸土补刷不伪造装土时间，必须真实卸土已接受并具有来源标识", () => {
    const trip = {
      ...normal(),
      loadConfirmedAt: null,
      loadConfirmedBy: null,
      loadEventId: null,
      routeSnapshot: {
        unloadOnlyCardClose: true,
        unloadOnlyCardClosedAt: time.toISOString(),
        loadCardRecorded: false,
      },
    };
    expect(
      getTransportReviewEligibility(trip, events.slice(1), evidence)
    ).toMatchObject({ eligible: true, closureKind: "unload_only" });
    expect(
      getTransportReviewEligibility(
        { ...trip, unloadEventId: null },
        events,
        evidence
      ).eligible
    ).toBe(false);
  });
  it("异常资格独立标识需显式核对，冲突特殊模式拒绝", () => {
    expect(
      getTransportReviewEligibility(
        { ...normal(), exceptionStatus: "open" },
        events,
        evidence
      ).requiresExceptionReview
    ).toBe(true);
    expect(
      getTransportReviewEligibility(
        {
          ...normal(),
          routeSnapshot: {
            nfcSingleScanClosed: true,
            unloadOnlyCardClose: true,
          },
        },
        events,
        evidence
      ).eligible
    ).toBe(false);
  });
  it("投影保留特殊业务事实但剔除坐标、令牌、账户、来源设备与存储键", () => {
    const projected = projectTransportSafetySnapshot(
      {
        routePresetId: 2,
        nfcSingleScanClosed: true,
        nfcSingleScanClosedAt: time.toISOString(),
        unloadOnlyCardClose: false,
        startLatitude: 12,
        endLongitude: 30,
        token: "SECRET",
        fileKey: "private",
        payeeAccount: "account",
        nfcSingleScanClosedBy: 99,
      },
      "nfc_card"
    );
    expect(projected.nfcSingleScanClosed).toBe(true);
    expect(JSON.stringify(projected)).not.toMatch(
      /SECRET|private|account|Latitude|Longitude|ClosedBy/
    );
    expect(
      projectTransportSafetySnapshot(
        { nfcSingleScanClosed: true },
        "plate_photo"
      ).nfcSingleScanClosed
    ).toBe(false);
  });
  it("地点实际策略覆盖旧路线且支持历史缺字段回退", () => {
    const route = {
      minimumTransitMinutes: 10,
      minimumTransitEnabled: true,
      unloadGeofenceMeters: 300,
      unloadGeofenceEnabled: true,
    };
    expect(
      effectiveTransportSafety(
        {
          minimumTransitMinutes: 30,
          minimumTransitEnabled: false,
          unloadGeofenceMeters: 100,
          unloadGeofenceEnabled: false,
        },
        route
      )
    ).toEqual({
      minimumTransitMinutes: 30,
      minimumTransitEnabled: false,
      unloadGeofenceMeters: 100,
      unloadGeofenceEnabled: false,
    });
    expect(effectiveTransportSafety(null, route)).toEqual(route);
  });
});
describe("按趟金额与历史付款状态", () => {
  const trip = (id: number, amount: number, status = "verified") => ({
    id,
    status,
    startAt: time,
    calculatedAmount: amount,
    fuelDeductionAmount: 0,
    netSettlementAmount: null,
    volumeCubicMeters: 10,
  });
  it("正常已核验无关联可生成，已关联待付不等于已付", () => {
    expect(
      classifyTransportSettlement(
        { status: "verified" },
        null,
        "trip_settlement"
      )
    ).toMatchObject({ canCreateSettlement: true, paymentConfirmed: false });
    expect(
      classifyTransportSettlement(
        { status: "settled" },
        { id: 8, settlementNo: "S8", status: "approved" },
        "trip_settlement"
      )
    ).toMatchObject({
      canCreateSettlement: false,
      legacyUnlinkedSettled: false,
      paymentConfirmed: false,
    });
    expect(
      classifyTransportSettlement(
        { status: "settled" },
        null,
        "trip_settlement"
      )
    ).toMatchObject({
      legacyUnlinkedSettled: true,
      canCreateSettlement: false,
      paymentConfirmed: false,
    });
  });
  it("只扣本次候选关联柴油，未关联油款完整分配；倒挂负净应付不丢余额", () => {
    const basis = buildTransportSettlementBasis(
      [trip(1, 100), trip(2, 50)],
      [
        { id: 5, transportTripId: 1, amount: 20 },
        { id: 6, transportTripId: null, amount: 160 },
        { id: 7, transportTripId: 99, amount: 999 },
      ]
    );
    expect(basis.consumedFuelIds).toEqual([5, 6]);
    expect(basis.details.map(row => row.netPayableAmount)).toEqual([0, -30]);
    expect(
      basis.details.reduce((sum, row) => sum + row.fuelDeductionAmount, 0)
    ).toBe(180);
    expect(basis.details[0].tripDate).toBe("2026-11-04");
  });
  it("历史settled保留原扣款和原净额，不能重新扣归集柴油", () => {
    const legacy = {
      ...trip(9, 100, "settled"),
      fuelDeductionAmount: 45,
      netSettlementAmount: 55,
    };
    const basis = buildTransportSettlementBasis(
      [legacy],
      [{ id: 6, transportTripId: null, amount: 88 }]
    );
    expect(basis.details[0]).toMatchObject({
      grossFreightAmount: 100,
      fuelDeductionAmount: 45,
      netPayableAmount: 55,
    });
    expect(basis.consumedFuelIds).toEqual([]);
  });
  it("历史单排列在最后也不截断正常新趟次柴油倒挂", () => {
    const basis = buildTransportSettlementBasis(
      [
        trip(1, 50),
        {
          ...trip(9, 100, "settled"),
          fuelDeductionAmount: 40,
          netSettlementAmount: 60,
        },
      ],
      [{ id: 6, transportTripId: null, amount: 100 }]
    );
    expect(basis.details.map(row => row.netPayableAmount)).toEqual([-50, 60]);
  });
});
