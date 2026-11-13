import { z } from "zod";

export const PERSONNEL_AFFILIATIONS = ["company", "temporary", "labor_team", "external"] as const;
export const PERSONNEL_POSITION_CATEGORIES = ["management", "technical", "business", "driver", "operator", "construction", "other"] as const;
export const PERSONNEL_STATUSES = ["active", "suspended", "left"] as const;
export const PERSONNEL_SALARY_BASES = ["monthly", "daily", "hourly", "piecework"] as const;
export const PERSONNEL_DOCUMENT_TYPES = ["portrait", "identity", "driver_license", "operator_certificate", "contract", "insurance", "other"] as const;
export const PERSONNEL_SALARY_PAYER_TYPES = ["company", "owner"] as const;
export const salaryPayerTypeLabels = { company: "公司发放", owner: "车队/机械老板自行发放" };
export const affiliationLabels = { company: "公司人员", temporary: "临时工", labor_team: "施工队人员", external: "外部人员" };
export const positionCategoryLabels = { management: "管理", technical: "技术", business: "业务", driver: "司机", operator: "机械操作", construction: "施工", other: "其他" };
export const employmentStatusLabels = { active: "在职", suspended: "暂停", left: "离职" };
export const salaryBasisLabels = { monthly: "月薪", daily: "日薪", hourly: "时薪", piecework: "计件" };
export const documentTypeLabels = { portrait: "头像照片", identity: "身份证明", driver_license: "驾驶证", operator_certificate: "操作证", contract: "合同", insurance: "保险", other: "其他" };
export const PERSONNEL_DEFAULT_POSITIONS = [
  { name: "项目经理", category: "management" }, { name: "行政管理", category: "management" },
  { name: "技术员", category: "technical" }, { name: "施工员", category: "technical" },
  { name: "安全员", category: "technical" }, { name: "会计", category: "business" },
  { name: "采购员", category: "business" }, { name: "材料员", category: "business" },
  { name: "运输司机", category: "driver" }, { name: "机械操作员", category: "operator" },
  { name: "施工工人", category: "construction" }, { name: "其他岗位", category: "other" },
  { name: "碴土车驾驶员", category: "driver" }, { name: "推土机驾驶员", category: "operator" },
  { name: "小车驾驶员", category: "driver" }, { name: "公司管理员", category: "management" },
  { name: "劳务人员", category: "construction" }, { name: "临时工", category: "construction" },
  { name: "挖掘机驾驶员", category: "operator" }, { name: "装载机驾驶员", category: "operator" },
  { name: "压路机驾驶员", category: "operator" }, { name: "其他机械驾驶员", category: "operator" },
  { name: "车队负责人", category: "management" },
] as const;

export type PersonnelSalaryPayerType = typeof PERSONNEL_SALARY_PAYER_TYPES[number];
type SalaryPayerSource = { affiliation?: string; salaryPayerType?: string | null; salaryPayerName?: string | null };
/** 当前生效薪资版本优先；旧公司暂停计薪仍为公司发薪，名称仅登记而非身份/授权。 */
export function resolvePersonnelSalaryPayer(person: SalaryPayerSource, currentSalary?: SalaryPayerSource | null) {
  const source = currentSalary ?? person;
  const salaryPayerType: PersonnelSalaryPayerType = source.salaryPayerType === "owner" ? "owner" : source.salaryPayerType === "company" ? "company" : source.affiliation === "external" ? "owner" : "company";
  return { salaryPayerType, salaryPayerName: source.salaryPayerName ?? null };
}

