import { toDeviceDateInput } from "@/lib/businessTime";

export const TAKEOFF_UNITS = [
  { value: "m3", label: "立方米（m³）" }, { value: "m2", label: "平方米（m²）" },
  { value: "m", label: "米（m）" }, { value: "t", label: "吨（t）" },
  { value: "piece", label: "件" }, { value: "set", label: "套" }, { value: "other", label: "其他" },
] as const;
export type TakeoffUnit = (typeof TAKEOFF_UNITS)[number]["value"];
export type TakeoffMeasurementRow = {
  item: string; location: string; length: number | null; width: number | null;
  height: number | null; count: number | null; quantity: number; calculation: string; remarks: string;
};
export type TakeoffEvidence = {
  evidenceId: number; fileName: string; mimeType: string; url: string;
  capturedAt: Date | string | null; description: string | null;
};
export type TakeoffDetail = {
  project: { id: number; name: string };
  submittedByName: string | null; reviewedByName: string | null; evidences: TakeoffEvidence[];
  record: {
    id: number; projectId: number; takeoffNo: string; measurementClaimId: number | null;
    workItem: string; workLocation: string; unit: TakeoffUnit; quantity: string | number;
    unitPrice: string | number; declaredAmount: string | number; takeoffDate: Date | string;
    status: string; submittedBy: number; reviewedBy: number | null; reviewedAt: Date | string | null;
    reviewNote: string | null; lockedAt: Date | string | null; createdAt: Date | string;
    updatedAt: Date | string; workDescription: string | null; measurementBasis: string | null;
    measurementRows: TakeoffMeasurementRow[] | null; version: string;
  };
};
export type TakeoffDraft = {
  measurementClaimId: string; workItem: string; workLocation: string; unit: TakeoffUnit;
  quantity: string; unitPrice: string; takeoffDate: string; workDescription: string | null;
  measurementBasis: string | null; measurementRows: TakeoffMeasurementRow[] | null;
};
export type TakeoffSaveInput = {
  id?: number; projectId: number; measurementClaimId: number | null;
  workItem: string; workLocation: string; unit: TakeoffUnit; quantity: number; unitPrice: number;
  takeoffDate: string; workDescription?: string; measurementBasis?: string;
  measurementRows?: TakeoffMeasurementRow[]; attachmentEvidenceIds?: number[]; expectedVersion?: string;
  documentRequestKey?: string;
};
export function emptyTakeoffDraft(): TakeoffDraft {
  return { measurementClaimId: "", workItem: "", workLocation: "", unit: "m3", quantity: "", unitPrice: "",
    takeoffDate: toDeviceDateInput(new Date()), workDescription: "", measurementBasis: "", measurementRows: [] };
}
export function draftFromDetail(detail: TakeoffDetail): TakeoffDraft {
  const r = detail.record;
  return { measurementClaimId: r.measurementClaimId ? String(r.measurementClaimId) : "", workItem: r.workItem,
    workLocation: r.workLocation, unit: r.unit, quantity: String(r.quantity), unitPrice: String(r.unitPrice),
    takeoffDate: toDeviceDateInput(r.takeoffDate), workDescription: r.workDescription,
    measurementBasis: r.measurementBasis, measurementRows: r.measurementRows };
}
export function emptyMeasurementRow(): TakeoffMeasurementRow {
  return { item: "", location: "", length: null, width: null, height: null, count: null, quantity: 0, calculation: "", remarks: "" };
}
const finiteNonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
export function validMeasurementRow(value: unknown): value is TakeoffMeasurementRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return ([ ["item", 120], ["location", 200], ["calculation", 500], ["remarks", 500] ] as const)
    .every(([key, max]) => typeof r[key] === "string" && (r[key] as string).length <= max)
    && (["length", "width", "height", "count"] as const).every(key => r[key] === null || finiteNonnegative(r[key]))
    && finiteNonnegative(r.quantity);
}
/** 只白名单普通字段；不恢复附件ID、签名URL、业务关联或文件字节。row.location 使用安全别名在本机存储。 */
export function ordinaryTakeoffDraft(d: TakeoffDraft) {
  return { workItem: d.workItem, workPosition: d.workLocation, unit: d.unit, quantity: d.quantity,
    unitPrice: d.unitPrice, takeoffDate: d.takeoffDate, workDescription: d.workDescription,
    measurementBasis: d.measurementBasis, measurementRows: d.measurementRows?.map(row => ({
      item: row.item, position: row.location, length: row.length, width: row.width, height: row.height,
      count: row.count, quantity: row.quantity, calculation: row.calculation, remarks: row.remarks,
    })) ?? null };
}
export function restoreOrdinaryTakeoffDraft(value: unknown): Partial<TakeoffDraft> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const result: Partial<TakeoffDraft> = {};
  for (const [key, max] of [["workItem", 200], ["quantity", 50], ["unitPrice", 50], ["workDescription", 10000], ["measurementBasis", 2000]] as const) {
    if (typeof v[key] === "string" && v[key].length <= max) result[key] = v[key];
    else if ((key === "workDescription" || key === "measurementBasis") && v[key] === null) result[key] = null;
  }
  const position = v.workPosition ?? v.workLocation;
  if (typeof position === "string" && position.length <= 200) result.workLocation = position;
  if (TAKEOFF_UNITS.some(unit => unit.value === v.unit)) result.unit = v.unit as TakeoffUnit;
  if (typeof v.takeoffDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.takeoffDate)) result.takeoffDate = v.takeoffDate;
  if (v.measurementRows === null) result.measurementRows = null;
  else if (Array.isArray(v.measurementRows) && v.measurementRows.length <= 100) {
    const rows = v.measurementRows.map(row => {
      if (!row || typeof row !== "object") return row;
      return { ...row, location: row.position ?? row.location ?? "" };
    });
    if (rows.every(validMeasurementRow)) result.measurementRows = rows.map(r => ({ item: r.item, location: r.location,
      length: r.length, width: r.width, height: r.height, count: r.count, quantity: r.quantity,
      calculation: r.calculation, remarks: r.remarks }));
  }
  return result;
}
export function takeoffSaveInput(d: TakeoffDraft, projectId: number, id: number | undefined, version: string | undefined, attachmentEvidenceIds: number[]): TakeoffSaveInput {
  if (!projectId || d.workItem.trim().length < 2 || d.workLocation.trim().length < 2 || !d.takeoffDate) throw new Error("请完整填写工程项目、位置和日期");
  if (!d.quantity.trim() || !Number.isFinite(Number(d.quantity)) || Number(d.quantity) <= 0 || !d.unitPrice.trim() || !Number.isFinite(Number(d.unitPrice)) || Number(d.unitPrice) < 0) throw new Error("工程量须大于零，单价须为非负有限数字");
  if (id && !version) throw new Error("记录版本缺失，请重新读取后编辑");
  if (d.workDescription && d.workDescription.length > 10000 || d.measurementBasis && d.measurementBasis.length > 2000) throw new Error("工程说明或计量依据超出长度限制");
  if (d.measurementRows && (d.measurementRows.length > 100 || !d.measurementRows.every(validMeasurementRow))) throw new Error("测量明细须为有限非负数，文字不得超长");
  if (attachmentEvidenceIds.length > 20 || attachmentEvidenceIds.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error("新增现场图片 ID 无效或超过 20 张");
  return { id, projectId, measurementClaimId: d.measurementClaimId ? Number(d.measurementClaimId) : null,
    workItem: d.workItem.trim(), workLocation: d.workLocation.trim(), unit: d.unit,
    quantity: Number(d.quantity), unitPrice: Number(d.unitPrice), takeoffDate: d.takeoffDate,
    ...(d.workDescription === null ? {} : { workDescription: d.workDescription }),
    ...(d.measurementBasis === null ? {} : { measurementBasis: d.measurementBasis }),
    ...(d.measurementRows === null ? {} : { measurementRows: d.measurementRows }),
    ...(attachmentEvidenceIds.length ? { attachmentEvidenceIds: [...attachmentEvidenceIds] } : {}),
    ...(id ? { expectedVersion: version } : {}) };
}

export type TakeoffCreateAttempt = { fingerprint: string; key: string };
/** 同一新建业务输入重试使用同一键；编辑不创建键，普通设备草稿不保存此键。 */
export function takeoffCreateAttempt(input: TakeoffSaveInput, previous: TakeoffCreateAttempt | null, createKey: () => string): TakeoffCreateAttempt | null {
  if (input.id) return null;
  const { documentRequestKey: _key, ...businessInput } = input;
  const fingerprint = JSON.stringify(businessInput);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createKey() };
}
