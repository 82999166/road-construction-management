import { and, desc, eq, gte, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { inArray, lte } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogs,
  assetMaintenanceRecords,
  contractTaxRegistrations,
  crossRegionConstructionTaxLedgers,
  dailyAccountingClosureEvents,
  dailyAccountingClosures,
  dieselRefuelRecords,
  financialInvoiceOriginals,
  financialInvoices,
  financialRecords,
  evidenceRecords,
  inventoryTransactions,
  measurementClaims,
  measurementTakeoffEvidences,
  measurementTakeoffRecords,
  laborWorkers,
  machineCostRecords,
  machinePaymentSettlements,
  outsourceContracts,
  payrollStatements,
  payrollTaxWithholdingEntries,
  projectTaxProfiles,
  projects,
  purchaseCategories,
  purchaseOrders,
  purchaseRequests,
  suppliers,
  systemSettings,
  taxAuxiliaryEntries,
  taxEntityProfiles,
  taxHandoffBatches,
  temporaryDailyWageSettlements,
  transportTrips,
  transportVehicleSettlements,
  transportVehicles,
  machines,
  users,
} from "../../drizzle/schema";
import {
  assertApprovalTransition,
  assertPurchaseOrderStatusTransition,
  assertPurchaseRequestStatusTransition,
  ConstructionDomainError,
  getBusinessStatusLabel,
} from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, assertSuperAdmin, getCurrentDataScope, getEffectiveRoleCodes, hasUserSpecificOperationPermission, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { appendIntegrityProtectedAudit } from "../services/auditIntegrity";
import { isSupervisorReviewAutoApprove } from "../services/supervisorReview";
import { storageGetSignedUrl, storagePut } from "../storage";

/** 期间一律采用 YYYY-MM，防止浏览器时区导致项目月报跨月统计。 */
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "期间格式应为 YYYY-MM");
const isoDateTimeSchema = z.string().datetime({ offset: true, message: "时间必须使用 ISO 8601 格式" });
const moneySchema = z.number().min(0).max(999999999999.99);

/** 将日期输入转为 UTC 业务日，所有项目汇总在服务端按同一口径计算。 */
function toBusinessDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 返回左闭右开的自然月区间，避免月末数据重复进入下一期统计。 */
function getMonthRange(period: string) {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: toBusinessDate(`${period}-01`),
    endExclusive: toBusinessDate(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`),
  };
}

/** 金额仅在服务端以两位小数落库，避免客户端浮点误差污染成本报表。 */
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 同一张原始发票无论被分摊到多少项目，均使用完全相同的服务端规范化指纹。 */
function createInvoiceOriginalFingerprint(input: Pick<z.infer<typeof financialInvoiceInput>, "invoiceNo" | "invoiceCode" | "counterpartyName" | "direction" | "issuedAt" | "amount" | "taxAmount">) {
  const normalizedCounterparty = input.counterpartyName.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256")
    .update([input.invoiceCode?.trim() ?? "", input.invoiceNo.trim(), normalizedCounterparty, input.direction, input.issuedAt, roundMoney(input.amount).toFixed(2), roundMoney(input.taxAmount).toFixed(2)].join("|"))
    .digest("hex");
}

/** 生成具有日期和随机后缀的单据号，避免并发录入时使用客户端编号发生冲突。 */
function createBusinessNo(prefix: string) {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

const SMALL_DIRECT_PURCHASE_LIMIT_KEY = "PURCHASING_SMALL_DIRECT_LIMIT";
const DEFAULT_SMALL_DIRECT_PURCHASE_LIMIT = 500;
const PURCHASE_REQUIRES_SUPERVISOR_APPROVAL_KEY = "PURCHASING_REQUIRES_SUPERVISOR_APPROVAL";

/** 小额免申请阈值仅从已发布后台参数读取；配置缺失时采用明确的审计默认值 500 元。 */
async function getSmallDirectPurchaseLimit(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [setting] = await db.select({ valueJson: systemSettings.valueJson }).from(systemSettings).where(and(eq(systemSettings.settingKey, SMALL_DIRECT_PURCHASE_LIMIT_KEY), eq(systemSettings.status, "published"))).limit(1);
  const value = Number(setting?.valueJson);
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? roundMoney(value) : DEFAULT_SMALL_DIRECT_PURCHASE_LIMIT;
}

/** 审核开关只读取已发布后台配置；配置缺失时保持需要主管确认的审计默认值。 */
async function getPurchaseRequiresSupervisorApproval(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [setting] = await db.select({ valueJson: systemSettings.valueJson }).from(systemSettings).where(and(eq(systemSettings.settingKey, PURCHASE_REQUIRES_SUPERVISOR_APPROVAL_KEY), eq(systemSettings.status, "published"))).limit(1);
  if (!setting?.valueJson) return true;
  try {
    const parsed = JSON.parse(setting.valueJson) as { enabled?: unknown } | boolean;
    return typeof parsed === "boolean" ? parsed : parsed.enabled !== false;
  } catch {
    return setting.valueJson !== "false";
  }
}

/** OCR 始终仅作辅助；落单时保留截断摘要以便复核，不把模型字段视为采购事实。 */
function getPurchaseOcrSummary(rawValue: string | null) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as { summary?: unknown; documentType?: unknown; amount?: unknown };
    const parts = [parsed.documentType, parsed.summary, parsed.amount].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return parts.length ? parts.join(" · ").slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** 将领域异常转换为稳定的业务错误，禁止将内部堆栈返回移动端。 */
function throwDomainAsBadRequest(error: unknown): never {
  if (error instanceof ConstructionDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

/**
 * 单据状态写入必须携带读取时的旧状态。受影响行数为 0 时说明有并发请求
 * 已完成状态迁移，调用方必须立即中止，避免追加错误审计或重复通知。
 */
function assertConditionalBusinessWrite(result: unknown, conflictMessage: string) {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: conflictMessage });
  }
}

/** 返回当前用户被授权的项目选项，组织范围授权仅覆盖其直属项目。 */
async function listScopedProjects(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  const scope = await getCurrentDataScope(ctx);
  const db = await getDb();
  if (!db) return [];
  const allProjects = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status, organizationId: projects.organizationId })
    .from(projects)
    .orderBy(projects.sortOrder, projects.id);
  if (scope.hasAllProjects) return allProjects;
  return allProjects.filter(project => scope.projectIds.includes(project.id) || (project.organizationId !== null && scope.organizationIds.includes(project.organizationId)));
}

/** 采购与仓储岗位访问控制，系统管理员以 ALL 角色覆盖应急处置。 */
async function assertPurchaseAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "PURCHASING");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["PURCHASER", "WAREHOUSE_MANAGER", "LOGISTICS_MANAGER", "FINANCE_MANAGER", "PROJECT_MANAGER"];
  const hasUserSpecificReadPermission = await hasUserSpecificOperationPermission(ctx, "PURCHASING", "read");
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role)) && !hasUserSpecificReadPermission) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获采购仓储数据访问授权" });
  }
  return roleCodes;
}

/** 工程计量岗位访问控制，金额确认还会在状态操作处进行更严格限制。 */
async function assertMeasurementAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "MEASUREMENT");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["MEASUREMENT_MANAGER", "FINANCE_MANAGER", "PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "ACCOUNTANT"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获工程计量数据访问授权" });
  }
  return roleCodes;
}

/** 财务成本岗位访问控制；审计只读仅可读取已授权范围，不会从该入口获得写入权限。 */
async function assertFinanceAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "FINANCE");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER", "PROJECT_MANAGER", "AUDIT_VIEWER"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获财务成本数据访问授权" });
  }
  return roleCodes;
}

/** 会计资料维护及日结封存属于会计审查职责；不等于执行资金支付或冲销。 */
function canMaintainFinancialLedger(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER") || roleCodes.includes("ACCOUNTANT");
}

/** 未支付流水的作废由会计审查或财务负责人办理，保留原因与审计链。 */
function canVoidFinancialRecord(roleCodes: readonly string[]) {
  return canMaintainFinancialLedger(roleCodes);
}

/** 已支付凭证的冲销仅限财务负责人，和会计审查、出纳执行明确分离。 */
function canReverseFinancialRecord(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER");
}

/** 财务原始资料可由会计、出纳或财务负责人登记；审计只读与项目经理不可登记。 */
function canCreateFinancialRecord(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER"].includes(role));
}

/** 资金收付属于执行动作，仅出纳或系统应急管理身份可确认。 */
function canExecutePayment(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("CASHIER");
}

/** 财务期间调整属于高影响会计控制：仅财务负责人或系统应急角色可授权反结账。 */
function canReopenFinancialPeriod(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER");
}

/**
 * 日结使用与既有流水汇总一致的 UTC 业务日口径。服务端在所有会改变财务事实的入口前调用，
 * 防止仅依赖前端按钮导致封存日期仍可被后端接口补录或改写。
 */
async function assertFinancialDayWritable(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  projectId: number,
  occurredAt: Date,
  actionLabel: string,
) {
  const businessDate = toBusinessDate(occurredAt.toISOString().slice(0, 10));
  const [closure] = await db
    .select({ status: dailyAccountingClosures.status, closingNo: dailyAccountingClosures.closingNo })
    .from(dailyAccountingClosures)
    .where(and(eq(dailyAccountingClosures.projectId, projectId), eq(dailyAccountingClosures.closingDate, businessDate)))
    .limit(1);
  if (closure && ["closed", "archived"].includes(closure.status)) {
    throw new TRPCError({ code: "CONFLICT", message: `${businessDate.toISOString().slice(0, 10)} 已完成日结（${closure.closingNo}），不可${actionLabel}；请由财务负责人先授权反结账。` });
  }
}

type TaxHandoffManifest = {
  version: 1;
  generatedAt: string;
  projectId: number;
  period: string;
  taxEntity: { id: number; entityName: string; taxpayerIdentifier: string; taxMethod: string };
  projectProfile: { projectLocation: string; crossRegionConstruction: boolean; contractExTaxAmount: string; contractTaxRate: string; subcontractDeductionMethod: string };
  columns: string[];
  rows: string[][];
};

/** RFC 4180 风格转义：交接批次保留真实字段快照，浏览器只负责下载，不自行改算。 */
function toTaxHandoffCsv(manifest: TaxHandoffManifest) {
  const escape = (value: string) => `"${String(value).replaceAll("\"", "\"\"")}"`;
  return `\uFEFF${[manifest.columns, ...manifest.rows].map(row => row.map(escape).join(",")).join("\r\n")}`;
}

/**
 * 构造正式财务软件/电子税务局准备资料的不可变交接快照。
 * 金额来自既有业务事实或人工明确登记的辅助事项；本函数不计算个人所得税、增值税、印花税或预缴税额。
 */
async function buildTaxHandoffManifest(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: z.infer<typeof taxHandoffInput>,
): Promise<TaxHandoffManifest> {
  const [profile] = await db.select().from(projectTaxProfiles).where(eq(projectTaxProfiles.projectId, input.projectId)).limit(1);
  if (!profile || profile.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "请先维护有效的项目税务辅助档案后再生成交接资料" });
  const [entity] = await db.select().from(taxEntityProfiles).where(eq(taxEntityProfiles.id, profile.taxEntityId)).limit(1);
  if (!entity || entity.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "项目关联的纳税主体不存在或未启用，不能生成交接资料" });
  const range = getMonthRange(input.period);
  const [invoices, records, monthlyPayroll, dailyPayroll, contracts, auxiliary] = await Promise.all([
    db.select().from(financialInvoices).where(and(eq(financialInvoices.projectId, input.projectId), gte(financialInvoices.issuedAt, range.start), lt(financialInvoices.issuedAt, range.endExclusive))).orderBy(financialInvoices.issuedAt, financialInvoices.id),
    db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))).orderBy(financialRecords.occurredAt, financialRecords.id),
    db.select().from(payrollStatements).where(and(eq(payrollStatements.projectId, input.projectId), eq(payrollStatements.period, input.period))).orderBy(payrollStatements.id),
    db.select().from(temporaryDailyWageSettlements).where(and(eq(temporaryDailyWageSettlements.projectId, input.projectId), gte(temporaryDailyWageSettlements.settlementDate, range.start), lt(temporaryDailyWageSettlements.settlementDate, range.endExclusive))).orderBy(temporaryDailyWageSettlements.settlementDate, temporaryDailyWageSettlements.id),
    db.select().from(outsourceContracts).where(eq(outsourceContracts.projectId, input.projectId)).orderBy(outsourceContracts.contractNo),
    db.select().from(taxAuxiliaryEntries).where(and(eq(taxAuxiliaryEntries.projectId, input.projectId), eq(taxAuxiliaryEntries.period, input.period))).orderBy(taxAuxiliaryEntries.entryType, taxAuxiliaryEntries.id),
  ]);
  const rows: string[][] = [];
  const add = (row: string[]) => rows.push(row);
  const include = (type: z.infer<typeof taxHandoffInput>["handoffType"], groups: readonly z.infer<typeof taxHandoffInput>["handoffType"][]) => type === "combined" || groups.includes(type);
  if (include(input.handoffType, ["vat_invoice"])) {
    for (const invoice of invoices) add(["发票项目分摊", "financial_invoices", String(invoice.id), invoice.issuedAt.toISOString().slice(0, 10), `${invoice.counterpartyName} · ${invoice.invoiceNo}`, invoice.direction === "income" ? "销项/收入资料" : "进项/成本资料", String(invoice.allocatedAmount), String(invoice.taxAmount), `${invoice.status}/${invoice.allocationStatus}`, invoice.evidenceId ? `证据#${invoice.evidenceId}` : "未关联原件"]);
  }
  if (include(input.handoffType, ["financial_ledger"])) {
    for (const record of records) add(["项目资金流水", "financial_records", record.recordNo, record.occurredAt.toISOString(), record.category, record.direction === "income" ? "收入" : "支出", String(record.amount), "", record.settlementStatus, record.sourceType ? `${record.sourceType}:${record.sourceId ?? ""}` : "人工登记"]);
  }
  if (include(input.handoffType, ["payroll"])) {
    for (const payroll of monthlyPayroll) add(["工资薪金待处理", "payroll_statements", String(payroll.id), payroll.period, `人员#${payroll.workerId} 月度工资`, "工资薪金", String(payroll.actualAmount), "", payroll.status, payroll.paymentReference ?? "待正式薪税系统处理"]);
    for (const payroll of dailyPayroll) add(["临时日结薪酬待处理", "temporary_daily_wage_settlements", String(payroll.id), payroll.settlementDate.toISOString().slice(0, 10), `人员#${payroll.workerId} 临时日结`, "工资薪金", String(payroll.actualAmount), "", payroll.status, payroll.paymentReference ?? "待正式薪税系统处理"]);
  }
  if (include(input.handoffType, ["contract_tax"])) {
    for (const contract of contracts) add(["合同税费资料", "outsource_contracts", String(contract.id), contract.startDate?.toISOString().slice(0, 10) ?? "", `${contract.contractNo} · ${contract.counterpartyName}`, contract.contractType, String(contract.contractAmount), "", contract.status, contract.attachmentEvidenceId ? `合同影像#${contract.attachmentEvidenceId}` : "未关联合同影像"]);
  }
  const selectedAuxiliaryTypes = input.handoffType === "cross_region" ? ["cross_region_prepayment"] : input.handoffType === "contract_tax" ? ["subcontract_deduction", "stamp_duty"] : input.handoffType === "payroll" ? ["payroll_handoff"] : input.handoffType === "vat_invoice" ? ["vat_input", "vat_output"] : input.handoffType === "financial_ledger" ? ["book_tax_difference"] : null;
  for (const entry of auxiliary.filter(item => input.handoffType === "combined" || selectedAuxiliaryTypes?.includes(item.entryType))) {
    add(["财税辅助事项", "tax_auxiliary_entries", String(entry.id), entry.period, entry.subject, entry.entryType, String(entry.amount), entry.reportedTaxAmount ?? "", entry.status, entry.documentReference ?? (entry.sourceType ? `${entry.sourceType}:${entry.sourceId ?? ""}` : "待补充")]);
  }
  if (include(input.handoffType, ["cross_region"]) && profile.crossRegionConstruction) {
    add(["项目税务档案提示", "project_tax_profiles", String(profile.id), input.period, `跨地区建筑服务资料准备：${profile.projectLocation}`, "跨地区预缴辅助", String(profile.contractExTaxAmount), "", "待持证人员核验", "本行为资料提示，不代表已预缴或应预缴税额"]);
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    projectId: input.projectId,
    period: input.period,
    taxEntity: { id: entity.id, entityName: entity.entityName, taxpayerIdentifier: entity.taxpayerIdentifier, taxMethod: entity.taxMethod },
    projectProfile: { projectLocation: profile.projectLocation, crossRegionConstruction: profile.crossRegionConstruction, contractExTaxAmount: String(profile.contractExTaxAmount), contractTaxRate: String(profile.contractTaxRate), subcontractDeductionMethod: profile.subcontractDeductionMethod },
    columns: ["资料类别", "来源表", "来源单号/ID", "业务日期/期间", "摘要", "性质", "金额", "原始税额/已确认税额", "业务状态", "凭证/交接参考"],
    rows,
  };
}

const RESIDENT_WAGE_WITHHOLDING_BRACKETS = [
  { ceiling: 36_000, rate: 0.03, quickDeduction: 0 },
  { ceiling: 144_000, rate: 0.1, quickDeduction: 2_520 },
  { ceiling: 300_000, rate: 0.2, quickDeduction: 16_920 },
  { ceiling: 420_000, rate: 0.25, quickDeduction: 31_920 },
  { ceiling: 660_000, rate: 0.3, quickDeduction: 52_920 },
  { ceiling: 960_000, rate: 0.35, quickDeduction: 85_920 },
  { ceiling: Number.POSITIVE_INFINITY, rate: 0.45, quickDeduction: 181_920 },
] as const;

function getResidentWageWithholdingBracket(taxableIncome: number) {
  return RESIDENT_WAGE_WITHHOLDING_BRACKETS.find(bracket => taxableIncome <= bracket.ceiling) ?? RESIDENT_WAGE_WITHHOLDING_BRACKETS.at(-1)!;
}

/**
 * 按国家税务总局公告2018年第56号的累计预扣公式生成“待复核”辅助测算。
 * 本函数不读取或猜测专项附加扣除，相关数值必须由会计根据员工实际申报资料录入。
 */