const id = z.number().int().positive();
export const personnelDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, "日期无效");
export const personnelPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "工资期间格式应为 YYYY-MM");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const personnelListInput = z.object({ search: z.string().trim().max(100).optional(), affiliation: z.enum(PERSONNEL_AFFILIATIONS).optional(), positionId: id.optional(), projectId: id.optional(), teamId: id.optional(), status: z.enum(PERSONNEL_STATUSES).optional() }).optional();
export const personnelSaveInput = z.object({
  id: id.optional(), version: id.optional(), name: z.string().trim().min(1, "请输入姓名").max(128),
  affiliation: z.enum(PERSONNEL_AFFILIATIONS), primaryPositionId: id.nullable(), secondaryPositionIds: z.array(id).max(20).optional(),
  projectId: id.nullable().optional(), teamId: id.nullable().optional(), employmentStatus: z.enum(PERSONNEL_STATUSES),
  entryDate: personnelDateSchema.nullable().optional(), exitDate: personnelDateSchema.nullable().optional(),
  gender: z.enum(["male", "female", "unspecified"]).nullable().optional(), birthDate: personnelDateSchema.nullable().optional(),
  address: optionalText(500), emergencyContactName: optionalText(128), emergencyContactPhone: optionalText(32), remarks: optionalText(1000),
  payrollEnabled: z.boolean(), userId: id.nullable().optional(), phoneNumber: z.string().trim().min(5).max(32).optional(), clearPhoneNumber: z.boolean().optional(),
  identityNo: z.string().trim().min(6).max(64).optional(), clearIdentityNo: z.boolean().optional(),
  bankAccount: z.string().trim().min(6).max(64).optional(), clearBankAccount: z.boolean().optional(), bankName: optionalText(128),
  salaryBasis: z.enum(PERSONNEL_SALARY_BASES).optional(), baseSalary: z.union([z.number().finite().min(0).max(999999999999), z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)]).nullable().optional(),
  salaryPayerType: z.enum(PERSONNEL_SALARY_PAYER_TYPES).optional(), salaryPayerName: optionalText(128),
  salaryEffectiveFrom: personnelDateSchema.optional(),
}).superRefine((v, ctx) => {
  if (v.salaryPayerType === "owner" && v.payrollEnabled) ctx.addIssue({ code: "custom", path: ["payrollEnabled"], message: "车队/机械老板自行发放工资不能启用公司计薪" });
  if (v.id && !v.version) ctx.addIssue({ code: "custom", path: ["version"], message: "修改人员须提供版本号，请刷新后重试" });
  if (v.entryDate && v.exitDate && v.exitDate < v.entryDate) ctx.addIssue({ code: "custom", path: ["exitDate"], message: "离职日期不能早于入职日期" });
  for (const [value, clear] of [["phoneNumber", "clearPhoneNumber"], ["identityNo", "clearIdentityNo"], ["bankAccount", "clearBankAccount"]] as const) {
    if (v[value] !== undefined && v[clear]) ctx.addIssue({ code: "custom", path: [clear], message: "不能同时填写与清空敏感资料" });
  }
});
export const personnelPositionInput = z.object({ id: id.optional(), name: z.string().trim().min(1).max(128), category: z.enum(PERSONNEL_POSITION_CATEGORIES), status: z.enum(["active", "disabled"]).optional() });
export const personnelTeamInput = z.object({ id: id.optional(), name: z.string().trim().min(1).max(128), projectId: id, leaderName: optionalText(128), remarks: optionalText(1000), status: z.enum(["active", "disabled"]).optional() });
export const personnelResourceInput = z.object({ personId: id, assetType: z.enum(["vehicle", "machine"]), assetId: id, effectiveFrom: personnelDateSchema, effectiveTo: personnelDateSchema.nullable().optional() }).refine(v => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, "资源结束日期不能早于开始日期");
export const personnelDocumentInput = z.object({ personId: id, documentType: z.enum(PERSONNEL_DOCUMENT_TYPES), name: z.string().trim().min(1).max(128), expiresAt: personnelDateSchema.nullable().optional(), fileName: z.string().trim().min(1).max(255), mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]), base64Data: z.string().min(1).max(11_500_000) }).refine(v => v.documentType !== "portrait" || v.mimeType === "image/jpeg" || v.mimeType === "image/png", { path: ["mimeType"], message: "头像照片仅支持JPEG或PNG图片" });
export const personnelInsuranceInput = z.object({
  personId: id, version: id, id: id.optional(),
  insuranceType: z.enum(["work_injury", "accident", "medical", "employer_liability", "other"]),
  providerName: optionalText(128), policyReference: optionalText(128), evidenceId: id.nullable().optional(),
  premiumAmount: z.number().finite().min(0).max(999999999999.99).nullable().optional(),
  coverageAmount: z.number().finite().min(0).max(999999999999.99).nullable().optional(),
  purchasedAt: personnelDateSchema, expiresAt: personnelDateSchema,
  status: z.enum(["active", "expired", "cancelled"]), remarks: optionalText(500),
}).refine(v => v.expiresAt >= v.purchasedAt, { path: ["expiresAt"], message: "保险到期日期不得早于购买日期" });
export type PersonnelSaveInput = z.infer<typeof personnelSaveInput>;
export type PersonnelAffiliation = typeof PERSONNEL_AFFILIATIONS[number];
export type PersonnelPositionCategory = typeof PERSONNEL_POSITION_CATEGORIES[number];
export type PersonnelEmploymentStatus = typeof PERSONNEL_STATUSES[number];
export type PersonnelSalaryBasis = typeof PERSONNEL_SALARY_BASES[number];
export type PersonnelDocumentType = typeof PERSONNEL_DOCUMENT_TYPES[number];
