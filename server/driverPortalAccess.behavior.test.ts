import { describe, expect, it } from "vitest";
import {
  buildDriverReadRanges,
  driverBusinessDayStart,
  driverRangeCovers,
  driverSettlementPaymentFacts,
  type DriverPaymentFact,
  type DriverReadRange,
} from "./services/driverPortalAccess";

type Input = Parameters<typeof buildDriverReadRanges>[0];
type Assignment = Input["assignments"][number];
type Grant = Input["grants"][number];
type PersonnelBinding = NonNullable<Input["personnelBindings"]>[number];
type PersonnelEvent = NonNullable<Input["personnelEvents"]>[number];
const at = (iso: string) => new Date(iso);
const now = at("2026-11-04T04:00:00Z").getTime();
const first = at("2026-11-01T00:00:00+08:00");
const handover = at("2026-11-04T10:00:00+08:00");
const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 1, vehicleId: 7, projectId: 11, fromProjectId: null, action: "enter", driverPersonId: null,
  driverUserId: 101, driverBindingId: null, effectiveFrom: first, effectiveTo: handover,
  meterReading: null, condition: "实际进场", reason: "本人服务区间", createdBy: 1, createdAt: first, ...overrides,
});
const grant = (overrides: Partial<Grant> = {}): Grant => ({
  id: 1, vehicleId: 7, projectId: 11, userId: 101, driverBindingId: null, role: "driver", scope: "service_period",
  effectiveFrom: first, effectiveTo: handover, validFrom: at("2026-11-04T01:00:00Z"),
  validTo: at("2026-11-04T05:00:00Z"), revokedAt: null, revokedBy: null,
  reason: "审核后的本人期间授权", createdBy: 1, createdAt: first, ...overrides,
});
const ranges = (overrides: Partial<Input> = {}) => buildDriverReadRanges({ subject: { userId: 101 }, assignments: [], grants: [], now, ...overrides });
const range = (from: number, to: number, overrides: Partial<DriverReadRange> = {}): DriverReadRange => ({ vehicleId: 7, projectId: 11, from, to, source: "assignment", allHistory: false, ...overrides });
const personnelBinding = (overrides: Partial<PersonnelBinding> = {}): PersonnelBinding => ({
  id: 1, personId: 51, assetType: "vehicle", assetId: 7, projectId: 11,
  effectiveFrom: "2026-11-01", effectiveTo: null, createdBy: 1, createdAt: first, ...overrides,
});
const identity = (userId: number | null, personId = 51) => ({ assetType: "vehicle", assetId: 7, projectId: 11, personId, userId });
const event = (id: number, createdAt: Date, before: unknown, after: unknown, overrides: Partial<PersonnelEvent> = {}): PersonnelEvent => ({
  id, personId: 51, action: "resource_binding", version: id, changes: { resourceBinding: { before, after } }, createdBy: 1, createdAt, ...overrides,
});

// These tests call only exported pure functions. No account, DB, token, or network operations.
describe("driver portal: deny predecessor, future, wrong-project and cross-driver records", () => {
  it("without explicit assignment/grant/audit proof, current vehicle fields cannot confer history", () => {
    expect(ranges()).toEqual([]);
    expect(ranges({ assignments: [assignment({ action: "baseline", effectiveFrom: at("2020-01-01T00:00:00Z") })] })).toEqual([]);
    expect(driverRangeCovers([], 7, 11, first.getTime())).toBe(false);
  });

  it("former driver sees only actual closed service interval, not before or at handover", () => {
    const own = ranges({ assignments: [assignment()] });
    expect(driverRangeCovers(own, 7, 11, first.getTime() - 1)).toBe(false);
    expect(driverRangeCovers(own, 7, 11, first.getTime())).toBe(true);
    expect(driverRangeCovers(own, 7, 11, handover.getTime() - 1)).toBe(true);
    expect(driverRangeCovers(own, 7, 11, handover.getTime())).toBe(false);
    expect(driverRangeCovers(own, 8, 11, first.getTime())).toBe(false);
    expect(driverRangeCovers(own, 7, 12, first.getTime())).toBe(false);
  });

  it("another user's assignment and a future assignment never authorize the subject", () => {
    expect(ranges({ assignments: [assignment({ driverUserId: 102 }), assignment({ id: 2, effectiveFrom: at("2026-11-05T00:00:00Z"), effectiveTo: null })] })).toEqual([]);
  });

  it("whole China-business-day settlement crossing a 10:00 handover is not visible to either driver", () => {
    const dayStart = driverBusinessDayStart("2026-11-04"), dayEnd = dayStart + 86400000;
    const oldDriver = ranges({ assignments: [assignment()] });
    const newDriver = ranges({ subject: { userId: 102 }, assignments: [assignment({ driverUserId: 102, effectiveFrom: handover, effectiveTo: null })] });
    expect(driverRangeCovers(oldDriver, 7, 11, dayStart, dayEnd)).toBe(false);
    expect(driverRangeCovers(newDriver, 7, 11, dayStart, dayEnd)).toBe(false);
    expect(driverRangeCovers(oldDriver, 7, 11, driverBusinessDayStart("2026-11-01"), driverBusinessDayStart("2026-11-03") + 86400000)).toBe(true);
  });

  it("continuous own fragments merge, but any one-millisecond service gap blocks the whole statement", () => {
    const from = first.getTime(), middle = from + 86400000, to = middle + 86400000;
    expect(driverRangeCovers([range(middle, to), range(from, middle)], 7, 11, from, to)).toBe(true);
    expect(driverRangeCovers([range(from, middle), range(middle + 1, to)], 7, 11, from, to)).toBe(false);
    expect(driverRangeCovers([range(from, middle), range(middle, to, { projectId: 12 })], 7, 11, from, to)).toBe(false);
    expect(driverRangeCovers([range(from, to)], 7, 11, NaN, to)).toBe(false);
  });

  it("a reused predecessor binding ID cannot override a conflicting driver's precise identity snapshot", () => {
    // assignFleet can currently retain activeBindings[0].id during a user-changing handover.
    const nextDriver = assignment({ driverUserId: 102, driverBindingId: 201, effectiveFrom: handover, effectiveTo: null, action: "handover" });
    const predecessor = ranges({ subject: { userId: 101, bindingId: 201 }, assignments: [nextDriver] });
    expect(driverRangeCovers(predecessor, 7, 11, handover.getTime())).toBe(false);
    const actualDriver = ranges({ subject: { userId: 102 }, assignments: [nextDriver] });
    expect(driverRangeCovers(actualDriver, 7, 11, handover.getTime())).toBe(true);
  });
});

