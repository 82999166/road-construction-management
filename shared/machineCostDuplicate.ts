import { z } from "zod";

export const machineCostDraftSchema = z.object({
  machineId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  costType: z.enum(["fuel", "repair", "overtime", "mobilization", "other"]),
  costName: z.string().trim().min(1, "请填写费用名称").max(128),
  quantity: z.number().min(0).max(999999999.999),
  unitPrice: z.number().min(0).max(999999999999.99),
  occurredAt: z.string().datetime({ offset: true, message: "时间必须使用 ISO 8601 格式" }),
  evidenceId: z.number().int().positive().nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  requestId: z.string().uuid().optional(),
});
export const machineCostSaveSchema = machineCostDraftSchema.extend({
  duplicateConfirmation: z.object({
    token: z.string().min(1).max(3000),
    reason: z.string().trim().min(10, "请至少填写10字说明不同业务的依据").max(300),
  }).optional(),
});
export type MachineCostDraft = z.infer<typeof machineCostDraftSchema>;
export type MachineCostSave = z.infer<typeof machineCostSaveSchema>;
export type MachineCostDuplicateCandidate = {
  id: number;
  occurredAt: Date;
  costType: string;
  costName: string | null;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  status: string | null;
  sameSource: boolean;
  sameInstant: boolean;
};
export type MachineCostDuplicateCheck = {
  candidates: MachineCostDuplicateCandidate[];
  confirmationToken: string | null;
  hardConflict: boolean;
  expiresAt: number | null;
};