async function buildPayrollTaxWithholdingSnapshot(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: z.infer<typeof payrollTaxWithholdingInput>,
) {
  const [profile, worker] = await Promise.all([
    db.select().from(projectTaxProfiles).where(eq(projectTaxProfiles.projectId, input.projectId)).limit(1).then(rows => rows[0]),
    db.select().from(laborWorkers).where(eq(laborWorkers.id, input.workerId)).limit(1).then(rows => rows[0]),
  ]);
  if (!profile || profile.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "请先维护有效项目税务辅助档案" });
  if (!worker || worker.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的劳务人员" });
  const yearStart = toBusinessDate(`${input.period.slice(0, 4)}-01-01`);
  const currentRange = getMonthRange(input.period);
  const [monthlyPayroll, dailyPayroll] = await Promise.all([
    db.select({ id: payrollStatements.id, period: payrollStatements.period, payableAmount: payrollStatements.payableAmount, status: payrollStatements.status })
      .from(payrollStatements)
      .where(and(eq(payrollStatements.workerId, input.workerId), eq(payrollStatements.projectId, input.projectId), gte(payrollStatements.period, `${input.period.slice(0, 4)}-01`), lte(payrollStatements.period, input.period), inArray(payrollStatements.status, ["approved", "paid"]))),
    db.select({ id: temporaryDailyWageSettlements.id, settlementDate: temporaryDailyWageSettlements.settlementDate, payableAmount: temporaryDailyWageSettlements.payableAmount, status: temporaryDailyWageSettlements.status })
      .from(temporaryDailyWageSettlements)
      .where(and(eq(temporaryDailyWageSettlements.workerId, input.workerId), eq(temporaryDailyWageSettlements.projectId, input.projectId), gte(temporaryDailyWageSettlements.settlementDate, yearStart), lt(temporaryDailyWageSettlements.settlementDate, currentRange.endExclusive), inArray(temporaryDailyWageSettlements.status, ["approved", "paid"]))),
  ]);
  const currentMonthly = monthlyPayroll.filter(item => item.period === input.period);
  const currentDaily = dailyPayroll.filter(item => item.settlementDate >= currentRange.start && item.settlementDate < currentRange.endExclusive);
  const sourceGrossIncome = roundMoney([...currentMonthly, ...currentDaily].reduce((sum, item) => sum + Number(item.payableAmount), 0));
  const cumulativeGrossIncome = roundMoney([...monthlyPayroll, ...dailyPayroll].reduce((sum, item) => sum + Number(item.payableAmount), 0));
  const sourceDocumentCount = currentMonthly.length + currentDaily.length;
  const cumulativeBasicDeduction = input.incomeType === "resident_wage_salary" ? roundMoney(input.employmentMonths * 5_000) : 0;
  const cumulativeTaxableIncome = roundMoney(Math.max(0, cumulativeGrossIncome - input.cumulativeExemptIncome - cumulativeBasicDeduction - input.cumulativeSocialInsuranceDeduction - input.cumulativeSpecialAdditionalDeduction - input.cumulativeOtherDeduction));
  const canCalculateResidentWage = input.incomeType === "resident_wage_salary";
  const bracket = canCalculateResidentWage ? getResidentWageWithholdingBracket(cumulativeTaxableIncome) : null;
  const calculatedCumulativeTax = bracket ? roundMoney(Math.max(0, cumulativeTaxableIncome * bracket.rate - bracket.quickDeduction)) : null;
  const calculatedCurrentWithholding = calculatedCumulativeTax === null ? null : roundMoney(Math.max(0, calculatedCumulativeTax - input.cumulativeTaxWithheldBefore));
  const snapshot = {
    formulaVersion: "resident-wage-cumulative-withholding-v1",
    regulationReference: "国家税务总局公告2018年第56号；个人所得税预扣率表一",
    createdAt: new Date().toISOString(),
    source: { payrollStatementCount: currentMonthly.length, temporaryDailySettlementCount: currentDaily.length, currentPeriodGrossIncome: sourceGrossIncome, cumulativeGrossIncome },
    declaredCumulativeDeductions: { exemptIncome: input.cumulativeExemptIncome, basicDeduction: cumulativeBasicDeduction, socialInsuranceDeduction: input.cumulativeSocialInsuranceDeduction, specialAdditionalDeduction: input.cumulativeSpecialAdditionalDeduction, otherDeduction: input.cumulativeOtherDeduction },
    result: { cumulativeTaxableIncome, rate: bracket?.rate ?? null, quickDeduction: bracket?.quickDeduction ?? null, calculatedCumulativeTax, cumulativeTaxWithheldBefore: input.cumulativeTaxWithheldBefore, calculatedCurrentWithholding },
    boundary: canCalculateResidentWage ? "辅助测算，须由持证人员结合居民身份、任职月份及扣除资料复核后申报" : "该收入类别不适用本系统居民工资薪金累计预扣自动测算；仅归集真实来源，须由专业人员复核",
  };
  return { profile, worker, sourceGrossIncome, sourceDocumentCount, cumulativeGrossIncome, cumulativeBasicDeduction, cumulativeTaxableIncome, applicableRate: bracket?.rate ?? null, quickDeduction: bracket?.quickDeduction ?? null, calculatedCumulativeTax, calculatedCurrentWithholding, snapshot };
}

/** 采购申请审批权仅限项目负责人、财务负责人和系统管理员。 */
function canApprovePurchase(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("PROJECT_MANAGER") || roleCodes.includes("FINANCE_MANAGER");
}

/** 入库责任人可由仓库、物流、采购负责人或项目负责人承担。 */
function canManageInventory(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["WAREHOUSE_MANAGER", "LOGISTICS_MANAGER", "PURCHASER", "PROJECT_MANAGER"].includes(role));
}

/** 工程计量复核由计量、项目、财务负责人或系统管理员执行。 */
function canReviewMeasurement(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["MEASUREMENT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"].includes(role));
}

/** 收方由项目部或施工现场提交，计量负责人负责复核；前端只据此收敛按钮，服务端仍逐次强制校验。 */
function canSubmitTakeoff(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER"].includes(role));
}

function canReviewTakeoff(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["MEASUREMENT_MANAGER", "PROJECT_MANAGER"].includes(role));
}

/** 已审核计量只能由会计、财务负责人或系统管理员结算确认。 */
function canSettleMeasurement(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER") || roleCodes.includes("ACCOUNTANT");
}

/** 工程回款属于资金执行动作，仅出纳或系统管理员可登记。 */
function canRecordMeasurementPayment(roleCodes: readonly string[]) {
  return canExecutePayment(roleCodes);
}

/** 采购结算属于真实资金执行，必须与会计审查职责分离。 */
function canRecordPurchaseSettlement(roleCodes: readonly string[]) {
  return canExecutePayment(roleCodes);
}

/** 采购申请输入不允许携带状态或审批人，状态由专用审批接口在服务端控制。 */
const purchaseRequestInput = z.object({
  id: z.number().int().positive().optional(),
  requestNo: z.string().trim().min(4, "请填写申请单号").max(64).optional(),
  projectId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  amount: moneySchema,
  description: z.string().trim().min(2, "请填写采购说明").max(2000),
});

/** 供应商只存储脱敏联系方式，不接受原始手机号等个人敏感字段。 */
const supplierInput = z.object({
  id: z.number().int().positive().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(2, "请填写供应商名称").max(200),
  unifiedSocialCreditCode: z.string().trim().max(64).nullable().optional(),
  contactName: z.string().trim().max(64).nullable().optional(),
  contactPhoneMasked: z.string().trim().regex(/^[*0-9\-+() ]*$/, "联系电话只能填写脱敏号码").max(32).nullable().optional(),
  status: z.enum(["active", "disabled"]),
});

/** 采购订单从已批准申请生成，服务器保留项目、申请、供应商和金额快照。 */
const purchaseOrderInput = z.object({
  requestId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  supplierId: z.number().int().positive().nullable().optional(),
  assetType: z.enum(["vehicle", "machine"]).nullable().optional(),
  assetId: z.number().int().positive().nullable().optional(),
  amount: moneySchema,
  orderedAt: isoDateTimeSchema,
  orderNo: z.string().trim().min(4).max(64).optional(),
}).superRefine((input, context) => {
  if (Boolean(input.assetType) !== Boolean(input.assetId)) context.addIssue({ code: "custom", path: [input.assetType ? "assetId" : "assetType"], message: "关联车辆或机械时必须同时选择资产类型和具体设备" });
});

/** 小额物资无需先建申请，但必须关联采购影像，服务端再按阈值和主管审核状态控制。 */
const smallDirectPurchaseInput = z.object({
  projectId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  itemDescription: z.string().trim().min(2, "请填写小额物资名称或说明").max(500),
  supplierId: z.number().int().positive().nullable().optional(),
  assetType: z.enum(["vehicle", "machine"]).nullable().optional(),
  assetId: z.number().int().positive().nullable().optional(),
  quantity: z.number().gt(0, "数量必须大于 0").max(999999999.999).optional(),
  unitPrice: moneySchema.optional(),
  /** 兼容既有客户端；新清单录入优先使用数量乘单价计算金额。 */
  amount: moneySchema.refine(value => value > 0, "金额必须大于 0").optional(),
  orderedAt: isoDateTimeSchema,
  evidenceId: z.number().int().positive(),
  hasInvoice: z.boolean().default(false),
  invoiceEvidenceId: z.number().int().positive().nullable().optional(),
}).superRefine((input, context) => {
  if (Boolean(input.assetType) !== Boolean(input.assetId)) context.addIssue({ code: "custom", path: [input.assetType ? "assetId" : "assetType"], message: "关联车辆或机械时必须同时选择资产类型和具体设备" });
});

/** 配件费用只能归集至当前项目实际存在的车辆或机械，禁止跨项目串账。 */
async function assertPurchaseAssetLink(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: { projectId: number; assetType?: "vehicle" | "machine" | null; assetId?: number | null },
) {
  if (!input.assetType && !input.assetId) return null;
  if (!input.assetType || !input.assetId) throw new TRPCError({ code: "BAD_REQUEST", message: "关联车辆或机械时必须同时选择资产类型和具体设备" });
  const [asset] = input.assetType === "vehicle"
    ? await db.select({ id: transportVehicles.id, projectId: transportVehicles.projectId, label: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.id, input.assetId)).limit(1)
    : await db.select({ id: machines.id, projectId: machines.projectId, label: machines.name }).from(machines).where(eq(machines.id, input.assetId)).limit(1);
  if (!asset || asset.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "关联车辆或机械不存在，或不属于当前项目" });
  return asset;
}
/** 普通采购单据照片不生成水印，只作为采购清单、送货单或验收单的审计附件归档。 */
const purchaseDocumentUploadInput = z.object({
  projectId: z.number().int().positive(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  base64Data: z.string().min(16).max(22_000_000),
  description: z.string().trim().min(2).max(300).default("采购单据照片"),
  attachmentKind: z.enum(["document", "invoice"]).default("document"),
});

/** 财务发票原件必须先受控归档；验真结果和项目分摊均只引用该证据记录。 */
const financialInvoiceEvidenceUploadInput = z.object({
  projectId: z.number().int().positive(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  base64Data: z.string().min(16).max(22_000_000),
  description: z.string().trim().min(2).max(300).default("财务发票原件"),
});

function decodePurchaseDocumentBase64(value: string, mimeType: "image/jpeg" | "image/png" | "application/pdf") {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const bytes = Buffer.from(normalized, "base64");
  const maxBytes = mimeType === "application/pdf" ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
  if (!bytes.length || bytes.length > maxBytes) throw new TRPCError({ code: "BAD_REQUEST", message: mimeType === "application/pdf" ? "发票 PDF 不能超过 15MB" : "单据或发票照片必须为 JPG/PNG，且单张不超过 5MB" });
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isPdf = bytes.length >= 5 && bytes.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if ((mimeType === "image/jpeg" && !isJpeg) || (mimeType === "image/png" && !isPng) || (mimeType === "application/pdf" && !isPdf)) throw new TRPCError({ code: "BAD_REQUEST", message: "单据、发票文件格式与内容不一致" });
  return bytes;
}

/** 采购订单结算只接收本次实际付款金额，待结算余额始终由服务端财务流水计算。 */
const purchaseSettlementInput = z.object({
  orderId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  amount: moneySchema.gt(0, "结算金额必须大于 0"),
  settledAt: isoDateTimeSchema,
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 库存收发输入只接收数量和单价，金额由服务器计算并写入不可变流水。 */
const inventoryInput = z.object({
  projectId: z.number().int().positive(),
  requestId: z.number().int().positive().nullable().optional(),
  purchaseOrderId: z.number().int().positive().nullable().optional(),
  transactionType: z.enum(["inbound", "outbound", "return"]),
  itemName: z.string().trim().min(1, "请填写物料名称").max(200),
  unit: z.string().trim().min(1, "请填写计量单位").max(32),
  quantity: z.number().gt(0, "数量必须大于 0").max(999999999.999),
  unitCost: moneySchema,
  occurredAt: isoDateTimeSchema,
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** Excel 历史导入仅接收结构化业务字段；金额、日期、项目范围和重复单号均由服务端再次校验。 */
const purchaseSpreadsheetImportInput = z.object({
  projectId: z.number().int().positive(),
  orders: z.array(z.object({
    orderNo: z.string().trim().min(4).max(64).nullable().optional(),
    categoryName: z.string().trim().min(1, "请填写采购类别").max(100),
    itemDescription: z.string().trim().min(1, "请填写物资说明").max(500),
    quantity: z.number().gt(0).max(999999999.999).nullable().optional(),
    unitPrice: moneySchema.nullable().optional(),
    amount: moneySchema.gt(0, "订单金额必须大于 0"),
    orderedAt: isoDateTimeSchema,
    supplierName: z.string().trim().min(1).max(200).nullable().optional(),
    hasInvoice: z.boolean().default(false),
    remarks: z.string().trim().max(500).nullable().optional(),
  }).superRefine((row, context) => {
    if ((row.quantity === null || row.quantity === undefined) !== (row.unitPrice === null || row.unitPrice === undefined)) {
      context.addIssue({ code: "custom", path: [row.quantity === null || row.quantity === undefined ? "quantity" : "unitPrice"], message: "数量和单价须同时填写，或同时留空" });
    }
    if (row.quantity !== null && row.quantity !== undefined && row.unitPrice !== null && row.unitPrice !== undefined && Math.abs(roundMoney(row.quantity * row.unitPrice) - roundMoney(row.amount)) > 0.01) {
      context.addIssue({ code: "custom", path: ["amount"], message: "订单金额须与数量×单价一致" });
    }
  })).max(300),
  inventoryTransactions: z.array(z.object({
    transactionNo: z.string().trim().min(4).max(64).nullable().optional(),
    transactionType: z.enum(["inbound", "outbound", "return"]),
    itemName: z.string().trim().min(1, "请填写物料名称").max(200),
    unit: z.string().trim().min(1, "请填写计量单位").max(32),
    quantity: z.number().gt(0, "数量必须大于 0").max(999999999.999),
    unitCost: moneySchema,
    occurredAt: isoDateTimeSchema,
    remarks: z.string().trim().max(500).nullable().optional(),
  })).max(300),
}).superRefine((input, context) => {
  if (input.orders.length + input.inventoryTransactions.length < 1) context.addIssue({ code: "custom", path: ["orders"], message: "请至少导入一条采购订单或库存流水" });
  if (input.orders.length + input.inventoryTransactions.length > 500) context.addIssue({ code: "custom", path: ["orders"], message: "单次最多导入 500 条记录，请拆分文件后重试" });
});

/** 工程计量草稿只允许申报金额；核定金额由审核状态操作接口独立提交。 */
const measurementInput = z.object({
  id: z.number().int().positive().optional(),
  claimNo: z.string().trim().min(4).max(64).optional(),
  projectId: z.number().int().positive(),
  period: periodSchema,
  declaredAmount: moneySchema,
});

/** 回款始终关联已确认的计量申报，金额上限由服务端根据历史回款流水校验。 */
const measurementPaymentInput = z.object({
  claimId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  amount: moneySchema.refine(value => value > 0, "回款金额必须大于 0"),
  receivedAt: isoDateTimeSchema,
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 财务流水由财务岗位登记，金额、发生时间和项目均经过服务端校验。 */
const financialRecordInput = z.object({
  projectId: z.number().int().positive(),
  direction: z.enum(["income", "expense"]),
  category: z.string().trim().min(2, "请填写资金分类").max(64),
  amount: moneySchema.refine(value => value > 0, "金额必须大于 0"),
  occurredAt: isoDateTimeSchema,
  settlementStatus: z.enum(["unpaid", "partial", "paid", "void"]),
  sourceType: z.string().trim().max(64).nullable().optional(),
  sourceId: z.string().trim().max(128).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

/** 未实际支付的人工流水可作废；已支付流水必须通过相反方向的冲销流水处理。 */
const financialRecordVoidInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  reason: z.string().trim().min(1, "请填写作废原因").max(500, "作废原因不得超过 500 个字符"),
});

/** 已支付人工流水的冲销必须保留原流水，不允许直接改写金额、方向或结算终态。 */
const financialRecordReversalInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  reversedAt: isoDateTimeSchema,
  reason: z.string().trim().min(1, "请填写冲销原因").max(500, "冲销原因不得超过 500 个字符"),
});

/** 发票金额、税额和认证状态只能由财务岗位按项目范围维护，票号在项目内唯一。 */
const financialInvoiceInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  financialRecordId: z.number().int().positive().nullable().optional(),
  invoiceNo: z.string().trim().min(1, "请填写发票号码").max(64),
  invoiceCode: z.string().trim().max(64).nullable().optional(),
  counterpartyName: z.string().trim().min(2, "请填写购销方名称").max(200),
  invoiceType: z.enum(["vat_special", "vat_normal", "electronic", "receipt", "other"]),
  direction: z.enum(["income", "expense"]),
  amount: moneySchema.refine(value => value > 0, "发票金额必须大于 0"),
  taxAmount: moneySchema,
  taxRate: z.number().min(0).max(1),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "开票日期格式应为 YYYY-MM-DD"),
  evidenceId: z.number().int().positive().nullable().optional(),
  /** 同一原件可合法分摊，但分摊总额、报销与抵扣均由服务端统一校验。 */
  allocatedAmount: moneySchema.refine(value => value > 0, "项目分摊金额必须大于 0").optional(),
  allocationPurpose: z.enum(["expense_deduction", "reimbursement", "income_collection", "reference_only"]).default("expense_deduction"),
  structuredPayloadJson: z.string().trim().max(200_000).nullable().optional(),
  verificationReference: z.string().trim().max(200).nullable().optional(),
  /** 红字电子凭证仅允许关联已存在的原始蓝字凭证。 */
  redFlushOriginalId: z.number().int().positive().nullable().optional(),
});

const financialInvoiceTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["verified", "void", "red_flushed"]),
  reason: z.string().trim().max(500).nullable().optional(),
  verificationReference: z.string().trim().max(200).nullable().optional(),
});

/** 每日会计日结只允许财务负责人或会计执行，服务端重新汇总当日流水而不信任客户端金额。 */
const dailyClosingInput = z.object({
  projectId: z.number().int().positive(),
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日结日期格式应为 YYYY-MM-DD"),
});

const dailyClosingReopenInput = dailyClosingInput.extend({
  reason: z.string().trim().min(5, "请填写不少于 5 个字的反结账原因").max(500),
});

/** 仅由财务岗位维护的纳税主体资料；税号只用于与正式财务/税务系统交接，不向普通业务页面投影。 */
const taxEntityProfileInput = z.object({
  id: z.number().int().positive().optional(),
  entityName: z.string().trim().min(2, "请填写纳税主体名称").max(200),
  taxpayerIdentifier: z.string().trim().min(8, "请填写有效的纳税人识别号").max(64),
  taxMethod: z.enum(["general", "small_scale", "simplified", "other"]),
  registeredLocation: z.string().trim().max(300).nullable().optional(),
  status: z.enum(["active", "suspended", "archived"]),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** 项目税务档案只采集真实项目所在地、合同不含税金额等资料，不由系统推导应纳税额。 */
const projectTaxProfileInput = z.object({
  projectId: z.number().int().positive(),
  taxEntityId: z.number().int().positive(),
  projectLocation: z.string().trim().min(2, "请填写项目实际所在地").max(300),
  taxMethod: z.enum(["general", "small_scale", "simplified", "other"]),
  contractExTaxAmount: moneySchema,
  contractTaxRate: z.number().min(0).max(1),
  crossRegionConstruction: z.boolean(),
  subcontractDeductionMethod: z.enum(["not_applicable", "supporting_document", "other"]),
  remarks: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["active", "archived"]),
});

/** 手工补充的分包扣除、印花税、薪税待处理、预缴与税会差异资料项；所有税额均仅记录外部专业确认值。 */
const taxAuxiliaryEntryInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  period: periodSchema,
  entryType: z.enum(["vat_input", "vat_output", "subcontract_deduction", "stamp_duty", "payroll_handoff", "cross_region_prepayment", "book_tax_difference", "other"]),
  sourceType: z.string().trim().max(64).nullable().optional(),
  sourceId: z.string().trim().max(128).nullable().optional(),
  subject: z.string().trim().min(2, "请填写资料事项").max(300),
  amount: moneySchema,
  taxBaseAmount: moneySchema.nullable().optional(),
  referenceTaxRate: z.number().min(0).max(1).nullable().optional(),
  reportedTaxAmount: moneySchema.nullable().optional(),
  documentReference: z.string().trim().max(200).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const taxAuxiliaryEntryTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["handed_off", "receipt_recorded", "void"]),
  documentReference: z.string().trim().max(200).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const taxHandoffInput = z.object({
  projectId: z.number().int().positive(),
  period: periodSchema,
  handoffType: z.enum(["vat_invoice", "financial_ledger", "payroll", "contract_tax", "cross_region", "combined"]),
  notes: z.string().trim().max(500).nullable().optional(),
});

const taxHandoffTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["handed_off", "receipt_recorded", "void"]),
  receiptReference: z.string().trim().max(200).nullable().optional(),
  receiptEvidenceId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** 累计预扣辅助测算的可变资料项；工资收入必须由已审核/已付款的工资事实在服务端重算。 */
const payrollTaxWithholdingInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  workerId: z.number().int().positive(),
  period: periodSchema,
  incomeType: z.enum(["resident_wage_salary", "labor_remuneration", "nonresident_wage_salary", "manual_review"]),
  cumulativeExemptIncome: moneySchema,
  employmentMonths: z.number().int().min(0).max(12),
  cumulativeSocialInsuranceDeduction: moneySchema,
  cumulativeSpecialAdditionalDeduction: moneySchema,
  cumulativeOtherDeduction: moneySchema,
  cumulativeTaxWithheldBefore: moneySchema,
  externallyWithheldThisPeriod: moneySchema.nullable().optional(),
  externalReference: z.string().trim().max(200).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  reviewNote: z.string().trim().max(1000).nullable().optional(),
});

const payrollTaxWithholdingTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["reviewed", "handed_off", "receipt_recorded", "void"]),
  externalReference: z.string().trim().max(200).nullable().optional(),
  evidenceId: z.number().int().positive().nullable().optional(),
  reviewNote: z.string().trim().max(1000).nullable().optional(),
});

/** 合同印花税资料只从真实合同快照读取；税目、计税依据、税率和实际税额均须人工专业确认。 */
const contractTaxRegistrationInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  contractId: z.number().int().positive(),
  taxItem: z.string().trim().max(100).nullable().optional(),
  taxBaseAmount: moneySchema.nullable().optional(),
  referenceTaxRate: z.number().min(0).max(1).nullable().optional(),
  professionallyConfirmedTaxAmount: moneySchema.nullable().optional(),
  paymentReference: z.string().trim().max(200).nullable().optional(),
  paymentEvidenceId: z.number().int().positive().nullable().optional(),
  reviewNote: z.string().trim().max(1000).nullable().optional(),
});

const contractTaxRegistrationTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["confirmed", "handed_off", "receipt_recorded", "not_applicable", "void"]),
  paymentReference: z.string().trim().max(200).nullable().optional(),
  paymentEvidenceId: z.number().int().positive().nullable().optional(),
  reviewNote: z.string().trim().max(1000).nullable().optional(),
});

/** 跨地区预缴资料项按项目/期间唯一，字段只承载实际业务资料与完税凭证引用。 */
const crossRegionConstructionTaxInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  period: periodSchema,
  projectRegistrationReference: z.string().trim().max(200).nullable().optional(),
  revenueIncludingTaxAmount: moneySchema.nullable().optional(),
  subcontractDeductionAmount: moneySchema.nullable().optional(),
  subcontractDeductionReference: z.string().trim().max(200).nullable().optional(),
  deductionEvidenceId: z.number().int().positive().nullable().optional(),
  prepaidVatAmount: moneySchema.nullable().optional(),
  taxPaymentReference: z.string().trim().max(200).nullable().optional(),
  taxPaymentEvidenceId: z.number().int().positive().nullable().optional(),
  reviewNote: z.string().trim().max(1000).nullable().optional(),
});

const crossRegionConstructionTaxTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["ready_for_handoff", "receipt_recorded", "not_applicable", "void"]),
  taxPaymentReference: z.string().trim().max(200).nullable().optional(),
  taxPaymentEvidenceId: z.number().int().positive().nullable().optional(),
  reviewNote: z.string().trim().max(1000).nullable().optional(),
});

/** 项目部收方草稿，工程量与单价由服务端重新计算申报金额。 */
const measurementTakeoffInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  measurementClaimId: z.number().int().positive().nullable().optional(),
  workItem: z.string().trim().min(2, "请填写计量项目").max(200),
  workLocation: z.string().trim().min(2, "请填写作业位置").max(200),
  unit: z.enum(["m3", "m2", "m", "t", "piece", "set", "other"]),
  quantity: z.number().gt(0, "工程量必须大于 0").max(999999999.999),
  unitPrice: moneySchema,
  takeoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "收方日期格式应为 YYYY-MM-DD"),
});

const measurementTakeoffTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["submitted", "reviewing", "approved", "rejected", "locked", "void"]),
  reviewNote: z.string().trim().max(500).nullable().optional(),
});

const measurementTakeoffEvidenceInput = z.object({ takeoffId: z.number().int().positive(), projectId: z.number().int().positive(), evidenceId: z.number().int().positive() });

/** 按项目读取采购申请，避免客户端仅凭申请 ID 获取或修改其他项目记录。 */
async function getScopedPurchaseRequest(ctx: Parameters<typeof requireAuthenticatedUser>[0], requestId: number, projectId: number) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [request] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, requestId)).limit(1);
  if (!request || request.projectId !== projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的采购申请" });
  }
  return { db, request };
}

/** 按项目读取采购订单并校验其申请关联，避免库存流水跨项目绑定订单。 */
async function getScopedPurchaseOrder(ctx: Parameters<typeof requireAuthenticatedUser>[0], orderId: number, projectId: number) {
  await assertProjectInCurrentScope(ctx, projectId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
  const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).limit(1);
  if (!order || order.projectId !== projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定项目下的采购订单" });
  }
  return { db, order };
}