describe("driver portal: grant validity is checked now, separately from business history", () => {
  it.each([
    { label: "expired", overrides: { validTo: at("2026-11-04T03:59:59Z") } },
    { label: "at expiry", overrides: { validTo: new Date(now) } },
    { label: "future validity", overrides: { validFrom: new Date(now + 1) } },
    { label: "revoked", overrides: { revokedAt: at("2026-11-04T03:00:00Z") } },
    { label: "other subject", overrides: { userId: 102 } },
  ])("$label grants do not revive old business records", ({ overrides }) => {
    expect(ranges({ grants: [grant(overrides)] })).toEqual([]);
  });

  it("a live service-period grant allows its past interval, but never predecessor or successor intervals", () => {
    const own = ranges({ grants: [grant()] });
    expect(driverRangeCovers(own, 7, 11, first.getTime())).toBe(true);
    expect(driverRangeCovers(own, 7, 11, first.getTime() - 1)).toBe(false);
    expect(driverRangeCovers(own, 7, 11, handover.getTime())).toBe(false);
  });

  it("only explicit live all_history permits previous statements; revocation removes it immediately", () => {
    const full = grant({ scope: "all_history" });
    expect(driverRangeCovers(ranges({ grants: [full] }), 7, 11, driverBusinessDayStart("2020-01-01"), driverBusinessDayStart("2020-02-01"))).toBe(true);
    expect(ranges({ grants: [{ ...full, revokedAt: new Date(now) }] })).toEqual([]);
    expect(ranges({ grants: [{ ...full, validTo: new Date(now) }] })).toEqual([]);
  });

  it("binding-only authorization is limited to that exact binding ID", () => {
    const own = grant({ userId: null, driverBindingId: 201 });
    expect(ranges({ subject: { bindingId: 201 }, grants: [own] })).toHaveLength(1);
    expect(ranges({ subject: { bindingId: 202 }, grants: [own] })).toEqual([]);
  });
});

describe("driver portal: date-only personnel bindings need true identity audit proof", () => {
  it("asset-createdAt/synthesized baselines and adopt_legacy audits cannot establish a driver's historical identity", () => {
    expect(ranges({ personnelBindings: [personnelBinding()] })).toEqual([]);
    expect(ranges({ personnelBindings: [personnelBinding()], personnelEvents: [event(1, first, null, identity(101), { action: "adopt_legacy" })] })).toEqual([]);
  });

  it("real identity starts at audit timestamp, not midnight of the DATE-only resource relation", () => {
    const start = at("2026-11-01T10:00:00+08:00");
    const own = ranges({ personnelBindings: [personnelBinding()], personnelEvents: [event(1, start, null, identity(101))] });
    expect(driverRangeCovers(own, 7, 11, start.getTime() - 1)).toBe(false);
    expect(driverRangeCovers(own, 7, 11, start.getTime())).toBe(true);
    expect(driverRangeCovers(own, 7, 11, driverBusinessDayStart("2026-11-01"), driverBusinessDayStart("2026-11-02"))).toBe(false);
  });

  it("real account change ends legacy access and other-driver precise responsibility supersedes day-only access", () => {
    const start = at("2026-11-01T10:00:00+08:00");
    const own = ranges({ personnelBindings: [personnelBinding()], personnelEvents: [event(1, start, null, identity(101)), event(2, handover, identity(101), identity(102))] });
    expect(driverRangeCovers(own, 7, 11, handover.getTime() - 1)).toBe(true);
    expect(driverRangeCovers(own, 7, 11, handover.getTime())).toBe(false);
    const superseded = ranges({ personnelBindings: [personnelBinding()], personnelEvents: [event(1, start, null, identity(101))], assignments: [assignment({ driverUserId: 102, effectiveFrom: handover, effectiveTo: null })] });
    expect(driverRangeCovers(superseded, 7, 11, handover.getTime())).toBe(false);
  });

  it("SQL DATE in a Date object denotes the same China calendar day as its string representation", () => {
    expect(driverBusinessDayStart(at("2026-11-04T00:00:00Z"))).toBe(driverBusinessDayStart("2026-11-04"));
    expect(driverBusinessDayStart("2026-11-04")).toBe(at("2026-11-04T00:00:00+08:00").getTime());
  });
});

