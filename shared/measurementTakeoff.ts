import { z } from "zod";

const value = z.number().finite().nonnegative();
/** 尺寸只记录原始观测；自由计算式不执行，工程量仍由父单显式填写。 */
export const takeoffMeasurementRowSchema = z.object({
  item: z.string().max(120),
  location: z.string().max(200),
  length: value.nullable(),
  width: value.nullable(),
  height: value.nullable(),
  count: value.nullable(),
  quantity: value,
  calculation: z.string().max(500),
  remarks: z.string().max(500),
}).strict();
export type TakeoffMeasurementRow = z.infer<typeof takeoffMeasurementRowSchema>;

export const measurementTakeoffInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  measurementClaimId: z.number().int().positive().nullable().optional(),
  workItem: z.string().trim().min(2, "请填写计量项目").max(200),
  workLocation: z.string().trim().min(2, "请填写作业位置").max(200),
  unit: z.enum(["m3", "m2", "m", "t", "piece", "set", "other"]),
  quantity: z.number().finite().gt(0, "工程量必须大于 0").max(999999999.999),
  unitPrice: z.number().finite().min(0).max(999999999999.99),
  takeoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "收方日期格式应为 YYYY-MM-DD"),
  workDescription: z.string().max(10000).optional(),
  measurementBasis: z.string().max(2000).optional(),
  measurementRows: z.array(takeoffMeasurementRowSchema).max(100).optional(),
  attachmentEvidenceIds: z.array(z.number().int().positive()).max(20).optional(),
  expectedVersion: z.string().regex(/^takeoff-v1:[a-f0-9]{64}$/, "收方版本无效，请重新读取详情").optional(),
  documentRequestKey: z.string().trim().min(1).max(128).optional(),
});
export type MeasurementTakeoffInput = z.infer<typeof measurementTakeoffInput>;
export const takeoffDetailInput = z.object({ projectId: z.number().int().positive(), id: z.number().int().positive() });
export const takeoffAttachmentUploadInput = z.object({
  projectId: z.number().int().positive(),
  takeoffId: z.number().int().positive().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  base64Data: z.string().min(1).max(11500000),
  description: z.string().max(500).optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
});
export type TakeoffAttachmentUploadInput = z.infer<typeof takeoffAttachmentUploadInput>;
