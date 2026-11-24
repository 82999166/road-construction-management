/** 业务单号 v1：版块(2字母)+服务端生成北京时间(YYYYMMDDHHmmss)+操作人+序号(0001..9999)。
 * 仅服务端事务分配；客户端只可展示格式，不可据此生成、预测或预占单号。
 */
export const BUSINESS_DOCUMENT_MODULES = {
  purchaseRequest: "PR",
  purchaseOrder: "PO",
  inventoryTransaction: "IV",
  measurementClaim: "CL",
  measurementTakeoff: "TO",
  transportTrip: "TR",
  transportSettlement: "TS",
  dieselRefuel: "DS",
  machineCost: "MC",
  machineDailyOperation: "MD",
  machineMonthlyStatement: "MM",
  machinePaymentSettlement: "MS",
  payrollStatement: "PY",
  temporaryDailyWage: "DW",
  payrollAdvance: "PA",
  settlementPayment: "PM",
  financialRecord: "FR",
  financialReversal: "RV",
  subcontractPackage: "SP",
  subcontractSettlement: "SS",
  contract: "CT",
  dailyAccountingClosure: "DC",
  taxHandoffBatch: "TX",
  assetMaintenance: "AM",
  constructionDailyReport: "CR",
  rfidWriteJob: "RJ",
  broadcast: "BC",
  personnel: "PN",
} as const;

export type BusinessDocumentModule =
  (typeof BUSINESS_DOCUMENT_MODULES)[keyof typeof BUSINESS_DOCUMENT_MODULES];

/** 用户编号必须来自 ctx.user.id / 可信触发 userId；后台无人触发任务明确 system。 */
export type BusinessDocumentActor =
  | { kind: "user"; userId: number | string | bigint }
  | { kind: "system" };

export const BUSINESS_DOCUMENT_NUMBER_CONTRACT = {
  version: 1,
  timeZone: "Asia/Shanghai",
  format: "{MODULE}{YYYYMMDD}{HHmmss}{USER_ID_PAD4_OR_SYS}{SEQ4}",
  sequenceMinimum: 1,
  sequenceMaximum: 9999,
  maximumLength: 36,
  userExample: "PO2026112417050900230001",
  systemExample: "PY20261124170509SYS0001",
  preview: "保存成功后由服务器分配正式单号",
} as const;

/** 纯格式检查，不验证日期是否合法、记录是否存在或访问权限。旧号不受此校验限制。 */
export function isBusinessDocumentNumber(value: string): boolean {
  return /^[A-Z]{2}\d{14}(?:[0-9]{4,16}|SYS)(?!0000$)\d{4}$/.test(value);
}
