import type {
  PersonnelAffiliation,
  PersonnelEmploymentStatus,
  PersonnelSalaryBasis,
  PersonnelSaveInput,
  PersonnelSalaryPayerType,
} from "@shared/personnel";
import { resolvePersonnelSalaryPayer } from "@shared/personnel";

export type SalaryPayerType = PersonnelSalaryPayerType;
export type SalaryPayerProjection = {
  affiliation: PersonnelAffiliation;
  salaryPayerType?: SalaryPayerType | null;
  salaryPayerName?: string | null;
};
export const salaryPayerLabels = {
  company: "公司发放",
  owner: "车队或机械老板自行发放",
} as const;
/** Legacy defaults depend on affiliation, never on the old payroll-disabled flag. */
export function salaryPayerTypeOf(
  person: SalaryPayerProjection
): SalaryPayerType {
  return resolvePersonnelSalaryPayer(person).salaryPayerType;
}
export function salaryPayerDescription(person: SalaryPayerProjection) {
  const label = salaryPayerLabels[salaryPayerTypeOf(person)];
  return person.salaryPayerName
    ? `${label} · ${person.salaryPayerName}`
    : label;
}

export type PersonnelDraft = {
  name: string;
  affiliation: PersonnelAffiliation;
  employmentStatus: PersonnelEmploymentStatus;
  primaryPositionId: string;
  secondaryPositionIds: number[];
  projectId: string;
  teamId: string;
  entryDate: string;
  exitDate: string;
  gender: "male" | "female" | "unspecified";
  birthDate: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  clearEmergencyContactPhone: boolean;
  remarks: string;
  payrollEnabled: boolean;
  salaryPayerType: SalaryPayerType;
  salaryPayerName: string;
  userId: string;
  phoneNumber: string;
  identityNo: string;
  bankAccount: string;
  bankName: string;
  clearPhoneNumber: boolean;
  clearIdentityNo: boolean;
  clearBankAccount: boolean;
  salaryBasis: PersonnelSalaryBasis;
  baseSalary: string;
  salaryEffectiveFrom: string;
};
export function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  return typeof value === "string" ? value.slice(0, 10) : chinaToday(value);
}
export function newPersonnelDraft(
  affiliation: PersonnelAffiliation = "company"
): PersonnelDraft {
  return {
    name: "",
    affiliation,
    employmentStatus: "active",
    primaryPositionId: "",
    secondaryPositionIds: [],
    projectId: "",
    teamId: "",
    entryDate: chinaToday(),
    exitDate: "",
    gender: "unspecified",
    birthDate: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    clearEmergencyContactPhone: false,
    remarks: "",
    payrollEnabled: affiliation !== "external",
    salaryPayerType: affiliation === "external" ? "owner" : "company",
    salaryPayerName: "",
    userId: "",
    phoneNumber: "",
    identityNo: "",
    bankAccount: "",
    bankName: "",
    clearPhoneNumber: false,
    clearIdentityNo: false,
    clearBankAccount: false,
    salaryBasis: affiliation === "temporary" ? "daily" : "monthly",
    baseSalary: "",
    salaryEffectiveFrom: chinaToday(),
  };
}
export function salaryChanged(
  draft: PersonnelDraft,
  original?: PersonnelDraft
) {
  return !original
    ? true
    : draft.salaryBasis !== original.salaryBasis ||
        draft.baseSalary !== original.baseSalary ||
        draft.payrollEnabled !== original.payrollEnabled ||
        draft.salaryPayerType !== original.salaryPayerType ||
        draft.salaryPayerName.trim() !== original.salaryPayerName.trim() ||
        draft.affiliation !== original.affiliation;
}
export function personnelDraftError(
  draft: PersonnelDraft,
  positions: readonly { id: number; status: string }[] | undefined,
  original?: PersonnelDraft
) {
  if (!draft.name.trim()) return "请输入姓名";
  if (!original && !draft.primaryPositionId)
    return "请选择人员类型 / 主要岗位，所有新增人员必须分类。";
  if (original?.primaryPositionId && !draft.primaryPositionId)
    return "已分类人员必须保留或选择人员类型 / 主要岗位；仅旧未分类档案可以保留未设置。";
  if (
    draft.primaryPositionId !== original?.primaryPositionId &&
    draft.primaryPositionId &&
    !positions?.some(
      position =>
        String(position.id) === draft.primaryPositionId &&
        position.status !== "disabled"
    )
  )
    return "所选岗位未加载、已停用或不存在，请重新读取岗位字典后选择。";
  if (!original && !positions?.some(position => position.status !== "disabled"))
    return "岗位字典尚未就绪，请重试或前往岗位维护添加真实岗位。";
  if (draft.salaryPayerName.trim().length > 128)
    return "老板 / 车队名称不能超过128个字符";
  if (
    draft.salaryPayerType === "company" &&
    draft.payrollEnabled &&
    (!original || salaryChanged(draft, original)) &&
    !draft.baseSalary.trim()
  )
    return "请填写公司计薪人员的基础工资 / 单价；暂不计薪可关闭公司计薪。";
  if (salaryChanged(draft, original) && !draft.salaryEffectiveFrom)
    return "修改薪资必须选择生效日期";
  return "";
}
export function personnelDraftDirty(
  draft: PersonnelDraft,
  baseline: PersonnelDraft
) {
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}
/** Only edited optional fields are submitted. Blank sensitive inputs preserve saved values; clear flags explicitly remove them. */
export function buildPersonnelSave(
  draft: PersonnelDraft,
  original?: PersonnelDraft,
  identity?: { id: number; version: number }
): PersonnelSaveInput {
  const result: PersonnelSaveInput = {
    ...identity,
    name: draft.name.trim(),
    affiliation: draft.affiliation,
    employmentStatus: draft.employmentStatus,
    primaryPositionId: draft.primaryPositionId
      ? Number(draft.primaryPositionId)
      : null,
    payrollEnabled: draft.salaryPayerType === "company" && draft.payrollEnabled,
    salaryPayerType: draft.salaryPayerType,
  };
  const changed = (key: keyof PersonnelDraft) =>
    !original || JSON.stringify(draft[key]) !== JSON.stringify(original[key]);
  if (changed("salaryPayerName"))
    result.salaryPayerName = draft.salaryPayerName.trim() || null;
  for (const key of ["projectId", "teamId", "userId"] as const)
    if (changed(key)) result[key] = draft[key] ? Number(draft[key]) : null;
  if (changed("secondaryPositionIds"))
    result.secondaryPositionIds = draft.secondaryPositionIds.filter(
      id => id !== Number(draft.primaryPositionId)
    );
  for (const key of [
    "entryDate",
    "exitDate",
    "birthDate",
    "address",
    "emergencyContactName",
    "remarks",
    "bankName",
  ] as const)
    if (changed(key)) result[key] = draft[key].trim() || null;
  if (changed("gender")) result.gender = draft.gender;
  if (draft.clearEmergencyContactPhone) result.emergencyContactPhone = null;
  else if (draft.emergencyContactPhone.trim() && changed("emergencyContactPhone"))
    result.emergencyContactPhone = draft.emergencyContactPhone.trim();
  for (const [key, clear] of [
    ["phoneNumber", "clearPhoneNumber"],
    ["identityNo", "clearIdentityNo"],
    ["bankAccount", "clearBankAccount"],
  ] as const) {
    if (draft[clear]) result[clear] = true;
    else {
      const value = draft[key].trim();
      if (value && (!original || value !== original[key].trim()))
        result[key] = value;
    }
  }
  if (salaryChanged(draft, original)) {
    result.salaryBasis = draft.salaryBasis;
    result.baseSalary =
      draft.salaryPayerType === "owner"
        ? null
        : draft.baseSalary.trim() || null;
    result.salaryEffectiveFrom = draft.salaryEffectiveFrom;
  }
  return result;
}
export function sensitiveClearLabels(draft: PersonnelDraft) {
  return [
    [draft.clearPhoneNumber, "手机号"],
    [draft.clearIdentityNo, "证件号"],
    [draft.clearBankAccount, "银行卡"],
    [draft.clearEmergencyContactPhone, "紧急联系电话"],
  ]
    .filter(([clear]) => clear)
    .map(([, label]) => label)
    .join("、");
}
/** CSV spreadsheet formula injection protection; export only caller-selected safe projection. */
export function personnelCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const cell = (value: string | number | null | undefined) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${[headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n")}`;
}
export function friendlyPersonnelError(error: {
  message: string;
  data?: { code?: string } | null;
}) {
  if (error.data?.code === "CONFLICT" || /版本|并发|冲突/.test(error.message))
    return "档案已被其他人更新。您的输入仍保留，请先重新读取最新档案，核对后再保存，不会覆盖他人的修改。";
  return error.message || "请求未成功，请重试。";
}