/** 采购、库存、工程计量和财务成本按领域拆分，根路由只负责组合。 */
export const purchasingRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertPurchaseAccess(ctx);
    return listScopedProjects(ctx);
  }),

  /** 前端仅据此收敛采购操作；每个写入接口仍会再次校验岗位、项目范围与状态机。 */
  capabilities: protectedProcedure.query(async ({ ctx }) => {
    const roleCodes = await assertPurchaseAccess(ctx);
    return { canApprove: canApprovePurchase(roleCodes), canManageInventory: canManageInventory(roleCodes) };
  }),

  /** 采购类别由基础数据固定为 12 类，只读返回，业务路由不允许改变标准编码。 */
  categories: protectedProcedure.query(async ({ ctx }) => {
    await assertPurchaseAccess(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(purchaseCategories).where(eq(purchaseCategories.status, "active")).orderBy(purchaseCategories.sortOrder, purchaseCategories.id);
  }),

  listSuppliers: protectedProcedure.query(async ({ ctx }) => {
    await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(suppliers).where(eq(suppliers.status, "active")).orderBy(suppliers.name);
  }),

  /** 车辆、机械配件采购只能选择当前项目的有效资产，不返回联系方式等不必要字段。 */
  listAssetOptions: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { vehicles: [], machines: [] };
    const [vehicles, machineRows] = await Promise.all([
      db.select({ id: transportVehicles.id, label: transportVehicles.plateNo, status: transportVehicles.status }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)).orderBy(transportVehicles.plateNo),
      db.select({ id: machines.id, name: machines.name, code: machines.code, status: machines.status }).from(machines).where(eq(machines.projectId, input.projectId)).orderBy(machines.name),
    ]);
    return {
      vehicles: vehicles.map(vehicle => ({ id: vehicle.id, label: vehicle.label, status: vehicle.status })),
      machines: machineRows.filter(machine => machine.status !== "retired").map(machine => ({ id: machine.id, label: `${machine.name}${machine.code ? ` · ${machine.code}` : ""}`, status: machine.status })),
    };
  }),

  /** 保存供应商基础资料；联系方式仅允许以脱敏形式进入本系统。 */
  saveSupplier: protectedProcedure.input(supplierInput).mutation(async ({ ctx, input }) => {
    const user = await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = {
      organizationId: input.organizationId ?? null,
      name: input.name,
      unifiedSocialCreditCode: input.unifiedSocialCreditCode ?? null,
      contactName: input.contactName ?? null,
      contactPhoneMasked: input.contactPhoneMasked ?? null,
      status: input.status,
    };
    let supplierId = input.id;
    if (supplierId) {
      await db.update(suppliers).set(values).where(eq(suppliers.id, supplierId));
    } else {
      const [created] = await db.insert(suppliers).values(values).$returningId();
      supplierId = Number(created?.id);
      if (!Number.isInteger(supplierId) || supplierId <= 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "供应商创建失败，请稍后重试" });
      }
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: input.id ? "update_supplier" : "create_supplier", targetType: "supplier", targetId: String(supplierId), summary: `${input.id ? "维护" : "新建"}供应商：${input.name}` });
    return { success: true, id: supplierId };
  }),

  listRequests: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(purchaseRequests).where(eq(purchaseRequests.projectId, input.projectId)).orderBy(desc(purchaseRequests.updatedAt));
  }),

  /** 保存采购草稿或被退回申请，已提交单据不得由申请人直接覆盖金额和说明。 */
  saveRequest: protectedProcedure.input(purchaseRequestInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [category] = await db.select().from(purchaseCategories).where(and(eq(purchaseCategories.id, input.categoryId), eq(purchaseCategories.status, "active"))).limit(1);
    if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的固定采购类别" });
    const values = { projectId: input.projectId, categoryId: input.categoryId, amount: String(roundMoney(input.amount)), description: input.description };
    if (input.id) {
      const { request } = await getScopedPurchaseRequest(ctx, input.id, input.projectId);
      if (request.status !== "draft" && request.status !== "rejected") {
        throw new TRPCError({ code: "CONFLICT", message: "仅草稿或被退回采购申请可以修改" });
      }
      const updateResult = await db.update(purchaseRequests)
        .set({ ...values, status: "draft" })
        .where(and(eq(purchaseRequests.id, input.id), eq(purchaseRequests.status, request.status)));
      assertConditionalBusinessWrite(updateResult, "采购申请已被其他用户更新，请刷新后重试");
    } else {
      await db.insert(purchaseRequests).values({ ...values, requestNo: input.requestNo ?? createBusinessNo("PR"), requesterId: user.id, status: "draft" });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: input.id ? "update_request" : "create_request", targetType: "purchase_request", targetId: String(input.id ?? input.requestNo ?? "draft"), summary: `${input.id ? "维护" : "新建"}采购申请` });
    return { success: true };
  }),

  /** 采购申请状态由专用流转接口管理，审批、入库和关闭动作均记录责任人与时间。 */
  transitionRequest: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), targetStatus: z.enum(["submitted", "approved", "ordered", "received", "stocked", "closed", "rejected", "draft"]) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertPurchaseAccess(ctx);
    const { db, request } = await getScopedPurchaseRequest(ctx, input.id, input.projectId);
    try {
      assertPurchaseRequestStatusTransition(request.status, input.targetStatus);
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    const autoApprove = input.targetStatus === "submitted" && await isSupervisorReviewAutoApprove(db);
    const effectiveTargetStatus = autoApprove ? "approved" : input.targetStatus;
    if (["approved", "rejected", "closed"].includes(effectiveTargetStatus) && !autoApprove && !canApprovePurchase(roleCodes)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无采购申请审批或关闭权限" });
    }
    if (["stocked", "received"].includes(input.targetStatus) && !canManageInventory(roleCodes)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无收货或入库确认权限" });
    }
    const now = new Date();
    const patch: Partial<typeof purchaseRequests.$inferInsert> = { status: effectiveTargetStatus };
    if (effectiveTargetStatus === "approved") { patch.approvedBy = user.id; patch.approvedAt = now; }
    if (effectiveTargetStatus === "stocked") { patch.stockedBy = user.id; patch.stockedAt = now; }
    if (effectiveTargetStatus === "closed") patch.closedAt = now;
    const updateResult = await db.update(purchaseRequests)
      .set(patch)
      .where(and(eq(purchaseRequests.id, input.id), eq(purchaseRequests.status, request.status)));
    assertConditionalBusinessWrite(updateResult, "采购申请已被其他用户更新，请刷新后重试");
    const purchaseRequestStatusLabel = getBusinessStatusLabel(effectiveTargetStatus);
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: autoApprove ? "auto_approve_purchase_request_by_supervisor_setting" : "transition_request", targetType: "purchase_request", targetId: String(input.id), summary: autoApprove ? "统一上级主管审核开关已开启：采购申请自动审核通过" : `采购申请状态变更为：${purchaseRequestStatusLabel}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "purchasing", eventCode: `purchase_request_${effectiveTargetStatus}`, targetType: "purchase_request", targetId: String(input.id), title: autoApprove ? "采购申请已自动审核通过" : `采购申请${purchaseRequestStatusLabel}`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true, status: effectiveTargetStatus, autoApproved: autoApprove };
  }),

  listOrders: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const orders = await db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, input.projectId)).orderBy(desc(purchaseOrders.updatedAt));
    const evidenceIds = Array.from(new Set(orders.flatMap(order => [order.evidenceId, order.invoiceEvidenceId]).filter((id): id is number => id !== null)));
    const categoryIds = Array.from(new Set(orders.map(order => order.categoryId).filter((id): id is number => id !== null)));
    const vehicleAssetIds = Array.from(new Set(orders.filter(order => order.assetType === "vehicle" && order.assetId !== null).map(order => order.assetId!)));
    const machineAssetIds = Array.from(new Set(orders.filter(order => order.assetType === "machine" && order.assetId !== null).map(order => order.assetId!)));
    const [evidenceRows, categoryRows, vehicleRows, machineRows] = await Promise.all([
      evidenceIds.length ? db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, mimeType: evidenceRecords.mimeType, uploadedBy: evidenceRecords.uploadedBy }).from(evidenceRecords).where(and(eq(evidenceRecords.projectId, input.projectId), inArray(evidenceRecords.id, evidenceIds))) : Promise.resolve([]),
      categoryIds.length ? db.select({ id: purchaseCategories.id, name: purchaseCategories.name }).from(purchaseCategories).where(inArray(purchaseCategories.id, categoryIds)) : Promise.resolve([]),
      vehicleAssetIds.length ? db.select({ id: transportVehicles.id, plateNo: transportVehicles.plateNo }).from(transportVehicles).where(and(eq(transportVehicles.projectId, input.projectId), inArray(transportVehicles.id, vehicleAssetIds))) : Promise.resolve([]),
      machineAssetIds.length ? db.select({ id: machines.id, name: machines.name, code: machines.code }).from(machines).where(and(eq(machines.projectId, input.projectId), inArray(machines.id, machineAssetIds))) : Promise.resolve([]),
    ]);
    const userIds = Array.from(new Set(orders.flatMap(order => [order.createdBy, ...evidenceRows.map(evidence => evidence.uploadedBy)]).filter((id): id is number => Number.isInteger(id))));
    const userRows = userIds.length ? await db.select({ id: users.id, name: users.name, localUsername: users.localUsername }).from(users).where(inArray(users.id, userIds)) : [];
    const userNameById = new Map(userRows.map(user => [user.id, user.name || user.localUsername || `管理员 #${user.id}`]));
    const categoryNameById = new Map(categoryRows.map(category => [category.id, category.name]));
    const assetLabelByKey = new Map<string, string>([
      ...vehicleRows.map(vehicle => [`vehicle:${vehicle.id}`, `车辆 · ${vehicle.plateNo}`] as const),
      ...machineRows.map(machine => [`machine:${machine.id}`, `机械 · ${machine.name}${machine.code ? ` (${machine.code})` : ""}`] as const),
    ]);
    const evidenceById = new Map(await Promise.all(evidenceRows.map(async evidence => {
      const url = await storageGetSignedUrl(evidence.fileKey);
      return [evidence.id, { fileName: evidence.fileName, mimeType: evidence.mimeType || "application/octet-stream", url, uploadedBy: evidence.uploadedBy, uploadedByName: userNameById.get(evidence.uploadedBy) ?? `管理员 #${evidence.uploadedBy}` }] as const;
    })));
    return orders.map(order => { const documentAttachment = order.evidenceId ? evidenceById.get(order.evidenceId) ?? null : null; const invoiceAttachment = order.invoiceEvidenceId ? evidenceById.get(order.invoiceEvidenceId) ?? null : null; return { ...order, categoryName: order.categoryId ? categoryNameById.get(order.categoryId) ?? "已删除类别" : "采购申请关联", assetLabel: order.assetType && order.assetId ? assetLabelByKey.get(`${order.assetType}:${order.assetId}`) ?? "关联资产已停用" : null, createdByName: userNameById.get(order.createdBy) ?? `管理员 #${order.createdBy}`, documentUploadedBy: documentAttachment?.uploadedBy ?? null, documentUploadedByName: documentAttachment?.uploadedByName ?? null, documentAttachment, invoiceAttachment }; });
  }),

  /** 批量导入历史采购订单和库存收发流水：先预校验类别与外部单号，再在一个事务内写入草稿订单和不可变库存流水。 */
  importSpreadsheet: protectedProcedure.input(purchaseSpreadsheetImportInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertSuperAdmin(ctx);
    const roleCodes = await assertPurchaseAccess(ctx);
    if (input.inventoryTransactions.length && !canManageInventory(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无库存收发导入权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

    const normalizedOrderNos = input.orders.map(row => row.orderNo?.trim()).filter((value): value is string => Boolean(value));
    const normalizedTransactionNos = input.inventoryTransactions.map(row => row.transactionNo?.trim()).filter((value): value is string => Boolean(value));
    if (new Set(normalizedOrderNos).size !== normalizedOrderNos.length) throw new TRPCError({ code: "BAD_REQUEST", message: "导入文件中存在重复采购订单号，请修正后重试" });
    if (new Set(normalizedTransactionNos).size !== normalizedTransactionNos.length) throw new TRPCError({ code: "BAD_REQUEST", message: "导入文件中存在重复库存流水单号，请修正后重试" });

    const [project] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目" });
    const [categoryRows, existingOrders, existingTransactions, supplierRows] = await Promise.all([
      db.select({ id: purchaseCategories.id, name: purchaseCategories.name }).from(purchaseCategories).where(eq(purchaseCategories.status, "active")),
      normalizedOrderNos.length ? db.select({ orderNo: purchaseOrders.orderNo }).from(purchaseOrders).where(inArray(purchaseOrders.orderNo, normalizedOrderNos)) : Promise.resolve([]),
      normalizedTransactionNos.length ? db.select({ transactionNo: inventoryTransactions.transactionNo }).from(inventoryTransactions).where(inArray(inventoryTransactions.transactionNo, normalizedTransactionNos)) : Promise.resolve([]),
      db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.status, "active")),
    ]);
    if (existingOrders.length) throw new TRPCError({ code: "CONFLICT", message: `采购订单号已存在：${existingOrders.slice(0, 3).map(row => row.orderNo).join("、")}${existingOrders.length > 3 ? "等" : ""}` });
    if (existingTransactions.length) throw new TRPCError({ code: "CONFLICT", message: `库存流水单号已存在：${existingTransactions.slice(0, 3).map(row => row.transactionNo).join("、")}${existingTransactions.length > 3 ? "等" : ""}` });
    const categoryIdByName = new Map(categoryRows.map(row => [row.name.trim(), row.id]));
    const unknownCategories = Array.from(new Set(input.orders.map(row => row.categoryName.trim()).filter(name => !categoryIdByName.has(name))));
    if (unknownCategories.length) throw new TRPCError({ code: "BAD_REQUEST", message: `采购类别不存在或已停用：${unknownCategories.slice(0, 3).join("、")}${unknownCategories.length > 3 ? "等" : ""}` });

    let createdOrders = 0;
    let createdInventoryTransactions = 0;
    let createdSuppliers = 0;
    await db.transaction(async tx => {
      const supplierIdByName = new Map(supplierRows.map(row => [row.name.trim(), row.id]));
      const missingSuppliers = Array.from(new Set(input.orders
        .map(row => row.supplierName?.trim())
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .filter(value => !supplierIdByName.has(value))));
      for (const supplierName of missingSuppliers) {
        const result = await tx.insert(suppliers).values({ organizationId: project.organizationId ?? null, name: supplierName, status: "active" });
        const supplierId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
        if (!supplierId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "导入供应商主数据失败" });
        supplierIdByName.set(supplierName, supplierId);
        createdSuppliers += 1;
      }
      if (input.orders.length) {
        await tx.insert(purchaseOrders).values(input.orders.map(row => ({
          orderNo: row.orderNo?.trim() || createBusinessNo("IMP"),
          requestId: null,
          projectId: input.projectId,
          procurementMode: "imported" as const,
          categoryId: categoryIdByName.get(row.categoryName.trim()) ?? null,
          itemDescription: row.itemDescription.trim(),
          quantity: row.quantity === null || row.quantity === undefined ? null : String(row.quantity),
          unitPrice: row.unitPrice === null || row.unitPrice === undefined ? null : String(roundMoney(row.unitPrice)),
          evidenceId: null,
          hasInvoice: row.hasInvoice,
          invoiceEvidenceId: null,
          ocrSummary: row.remarks?.trim() || null,
          supplierId: row.supplierName?.trim() ? supplierIdByName.get(row.supplierName.trim()) ?? null : null,
          assetType: null,
          assetId: null,
          assetDeductionReference: null,
          assetDeductedAt: null,
          amount: String(roundMoney(row.amount)),
          orderedAt: new Date(row.orderedAt),
          status: "draft" as const,
          createdBy: user.id,
          confirmedBy: null,
          confirmedAt: null,
        })));
        createdOrders = input.orders.length;
      }
      if (input.inventoryTransactions.length) {
        await tx.insert(inventoryTransactions).values(input.inventoryTransactions.map(row => ({
          projectId: input.projectId,
          requestId: null,
          purchaseOrderId: null,
          transactionNo: row.transactionNo?.trim() || createBusinessNo("IMPINV"),
          transactionType: row.transactionType,
          itemName: row.itemName.trim(),
          unit: row.unit.trim(),
          quantity: String(row.quantity),
          unitCost: String(roundMoney(row.unitCost)),
          amount: String(roundMoney(row.quantity * row.unitCost)),
          occurredAt: new Date(row.occurredAt),
          operatorId: user.id,
          remarks: row.remarks?.trim() || "历史 Excel 导入",
        })));
        createdInventoryTransactions = input.inventoryTransactions.length;
      }
      await tx.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "import_purchase_spreadsheet", targetType: "purchase_inventory_import", targetId: String(input.projectId), summary: `Excel 导入完成：采购订单 ${createdOrders} 条、库存流水 ${createdInventoryTransactions} 条、新建供应商 ${createdSuppliers} 家；导入订单均为草稿，发票附件须后续补传。` });
    });
    return { success: true, createdOrders, createdInventoryTransactions, createdSuppliers };
  }),

  /** 仅返回当前项目的采购取证影像，供小额物资在 OCR 后人工补全并关联，URL 使用短时签名。 */
  listPurchaseEvidences: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, capturedAt: evidenceRecords.capturedAt, ocrResultJson: evidenceRecords.ocrResultJson, watermarkJson: evidenceRecords.watermarkJson }).from(evidenceRecords).where(and(eq(evidenceRecords.projectId, input.projectId), eq(evidenceRecords.sourceType, "purchase"))).orderBy(desc(evidenceRecords.capturedAt)).limit(30);
    return Promise.all(rows.map(async row => {
      const url = await storageGetSignedUrl(row.fileKey);
      return { id: row.id, fileName: row.fileName, capturedAt: row.capturedAt, ocrSummary: getPurchaseOcrSummary(row.ocrResultJson), description: (() => { try { return (JSON.parse(row.watermarkJson ?? "{}") as { description?: string }).description ?? "采购影像"; } catch { return "采购影像"; } })(), url };
    }));
  }),

  /** 采购单据直接拍照上传：不调用水印相机，不要求定位，仅归档为当前项目采购审计附件。 */
  uploadPurchaseDocument: protectedProcedure.input(purchaseDocumentUploadInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const bytes = decodePurchaseDocumentBase64(input.base64Data, input.mimeType);
    const capturedAt = new Date();
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "purchase-document.jpg";
    const storedFile = await storagePut(`purchase-documents/${input.projectId}/${capturedAt.toISOString().slice(0, 10)}/${user.id}-${safeFileName}`, bytes, input.mimeType);
    let evidenceId = 0;
    await db.transaction(async tx => {
      const result = await tx.insert(evidenceRecords).values({ projectId: input.projectId, sourceType: "purchase", sourceId: input.attachmentKind === "invoice" ? "small_direct_invoice" : "small_direct_document", fileKey: storedFile.key, fileName: input.fileName, mimeType: input.mimeType, contentSha256, contentBytes: bytes.length, watermarkJson: JSON.stringify({ description: input.description, attachmentKind: input.attachmentKind, captureMode: "purchase_document_upload", capturedAt: capturedAt.toISOString(), version: 2 }), longitude: null, latitude: null, capturedAt, retentionUntil: null, status: "active", uploadedBy: user.id });
      evidenceId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "purchasing", action: input.attachmentKind === "invoice" ? "upload_purchase_invoice" : "upload_purchase_document", targetType: "evidence", targetId: String(evidenceId || storedFile.key), summary: `归档采购${input.attachmentKind === "invoice" ? "发票" : "单据"}附件：${input.description.slice(0, 80)}（非水印影像）`, afterJson: JSON.stringify({ projectId: input.projectId, contentSha256, contentBytes: bytes.length, mimeType: input.mimeType }) });
    });
    return { success: true, id: evidenceId, fileName: input.fileName };
  }),

  /** 小额物资关联普通单据照片；手动金额优先，否则由数量乘单价计算，并按后台开关直接入账。 */
  createSmallDirectOrder: protectedProcedure.input(smallDirectPurchaseInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const calculatedAmount = input.quantity !== undefined && input.unitPrice !== undefined ? roundMoney(input.quantity * input.unitPrice) : null;
    const isManualAmount = input.amount !== undefined;
    const amount = isManualAmount ? roundMoney(input.amount as number) : calculatedAmount;
    if (!amount || amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "请填写数量和单价，或提供有效金额" });
    const limit = await getSmallDirectPurchaseLimit(db);
    if (amount > limit) throw new TRPCError({ code: "BAD_REQUEST", message: `小额免申请采购金额不得超过 ¥${limit.toFixed(2)}，请先提交采购申请` });
    const [category] = await db.select({ id: purchaseCategories.id }).from(purchaseCategories).where(and(eq(purchaseCategories.id, input.categoryId), eq(purchaseCategories.status, "active"))).limit(1);
    if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的固定采购类别" });
    const [evidence] = await db.select({ id: evidenceRecords.id, sourceType: evidenceRecords.sourceType, ocrResultJson: evidenceRecords.ocrResultJson }).from(evidenceRecords).where(and(eq(evidenceRecords.id, input.evidenceId), eq(evidenceRecords.projectId, input.projectId))).limit(1);
    if (!evidence || evidence.sourceType !== "purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择当前项目已归档的采购影像" });
    if (input.hasInvoice && !input.invoiceEvidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "选择有发票时必须上传并关联发票照片或 PDF" });
    if (input.invoiceEvidenceId) {
      const [invoiceEvidence] = await db.select({ id: evidenceRecords.id, sourceType: evidenceRecords.sourceType }).from(evidenceRecords).where(and(eq(evidenceRecords.id, input.invoiceEvidenceId), eq(evidenceRecords.projectId, input.projectId))).limit(1);
      if (!invoiceEvidence || invoiceEvidence.sourceType !== "purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择当前项目已归档的发票附件" });
    }
    if (input.supplierId) {
      const [supplier] = await db.select({ id: suppliers.id, status: suppliers.status }).from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!supplier || supplier.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效供应商" });
    }
    const linkedAsset = await assertPurchaseAssetLink(db, input);
    const requiresSupervisorApproval = !(await isSupervisorReviewAutoApprove(db));
    const [created] = await db.insert(purchaseOrders).values({ orderNo: createBusinessNo("SPD"), requestId: null, projectId: input.projectId, procurementMode: "small_direct", categoryId: input.categoryId, itemDescription: input.itemDescription, quantity: input.quantity !== undefined ? String(input.quantity) : null, unitPrice: input.unitPrice !== undefined ? String(roundMoney(input.unitPrice)) : null, evidenceId: input.evidenceId, hasInvoice: input.hasInvoice, invoiceEvidenceId: input.hasInvoice ? input.invoiceEvidenceId ?? null : null, ocrSummary: getPurchaseOcrSummary(evidence.ocrResultJson), supplierId: input.supplierId ?? null, assetType: input.assetType ?? null, assetId: input.assetId ?? null, amount: String(amount), orderedAt: new Date(input.orderedAt), status: requiresSupervisorApproval ? "draft" : "confirmed", createdBy: user.id, confirmedBy: requiresSupervisorApproval ? null : user.id, confirmedAt: requiresSupervisorApproval ? null : new Date() }).$returningId();
    const orderId = Number(created?.id);
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: requiresSupervisorApproval ? "create_small_direct_order" : "auto_approve_small_direct_order_by_supervisor_setting", targetType: "purchase_order", targetId: String(orderId), summary: `创建清单采购订单：¥${amount.toFixed(2)}，金额来源 ${isManualAmount ? "手动录入" : "数量×单价自动计算"}，数量 ${input.quantity ?? "未记录"}，单价 ${input.unitPrice ?? "未记录"}，发票 ${input.hasInvoice ? `已附 #${input.invoiceEvidenceId}` : "无发票"}，资产 ${linkedAsset ? `${input.assetType === "vehicle" ? "车辆" : "机械"} ${linkedAsset.label}` : "未关联"}，审批 ${requiresSupervisorApproval ? "待主管确认" : "统一上级主管审核开关开启后自动通过"}，已关联单据照片 #${input.evidenceId}` });
    if (requiresSupervisorApproval) void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "purchasing", eventCode: "purchase_order_small_direct_submitted", targetType: "purchase_order", targetId: String(orderId), title: "清单采购订单待主管确认", content: `金额 ¥${amount.toFixed(2)}（${isManualAmount ? "手动录入" : "自动计算"}），已附采购单据照片，请审核。`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true, id: orderId, limit, requiresSupervisorApproval, amount, amountSource: isManualAmount ? "manual" : "auto" };
  }),

  /** 返回由服务端汇总的采购订单结算明细和余额，禁止移动端自行累计金额。 */
  listSettlements: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { records: [], totalsByOrder: {} as Record<string, { settledAmount: number; remainingAmount: number }> };
    const [orders, records] = await Promise.all([
      db.select({ id: purchaseOrders.id, amount: purchaseOrders.amount }).from(purchaseOrders).where(eq(purchaseOrders.projectId, input.projectId)),
      db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), eq(financialRecords.sourceType, "purchase_order_settlement"))).orderBy(desc(financialRecords.occurredAt)),
    ]);
    const settledByOrder = new Map<string, number>();
    for (const record of records) {
      if (record.settlementStatus === "void" || !record.sourceId) continue;
      settledByOrder.set(record.sourceId, roundMoney((settledByOrder.get(record.sourceId) ?? 0) + Number(record.amount)));
    }
    const totalsByOrder: Record<string, { settledAmount: number; remainingAmount: number }> = {};
    for (const order of orders) {
      const settledAmount = settledByOrder.get(String(order.id)) ?? 0;
      totalsByOrder[String(order.id)] = { settledAmount, remainingAmount: roundMoney(Math.max(0, Number(order.amount) - settledAmount)) };
    }
    return { records, totalsByOrder };
  }),

  /** 只有已批准采购申请可生成采购订单，订单金额不能超过申请金额。 */
  createOrder: protectedProcedure.input(purchaseOrderInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertPurchaseAccess(ctx);
    if (!canApprovePurchase(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无创建采购订单权限" });
    const { db, request } = await getScopedPurchaseRequest(ctx, input.requestId, input.projectId);
    if (request.status !== "approved") throw new TRPCError({ code: "CONFLICT", message: "仅已批准采购申请可生成采购订单" });
    if (input.amount > Number(request.amount)) throw new TRPCError({ code: "BAD_REQUEST", message: "采购订单金额不得高于申请批准金额" });
    if (input.supplierId) {
      const [supplier] = await db.select({ id: suppliers.id, status: suppliers.status }).from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!supplier || supplier.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效供应商" });
    }
    const linkedAsset = await assertPurchaseAssetLink(db, input);
    await db.insert(purchaseOrders).values({ orderNo: input.orderNo ?? createBusinessNo("PO"), requestId: input.requestId, projectId: input.projectId, supplierId: input.supplierId ?? null, assetType: input.assetType ?? null, assetId: input.assetId ?? null, amount: String(roundMoney(input.amount)), orderedAt: new Date(input.orderedAt), status: "draft", createdBy: user.id });
    await db.update(purchaseRequests).set({ status: "ordered" }).where(eq(purchaseRequests.id, input.requestId));
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "create_order", targetType: "purchase_order", targetId: String(input.requestId), summary: `已从采购申请创建采购订单${linkedAsset ? `，关联${input.assetType === "vehicle" ? "车辆" : "机械"} ${linkedAsset.label}` : ""}` });
    return { success: true };
  }),

  /** 采购订单状态受独立状态机约束，收货状态同步回采购申请。 */
  transitionOrder: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), targetStatus: z.enum(["confirmed", "received", "closed", "void"]) })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertPurchaseAccess(ctx);
    const { db, order } = await getScopedPurchaseOrder(ctx, input.id, input.projectId);
    try {
      assertPurchaseOrderStatusTransition(order.status, input.targetStatus);
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    if (input.targetStatus === "confirmed" && !canApprovePurchase(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无采购订单确认权限" });
    if (input.targetStatus === "received" && !canManageInventory(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无采购订单收货权限" });
    const patch: Partial<typeof purchaseOrders.$inferInsert> = { status: input.targetStatus };
    if (input.targetStatus === "confirmed") { patch.confirmedBy = user.id; patch.confirmedAt = new Date(); }
    const updateResult = await db.update(purchaseOrders)
      .set(patch)
      .where(and(eq(purchaseOrders.id, input.id), eq(purchaseOrders.status, order.status)));
    assertConditionalBusinessWrite(updateResult, "采购订单已被其他用户更新，请刷新后重试");
    if (input.targetStatus === "received" && order.requestId !== null) await db.update(purchaseRequests).set({ status: "received" }).where(eq(purchaseRequests.id, order.requestId));
    const purchaseOrderStatusLabel = getBusinessStatusLabel(input.targetStatus);
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "transition_order", targetType: "purchase_order", targetId: String(input.id), summary: `采购订单状态变更为：${purchaseOrderStatusLabel}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "purchasing", eventCode: `purchase_order_${input.targetStatus}`, targetType: "purchase_order", targetId: String(input.id), title: `采购订单${purchaseOrderStatusLabel}`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true };
  }),

  /** 对已收货订单分次登记实际付款，并自动归集到项目费用流水，防止超额付款或跨项目串账。 */
  recordSettlement: protectedProcedure.input(purchaseSettlementInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canRecordPurchaseSettlement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无采购结算登记权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await assertFinancialDayWritable(db, input.projectId, new Date(input.settledAt), "登记采购结算");
    const [order] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.orderId), eq(purchaseOrders.projectId, input.projectId))).limit(1);
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的采购订单" });
    if (!["received", "closed"].includes(order.status)) throw new TRPCError({ code: "CONFLICT", message: "采购订单须已收货后才能登记结算" });
    const sourceId = String(order.id);
    const settlements = await db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), eq(financialRecords.sourceType, "purchase_order_settlement"), eq(financialRecords.sourceId, sourceId))).orderBy(desc(financialRecords.occurredAt));
    const settledAmount = roundMoney(settlements.filter(item => item.settlementStatus !== "void").reduce((sum, item) => sum + Number(item.amount), 0));
    const remainingAmount = roundMoney(Number(order.amount) - settledAmount);
    if (input.amount > remainingAmount + 0.000001) throw new TRPCError({ code: "BAD_REQUEST", message: "本次结算超过采购订单待结算余额" });
    const nextRemainingAmount = roundMoney(remainingAmount - input.amount);
    await db.insert(financialRecords).values({ recordNo: createBusinessNo("PSET"), projectId: input.projectId, direction: "expense", category: "采购结算", amount: String(roundMoney(input.amount)), occurredAt: new Date(input.settledAt), settlementStatus: nextRemainingAmount === 0 ? "paid" : "partial", sourceType: "purchase_order_settlement", sourceId, remarks: input.remarks ?? null });
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "record_settlement", targetType: "purchase_order", targetId: sourceId, summary: `登记采购订单结算：${roundMoney(input.amount)}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "purchasing", eventCode: "purchase_order_settlement", targetType: "purchase_order", targetId: sourceId, title: "采购订单已登记结算", deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true, settledAmount: roundMoney(settledAmount + input.amount), remainingAmount: nextRemainingAmount };
  }),

  listInventory: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(inventoryTransactions).where(eq(inventoryTransactions.projectId, input.projectId)).orderBy(desc(inventoryTransactions.occurredAt));
    const summary = new Map<string, { itemName: string; unit: string; balanceQuantity: number; totalAmount: number }>();
    for (const row of rows) {
      const key = `${row.itemName}::${row.unit}`;
      const current = summary.get(key) ?? { itemName: row.itemName, unit: row.unit, balanceQuantity: 0, totalAmount: 0 };
      const direction = row.transactionType === "outbound" ? -1 : 1;
      current.balanceQuantity += direction * Number(row.quantity);
      current.totalAmount += direction * Number(row.amount);
      summary.set(key, current);
    }
    return { transactions: rows, balances: Array.from(summary.values()).map(item => ({ ...item, balanceQuantity: Math.round(item.balanceQuantity * 1000) / 1000, totalAmount: roundMoney(item.totalAmount) })) };
  }),

  /** 入库、领用、退库都以不可变流水记录；库存余额永远从服务端流水汇总得出。 */
  saveInventoryTransaction: protectedProcedure.input(inventoryInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertPurchaseAccess(ctx);
    if (!canManageInventory(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无库存收发操作权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    if (input.requestId) await getScopedPurchaseRequest(ctx, input.requestId, input.projectId);
    if (input.purchaseOrderId) await getScopedPurchaseOrder(ctx, input.purchaseOrderId, input.projectId);
    const amount = roundMoney(input.quantity * input.unitCost);
    await db.transaction(async tx => {
      await tx.insert(inventoryTransactions).values({ projectId: input.projectId, requestId: input.requestId ?? null, purchaseOrderId: input.purchaseOrderId ?? null, transactionNo: createBusinessNo("INV"), transactionType: input.transactionType, itemName: input.itemName, unit: input.unit, quantity: String(input.quantity), unitCost: String(roundMoney(input.unitCost)), amount: String(amount), occurredAt: new Date(input.occurredAt), operatorId: user.id, remarks: input.remarks ?? null });
      if (input.transactionType === "inbound" && input.requestId) await tx.update(purchaseRequests).set({ status: "stocked", stockedBy: user.id, stockedAt: new Date() }).where(eq(purchaseRequests.id, input.requestId));
      await tx.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: `inventory_${input.transactionType}`, targetType: "inventory_transaction", targetId: input.itemName, summary: `登记库存${input.transactionType === "inbound" ? "入库" : input.transactionType === "outbound" ? "领用" : "退库"}：${input.itemName}` });
    });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "purchasing", eventCode: `inventory_${input.transactionType}`, targetType: "inventory_transaction", targetId: input.purchaseOrderId ? String(input.purchaseOrderId) : `${input.transactionType}:${input.itemName}`, title: `库存${input.transactionType === "inbound" ? "入库" : input.transactionType === "outbound" ? "领用出库" : "退库"}已登记`, content: "一笔采购仓储收发记录已登记，请进入系统查看受控台账。", deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true, amount };
  }),
});

