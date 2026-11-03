import type {
  PersonnelAffiliation,
  PersonnelEmploymentStatus,
  PersonnelSalaryBasis,
  PersonnelSaveInput,
} from "@shared/personnel";

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
  remarks: string;
  payrollEnabled: boolean;
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
    remarks: "",
    payrollEnabled: affiliation !== "external",
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
    ? Boolean(draft.baseSalary)
    : draft.salaryBasis !== original.salaryBasis ||
        draft.baseSalary !== original.baseSalary ||
        draft.payrollEnabled !== original.payrollEnabled ||
        draft.affiliation !== original.affiliation;
}
/** Only edited optional fields are submitted. Empty secret inputs always preserve saved values. */
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
    payrollEnabled: draft.payrollEnabled,
  };
  const changed = (key: keyof PersonnelDraft) =>
    !original || JSON.stringify(draft[key]) !== JSON.stringify(original[key]);
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
  if (draft.emergencyContactPhone.trim())
    result.emergencyContactPhone = draft.emergencyContactPhone.trim();
  for (const [key, clear] of [
    ["phoneNumber", "clearPhoneNumber"],
    ["identityNo", "clearIdentityNo"],
    ["bankAccount", "clearBankAccount"],
  ] as const) {
    if (draft[clear]) result[clear] = true;
    else if (draft[key].trim()) result[key] = draft[key].trim();
  }
  if (salaryChanged(draft, original)) {
    result.salaryBasis = draft.salaryBasis;
    result.baseSalary = draft.baseSalary.trim() || null;
    result.salaryEffectiveFrom = draft.salaryEffectiveFrom;
  }
  return result;
}
export function sensitiveClearLabels(draft: PersonnelDraft) {
  return [
    [draft.clearPhoneNumber, "手机号"],
    [draft.clearIdentityNo, "证件号"],
    [draft.clearBankAccount, "银行卡"],
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
