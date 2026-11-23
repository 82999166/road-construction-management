import { toDeviceDateTimeInput } from "./businessTime";

export type DieselCorrectionRecord = {
  id: number;
  projectId: number;
  recordNo: string;
  assetType: "vehicle" | "machine";
  vehicleId: number | null;
  machineId: number | null;
  transportTripId: number | null;
  supplyMethod: "project_supply" | "external_station";
  stationOrSupplierName: string | null;
  liters: string | number;
  actualUnitPrice: string | number | null;
  amount: string | number;
  deductFromFreight: boolean;
  refueledAt: Date | string;
  updatedAt: Date | string;
  meterReading: string | number | null;
  receiptNo: string | null;
  evidenceId: number | null;
  remarks: string | null;
  status: string;
  assetName?: string;
  readOnly?: boolean;
  receiptEvidence?: { url: string | null; fileName: string | null; mimeType: string | null } | null;
};

export function dieselCorrectionLockReason(
  record: Pick<DieselCorrectionRecord, "recordNo" | "status" | "readOnly">
) {
  if (record.readOnly || record.recordNo.startsWith("DS-MC-"))
    return "机械录入：请在机械管理原记录修改或删除";
  if (record.status === "settled") return "已结算，不能修改或删除";
  if (record.status === "void") return "已删除/作废，仅供追溯";
  if (!["draft", "approved"].includes(record.status))
    return "当前状态不能修改或删除";
  return null;
}

export function createDieselEditForm(record: DieselCorrectionRecord) {
  const originalRefueledAt = new Date(record.refueledAt).toISOString();
  return {
    id: record.id,
    expectedUpdatedAt: new Date(record.updatedAt).toISOString(),
    originalRefueledAt,
    originalRefueledAtInput: toDeviceDateTimeInput(record.refueledAt),
    evidenceId: record.evidenceId,
    originalReceipt: record.receiptEvidence ?? null,
    projectId: String(record.projectId),
    assetType: record.assetType,
    vehicleId: record.vehicleId === null ? "" : String(record.vehicleId),
    machineId: record.machineId === null ? "" : String(record.machineId),
    transportTripId:
      record.transportTripId === null ? "" : String(record.transportTripId),
    supplyMethod: record.supplyMethod,
    stationOrSupplierName: record.stationOrSupplierName ?? "",
    liters: String(record.liters),
    actualUnitPrice:
      record.actualUnitPrice === null ? "" : String(record.actualUnitPrice),
    deductFromFreight: record.deductFromFreight,
    refueledAt: toDeviceDateTimeInput(record.refueledAt),
    meterReading:
      record.meterReading === null ? "" : String(record.meterReading),
    receiptNo: record.receiptNo ?? "",
    remarks: record.remarks ?? "",
    status: "approved" as const,
  };
}

/** 未修改时间时保留原秒数/毫秒，避免 datetime-local 的分钟精度改写历史时间。 */
export function dieselRefueledAtForSave(form: {
  refueledAt: string;
  originalRefueledAt?: string;
  originalRefueledAtInput?: string;
}) {
  return form.originalRefueledAt &&
    form.refueledAt === form.originalRefueledAtInput
    ? form.originalRefueledAt
    : new Date(form.refueledAt).toISOString();
}