/** 工程计量主张、会计审核、收入确认和回款登记。 */
export const measurementRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertMeasurementAccess(ctx);
    return listScopedProjects(ctx);
  }),

  /** 仅投影当前用户可办理的收方动作，不向浏览器泄露角色原始授权明细。 */
  takeoffCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const roleCodes = await assertMeasurementAccess(ctx);
    return { canSubmit: canSubmitTakeoff(roleCodes), canReview: canReviewTakeoff(roleCodes) };
  }),

  /** 仅向浏览器投影可办理的计量申报动作，页面不再以“是否超级管理员”替代岗位权限。 */
  claimCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const roleCodes = await assertMeasurementAccess(ctx);
    return {
      canDraft: true,
      canSubmit: true,
      canReview: canReviewMeasurement(roleCodes),
      canSettle: canSettleMeasurement(roleCodes),
      canRecordPayment: canRecordMeasurementPayment(roleCodes),
    };
  }),

  listClaims: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(measurementClaims).where(eq(measurementClaims.projectId, input.projectId)).orderBy(desc(measurementClaims.updatedAt));
  }),

  /** 收方记录独立于计量申报维护，项目部可先保存草稿并补齐影像/签认单后再提交复核。 */
  listTakeoffs: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.projectId, input.projectId)).orderBy(desc(measurementTakeoffRecords.updatedAt));
  }),

  saveTakeoff: protectedProcedure.input(measurementTakeoffInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMeasurementAccess(ctx);
    if (!canSubmitTakeoff(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "项目经理或施工管理员方可维护收方草稿" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    if (input.measurementClaimId) {
      const [claim] = await db.select({ id: measurementClaims.id, projectId: measurementClaims.projectId, status: measurementClaims.status }).from(measurementClaims).where(eq(measurementClaims.id, input.measurementClaimId)).limit(1);
      if (!claim || claim.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的关联计量申报" });
      if (claim.status === "void") throw new TRPCError({ code: "CONFLICT", message: "已作废计量申报不可关联收方记录" });
    }
    const declaredAmount = roundMoney(input.quantity * input.unitPrice);
    const values = {
      projectId: input.projectId,
      measurementClaimId: input.measurementClaimId ?? null,
      workItem: input.workItem,
      workLocation: input.workLocation,
      unit: input.unit,
      quantity: String(input.quantity),
      unitPrice: String(roundMoney(input.unitPrice)),
      declaredAmount: String(declaredAmount),
      takeoffDate: toBusinessDate(input.takeoffDate),
    };
    let takeoffId = input.id;
    if (input.id) {
      const [existing] = await db.select().from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目收方记录" });
      if (!["draft", "rejected"].includes(existing.status)) throw new TRPCError({ code: "CONFLICT", message: "仅草稿或被退回收方记录可修改" });
      const updateResult = await db.update(measurementTakeoffRecords).set({ ...values, status: "draft", reviewNote: null }).where(and(eq(measurementTakeoffRecords.id, input.id), eq(measurementTakeoffRecords.status, existing.status)));
      assertConditionalBusinessWrite(updateResult, "收方记录已被其他用户更新，请刷新后重试");
    } else {
      const takeoffNo = createBusinessNo("TO");
      await db.insert(measurementTakeoffRecords).values({ ...values, takeoffNo, status: "draft", submittedBy: user.id });
      const [created] = await db.select({ id: measurementTakeoffRecords.id }).from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.takeoffNo, takeoffNo)).limit(1);
      takeoffId = created?.id;
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: input.id ? "update_takeoff" : "create_takeoff", targetType: "measurement_takeoff", targetId: String(takeoffId ?? input.id ?? "draft"), summary: `${input.id ? "维护" : "新建"}项目计量收方：${input.workItem}` });
    return { success: true, takeoffId, declaredAmount };
  }),

  transitionTakeoff: protectedProcedure.input(measurementTakeoffTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目收方记录" });
    const allowedTargets: Record<string, string[]> = { draft: ["submitted", "void"], submitted: ["reviewing", "rejected"], reviewing: ["approved", "rejected"], approved: ["locked"], rejected: ["submitted", "void"] };
    if (!allowedTargets[record.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前收方状态不允许该操作" });
    if (["submitted", "void"].includes(input.targetStatus) && !canSubmitTakeoff(roleCodes) && !canReviewTakeoff(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无收方提交或撤回权限" });
    if (["reviewing", "approved", "rejected", "locked"].includes(input.targetStatus) && !canReviewTakeoff(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无收方复核、审核或锁定权限" });
    const patch: Partial<typeof measurementTakeoffRecords.$inferInsert> = { status: input.targetStatus, reviewNote: input.reviewNote ?? null };
    if (["reviewing", "approved", "rejected"].includes(input.targetStatus)) { patch.reviewedBy = user.id; patch.reviewedAt = new Date(); }
    if (input.targetStatus === "locked") patch.lockedAt = new Date();
    const updateResult = await db.update(measurementTakeoffRecords).set(patch).where(and(eq(measurementTakeoffRecords.id, input.id), eq(measurementTakeoffRecords.status, record.status)));
    assertConditionalBusinessWrite(updateResult, "收方记录已被其他用户更新，请刷新后重试");
    const takeoffStatusLabel = getBusinessStatusLabel(input.targetStatus);
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "transition_takeoff", targetType: "measurement_takeoff", targetId: String(input.id), summary: `项目收方状态变更为：${takeoffStatusLabel}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: `takeoff_${input.targetStatus}`, targetType: "measurement_takeoff", targetId: String(input.id), title: `项目收方${takeoffStatusLabel}`, deepLink: "/mobile/measurement" }).catch(() => undefined);
    return { success: true };
  }),

  linkTakeoffEvidence: protectedProcedure.input(measurementTakeoffEvidenceInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMeasurementAccess(ctx);
    if (!canSubmitTakeoff(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "项目经理或施工管理员方可关联收方证据" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select({ id: measurementTakeoffRecords.id, status: measurementTakeoffRecords.status, projectId: measurementTakeoffRecords.projectId }).from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.id, input.takeoffId)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目收方记录" });
    if (["locked", "void"].includes(record.status)) throw new TRPCError({ code: "CONFLICT", message: "已锁定或已作废收方记录不可补充证据" });
    await db.insert(measurementTakeoffEvidences).values({ takeoffId: input.takeoffId, evidenceId: input.evidenceId, linkedBy: user.id }).onDuplicateKeyUpdate({ set: { linkedBy: user.id } });
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "link_takeoff_evidence", targetType: "measurement_takeoff", targetId: String(input.takeoffId), summary: "关联项目收方影像/签认凭证" });
    return { success: true };
  }),

  /** 保存工程计量草稿，已提交或已审核主张不得通过草稿接口改变申报金额。 */
  saveClaim: protectedProcedure.input(measurementInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = { projectId: input.projectId, period: input.period, declaredAmount: String(roundMoney(input.declaredAmount)) };
    if (input.id) {
      const [claim] = await db.select().from(measurementClaims).where(eq(measurementClaims.id, input.id)).limit(1);
      if (!claim || claim.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定工程计量申报" });
      if (claim.status !== "draft" && claim.status !== "rejected") throw new TRPCError({ code: "CONFLICT", message: "仅草稿或被退回计量申报可修改" });
      const updateResult = await db.update(measurementClaims)
        .set({ ...values, status: "draft", reviewNote: null })
        .where(and(eq(measurementClaims.id, input.id), eq(measurementClaims.status, claim.status)));
      assertConditionalBusinessWrite(updateResult, "工程计量申报已被其他用户更新，请刷新后重试");
    } else {
      await db.insert(measurementClaims).values({ ...values, claimNo: input.claimNo ?? createBusinessNo("MC"), submittedBy: user.id, status: "draft" });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: input.id ? "update_claim" : "create_claim", targetType: "measurement_claim", targetId: String(input.id ?? input.claimNo ?? "draft"), summary: `${input.id ? "维护" : "新建"}工程计量申报` });
    return { success: true };
  }),

  /** 计量状态流转含项目复核、会计审核、受控作废和收入确认，金额以审核接口传入的核定值为准。 */
  transitionClaim: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), targetStatus: z.enum(["submitted", "reviewing", "approved", "settled", "rejected", "void"]), approvedAmount: moneySchema.nullable().optional(), reviewNote: z.string().trim().max(500).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [claim] = await db.select().from(measurementClaims).where(eq(measurementClaims.id, input.id)).limit(1);
    if (!claim || claim.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定工程计量申报" });
    try {
      assertApprovalTransition(claim.status, input.targetStatus);
    } catch (error) {
      throwDomainAsBadRequest(error);
    }
    if (["reviewing", "approved", "rejected", "void"].includes(input.targetStatus) && !canReviewMeasurement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无工程计量复核或作废权限" });
    if (input.targetStatus === "settled" && !canSettleMeasurement(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无工程计量结算确认权限" });
    if (input.targetStatus === "approved" && (input.approvedAmount === null || input.approvedAmount === undefined)) throw new TRPCError({ code: "BAD_REQUEST", message: "核定通过时必须填写核定金额" });
    const now = new Date();
    const patch: Partial<typeof measurementClaims.$inferInsert> = { status: input.targetStatus, reviewNote: input.reviewNote ?? null };
    if (["reviewing", "approved", "rejected"].includes(input.targetStatus)) { patch.reviewedBy = user.id; patch.reviewedAt = now; }
    if (input.targetStatus === "approved") { patch.approvedAmount = String(roundMoney(input.approvedAmount!)); patch.accountantId = user.id; }
    if (input.targetStatus === "settled") patch.settledAt = now;
    const updateResult = await db.update(measurementClaims)
      .set(patch)
      .where(and(eq(measurementClaims.id, input.id), eq(measurementClaims.status, claim.status)));
    assertConditionalBusinessWrite(updateResult, "工程计量申报已被其他用户更新，请刷新后重试");
    if (input.targetStatus === "settled") {
      const sourceId = String(input.id);
      const existing = await db.select({ id: financialRecords.id }).from(financialRecords).where(and(eq(financialRecords.sourceType, "measurement_claim"), eq(financialRecords.sourceId, sourceId))).limit(1);
      if (existing.length === 0) {
        const incomeAmount = Number(claim.approvedAmount ?? claim.declaredAmount);
        await db.insert(financialRecords).values({ recordNo: createBusinessNo("FIN"), projectId: input.projectId, direction: "income", category: "工程计量收入", amount: String(roundMoney(incomeAmount)), occurredAt: now, settlementStatus: "unpaid", sourceType: "measurement_claim", sourceId, remarks: `由工程计量申报 ${claim.claimNo} 自动确认收入` });
      }
    }
    const measurementStatusLabel = getBusinessStatusLabel(input.targetStatus);
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "transition_claim", targetType: "measurement_claim", targetId: String(input.id), summary: `工程计量状态变更为：${measurementStatusLabel}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: `measurement_${input.targetStatus}`, targetType: "measurement_claim", targetId: String(input.id), title: `工程计量${measurementStatusLabel}`, deepLink: "/mobile/measurement" }).catch(() => undefined);
    return { success: true };
  }),

  /** 按项目与期间读取工程回款；移动端仅展示服务端汇总结果，不在客户端重算。 */
  listPayments: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema.optional() })).query(async ({ ctx, input }) => {
    await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { records: [], totalAmount: 0 };
    const conditions = [eq(financialRecords.projectId, input.projectId), eq(financialRecords.sourceType, "measurement_payment")];
    if (input.period) {
      const range = getMonthRange(input.period);
      conditions.push(gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive));
    }
    const records = await db.select().from(financialRecords).where(and(...conditions)).orderBy(desc(financialRecords.occurredAt));
    return { records, totalAmount: roundMoney(records.filter(item => item.settlementStatus !== "void").reduce((sum, item) => sum + Number(item.amount), 0)) };
  }),

  /** 登记工程回款，并同步收入确认流水的结算状态，防止对已确认金额超额回款。 */
  recordPayment: protectedProcedure.input(measurementPaymentInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canRecordMeasurementPayment(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无工程回款登记权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [claim] = await db.select().from(measurementClaims).where(eq(measurementClaims.id, input.claimId)).limit(1);
    if (!claim || claim.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到指定工程计量申报" });
    if (claim.status !== "settled") throw new TRPCError({ code: "CONFLICT", message: "仅已确认收入的工程计量可以登记回款" });
    const sourceId = String(input.claimId);
    const payments = await db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), eq(financialRecords.sourceType, "measurement_payment"), eq(financialRecords.sourceId, sourceId))).orderBy(desc(financialRecords.occurredAt));
    const receivedAmount = roundMoney(payments.filter(item => item.settlementStatus !== "void").reduce((sum, item) => sum + Number(item.amount), 0));
    const confirmedAmount = roundMoney(Number(claim.approvedAmount ?? claim.declaredAmount));
    const availableAmount = roundMoney(confirmedAmount - receivedAmount);
    if (input.amount > availableAmount + 0.000001) throw new TRPCError({ code: "BAD_REQUEST", message: "本次回款超过可回款余额" });
    const remainingAmount = roundMoney(availableAmount - input.amount);
    await db.insert(financialRecords).values({ recordNo: createBusinessNo("PAY"), projectId: input.projectId, direction: "income", category: "工程计量回款", amount: String(roundMoney(input.amount)), occurredAt: new Date(input.receivedAt), settlementStatus: remainingAmount === 0 ? "paid" : "partial", sourceType: "measurement_payment", sourceId, remarks: input.remarks ?? null });
    const [incomeRecord] = await db.select({ id: financialRecords.id }).from(financialRecords).where(and(eq(financialRecords.sourceType, "measurement_claim"), eq(financialRecords.sourceId, sourceId))).limit(1);
    if (incomeRecord) await db.update(financialRecords).set({ settlementStatus: remainingAmount === 0 ? "paid" : "partial" }).where(eq(financialRecords.id, incomeRecord.id));
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "record_payment", targetType: "measurement_claim", targetId: sourceId, summary: `登记工程计量回款：${roundMoney(input.amount)}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: "measurement_payment", targetType: "measurement_claim", targetId: sourceId, title: "工程计量已登记回款", deepLink: "/mobile/measurement" }).catch(() => undefined);
    return { success: true, receivedAmount: roundMoney(receivedAmount + input.amount), remainingAmount };
  }),

  /** 按项目与期间汇总申报、核定和已结算金额，打印视图不依赖客户端自行重算。 */
  summary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema })).query(async ({ ctx, input }) => {
    await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { declaredAmount: 0, approvedAmount: 0, settledAmount: 0, pendingCount: 0, claims: [] };
    const claims = await db.select().from(measurementClaims).where(and(eq(measurementClaims.projectId, input.projectId), eq(measurementClaims.period, input.period))).orderBy(desc(measurementClaims.updatedAt));
    return {
      declaredAmount: roundMoney(claims.reduce((sum, item) => sum + Number(item.declaredAmount), 0)),
      approvedAmount: roundMoney(claims.reduce((sum, item) => sum + Number(item.approvedAmount ?? 0), 0)),
      settledAmount: roundMoney(claims.filter(item => item.status === "settled").reduce((sum, item) => sum + Number(item.approvedAmount ?? item.declaredAmount), 0)),
      pendingCount: claims.filter(item => ["submitted", "reviewing"].includes(item.status)).length,
      claims,
    };
  }),
});

/** 项目日常开支、收入确认、现金流与利润统计。 */
export const financeRouter = router({
  projectOptions: protectedProcedure.query(async ({ ctx }) => {
    await assertFinanceAccess(ctx);
    return listScopedProjects(ctx);
  }),

  /** 浏览器仅获得是否可维护发票的最小投影；认证、作废和红冲仍由各状态接口强制校验。 */
  invoiceCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const roleCodes = await assertFinanceAccess(ctx);
    return {
      canMaintain: canMaintainFinancialLedger(roleCodes),
      canExecutePayment: canExecutePayment(roleCodes),
      canReverse: canReverseFinancialRecord(roleCodes),
      readOnly: !canCreateFinancialRecord(roleCodes),
    };
  }),

  /** 财税辅助工作区只展示已授权项目的资料清单与交接历史，不声称本系统完成法定申报。 */
  taxWorkspace: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { projectProfile: null, entityOptions: [], entries: [], handoffBatches: [], disclaimer: "数据库暂不可用，无法读取财税辅助资料。" };
    const [projectProfile] = await db.select().from(projectTaxProfiles).where(eq(projectTaxProfiles.projectId, input.projectId)).limit(1);
    const [entityOptions, entries, batches, workers, payrollTaxEntries, contracts, contractTaxEntries, crossRegionLedger] = await Promise.all([
      db.select().from(taxEntityProfiles).where(inArray(taxEntityProfiles.status, ["active", "suspended"])).orderBy(taxEntityProfiles.entityName),
      db.select().from(taxAuxiliaryEntries).where(and(eq(taxAuxiliaryEntries.projectId, input.projectId), eq(taxAuxiliaryEntries.period, input.period))).orderBy(desc(taxAuxiliaryEntries.updatedAt), desc(taxAuxiliaryEntries.id)),
      db.select({ id: taxHandoffBatches.id, batchNo: taxHandoffBatches.batchNo, period: taxHandoffBatches.period, handoffType: taxHandoffBatches.handoffType, format: taxHandoffBatches.format, recordCount: taxHandoffBatches.recordCount, snapshotHash: taxHandoffBatches.snapshotHash, receiptReference: taxHandoffBatches.receiptReference, receiptEvidenceId: taxHandoffBatches.receiptEvidenceId, status: taxHandoffBatches.status, generatedAt: taxHandoffBatches.generatedAt, receiptRecordedAt: taxHandoffBatches.receiptRecordedAt, notes: taxHandoffBatches.notes }).from(taxHandoffBatches).where(and(eq(taxHandoffBatches.projectId, input.projectId), eq(taxHandoffBatches.period, input.period))).orderBy(desc(taxHandoffBatches.generatedAt)),
      db.select({ id: laborWorkers.id, realName: laborWorkers.realName, workerCategory: laborWorkers.workerCategory, teamName: laborWorkers.teamName, attendanceStatus: laborWorkers.attendanceStatus }).from(laborWorkers).where(eq(laborWorkers.projectId, input.projectId)).orderBy(laborWorkers.realName),
      db.select().from(payrollTaxWithholdingEntries).where(and(eq(payrollTaxWithholdingEntries.projectId, input.projectId), eq(payrollTaxWithholdingEntries.period, input.period))).orderBy(payrollTaxWithholdingEntries.workerId, payrollTaxWithholdingEntries.incomeType),
      db.select().from(outsourceContracts).where(eq(outsourceContracts.projectId, input.projectId)).orderBy(outsourceContracts.contractNo),
      db.select().from(contractTaxRegistrations).where(eq(contractTaxRegistrations.projectId, input.projectId)).orderBy(desc(contractTaxRegistrations.updatedAt)),
      db.select().from(crossRegionConstructionTaxLedgers).where(and(eq(crossRegionConstructionTaxLedgers.projectId, input.projectId), eq(crossRegionConstructionTaxLedgers.period, input.period))).limit(1).then(rows => rows[0] ?? null),
    ]);
    return {
      projectProfile: projectProfile ?? null,
      entityOptions,
      entries,
      handoffBatches: batches,
      workers,
      payrollTaxEntries,
      contracts,
      contractTaxEntries,
      crossRegionLedger,
      disclaimer: "本区仅归集真实项目业务资料、人工确认的辅助事项及外部系统回执引用；不自动计算税额、不生成纳税申报结果，也不替代持证会计师或税务师。",
    };
  }),

  /** 纳税主体属于公司级高敏感基础资料，仅会计/财务负责人维护，列表仍受财务模块门禁。 */
  saveTaxEntityProfile: protectedProcedure.input(taxEntityProfileInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "纳税主体资料仅限会计或财务负责人维护" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = { entityName: input.entityName, taxpayerIdentifier: input.taxpayerIdentifier.toUpperCase(), taxMethod: input.taxMethod, registeredLocation: input.registeredLocation ?? null, status: input.status, remarks: input.remarks ?? null };
    if (input.id) {
      const [existing] = await db.select({ id: taxEntityProfiles.id }).from(taxEntityProfiles).where(eq(taxEntityProfiles.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "未找到纳税主体资料" });
      await db.update(taxEntityProfiles).set(values).where(eq(taxEntityProfiles.id, input.id));
    } else {
      await db.insert(taxEntityProfiles).values({ ...values, createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_tax_entity_profile" : "create_tax_entity_profile", targetType: "tax_entity_profile", targetId: String(input.id ?? values.taxpayerIdentifier), summary: `${input.id ? "维护" : "新建"}纳税主体辅助资料：${input.entityName}` });
    return { success: true };
  }),

  /** 项目税务档案绑定唯一纳税主体；合同不含税金额和税率仅记录持证人员/合同资料确认值，不自动生成税额。 */
  saveProjectTaxProfile: protectedProcedure.input(projectTaxProfileInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "项目税务辅助档案仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [entity] = await db.select({ id: taxEntityProfiles.id, status: taxEntityProfiles.status }).from(taxEntityProfiles).where(eq(taxEntityProfiles.id, input.taxEntityId)).limit(1);
    if (!entity || entity.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择已启用的纳税主体" });
    const values = { taxEntityId: input.taxEntityId, projectLocation: input.projectLocation, taxMethod: input.taxMethod, contractExTaxAmount: String(roundMoney(input.contractExTaxAmount)), contractTaxRate: String(input.contractTaxRate), crossRegionConstruction: input.crossRegionConstruction, subcontractDeductionMethod: input.subcontractDeductionMethod, remarks: input.remarks ?? null, status: input.status };
    await db.insert(projectTaxProfiles).values({ projectId: input.projectId, ...values, createdBy: user.id }).onDuplicateKeyUpdate({ set: values });
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "save_project_tax_profile", targetType: "project_tax_profile", targetId: String(input.projectId), summary: `维护项目财税辅助档案：${input.projectLocation}` });
    return { success: true };
  }),

  /** 保存人工确认的财税辅助资料事项；待交接、已交接和已登记回执的状态由独立状态机维护。 */
  saveTaxAuxiliaryEntry: protectedProcedure.input(taxAuxiliaryEntryInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财税辅助事项仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [profile] = await db.select({ taxEntityId: projectTaxProfiles.taxEntityId, status: projectTaxProfiles.status }).from(projectTaxProfiles).where(eq(projectTaxProfiles.projectId, input.projectId)).limit(1);
    if (!profile || profile.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "请先维护有效项目税务辅助档案" });
    const values = { projectId: input.projectId, taxEntityId: profile.taxEntityId, period: input.period, entryType: input.entryType, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, subject: input.subject, amount: String(roundMoney(input.amount)), taxBaseAmount: input.taxBaseAmount === null || input.taxBaseAmount === undefined ? null : String(roundMoney(input.taxBaseAmount)), referenceTaxRate: input.referenceTaxRate === null || input.referenceTaxRate === undefined ? null : String(input.referenceTaxRate), reportedTaxAmount: input.reportedTaxAmount === null || input.reportedTaxAmount === undefined ? null : String(roundMoney(input.reportedTaxAmount)), documentReference: input.documentReference ?? null, evidenceId: input.evidenceId ?? null, notes: input.notes ?? null };
    if (input.id) {
      const [existing] = await db.select().from(taxAuxiliaryEntries).where(eq(taxAuxiliaryEntries.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目财税辅助事项" });
      if (existing.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "已交接、已登记回执或已作废的辅助事项不可直接修改" });
      await db.update(taxAuxiliaryEntries).set(values).where(and(eq(taxAuxiliaryEntries.id, input.id), eq(taxAuxiliaryEntries.status, "pending")));
    } else {
      await db.insert(taxAuxiliaryEntries).values({ ...values, status: "pending", createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_tax_auxiliary_entry" : "create_tax_auxiliary_entry", targetType: "tax_auxiliary_entry", targetId: String(input.id ?? input.subject), summary: `${input.id ? "维护" : "新增"}财税辅助事项：${input.subject}` });
    return { success: true };
  }),

  /** 财税辅助事项交接状态不可回退；回执仅记录真实外部引用或受控证据，不伪造申报结果。 */
  transitionTaxAuxiliaryEntry: protectedProcedure.input(taxAuxiliaryEntryTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财税辅助事项状态仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [entry] = await db.select().from(taxAuxiliaryEntries).where(eq(taxAuxiliaryEntries.id, input.id)).limit(1);
    if (!entry || entry.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目财税辅助事项" });
    const allowedTargets: Record<string, string[]> = { pending: ["handed_off", "void"], handed_off: ["receipt_recorded", "void"], receipt_recorded: [], void: [] };
    if (!allowedTargets[entry.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前辅助事项状态不允许该操作" });
    if (input.targetStatus === "receipt_recorded" && !input.documentReference && !input.evidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "登记外部回执时至少填写回执引用或关联受控证据" });
    const result = await db.update(taxAuxiliaryEntries).set({ status: input.targetStatus, documentReference: input.documentReference ?? entry.documentReference, evidenceId: input.evidenceId ?? entry.evidenceId, notes: input.notes ?? entry.notes }).where(and(eq(taxAuxiliaryEntries.id, input.id), eq(taxAuxiliaryEntries.status, entry.status)));
    assertConditionalBusinessWrite(result, "财税辅助事项已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `transition_tax_auxiliary_${input.targetStatus}`, targetType: "tax_auxiliary_entry", targetId: String(input.id), summary: `财税辅助事项状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    return { success: true };
  }),

  /** 生成正式财务软件/电子税务局资料交接CSV，并将完整字段快照和SHA-256写入批次审计链。 */
  createTaxHandoffBatch: protectedProcedure.input(taxHandoffInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财税资料交接仅限会计或财务负责人生成" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const manifest = await buildTaxHandoffManifest(db, input);
    const snapshotJson = JSON.stringify(manifest);
    const snapshotHash = createHash("sha256").update(snapshotJson).digest("hex");
    const batchNo = createBusinessNo("TAX");
    const generatedAt = new Date();
    const [created] = await db.insert(taxHandoffBatches).values({ batchNo, projectId: input.projectId, taxEntityId: manifest.taxEntity.id, period: input.period, handoffType: input.handoffType, format: "csv", recordCount: manifest.rows.length, snapshotHash, snapshotJson, status: "generated", generatedBy: user.id, generatedAt, notes: input.notes ?? null }).$returningId();
    const batchId = Number(created?.id);
    if (!Number.isInteger(batchId) || batchId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "财税交接批次创建失败，请稍后重试" });
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "create_tax_handoff_batch", targetType: "tax_handoff_batch", targetId: batchNo, summary: `生成${input.period}财税资料交接批次：${input.handoffType}，共 ${manifest.rows.length} 行` });
    return { success: true, batchId, batchNo, snapshotHash, recordCount: manifest.rows.length, csv: toTaxHandoffCsv(manifest) };
  }),

  /** 下载时只返回已保存批次的生成时快照，禁止用当前数据覆盖历史交接内容。 */
  downloadTaxHandoffBatch: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [batch] = await db.select().from(taxHandoffBatches).where(eq(taxHandoffBatches.id, input.id)).limit(1);
    if (!batch || batch.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目财税交接批次" });
    const manifest = JSON.parse(batch.snapshotJson) as TaxHandoffManifest;
    return { batchNo: batch.batchNo, period: batch.period, handoffType: batch.handoffType, snapshotHash: batch.snapshotHash, csv: toTaxHandoffCsv(manifest) };
  }),

  /** 交接批次状态不可倒退，外部回执只能登记真实编号或受控证据引用。 */
  transitionTaxHandoffBatch: protectedProcedure.input(taxHandoffTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财税交接批次状态仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [batch] = await db.select().from(taxHandoffBatches).where(eq(taxHandoffBatches.id, input.id)).limit(1);
    if (!batch || batch.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目财税交接批次" });
    const allowedTargets: Record<string, string[]> = { generated: ["handed_off", "void"], handed_off: ["receipt_recorded", "void"], receipt_recorded: [], void: [] };
    if (!allowedTargets[batch.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前交接批次状态不允许该操作" });
    if (input.targetStatus === "receipt_recorded" && !input.receiptReference && !input.receiptEvidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "登记外部回执时至少填写回执引用或关联受控证据" });
    const result = await db.update(taxHandoffBatches).set({ status: input.targetStatus, receiptReference: input.receiptReference ?? batch.receiptReference, receiptEvidenceId: input.receiptEvidenceId ?? batch.receiptEvidenceId, receiptRecordedBy: input.targetStatus === "receipt_recorded" ? user.id : batch.receiptRecordedBy, receiptRecordedAt: input.targetStatus === "receipt_recorded" ? new Date() : batch.receiptRecordedAt, notes: input.notes ?? batch.notes }).where(and(eq(taxHandoffBatches.id, input.id), eq(taxHandoffBatches.status, batch.status)));
    assertConditionalBusinessWrite(result, "财税交接批次已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `transition_tax_handoff_${input.targetStatus}`, targetType: "tax_handoff_batch", targetId: batch.batchNo, summary: `财税交接批次状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    return { success: true };
  }),

  /** 依据真实工资单和临时日结生成居民工资薪金累计预扣辅助测算，扣除资料和外部实际扣缴额必须由会计确认。 */
  savePayrollTaxWithholdingEntry: protectedProcedure.input(payrollTaxWithholdingInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "薪税辅助测算仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const calculated = await buildPayrollTaxWithholdingSnapshot(db, input);
    const values = {
      workerId: input.workerId,
      projectId: input.projectId,
      taxEntityId: calculated.profile.taxEntityId,
      period: input.period,
      incomeType: input.incomeType,
      sourceGrossIncome: String(calculated.sourceGrossIncome),
      sourceDocumentCount: calculated.sourceDocumentCount,
      cumulativeGrossIncome: String(calculated.cumulativeGrossIncome),
      cumulativeExemptIncome: String(roundMoney(input.cumulativeExemptIncome)),
      employmentMonths: input.employmentMonths,
      cumulativeBasicDeduction: String(calculated.cumulativeBasicDeduction),
      cumulativeSocialInsuranceDeduction: String(roundMoney(input.cumulativeSocialInsuranceDeduction)),
      cumulativeSpecialAdditionalDeduction: String(roundMoney(input.cumulativeSpecialAdditionalDeduction)),
      cumulativeOtherDeduction: String(roundMoney(input.cumulativeOtherDeduction)),
      cumulativeTaxableIncome: String(calculated.cumulativeTaxableIncome),
      applicableRate: calculated.applicableRate === null ? null : String(calculated.applicableRate),
      quickDeduction: calculated.quickDeduction === null ? null : String(calculated.quickDeduction),
      calculatedCumulativeTax: calculated.calculatedCumulativeTax === null ? null : String(calculated.calculatedCumulativeTax),
      cumulativeTaxWithheldBefore: String(roundMoney(input.cumulativeTaxWithheldBefore)),
      calculatedCurrentWithholding: calculated.calculatedCurrentWithholding === null ? null : String(calculated.calculatedCurrentWithholding),
      externallyWithheldThisPeriod: input.externallyWithheldThisPeriod === null || input.externallyWithheldThisPeriod === undefined ? null : String(roundMoney(input.externallyWithheldThisPeriod)),
      externalReference: input.externalReference ?? null,
      evidenceId: input.evidenceId ?? null,
      calculationSnapshotJson: JSON.stringify(calculated.snapshot),
      reviewNote: input.reviewNote ?? null,
    };
    if (input.id) {
      const [existing] = await db.select().from(payrollTaxWithholdingEntries).where(eq(payrollTaxWithholdingEntries.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目薪税辅助测算" });
      if (existing.status !== "draft") throw new TRPCError({ code: "CONFLICT", message: "已复核、已交接、已登记回执或已作废的测算不可直接修改" });
      await db.update(payrollTaxWithholdingEntries).set(values).where(and(eq(payrollTaxWithholdingEntries.id, input.id), eq(payrollTaxWithholdingEntries.status, "draft")));
    } else {
      await db.insert(payrollTaxWithholdingEntries).values({ ...values, status: "draft", createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_payroll_tax_withholding" : "create_payroll_tax_withholding", targetType: "payroll_tax_withholding", targetId: String(input.id ?? `${input.workerId}:${input.period}`), summary: `生成${input.period}工资薪金累计预扣辅助测算：${calculated.worker.realName}` });
    return { success: true, calculation: { sourceGrossIncome: calculated.sourceGrossIncome, cumulativeGrossIncome: calculated.cumulativeGrossIncome, calculatedCurrentWithholding: calculated.calculatedCurrentWithholding, isResidentWageCalculation: input.incomeType === "resident_wage_salary" } };
  }),

  /** 薪税测算状态不能回退；登记回执只接受真实外部扣缴或交接引用。 */
  transitionPayrollTaxWithholdingEntry: protectedProcedure.input(payrollTaxWithholdingTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "薪税辅助测算状态仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [entry] = await db.select().from(payrollTaxWithholdingEntries).where(eq(payrollTaxWithholdingEntries.id, input.id)).limit(1);
    if (!entry || entry.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目薪税辅助测算" });
    const allowedTargets: Record<string, string[]> = { draft: ["reviewed", "void"], reviewed: ["handed_off", "void"], handed_off: ["receipt_recorded", "void"], receipt_recorded: [], void: [] };
    if (!allowedTargets[entry.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前薪税辅助测算状态不允许该操作" });
    if (input.targetStatus === "receipt_recorded" && !input.externalReference && !input.evidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "登记外部扣缴/申报回执时至少填写外部引用或关联受控证据" });
    const result = await db.update(payrollTaxWithholdingEntries).set({ status: input.targetStatus, externalReference: input.externalReference ?? entry.externalReference, evidenceId: input.evidenceId ?? entry.evidenceId, reviewNote: input.reviewNote ?? entry.reviewNote, reviewedBy: input.targetStatus === "reviewed" ? user.id : entry.reviewedBy, reviewedAt: input.targetStatus === "reviewed" ? new Date() : entry.reviewedAt }).where(and(eq(payrollTaxWithholdingEntries.id, input.id), eq(payrollTaxWithholdingEntries.status, entry.status)));
    assertConditionalBusinessWrite(result, "薪税辅助测算已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `transition_payroll_tax_${input.targetStatus}`, targetType: "payroll_tax_withholding", targetId: String(input.id), summary: `薪税辅助测算状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    return { success: true };
  }),

  /** 合同印花税资料必须从真实外包合同快照创建，避免在税务台账二次录入或伪造合同金额。 */
  saveContractTaxRegistration: protectedProcedure.input(contractTaxRegistrationInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "合同税费资料仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [[profile], [contract]] = await Promise.all([
      db.select().from(projectTaxProfiles).where(eq(projectTaxProfiles.projectId, input.projectId)).limit(1),
      db.select().from(outsourceContracts).where(eq(outsourceContracts.id, input.contractId)).limit(1),
    ]);
    if (!profile || profile.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "请先维护有效项目税务辅助档案" });
    if (!contract || contract.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目外包合同" });
    const values = { contractId: input.contractId, projectId: input.projectId, taxEntityId: profile.taxEntityId, contractNoSnapshot: contract.contractNo, contractTypeSnapshot: contract.contractType, counterpartyNameSnapshot: contract.counterpartyName, contractDate: contract.startDate ?? null, contractAmountSnapshot: String(contract.contractAmount), contractEvidenceId: contract.attachmentEvidenceId ?? null, taxItem: input.taxItem ?? null, taxBaseAmount: input.taxBaseAmount === null || input.taxBaseAmount === undefined ? null : String(roundMoney(input.taxBaseAmount)), referenceTaxRate: input.referenceTaxRate === null || input.referenceTaxRate === undefined ? null : String(input.referenceTaxRate), professionallyConfirmedTaxAmount: input.professionallyConfirmedTaxAmount === null || input.professionallyConfirmedTaxAmount === undefined ? null : String(roundMoney(input.professionallyConfirmedTaxAmount)), paymentReference: input.paymentReference ?? null, paymentEvidenceId: input.paymentEvidenceId ?? null, reviewNote: input.reviewNote ?? null };
    if (input.id) {
      const [existing] = await db.select().from(contractTaxRegistrations).where(eq(contractTaxRegistrations.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目合同税费资料" });
      if (existing.status !== "pending_review") throw new TRPCError({ code: "CONFLICT", message: "已确认、已交接、已登记回执或已作废的合同税费资料不可直接修改" });
      await db.update(contractTaxRegistrations).set(values).where(and(eq(contractTaxRegistrations.id, input.id), eq(contractTaxRegistrations.status, "pending_review")));
    } else {
      await db.insert(contractTaxRegistrations).values({ ...values, status: "pending_review", createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_contract_tax_registration" : "create_contract_tax_registration", targetType: "contract_tax_registration", targetId: String(input.id ?? input.contractId), summary: `维护合同税费辅助资料：${contract.contractNo}` });
    return { success: true };
  }),

  transitionContractTaxRegistration: protectedProcedure.input(contractTaxRegistrationTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "合同税费资料状态仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [entry] = await db.select().from(contractTaxRegistrations).where(eq(contractTaxRegistrations.id, input.id)).limit(1);
    if (!entry || entry.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目合同税费资料" });
    const allowedTargets: Record<string, string[]> = { pending_review: ["confirmed", "not_applicable", "void"], confirmed: ["handed_off", "void"], handed_off: ["receipt_recorded", "void"], receipt_recorded: [], not_applicable: [], void: [] };
    if (!allowedTargets[entry.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前合同税费资料状态不允许该操作" });
    if (input.targetStatus === "confirmed" && !entry.taxItem && entry.professionallyConfirmedTaxAmount === null) throw new TRPCError({ code: "BAD_REQUEST", message: "确认合同税费资料前请至少记录税目或专业确认税额" });
    if (input.targetStatus === "receipt_recorded" && !input.paymentReference && !input.paymentEvidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "登记合同税费回执时至少填写支付/回执引用或关联受控证据" });
    const result = await db.update(contractTaxRegistrations).set({ status: input.targetStatus, paymentReference: input.paymentReference ?? entry.paymentReference, paymentEvidenceId: input.paymentEvidenceId ?? entry.paymentEvidenceId, reviewNote: input.reviewNote ?? entry.reviewNote, reviewedBy: ["confirmed", "not_applicable"].includes(input.targetStatus) ? user.id : entry.reviewedBy, reviewedAt: ["confirmed", "not_applicable"].includes(input.targetStatus) ? new Date() : entry.reviewedAt }).where(and(eq(contractTaxRegistrations.id, input.id), eq(contractTaxRegistrations.status, entry.status)));
    assertConditionalBusinessWrite(result, "合同税费资料已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `transition_contract_tax_${input.targetStatus}`, targetType: "contract_tax_registration", targetId: String(input.id), summary: `合同税费资料状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    return { success: true };
  }),

  /** 跨地区建筑服务预缴资料按项目和期间唯一；金额与凭证均由会计根据真实登记和完税资料登记。 */
  saveCrossRegionConstructionTaxLedger: protectedProcedure.input(crossRegionConstructionTaxInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "跨地区预缴资料仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [profile] = await db.select().from(projectTaxProfiles).where(eq(projectTaxProfiles.projectId, input.projectId)).limit(1);
    if (!profile || profile.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "请先维护有效项目税务辅助档案" });
    if (!profile.crossRegionConstruction) throw new TRPCError({ code: "CONFLICT", message: "当前项目未标记跨地区建筑服务；如确有业务，请先由会计维护项目税务档案" });
    const values = { projectId: input.projectId, taxEntityId: profile.taxEntityId, period: input.period, projectLocationSnapshot: profile.projectLocation, taxMethodSnapshot: profile.taxMethod, projectRegistrationReference: input.projectRegistrationReference ?? null, revenueIncludingTaxAmount: input.revenueIncludingTaxAmount === null || input.revenueIncludingTaxAmount === undefined ? null : String(roundMoney(input.revenueIncludingTaxAmount)), subcontractDeductionAmount: input.subcontractDeductionAmount === null || input.subcontractDeductionAmount === undefined ? null : String(roundMoney(input.subcontractDeductionAmount)), subcontractDeductionReference: input.subcontractDeductionReference ?? null, deductionEvidenceId: input.deductionEvidenceId ?? null, prepaidVatAmount: input.prepaidVatAmount === null || input.prepaidVatAmount === undefined ? null : String(roundMoney(input.prepaidVatAmount)), taxPaymentReference: input.taxPaymentReference ?? null, taxPaymentEvidenceId: input.taxPaymentEvidenceId ?? null, reviewNote: input.reviewNote ?? null };
    if (input.id) {
      const [existing] = await db.select().from(crossRegionConstructionTaxLedgers).where(eq(crossRegionConstructionTaxLedgers.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目跨地区预缴资料" });
      if (existing.status !== "pending_review") throw new TRPCError({ code: "CONFLICT", message: "已交接、已登记回执或已作废的跨地区预缴资料不可直接修改" });
      await db.update(crossRegionConstructionTaxLedgers).set(values).where(and(eq(crossRegionConstructionTaxLedgers.id, input.id), eq(crossRegionConstructionTaxLedgers.status, "pending_review")));
    } else {
      await db.insert(crossRegionConstructionTaxLedgers).values({ ...values, status: "pending_review", createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_cross_region_construction_tax" : "create_cross_region_construction_tax", targetType: "cross_region_construction_tax", targetId: String(input.id ?? `${input.projectId}:${input.period}`), summary: `维护${input.period}跨地区建筑服务预缴辅助资料` });
    return { success: true };
  }),

  transitionCrossRegionConstructionTaxLedger: protectedProcedure.input(crossRegionConstructionTaxTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "跨地区预缴资料状态仅限会计或财务负责人维护" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [entry] = await db.select().from(crossRegionConstructionTaxLedgers).where(eq(crossRegionConstructionTaxLedgers.id, input.id)).limit(1);
    if (!entry || entry.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目跨地区预缴资料" });
    const allowedTargets: Record<string, string[]> = { pending_review: ["ready_for_handoff", "not_applicable", "void"], ready_for_handoff: ["receipt_recorded", "void"], receipt_recorded: [], not_applicable: [], void: [] };
    if (!allowedTargets[entry.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前跨地区预缴资料状态不允许该操作" });
    if (input.targetStatus === "ready_for_handoff" && !entry.projectRegistrationReference) throw new TRPCError({ code: "BAD_REQUEST", message: "交接跨地区预缴资料前请填写项目登记/报验引用" });
    if (input.targetStatus === "receipt_recorded" && !input.taxPaymentReference && !input.taxPaymentEvidenceId) throw new TRPCError({ code: "BAD_REQUEST", message: "登记实际预缴回执时至少填写完税/回执引用或关联受控证据" });
    const result = await db.update(crossRegionConstructionTaxLedgers).set({ status: input.targetStatus, taxPaymentReference: input.taxPaymentReference ?? entry.taxPaymentReference, taxPaymentEvidenceId: input.taxPaymentEvidenceId ?? entry.taxPaymentEvidenceId, reviewNote: input.reviewNote ?? entry.reviewNote, reviewedBy: ["ready_for_handoff", "not_applicable"].includes(input.targetStatus) ? user.id : entry.reviewedBy, reviewedAt: ["ready_for_handoff", "not_applicable"].includes(input.targetStatus) ? new Date() : entry.reviewedAt }).where(and(eq(crossRegionConstructionTaxLedgers.id, input.id), eq(crossRegionConstructionTaxLedgers.status, entry.status)));
    assertConditionalBusinessWrite(result, "跨地区预缴资料已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `transition_cross_region_tax_${input.targetStatus}`, targetType: "cross_region_construction_tax", targetId: String(input.id), summary: `跨地区预缴资料状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    return { success: true };
  }),

  listRecords: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema.optional() })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    if (!input.period) return db.select().from(financialRecords).where(eq(financialRecords.projectId, input.projectId)).orderBy(desc(financialRecords.occurredAt));
    const range = getMonthRange(input.period);
    return db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))).orderBy(desc(financialRecords.occurredAt));
  }),

  /** 电子凭证、扫描件或影像先进入受控证据库；保存发票原件时再以 evidenceId 关联。 */
  uploadInvoiceEvidence: protectedProcedure.input(financialInvoiceEvidenceUploadInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "发票原件归档仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const bytes = decodePurchaseDocumentBase64(input.base64Data, input.mimeType);
    const uploadedAt = new Date();
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "financial-invoice.pdf";
    const stored = await storagePut(`financial-invoices/${input.projectId}/${uploadedAt.toISOString().slice(0, 10)}/${user.id}-${safeFileName}`, bytes, input.mimeType);
    let evidenceId = 0;
    await db.transaction(async tx => {
      const result = await tx.insert(evidenceRecords).values({ projectId: input.projectId, sourceType: "financial_invoice", sourceId: "invoice_original_upload", fileKey: stored.key, fileName: input.fileName, mimeType: input.mimeType, contentSha256, contentBytes: bytes.length, watermarkJson: JSON.stringify({ description: input.description, attachmentKind: "financial_invoice_original", captureMode: "financial_invoice_upload", uploadedAt: uploadedAt.toISOString(), version: 1 }), longitude: null, latitude: null, capturedAt: uploadedAt, retentionUntil: null, status: "active", uploadedBy: user.id });
      evidenceId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      await appendIntegrityProtectedAudit(tx, { userId: user.id, module: "finance", action: "upload_invoice_original", targetType: "evidence", targetId: String(evidenceId || stored.key), summary: `归档财务发票原件：${input.description.slice(0, 80)}`, afterJson: JSON.stringify({ projectId: input.projectId, contentSha256, contentBytes: bytes.length, mimeType: input.mimeType }) });
    });
    if (!Number.isInteger(evidenceId) || evidenceId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "发票原件归档失败，请稍后重试" });
    return { success: true, evidenceId, fileName: input.fileName, mimeType: input.mimeType };
  }),

  /** 发票台账按项目受控读取；原件状态来自全局电子凭证主档，项目仅保留合法分摊。 */
  listInvoices: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema.optional() })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { invoices: [], summary: { totalAmount: 0, verifiedAmount: 0, pendingAmount: 0, byType: {} as Record<string, number> } };
    const conditions = [eq(financialInvoices.projectId, input.projectId)];
    if (input.period) {
      const range = getMonthRange(input.period);
      conditions.push(gte(financialInvoices.issuedAt, range.start), lt(financialInvoices.issuedAt, range.endExclusive));
    }
    const invoices = await db.select().from(financialInvoices).where(and(...conditions)).orderBy(desc(financialInvoices.issuedAt), desc(financialInvoices.id));
    const originalIds = Array.from(new Set(invoices.map(invoice => invoice.originalId).filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0)));
    const originals = originalIds.length ? await db.select().from(financialInvoiceOriginals).where(inArray(financialInvoiceOriginals.id, originalIds)) : [];
    const originalById = new Map(originals.map(original => [original.id, original]));
    const projected = invoices.map(invoice => ({ ...invoice, original: invoice.originalId ? originalById.get(invoice.originalId) ?? null : null }));
    const active = projected.filter(invoice => invoice.allocationStatus === "active" && !["void", "red_flushed"].includes(invoice.status));
    const byType = active.reduce<Record<string, number>>((summary, invoice) => { summary[invoice.invoiceType] = roundMoney((summary[invoice.invoiceType] ?? 0) + Number(invoice.amount)); return summary; }, {});
    return {
      invoices: projected,
      summary: {
        totalAmount: roundMoney(active.reduce((sum, invoice) => sum + Number(invoice.allocatedAmount), 0)),
        verifiedAmount: roundMoney(active.filter(invoice => invoice.original?.verificationStatus === "external_verified" || invoice.original?.verificationStatus === "manual_verified").reduce((sum, invoice) => sum + Number(invoice.allocatedAmount), 0)),
        pendingAmount: roundMoney(active.filter(invoice => !["external_verified", "manual_verified", "not_required"].includes(invoice.original?.verificationStatus ?? "pending")).reduce((sum, invoice) => sum + Number(invoice.allocatedAmount), 0)),
        byType,
      },
    };
  }),

  saveInvoice: protectedProcedure.input(financialInvoiceInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "发票台账维护仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    if (input.taxAmount > input.amount) throw new TRPCError({ code: "BAD_REQUEST", message: "税额不得高于价税合计金额" });
    if (input.invoiceType === "electronic" && !input.evidenceId && !input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "电子发票必须归档原始 PDF、OFD 或受控影像后才能登记" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    if (input.financialRecordId) {
      const [record] = await db.select({ projectId: financialRecords.projectId }).from(financialRecords).where(eq(financialRecords.id, input.financialRecordId)).limit(1);
      if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目关联的财务流水" });
    }
    const originalFingerprint = createInvoiceOriginalFingerprint(input);
    const allocationAmount = roundMoney(input.allocatedAmount ?? input.amount);
    if (allocationAmount > input.amount) throw new TRPCError({ code: "BAD_REQUEST", message: "项目分摊金额不得超过发票原件价税合计" });
    const baseValues = { projectId: input.projectId, financialRecordId: input.financialRecordId ?? null, invoiceNo: input.invoiceNo, invoiceCode: input.invoiceCode ?? null, counterpartyName: input.counterpartyName, invoiceType: input.invoiceType, direction: input.direction, amount: String(roundMoney(input.amount)), taxAmount: String(roundMoney(input.taxAmount)), taxRate: String(input.taxRate), issuedAt: toBusinessDate(input.issuedAt), evidenceId: input.evidenceId ?? null, allocatedAmount: String(allocationAmount), allocationPurpose: input.allocationPurpose };
    if (input.id) {
      const [existing] = await db.select().from(financialInvoices).where(eq(financialInvoices.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目发票" });
      if (existing.status !== "issued" || existing.allocationStatus !== "active") throw new TRPCError({ code: "CONFLICT", message: "已认证、作废、红冲或待复核的发票分摊不可直接修改" });
      const [original] = existing.originalId ? await db.select().from(financialInvoiceOriginals).where(eq(financialInvoiceOriginals.id, existing.originalId)).limit(1) : [];
      if (!original || original.originalFingerprint !== originalFingerprint) throw new TRPCError({ code: "CONFLICT", message: "原件代码、号码、销方、日期或金额变更会破坏电子凭证链；请作废原分摊后重新登记" });
      await assertFinancialDayWritable(db, input.projectId, existing.issuedAt, "修改已封存日期的发票");
      await assertFinancialDayWritable(db, input.projectId, baseValues.issuedAt, "迁移发票日期");
      const activeAllocations = await db.select({ id: financialInvoices.id, allocatedAmount: financialInvoices.allocatedAmount }).from(financialInvoices).where(and(eq(financialInvoices.originalId, original.id), eq(financialInvoices.allocationStatus, "active")));
      const totalOtherAllocations = activeAllocations.filter(allocation => allocation.id !== existing.id).reduce((sum, allocation) => sum + Number(allocation.allocatedAmount), 0);
      if (roundMoney(totalOtherAllocations + allocationAmount) > Number(original.totalAmount)) throw new TRPCError({ code: "CONFLICT", message: "修改后会导致同一原件跨项目分摊超过原件金额，请先调整其它项目分摊" });
      await db.update(financialInvoices).set(baseValues).where(and(eq(financialInvoices.id, input.id), eq(financialInvoices.status, "issued"), eq(financialInvoices.allocationStatus, "active")));
    } else {
      await assertFinancialDayWritable(db, input.projectId, baseValues.issuedAt, "登记发票");
      let [original] = await db.select().from(financialInvoiceOriginals).where(eq(financialInvoiceOriginals.originalFingerprint, originalFingerprint)).limit(1);
      if (!original) {
        if (input.redFlushOriginalId) {
          const [blueOriginal] = await db.select().from(financialInvoiceOriginals).where(eq(financialInvoiceOriginals.id, input.redFlushOriginalId)).limit(1);
          if (!blueOriginal || ["void", "red_flushed"].includes(blueOriginal.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的蓝字原件建立红冲关联" });
        }
        const [created] = await db.insert(financialInvoiceOriginals).values({ originalFingerprint, invoiceNo: input.invoiceNo, invoiceCode: input.invoiceCode ?? null, counterpartyName: input.counterpartyName, invoiceType: input.invoiceType, direction: input.direction, totalAmount: String(roundMoney(input.amount)), totalTaxAmount: String(roundMoney(input.taxAmount)), taxRate: String(input.taxRate), issuedAt: baseValues.issuedAt, evidenceId: input.evidenceId ?? null, structuredPayloadJson: input.structuredPayloadJson ?? null, verificationStatus: input.invoiceType === "receipt" ? "not_required" : "pending", verificationReference: input.verificationReference ?? null, redFlushOriginalId: input.redFlushOriginalId ?? null, status: "issued", createdBy: user.id }).$returningId();
        const originalId = Number(created?.id);
        if (!Number.isInteger(originalId) || originalId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "发票原件主档创建失败" });
        [original] = await db.select().from(financialInvoiceOriginals).where(eq(financialInvoiceOriginals.id, originalId)).limit(1);
      }
      if (!original || ["void", "red_flushed"].includes(original.status)) throw new TRPCError({ code: "CONFLICT", message: "该发票原件已作废或红冲，不可继续分摊" });
      const activeAllocations = await db.select({ allocatedAmount: financialInvoices.allocatedAmount }).from(financialInvoices).where(and(eq(financialInvoices.originalId, original.id), eq(financialInvoices.allocationStatus, "active")));
      const totalAllocated = activeAllocations.reduce((sum, allocation) => sum + Number(allocation.allocatedAmount), 0);
      if (roundMoney(totalAllocated + allocationAmount) > Number(original.totalAmount)) throw new TRPCError({ code: "CONFLICT", message: "该发票原件已被其它项目分摊，新增分摊会超过原件金额" });
      await db.insert(financialInvoices).values({ ...baseValues, originalId: original.id, allocationStatus: "active", status: original.status === "verified" ? "verified" : "issued", createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_invoice_allocation" : "create_invoice_allocation", targetType: "financial_invoice", targetId: input.invoiceNo, summary: `${input.id ? "维护" : "登记"}${input.direction === "expense" ? "成本" : "收入"}发票项目分摊：${input.invoiceNo}，金额 ${allocationAmount.toFixed(2)}` });
    return { success: true };
  }),

  transitionInvoice: protectedProcedure.input(financialInvoiceTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "发票认证、作废和红冲仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [invoice] = await db.select().from(financialInvoices).where(eq(financialInvoices.id, input.id)).limit(1);
    if (!invoice || invoice.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目发票" });
    if (invoice.status !== "issued" || invoice.allocationStatus !== "active" || !invoice.originalId) throw new TRPCError({ code: "CONFLICT", message: "当前发票分摊状态不允许再次操作" });
    if (["void", "red_flushed"].includes(input.targetStatus) && !input.reason) throw new TRPCError({ code: "BAD_REQUEST", message: "作废或红冲必须填写原因" });
    await assertFinancialDayWritable(db, input.projectId, invoice.issuedAt, "变更已封存日期的发票状态");
    const [original] = await db.select().from(financialInvoiceOriginals).where(eq(financialInvoiceOriginals.id, invoice.originalId)).limit(1);
    if (!original) throw new TRPCError({ code: "CONFLICT", message: "发票原件主档缺失，需先执行电子凭证数据健康检查" });
    if (input.targetStatus === "verified") {
      await db.update(financialInvoiceOriginals).set({ status: "verified", verificationStatus: input.verificationReference ? "external_verified" : "manual_verified", verificationReference: input.verificationReference ?? original.verificationReference, verificationCheckedAt: new Date() }).where(eq(financialInvoiceOriginals.id, original.id));
      await db.update(financialInvoices).set({ status: "verified", verifiedAt: new Date() }).where(and(eq(financialInvoices.id, input.id), eq(financialInvoices.status, "issued")));
    } else if (input.targetStatus === "void") {
      await db.update(financialInvoices).set({ status: "void", allocationStatus: "void", voidReason: input.reason ?? null }).where(and(eq(financialInvoices.id, input.id), eq(financialInvoices.status, "issued"), eq(financialInvoices.allocationStatus, "active")));
    } else {
      const activeAllocations = await db.select({ id: financialInvoices.id }).from(financialInvoices).where(and(eq(financialInvoices.originalId, original.id), eq(financialInvoices.allocationStatus, "active")));
      if (activeAllocations.length > 1) throw new TRPCError({ code: "CONFLICT", message: "该原件已分摊到多个项目，红冲前须先逐项作废或登记关联红字原件，防止跨项目账实不一致" });
      await db.transaction(async tx => {
        await tx.update(financialInvoiceOriginals).set({ status: "red_flushed", redFlushReason: input.reason ?? null }).where(eq(financialInvoiceOriginals.id, original.id));
        await tx.update(financialInvoices).set({ status: "red_flushed", allocationStatus: "red_flushed", voidReason: input.reason ?? null }).where(eq(financialInvoices.originalId, original.id));
      });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `invoice_${input.targetStatus}`, targetType: "financial_invoice", targetId: String(input.id), summary: `发票原件 ${invoice.invoiceNo} 的项目分摊状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    return { success: true };
  }),

  closeDailyAccount: protectedProcedure.input(dailyClosingInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canMaintainFinancialLedger(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "每日会计日结仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const closingDate = toBusinessDate(input.closingDate);
    const endExclusive = new Date(closingDate.getTime() + 86_400_000);
    return db.transaction(async tx => {
      const [existing] = await tx.select().from(dailyAccountingClosures).where(and(eq(dailyAccountingClosures.projectId, input.projectId), eq(dailyAccountingClosures.closingDate, closingDate))).limit(1);
      if (existing && existing.status !== "reopened") throw new TRPCError({ code: "CONFLICT", message: "该项目日期已完成日结，不可重复封存；如需调整，请先由财务负责人授权反结账。" });
      const records = await tx.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, closingDate), lt(financialRecords.occurredAt, endExclusive))).orderBy(financialRecords.occurredAt, financialRecords.id);
      const invoices = await tx.select().from(financialInvoices).where(and(eq(financialInvoices.projectId, input.projectId), eq(financialInvoices.issuedAt, closingDate))).orderBy(financialInvoices.id);
      const activeRecords = records.filter(record => record.settlementStatus !== "void");
      const activeInvoices = invoices.filter(invoice => !["void", "red_flushed"].includes(invoice.status));
      const revision = existing ? existing.revision + 1 : 1;
      const snapshot = { projectId: input.projectId, closingDate: input.closingDate, revision, records: activeRecords.map(record => ({ id: record.id, recordNo: record.recordNo, direction: record.direction, category: record.category, amount: record.amount, settlementStatus: record.settlementStatus })), invoices: invoices.map(invoice => ({ id: invoice.id, invoiceNo: invoice.invoiceNo, invoiceType: invoice.invoiceType, amount: invoice.amount, status: invoice.status })) };
      const snapshotJson = JSON.stringify(snapshot);
      const snapshotHash = createHash("sha256").update(snapshotJson).digest("hex");
      const totalIncome = roundMoney(activeRecords.filter(record => record.direction === "income").reduce((sum, record) => sum + Number(record.amount), 0));
      const totalExpense = roundMoney(activeRecords.filter(record => record.direction === "expense").reduce((sum, record) => sum + Number(record.amount), 0));
      const closingNo = existing?.closingNo ?? createBusinessNo("DAY");
      const now = new Date();
      let closureId = existing?.id;
      if (existing) {
        await tx.update(dailyAccountingClosures).set({ totalIncome: String(totalIncome), totalExpense: String(totalExpense), recordCount: activeRecords.length, invoiceCount: activeInvoices.length, invoiceAmount: String(roundMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0))), snapshotHash, snapshotJson, status: "closed", revision, closedBy: user.id, closedAt: now, reopenedBy: null, reopenedAt: null, reopenReason: null }).where(eq(dailyAccountingClosures.id, existing.id));
      } else {
        await tx.insert(dailyAccountingClosures).values({ closingNo, projectId: input.projectId, closingDate, totalIncome: String(totalIncome), totalExpense: String(totalExpense), recordCount: activeRecords.length, invoiceCount: activeInvoices.length, invoiceAmount: String(roundMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0))), snapshotHash, snapshotJson, status: "closed", revision, closedBy: user.id, closedAt: now });
        const [created] = await tx.select({ id: dailyAccountingClosures.id }).from(dailyAccountingClosures).where(eq(dailyAccountingClosures.closingNo, closingNo)).limit(1);
        closureId = created?.id;
      }
      if (!closureId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "日结封存单创建失败，请重试" });
      await tx.insert(dailyAccountingClosureEvents).values({ closureId, projectId: input.projectId, revision, eventType: "closed", snapshotHash, snapshotJson, reason: existing ? "授权反结账后重新封存" : "首次日结封存", performedBy: user.id, performedAt: now });
      if (activeRecords.length) await tx.update(financialRecords).set({ dailyClosingId: closureId }).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, closingDate), lt(financialRecords.occurredAt, endExclusive)));
      await tx.insert(auditLogs).values({ userId: user.id, module: "finance", action: existing ? "reclose_daily_account" : "close_daily_account", targetType: "daily_accounting_closure", targetId: closingNo, summary: `${existing ? "重新" : "完成"}项目日结：${input.closingDate}，支出 ${totalExpense}`, beforeJson: existing ? JSON.stringify({ status: existing.status, revision: existing.revision, snapshotHash: existing.snapshotHash }) : null, afterJson: JSON.stringify({ status: "closed", revision, snapshotHash }) });
      return { success: true, closingNo, revision, totalIncome, totalExpense, recordCount: activeRecords.length };
    });
  }),

  reopenDailyAccount: protectedProcedure.input(dailyClosingReopenInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canReopenFinancialPeriod(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "反结账仅限财务负责人或系统应急管理身份授权" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const closingDate = toBusinessDate(input.closingDate);
    return db.transaction(async tx => {
      const [closure] = await tx.select().from(dailyAccountingClosures).where(and(eq(dailyAccountingClosures.projectId, input.projectId), eq(dailyAccountingClosures.closingDate, closingDate))).limit(1);
      if (!closure) throw new TRPCError({ code: "NOT_FOUND", message: "该日期尚未日结，不能反结账" });
      if (closure.status === "archived") throw new TRPCError({ code: "CONFLICT", message: "已归档日结不可直接反结账，请按档案调整流程处理" });
      if (closure.status !== "closed") throw new TRPCError({ code: "CONFLICT", message: "当前日结不处于可反结账状态" });
      const now = new Date();
      await tx.update(dailyAccountingClosures).set({ status: "reopened", reopenedBy: user.id, reopenedAt: now, reopenReason: input.reason }).where(and(eq(dailyAccountingClosures.id, closure.id), eq(dailyAccountingClosures.status, "closed")));
      await tx.insert(dailyAccountingClosureEvents).values({ closureId: closure.id, projectId: input.projectId, revision: closure.revision, eventType: "reopened", snapshotHash: closure.snapshotHash, snapshotJson: closure.snapshotJson, reason: input.reason, performedBy: user.id, performedAt: now });
      await tx.insert(auditLogs).values({ userId: user.id, module: "finance", action: "reopen_daily_account", targetType: "daily_accounting_closure", targetId: closure.closingNo, summary: `授权反结账：${input.closingDate}；原因：${input.reason}`, beforeJson: JSON.stringify({ status: "closed", revision: closure.revision, snapshotHash: closure.snapshotHash }), afterJson: JSON.stringify({ status: "reopened", reason: input.reason }) });
      return { success: true, closingNo: closure.closingNo, revision: closure.revision, status: "reopened" as const };
    });
  }),

  getDailyPrintableReport: protectedProcedure.input(dailyClosingInput).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const closingDate = toBusinessDate(input.closingDate);
    const [closure] = await db.select().from(dailyAccountingClosures).where(and(eq(dailyAccountingClosures.projectId, input.projectId), eq(dailyAccountingClosures.closingDate, closingDate))).limit(1);
    if (!closure) throw new TRPCError({ code: "NOT_FOUND", message: "请先完成该日期日结，才可打印审计报表" });
    return { closure, snapshot: JSON.parse(closure.snapshotJson) as unknown };
  }),

  /** 登记真实资金流水，项目、金额、发生时间和结算状态均经服务端校验并审计。 */
  saveRecord: protectedProcedure.input(financialRecordInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canCreateFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "审计只读岗位仅可查看财务资料，不可登记资金流水" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    /** 非支付执行岗位只能创建待结清原始流水，结清状态只能由出纳或系统应急管理身份确认。 */
    if (input.settlementStatus !== "unpaid" && !canExecutePayment(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "资金结清状态仅可由出纳执行确认" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await assertFinancialDayWritable(db, input.projectId, new Date(input.occurredAt), "登记财务流水");
    await db.insert(financialRecords).values({ recordNo: createBusinessNo("FIN"), projectId: input.projectId, direction: input.direction, category: input.category, amount: String(roundMoney(input.amount)), occurredAt: new Date(input.occurredAt), settlementStatus: input.settlementStatus, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, evidenceId: input.evidenceId ?? null, remarks: input.remarks ?? null });
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "create_record", targetType: "financial_record", targetId: input.category, summary: `登记项目${input.direction === "income" ? "收入" : "支出"}流水：${input.category}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "finance", eventCode: `financial_${input.direction}`, targetType: "financial_record", targetId: input.category, title: `项目${input.direction === "income" ? "收入" : "支出"}流水已登记`, deepLink: "/mobile/finance" }).catch(() => undefined);
    return { success: true };
  }),

  /** 作废未支付的人工财务流水；来源于计量、采购等业务单据的自动流水不得在此入口调整。 */
  voidRecord: protectedProcedure.input(financialRecordVoidInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canVoidFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财务流水作废仅限会计审查或财务负责人办理" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(financialRecords).where(eq(financialRecords.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的财务流水" });
    await assertFinancialDayWritable(db, input.projectId, record.occurredAt, "作废已封存日期的财务流水");
    if (record.sourceType) throw new TRPCError({ code: "CONFLICT", message: "来源业务流水须在原业务模块按流程调整，不支持在财务台账直接作废" });
    if (record.settlementStatus === "paid") throw new TRPCError({ code: "CONFLICT", message: "已支付流水不可作废，请使用冲销流程" });
    if (record.settlementStatus === "void") throw new TRPCError({ code: "CONFLICT", message: "该财务流水已作废" });
    const updateResult = await db.update(financialRecords)
      .set({ settlementStatus: "void" })
      .where(and(eq(financialRecords.id, record.id), eq(financialRecords.settlementStatus, record.settlementStatus)));
    assertConditionalBusinessWrite(updateResult, "财务流水已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "void_financial_record", targetType: "financial_record", targetId: String(record.id), summary: `财务流水已作废：${record.recordNo}；原因：${input.reason}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "finance", eventCode: "financial_voided", targetType: "financial_record", targetId: String(record.id), title: "项目财务流水已作废", deepLink: "/mobile/finance" }).catch(() => undefined);
    return { success: true, status: "void" as const };
  }),

  /** 已支付的人工流水以反方向新流水冲销，保留原记录和资金发生时点的审计链。 */
  reverseRecord: protectedProcedure.input(financialRecordReversalInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canReverseFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "已支付财务流水冲销仅限财务负责人办理" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(financialRecords).where(eq(financialRecords.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的财务流水" });
    if (record.sourceType) throw new TRPCError({ code: "CONFLICT", message: "来源业务流水须在原业务模块按流程调整，不支持在财务台账直接冲销" });
    if (record.settlementStatus !== "paid") throw new TRPCError({ code: "CONFLICT", message: "仅已支付的人工财务流水可以冲销；未支付流水请使用作废流程" });
    await assertFinancialDayWritable(db, input.projectId, new Date(input.reversedAt), "登记冲销调整");
    const existingReversal = await db
      .select({ id: financialRecords.id })
      .from(financialRecords)
      .where(and(eq(financialRecords.sourceType, "financial_reversal"), eq(financialRecords.sourceId, String(record.id))))
      .limit(1);
    if (existingReversal.length > 0) throw new TRPCError({ code: "CONFLICT", message: "该财务流水已存在冲销记录" });
    const reversalDirection = record.direction === "income" ? "expense" : "income";
    await db.insert(financialRecords).values({
      recordNo: createBusinessNo("REV"),
      projectId: input.projectId,
      direction: reversalDirection,
      category: `冲销：${record.category}`.slice(0, 64),
      amount: String(roundMoney(Number(record.amount))),
      occurredAt: new Date(input.reversedAt),
      settlementStatus: "paid",
      sourceType: "financial_reversal",
      sourceId: String(record.id),
      evidenceId: null,
      remarks: `冲销原流水 ${record.recordNo}：${input.reason}`,
    });
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "reverse_financial_record", targetType: "financial_record", targetId: String(record.id), summary: `财务流水已冲销：${record.recordNo}；原因：${input.reason}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "finance", eventCode: "financial_reversed", targetType: "financial_record", targetId: String(record.id), title: "项目财务流水已冲销", deepLink: "/mobile/finance" }).catch(() => undefined);
    return { success: true, reversalDirection };
  }),

  /** 现金流与利润只在服务端按原始财务流水汇总；工程计量收入确认与实际回款使用不同口径。 */
  summary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { incomeAmount: 0, expenseAmount: 0, profitAmount: 0, receivableAmount: 0, payableAmount: 0, records: [] };
    const range = getMonthRange(input.period);
    const [physicalRecords, periodPurchaseOrders, allPurchaseSettlements, machineSettlements, transportSettlements] = await Promise.all([
      db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))).orderBy(desc(financialRecords.occurredAt)),
      db.select().from(purchaseOrders).where(and(eq(purchaseOrders.projectId, input.projectId), gte(purchaseOrders.orderedAt, range.start), lt(purchaseOrders.orderedAt, range.endExclusive))).orderBy(desc(purchaseOrders.orderedAt)),
      db.select({ sourceId: financialRecords.sourceId, amount: financialRecords.amount, settlementStatus: financialRecords.settlementStatus }).from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), eq(financialRecords.sourceType, "purchase_order_settlement"))).orderBy(desc(financialRecords.occurredAt)),
      db.select({ id: machinePaymentSettlements.id, settlementNo: machinePaymentSettlements.settlementNo, projectId: machinePaymentSettlements.projectId, netPayableAmount: machinePaymentSettlements.netPayableAmount, status: machinePaymentSettlements.status, paymentDate: machinePaymentSettlements.paymentDate }).from(machinePaymentSettlements).where(and(eq(machinePaymentSettlements.projectId, input.projectId), eq(machinePaymentSettlements.period, input.period))).orderBy(desc(machinePaymentSettlements.createdAt)),
      db.select({ id: transportVehicleSettlements.id, settlementNo: transportVehicleSettlements.settlementNo, projectId: transportVehicleSettlements.projectId, netPayableAmount: transportVehicleSettlements.netPayableAmount, status: transportVehicleSettlements.status, paymentDate: transportVehicleSettlements.paymentDate, periodEnd: transportVehicleSettlements.periodEnd }).from(transportVehicleSettlements).where(and(eq(transportVehicleSettlements.projectId, input.projectId), gte(transportVehicleSettlements.periodEnd, range.start), lt(transportVehicleSettlements.periodEnd, range.endExclusive))).orderBy(desc(transportVehicleSettlements.createdAt)),
    ]);
    const settledByOrder = new Map<string, number>();
    for (const settlement of allPurchaseSettlements) {
      if (!settlement.sourceId || settlement.settlementStatus === "void") continue;
      settledByOrder.set(settlement.sourceId, roundMoney((settledByOrder.get(settlement.sourceId) ?? 0) + Number(settlement.amount)));
    }
    const purchasePayables = periodPurchaseOrders
      .filter(order => ["confirmed", "received", "closed"].includes(order.status))
      .map(order => {
        const remainingAmount = roundMoney(Math.max(0, Number(order.amount) - (settledByOrder.get(String(order.id)) ?? 0)));
        if (remainingAmount <= 0) return null;
        return {
          id: `purchase-payable-${order.id}`,
          recordNo: `${order.orderNo}-AP`,
          projectId: order.projectId,
          direction: "expense" as const,
          category: "采购应付",
          amount: String(remainingAmount),
          occurredAt: order.orderedAt,
          settlementStatus: (settledByOrder.get(String(order.id)) ?? 0) > 0 ? "partial" : "unpaid",
          sourceType: "purchase_order_payable",
          sourceId: String(order.id),
          evidenceId: order.evidenceId,
          remarks: `采购订单 ${order.orderNo}：${order.itemDescription}；未结余额 ¥${remainingAmount.toFixed(2)}`,
          dailyClosingId: null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    /** 已付款结算会在付款事务内写入资金总账；下面仅兼容历史已付款结算，或展示当前已审核待付款应付，绝不双算。 */
    const ledgerSettlementKeys = new Set(physicalRecords.filter(record => ["machine_payment_settlement", "transport_vehicle_settlement"].includes(record.sourceType ?? "") && record.sourceId).map(record => `${record.sourceType}:${record.sourceId}`));
    const settlementVirtualRecords = [
      ...machineSettlements.filter(item => ["approved", "paid"].includes(item.status) && !ledgerSettlementKeys.has(`machine_payment_settlement:${item.id}`)).map(item => ({
        id: `machine-payment-${item.id}`, recordNo: `${item.settlementNo}-${item.status === "paid" ? "HISTORICAL" : "AP"}`, projectId: item.projectId, direction: "expense" as const, category: "机械付款结算", amount: String(item.netPayableAmount), occurredAt: item.paymentDate ?? range.start, settlementStatus: item.status === "paid" ? "paid" as const : "unpaid" as const, sourceType: item.status === "paid" ? "machine_payment_settlement_legacy" : "machine_payment_settlement_payable", sourceId: String(item.id), evidenceId: null, remarks: item.status === "paid" ? `历史机械付款结算 ${item.settlementNo}：系统补齐资金展示，未改写原始数据` : `机械付款结算 ${item.settlementNo}：已审核待付款`, dailyClosingId: null,
      })),
      ...transportSettlements.filter(item => ["approved", "paid"].includes(item.status) && !ledgerSettlementKeys.has(`transport_vehicle_settlement:${item.id}`)).map(item => ({
        id: `transport-payment-${item.id}`, recordNo: `${item.settlementNo}-${item.status === "paid" ? "HISTORICAL" : "AP"}`, projectId: item.projectId, direction: "expense" as const, category: "渣土车运费结算", amount: String(item.netPayableAmount), occurredAt: item.paymentDate ?? item.periodEnd, settlementStatus: item.status === "paid" ? "paid" as const : "unpaid" as const, sourceType: item.status === "paid" ? "transport_vehicle_settlement_legacy" : "transport_vehicle_settlement_payable", sourceId: String(item.id), evidenceId: null, remarks: item.status === "paid" ? `历史渣土车付款结算 ${item.settlementNo}：系统补齐资金展示，未改写原始数据` : `渣土车结算单 ${item.settlementNo}：已审核待付款`, dailyClosingId: null,
      })),
    ];
    const records = [...physicalRecords, ...purchasePayables, ...settlementVirtualRecords].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    const confirmedIncomeRecords = records.filter(item => item.direction === "income" && item.sourceType !== "measurement_payment" && item.settlementStatus !== "void");
    const measurementPayments = records.filter(item => item.sourceType === "measurement_payment" && item.settlementStatus !== "void");
    const paymentByClaim = new Map<string, number>();
    for (const payment of measurementPayments) {
      const key = payment.sourceId ?? "";
      paymentByClaim.set(key, roundMoney((paymentByClaim.get(key) ?? 0) + Number(payment.amount)));
    }
    const incomeAmount = roundMoney(confirmedIncomeRecords.reduce((sum, item) => sum + Number(item.amount), 0));
    const expenseAmount = roundMoney(records.filter(item => item.direction === "expense" && item.settlementStatus !== "void").reduce((sum, item) => sum + Number(item.amount), 0));
    const receivableAmount = roundMoney(confirmedIncomeRecords.filter(item => ["unpaid", "partial"].includes(item.settlementStatus)).reduce((sum, item) => {
      if (item.sourceType !== "measurement_claim") return sum + Number(item.amount);
      return sum + Math.max(0, Number(item.amount) - (paymentByClaim.get(item.sourceId ?? "") ?? 0));
    }, 0));
    const payableAmount = roundMoney(records.filter(item => item.direction === "expense" && item.sourceType !== "purchase_order_settlement" && ["unpaid", "partial"].includes(item.settlementStatus)).reduce((sum, item) => sum + Number(item.amount), 0));
    const cashInflowAmount = roundMoney(records.filter(item => item.direction === "income" && item.settlementStatus !== "void" && (item.sourceType === "measurement_payment" || (item.sourceType !== "measurement_claim" && item.settlementStatus === "paid"))).reduce((sum, item) => sum + Number(item.amount), 0));
    const cashOutflowAmount = roundMoney(records.filter(item => item.direction === "expense" && (item.settlementStatus === "paid" || item.sourceType === "purchase_order_settlement")).reduce((sum, item) => sum + Number(item.amount), 0));
    return { incomeAmount, expenseAmount, profitAmount: roundMoney(incomeAmount - expenseAmount), receivableAmount, payableAmount, cashInflowAmount, cashOutflowAmount, netCashFlowAmount: roundMoney(cashInflowAmount - cashOutflowAmount), records };
  }),

  /**
   * 财务页面的真实业务数据覆盖清单。资金总账、柴油、工资、机械、维修、采购与运输的
   * 业务事实分层展示，绝不把没有共享来源编号的跨模块记录强行相加，避免产生虚假的“合计”。
   */
  businessSummary: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { period: input.period, sources: [], pendingTransport: { count: 0, amount: 0 }, settledTransport: { count: 0, amount: 0 } };
    const range = getMonthRange(input.period);
    const [ledgerRows, purchaseRows, dieselRows, payrollRows, dailyWageRows, machineRows, machineSettlementRows, maintenanceRows, tripRows, settlementRows] = await Promise.all([
      db.select({ id: financialRecords.id, direction: financialRecords.direction, amount: financialRecords.amount, settlementStatus: financialRecords.settlementStatus }).from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))),
      db.select({ id: purchaseOrders.id, amount: purchaseOrders.amount, status: purchaseOrders.status }).from(purchaseOrders).where(and(eq(purchaseOrders.projectId, input.projectId), gte(purchaseOrders.orderedAt, range.start), lt(purchaseOrders.orderedAt, range.endExclusive))),
      db.select({ id: dieselRefuelRecords.id, amount: dieselRefuelRecords.amount, status: dieselRefuelRecords.status }).from(dieselRefuelRecords).where(and(eq(dieselRefuelRecords.projectId, input.projectId), gte(dieselRefuelRecords.refueledAt, range.start), lt(dieselRefuelRecords.refueledAt, range.endExclusive))),
      db.select({ id: payrollStatements.id, amount: payrollStatements.actualAmount, status: payrollStatements.status }).from(payrollStatements).where(and(eq(payrollStatements.projectId, input.projectId), eq(payrollStatements.period, input.period))),
      db.select({ id: temporaryDailyWageSettlements.id, amount: temporaryDailyWageSettlements.actualAmount, status: temporaryDailyWageSettlements.status }).from(temporaryDailyWageSettlements).where(and(eq(temporaryDailyWageSettlements.projectId, input.projectId), gte(temporaryDailyWageSettlements.settlementDate, range.start), lt(temporaryDailyWageSettlements.settlementDate, range.endExclusive))),
      db.select({ id: machineCostRecords.id, amount: machineCostRecords.amount, status: machineCostRecords.status, dieselRefuelRecordId: machineCostRecords.dieselRefuelRecordId }).from(machineCostRecords).where(and(eq(machineCostRecords.projectId, input.projectId), gte(machineCostRecords.occurredAt, range.start), lt(machineCostRecords.occurredAt, range.endExclusive))),
      db.select({ id: machinePaymentSettlements.id, amount: machinePaymentSettlements.netPayableAmount, status: machinePaymentSettlements.status }).from(machinePaymentSettlements).where(and(eq(machinePaymentSettlements.projectId, input.projectId), eq(machinePaymentSettlements.period, input.period))),
      db.select({ id: assetMaintenanceRecords.id, amount: assetMaintenanceRecords.amount, status: assetMaintenanceRecords.status }).from(assetMaintenanceRecords).where(and(eq(assetMaintenanceRecords.projectId, input.projectId), gte(assetMaintenanceRecords.occurredAt, range.start), lt(assetMaintenanceRecords.occurredAt, range.endExclusive))),
      db.select({ id: transportTrips.id, amount: transportTrips.calculatedAmount, status: transportTrips.status }).from(transportTrips).where(and(eq(transportTrips.projectId, input.projectId), gte(transportTrips.startAt, range.start), lt(transportTrips.startAt, range.endExclusive))),
      db.select({ id: transportVehicleSettlements.id, amount: transportVehicleSettlements.netPayableAmount, status: transportVehicleSettlements.status }).from(transportVehicleSettlements).where(and(eq(transportVehicleSettlements.projectId, input.projectId), gte(transportVehicleSettlements.periodEnd, range.start), lt(transportVehicleSettlements.periodEnd, range.endExclusive))),
    ]);
    const amountOf = (rows: Array<{ amount: string | number | null }>) => roundMoney(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0));
    const statusText = (rows: Array<{ status: string }>) => Array.from(rows.reduce((counts, row) => counts.set(row.status, (counts.get(row.status) ?? 0) + 1), new Map<string, number>()).entries()).map(([status, count]) => `${status}:${count}`).join("、") || "无";
    const valid = <T extends { status: string }>(rows: T[]) => rows.filter(row => row.status !== "void");
    const nonDieselMachineRows = machineRows.filter(row => !row.dieselRefuelRecordId);
    const sources = [
      { code: "financial_ledger", label: "资金总账流水", recordCount: ledgerRows.length, effectiveCount: ledgerRows.filter(row => row.settlementStatus !== "void").length, amount: amountOf(ledgerRows.filter(row => row.direction === "expense" && row.settlementStatus !== "void")), accountingLink: "已进入资金总账", statusSummary: statusText(ledgerRows.map(row => ({ status: row.settlementStatus }))) },
      { code: "purchase", label: "采购订单", recordCount: purchaseRows.length, effectiveCount: valid(purchaseRows).length, amount: amountOf(valid(purchaseRows)), accountingLink: "付款后进入资金总账；未付款作为应付管理", statusSummary: statusText(purchaseRows) },
      { code: "diesel", label: "柴油领用", recordCount: dieselRows.length, effectiveCount: valid(dieselRows).length, amount: amountOf(valid(dieselRows)), accountingLink: "独立油料台账；关联机械油料不重复计入", statusSummary: statusText(dieselRows) },
      { code: "payroll", label: "月度工资", recordCount: payrollRows.length, effectiveCount: payrollRows.filter(row => ["approved", "paid"].includes(row.status)).length, amount: amountOf(payrollRows.filter(row => ["approved", "paid"].includes(row.status))), accountingLink: "工资台账；付款凭证由劳资流程管理", statusSummary: statusText(payrollRows) },
      { code: "daily_wage", label: "临时日结工资", recordCount: dailyWageRows.length, effectiveCount: dailyWageRows.filter(row => ["approved", "paid"].includes(row.status)).length, amount: amountOf(dailyWageRows.filter(row => ["approved", "paid"].includes(row.status))), accountingLink: "工资台账；付款凭证由劳资流程管理", statusSummary: statusText(dailyWageRows) },
      { code: "machine", label: "机械成本", recordCount: nonDieselMachineRows.length, effectiveCount: valid(nonDieselMachineRows).length, amount: amountOf(valid(nonDieselMachineRows)), accountingLink: "独立机械成本；已关联柴油不重复计入", statusSummary: statusText(nonDieselMachineRows) },
      { code: "machine_payment_settlement", label: "机械付款结算单", recordCount: machineSettlementRows.length, effectiveCount: machineSettlementRows.filter(row => ["approved", "paid"].includes(row.status)).length, amount: amountOf(machineSettlementRows.filter(row => ["approved", "paid"].includes(row.status))), accountingLink: "付款时同步资金总账；历史付款自动补齐展示", statusSummary: statusText(machineSettlementRows) },
      { code: "maintenance", label: "车辆/机械维修保养", recordCount: maintenanceRows.length, effectiveCount: valid(maintenanceRows).length, amount: amountOf(valid(maintenanceRows)), accountingLink: "独立维修保养台账", statusSummary: statusText(maintenanceRows) },
      { code: "transport_settlement", label: "运输结算单", recordCount: settlementRows.length, effectiveCount: settlementRows.filter(row => ["approved", "paid"].includes(row.status)).length, amount: amountOf(settlementRows.filter(row => ["approved", "paid"].includes(row.status))), accountingLink: "审核/付款按运输结算流程办理", statusSummary: statusText(settlementRows) },
    ];
    const activeTrips = tripRows.filter(row => row.status !== "void");
    const pendingTransport = activeTrips.filter(row => row.status !== "settled");
    const settledTransport = activeTrips.filter(row => row.status === "settled");
    return { period: input.period, sources, pendingTransport: { count: pendingTransport.length, amount: amountOf(pendingTransport) }, settledTransport: { count: settledTransport.length, amount: amountOf(settledTransport) } };
  }),
});