const statement = (overrides: Partial<Parameters<typeof driverSettlementPaymentFacts>[0]> = {}): Parameters<typeof driverSettlementPaymentFacts>[0] => ({ id: 4, projectId: 11, status: "approved", netPayableAmount: "700", ...overrides });
const payment = (overrides: Partial<DriverPaymentFact> = {}): DriverPaymentFact => ({ projectId: 11, settlementType: "transport_vehicle", settlementId: 4, direction: "expense", amount: "200", paymentDate: at("2026-11-04T00:00:00Z"), paidAt: at("2026-11-04T03:00:00Z"), status: "active", ...overrides });
describe("driver portal: payment status is derived from scoped cash, not legacy labels", () => {
  it("legacy paid without any active payment fact remains unconfirmed with the full balance", () => {
    expect(driverSettlementPaymentFacts(statement({ status: "paid" }), [], 0)).toMatchObject({ confirmed: true, actualPaidAmount: 0, remainingPayableAmount: 700, legacyPaymentUnconfirmed: true, paymentStatus: "unconfirmed", paidAt: null, paymentDate: null });
  });

  it("200 active payment against 700 approved payable leaves 500; reversed/invalid/foreign facts do not contribute", () => {
    const records = [payment(), payment({ status: "reversed", amount: "999" }), payment({ projectId: 12, amount: "999" }), payment({ settlementId: 5, amount: "999" }), payment({ settlementType: "machine", amount: "999" }), payment({ amount: "-25" }), payment({ amount: "NaN" })];
    expect(driverSettlementPaymentFacts(statement(), records, 999)).toMatchObject({ actualPaidAmount: 200, actualReceivedAmount: 0, remainingPayableAmount: 500, recoveredOffsetAmount: 0, paymentStatus: "partial", paymentDate: "2026-11-04" });
    expect(driverSettlementPaymentFacts(statement(), records, 999).paymentFacts).toHaveLength(1);
  });

  it("negative 300 receivable less actual income 80 and validated offset 120 leaves recovery balance 100", () => {
    expect(driverSettlementPaymentFacts(statement({ status: "receivable", netPayableAmount: "-300" }), [payment({ direction: "income", amount: "80" }), payment({ amount: "999" })], 120)).toMatchObject({ actualReceivedAmount: 80, recoveredOffsetAmount: 120, remainingPayableAmount: 0, remainingReceivableAmount: 100, paymentStatus: "partial_recovery" });
  });

  it("offset status alone does not establish recovery; explicit cash/validated offsets do", () => {
    expect(driverSettlementPaymentFacts(statement({ status: "offset", netPayableAmount: "-300" }), [], 0)).toMatchObject({ remainingReceivableAmount: 300, recoveredOffsetAmount: 0, paymentStatus: "receivable" });
    expect(driverSettlementPaymentFacts(statement({ status: "offset", netPayableAmount: "-300" }), [], 300)).toMatchObject({ remainingReceivableAmount: 0, paymentStatus: "recovered" });
  });

  it("draft is pending approval even with an inconsistent cash row; void excludes all cash facts", () => {
    expect(driverSettlementPaymentFacts(statement({ status: "draft" }), [payment()], 300)).toMatchObject({ confirmed: false, remainingPayableAmount: 0, recoveredOffsetAmount: 0, paymentStatus: "pending_approval" });
    expect(driverSettlementPaymentFacts(statement({ status: "void" }), [payment()], 300)).toMatchObject({ actualPaidAmount: 0, actualReceivedAmount: 0, paymentFacts: [] });
  });

  it("an opposite-direction cash fact cannot confirm a legacy paid payable", () => {
    expect(driverSettlementPaymentFacts(statement({ status: "paid" }), [payment({ direction: "income", amount: "50" })], 0)).toMatchObject({ actualPaidAmount: 0, remainingPayableAmount: 700, legacyPaymentUnconfirmed: true, paymentStatus: "unconfirmed" });
  });

  it("zero payable is a zero statement, not a fabricated expense payment", () => {
    expect(driverSettlementPaymentFacts(statement({ netPayableAmount: "0" }), [], 0)).toMatchObject({ actualPaidAmount: 0, remainingAmount: 0, paymentStatus: "zero" });
  });
});
