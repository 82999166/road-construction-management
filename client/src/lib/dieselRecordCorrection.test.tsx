import { describe, expect, it } from "vitest";
import {
  createDieselEditForm,
  dieselCorrectionLockReason,
  dieselRefueledAtForSave,
  type DieselCorrectionRecord,
} from "./dieselRecordCorrection";

export const fixture: DieselCorrectionRecord = {
  id: 12,
  projectId: 30003,
  recordNo: "DS30003-test",
  assetType: "machine",
  vehicleId: null,
  machineId: 3,
  transportTripId: null,
  supplyMethod: "external_station",
  stationOrSupplierName: "中国石化淘沙加油站",
  liters: "179.80",
  actualUnitPrice: "8.64",
  amount: "1553.47",
  deductFromFreight: false,
  refueledAt: new Date("2026-11-12T10:51:37.123Z"),
  updatedAt: new Date("2026-11-12T10:52:00Z"),
  meterReading: "0",
  receiptNo: "receipt001",
  evidenceId: 59,
  remarks: "原始说明",
  status: "approved",
  assetName: "中联375 · 03",
};

describe("柴油记录纠错回填", () => {
  it("已审核普通柴油记录允许修改删除，机械来源和终态明确锁定", () => {
    expect(dieselCorrectionLockReason(fixture)).toBeNull();
    expect(
      dieselCorrectionLockReason({ ...fixture, status: "settled" })
    ).toContain("已结算");
    expect(
      dieselCorrectionLockReason({ ...fixture, status: "void" })
    ).toContain("已删除/作废");
    expect(
      dieselCorrectionLockReason({ ...fixture, recordNo: "DS-MC-12" })
    ).toContain("机械管理");
    expect(
      dieselCorrectionLockReason({ ...fixture, readOnly: true })
    ).toContain("机械管理");
    expect(
      dieselCorrectionLockReason({ ...fixture, status: "unknown" })
    ).toContain("当前状态");
  });
  it("完整回填并保留原始证据、数字精度及0表数", () => {
    expect(createDieselEditForm(fixture)).toMatchObject({
      id: 12,
      projectId: "30003",
      assetType: "machine",
      machineId: "3",
      vehicleId: "",
      evidenceId: 59,
      liters: "179.80",
      actualUnitPrice: "8.64",
      meterReading: "0",
      receiptNo: "receipt001",
      remarks: "原始说明",
      expectedUpdatedAt: "2026-11-12T10:52:00.000Z",
      status: "approved",
    });
  });
  it("车辆回填原趟次关联，空值不被转成0或null文字", () => {
    expect(
      createDieselEditForm({
        ...fixture,
        assetType: "vehicle",
        machineId: null,
        vehicleId: 9,
        transportTripId: 45,
        actualUnitPrice: null,
        receiptNo: null,
        meterReading: null,
        remarks: null,
        evidenceId: null,
      })
    ).toMatchObject({
      vehicleId: "9",
      machineId: "",
      transportTripId: "45",
      actualUnitPrice: "",
      receiptNo: "",
      meterReading: "",
      remarks: "",
      evidenceId: null,
    });
  });
  it("datetime-local未修改时不丢原秒数/毫秒，更改后使用新时间", () => {
    const form = createDieselEditForm(fixture);
    expect(dieselRefueledAtForSave(form)).toBe("2026-11-12T10:51:37.123Z");
    expect(
      dieselRefueledAtForSave({ ...form, refueledAt: "2026-11-13T08:32" })
    ).toBe(new Date("2026-11-13T08:32").toISOString());
    expect(dieselRefueledAtForSave({ refueledAt: "2026-11-13T08:32" })).toBe(
      new Date("2026-11-13T08:32").toISOString()
    );
  });
});
