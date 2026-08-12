import { and, desc, eq, gte, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  auditLogs,
  dailyAccountingClosures,
  financialInvoices,
  financialRecords,
  evidenceRecords,
  inventoryTransactions,
  measurementClaims,
  measurementTakeoffEvidences,
  measurementTakeoffRecords,
  projects,
  purchaseCategories,
  purchaseOrders,
  purchaseRequests,
  suppliers,
  systemSettings,
} from "../../drizzle/schema";
import {
  assertApprovalTransition,
  assertPurchaseOrderStatusTransition,
  assertPurchaseRequestStatusTransition,
  ConstructionDomainError,
} from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, assertSuperAdmin, getCurrentDataScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { storageGet } from "../storage";

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

/** 生成具有日期和随机后缀的单据号，避免并发录入时使用客户端编号发生冲突。 */
function createBusinessNo(prefix: string) {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

const SMALL_DIRECT_PURCHASE_LIMIT_KEY = "PURCHASING_SMALL_DIRECT_LIMIT";
const DEFAULT_SMALL_DIRECT_PURCHASE_LIMIT = 500;

/** 小额免申请阈值仅从已发布后台参数读取；配置缺失时采用明确的审计默认值 500 元。 */
async function getSmallDirectPurchaseLimit(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [setting] = await db.select({ valueJson: systemSettings.valueJson }).from(systemSettings).where(and(eq(systemSettings.settingKey, SMALL_DIRECT_PURCHASE_LIMIT_KEY), eq(systemSettings.status, "published"))).limit(1);
  const value = Number(setting?.valueJson);
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? roundMoney(value) : DEFAULT_SMALL_DIRECT_PURCHASE_LIMIT;
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
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
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

/** 财务成本岗位访问控制，出纳可登记资金流水但不能确认工程计量。 */
async function assertFinanceAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  await assertDepartmentBusinessAccess(ctx, "FINANCE");
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER", "PROJECT_MANAGER"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获财务成本数据访问授权" });
  }
  return roleCodes;
}

/** 人工资金流水的作废和冲销会改变财务口径，仅允许会计、财务负责人或系统应急角色办理。 */
function canAdjustFinancialRecord(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER") || roleCodes.includes("ACCOUNTANT");
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

/** 工程回款属于资金确认动作，仅财务、会计、出纳或系统管理员可登记。 */
function canRecordMeasurementPayment(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER"].includes(role));
}

/** 采购结算属于真实资金确认，允许财务、会计、出纳或系统管理员分次登记。 */
function canRecordPurchaseSettlement(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER"].includes(role));
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
  amount: moneySchema,
  orderedAt: isoDateTimeSchema,
  orderNo: z.string().trim().min(4).max(64).optional(),
});

/** 小额物资无需先建申请，但必须关联采购影像，服务端再按阈值和主管审核状态控制。 */
const smallDirectPurchaseInput = z.object({
  projectId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  itemDescription: z.string().trim().min(2, "请填写小额物资名称或说明").max(500),
  supplierId: z.number().int().positive().nullable().optional(),
  amount: moneySchema.refine(value => value > 0, "金额必须大于 0"),
  orderedAt: isoDateTimeSchema,
  evidenceId: z.number().int().positive(),
});

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
});

const financialInvoiceTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: z.enum(["verified", "void", "red_flushed"]),
  reason: z.string().trim().max(500).nullable().optional(),
});

/** 每日会计日结只允许财务负责人或会计执行，服务端重新汇总当日流水而不信任客户端金额。 */
const dailyClosingInput = z.object({
  projectId: z.number().int().positive(),
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日结日期格式应为 YYYY-MM-DD"),
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
    if (["approved", "rejected", "closed"].includes(input.targetStatus) && !canApprovePurchase(roleCodes)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无采购申请审批或关闭权限" });
    }
    if (["stocked", "received"].includes(input.targetStatus) && !canManageInventory(roleCodes)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无收货或入库确认权限" });
    }
    const now = new Date();
    const patch: Partial<typeof purchaseRequests.$inferInsert> = { status: input.targetStatus };
    if (input.targetStatus === "approved") { patch.approvedBy = user.id; patch.approvedAt = now; }
    if (input.targetStatus === "stocked") { patch.stockedBy = user.id; patch.stockedAt = now; }
    if (input.targetStatus === "closed") patch.closedAt = now;
    const updateResult = await db.update(purchaseRequests)
      .set(patch)
      .where(and(eq(purchaseRequests.id, input.id), eq(purchaseRequests.status, request.status)));
    assertConditionalBusinessWrite(updateResult, "采购申请已被其他用户更新，请刷新后重试");
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "transition_request", targetType: "purchase_request", targetId: String(input.id), summary: `采购申请状态变更为：${input.targetStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "purchasing", eventCode: `purchase_request_${input.targetStatus}`, targetType: "purchase_request", targetId: String(input.id), title: `采购申请已${input.targetStatus}`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true };
  }),

  listOrders: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, input.projectId)).orderBy(desc(purchaseOrders.updatedAt));
  }),

  /** 仅返回当前项目的采购取证影像，供小额物资在 OCR 后人工补全并关联，URL 使用短时签名。 */
  listPurchaseEvidences: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select({ id: evidenceRecords.id, fileKey: evidenceRecords.fileKey, fileName: evidenceRecords.fileName, capturedAt: evidenceRecords.capturedAt, ocrResultJson: evidenceRecords.ocrResultJson, watermarkJson: evidenceRecords.watermarkJson }).from(evidenceRecords).where(and(eq(evidenceRecords.projectId, input.projectId), eq(evidenceRecords.sourceType, "purchase"))).orderBy(desc(evidenceRecords.capturedAt)).limit(30);
    return Promise.all(rows.map(async row => {
      const file = await storageGet(row.fileKey);
      return { id: row.id, fileName: row.fileName, capturedAt: row.capturedAt, ocrSummary: getPurchaseOcrSummary(row.ocrResultJson), description: (() => { try { return (JSON.parse(row.watermarkJson ?? "{}") as { description?: string }).description ?? "采购影像"; } catch { return "采购影像"; } })(), url: file.url };
    }));
  }),

  /** 小额物资不走申请单，但必须拍照/OCR 后由人工补全；创建后仍进入主管确认状态。 */
  createSmallDirectOrder: protectedProcedure.input(smallDirectPurchaseInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const limit = await getSmallDirectPurchaseLimit(db);
    if (roundMoney(input.amount) > limit) throw new TRPCError({ code: "BAD_REQUEST", message: `小额免申请采购金额不得超过 ¥${limit.toFixed(2)}，请先提交采购申请` });
    const [category] = await db.select({ id: purchaseCategories.id }).from(purchaseCategories).where(and(eq(purchaseCategories.id, input.categoryId), eq(purchaseCategories.status, "active"))).limit(1);
    if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的固定采购类别" });
    const [evidence] = await db.select({ id: evidenceRecords.id, sourceType: evidenceRecords.sourceType, ocrResultJson: evidenceRecords.ocrResultJson }).from(evidenceRecords).where(and(eq(evidenceRecords.id, input.evidenceId), eq(evidenceRecords.projectId, input.projectId))).limit(1);
    if (!evidence || evidence.sourceType !== "purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择当前项目已归档的采购影像" });
    if (input.supplierId) {
      const [supplier] = await db.select({ id: suppliers.id, status: suppliers.status }).from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!supplier || supplier.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效供应商" });
    }
    const [created] = await db.insert(purchaseOrders).values({ orderNo: createBusinessNo("SPD"), requestId: null, projectId: input.projectId, procurementMode: "small_direct", categoryId: input.categoryId, itemDescription: input.itemDescription, evidenceId: input.evidenceId, ocrSummary: getPurchaseOcrSummary(evidence.ocrResultJson), supplierId: input.supplierId ?? null, amount: String(roundMoney(input.amount)), orderedAt: new Date(input.orderedAt), status: "draft", createdBy: user.id }).$returningId();
    const orderId = Number(created?.id);
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "create_small_direct_order", targetType: "purchase_order", targetId: String(orderId), summary: `创建小额免申请采购订单：¥${roundMoney(input.amount)}，阈值 ¥${limit.toFixed(2)}，已关联影像 #${input.evidenceId}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, projectId: input.projectId, module: "purchasing", eventCode: "purchase_order_small_direct_submitted", targetType: "purchase_order", targetId: String(orderId), title: "小额采购订单待主管确认", content: `金额 ¥${roundMoney(input.amount).toFixed(2)}，已附现场影像与 OCR 辅助信息，请审核。`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true, id: orderId, limit };
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
    await db.insert(purchaseOrders).values({ orderNo: input.orderNo ?? createBusinessNo("PO"), requestId: input.requestId, projectId: input.projectId, supplierId: input.supplierId ?? null, amount: String(roundMoney(input.amount)), orderedAt: new Date(input.orderedAt), status: "draft", createdBy: user.id });
    await db.update(purchaseRequests).set({ status: "ordered" }).where(eq(purchaseRequests.id, input.requestId));
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "create_order", targetType: "purchase_order", targetId: String(input.requestId), summary: "已从采购申请创建采购订单" });
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
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "transition_order", targetType: "purchase_order", targetId: String(input.id), summary: `采购订单状态变更为：${input.targetStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "purchasing", eventCode: `purchase_order_${input.targetStatus}`, targetType: "purchase_order", targetId: String(input.id), title: `采购订单已${input.targetStatus}`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
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
    await db.insert(inventoryTransactions).values({ projectId: input.projectId, requestId: input.requestId ?? null, purchaseOrderId: input.purchaseOrderId ?? null, transactionNo: createBusinessNo("INV"), transactionType: input.transactionType, itemName: input.itemName, unit: input.unit, quantity: String(input.quantity), unitCost: String(roundMoney(input.unitCost)), amount: String(amount), occurredAt: new Date(input.occurredAt), operatorId: user.id, remarks: input.remarks ?? null });
    if (input.transactionType === "inbound" && input.requestId) await db.update(purchaseRequests).set({ status: "stocked", stockedBy: user.id, stockedAt: new Date() }).where(eq(purchaseRequests.id, input.requestId));
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: `inventory_${input.transactionType}`, targetType: "inventory_transaction", targetId: input.itemName, summary: `登记库存${input.transactionType === "inbound" ? "入库" : input.transactionType === "outbound" ? "领用" : "退库"}：${input.itemName}` });
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
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "transition_takeoff", targetType: "measurement_takeoff", targetId: String(input.id), summary: `项目收方状态变更为：${input.targetStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: `takeoff_${input.targetStatus}`, targetType: "measurement_takeoff", targetId: String(input.id), title: `项目收方已${input.targetStatus}`, deepLink: "/mobile/measurement" }).catch(() => undefined);
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
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "transition_claim", targetType: "measurement_claim", targetId: String(input.id), summary: `工程计量状态变更为：${input.targetStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: `measurement_${input.targetStatus}`, targetType: "measurement_claim", targetId: String(input.id), title: `工程计量已${input.targetStatus}`, deepLink: "/mobile/measurement" }).catch(() => undefined);
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
    return { canMaintain: canAdjustFinancialRecord(roleCodes) };
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

  /** 发票台账按项目受控读取，统计口径与财务流水分离，避免把发票金额重复记入成本。 */
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
    const active = invoices.filter(invoice => !["void", "red_flushed"].includes(invoice.status));
    const byType = active.reduce<Record<string, number>>((summary, invoice) => { summary[invoice.invoiceType] = roundMoney((summary[invoice.invoiceType] ?? 0) + Number(invoice.amount)); return summary; }, {});
    return {
      invoices,
      summary: {
        totalAmount: roundMoney(active.reduce((sum, invoice) => sum + Number(invoice.amount), 0)),
        verifiedAmount: roundMoney(active.filter(invoice => invoice.status === "verified").reduce((sum, invoice) => sum + Number(invoice.amount), 0)),
        pendingAmount: roundMoney(active.filter(invoice => invoice.status === "issued").reduce((sum, invoice) => sum + Number(invoice.amount), 0)),
        byType,
      },
    };
  }),

  saveInvoice: protectedProcedure.input(financialInvoiceInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canAdjustFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "发票台账维护仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    if (input.taxAmount > input.amount) throw new TRPCError({ code: "BAD_REQUEST", message: "税额不得高于价税合计金额" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    if (input.financialRecordId) {
      const [record] = await db.select({ projectId: financialRecords.projectId }).from(financialRecords).where(eq(financialRecords.id, input.financialRecordId)).limit(1);
      if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目关联的财务流水" });
    }
    const values = { projectId: input.projectId, financialRecordId: input.financialRecordId ?? null, invoiceNo: input.invoiceNo, invoiceCode: input.invoiceCode ?? null, counterpartyName: input.counterpartyName, invoiceType: input.invoiceType, direction: input.direction, amount: String(roundMoney(input.amount)), taxAmount: String(roundMoney(input.taxAmount)), taxRate: String(input.taxRate), issuedAt: toBusinessDate(input.issuedAt), evidenceId: input.evidenceId ?? null };
    if (input.id) {
      const [existing] = await db.select().from(financialInvoices).where(eq(financialInvoices.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目发票" });
      if (existing.status !== "issued") throw new TRPCError({ code: "CONFLICT", message: "已认证、作废或红冲发票不可直接修改" });
      await db.update(financialInvoices).set(values).where(and(eq(financialInvoices.id, input.id), eq(financialInvoices.status, "issued")));
    } else {
      await db.insert(financialInvoices).values({ ...values, status: "issued", createdBy: user.id });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: input.id ? "update_invoice" : "create_invoice", targetType: "financial_invoice", targetId: input.invoiceNo, summary: `${input.id ? "维护" : "登记"}${input.direction === "expense" ? "成本" : "收入"}发票：${input.invoiceNo}` });
    return { success: true };
  }),

  transitionInvoice: protectedProcedure.input(financialInvoiceTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canAdjustFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "发票认证、作废和红冲仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [invoice] = await db.select().from(financialInvoices).where(eq(financialInvoices.id, input.id)).limit(1);
    if (!invoice || invoice.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目发票" });
    if (invoice.status !== "issued") throw new TRPCError({ code: "CONFLICT", message: "当前发票状态不允许再次操作" });
    if (["void", "red_flushed"].includes(input.targetStatus) && !input.reason) throw new TRPCError({ code: "BAD_REQUEST", message: "作废或红冲必须填写原因" });
    await db.update(financialInvoices).set({ status: input.targetStatus, verifiedAt: input.targetStatus === "verified" ? new Date() : null, voidReason: input.reason ?? null }).where(and(eq(financialInvoices.id, input.id), eq(financialInvoices.status, "issued")));
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: `invoice_${input.targetStatus}`, targetType: "financial_invoice", targetId: String(input.id), summary: `发票 ${invoice.invoiceNo} 状态变更为：${input.targetStatus}` });
    return { success: true };
  }),

  closeDailyAccount: protectedProcedure.input(dailyClosingInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canAdjustFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "每日会计日结仅限会计或财务负责人" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const closingDate = toBusinessDate(input.closingDate);
    const endExclusive = new Date(closingDate.getTime() + 86_400_000);
    const [existing] = await db.select({ id: dailyAccountingClosures.id }).from(dailyAccountingClosures).where(and(eq(dailyAccountingClosures.projectId, input.projectId), eq(dailyAccountingClosures.closingDate, closingDate))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "该项目日期已完成日结，不可重复封存" });
    const records = await db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, closingDate), lt(financialRecords.occurredAt, endExclusive))).orderBy(financialRecords.occurredAt, financialRecords.id);
    const invoices = await db.select().from(financialInvoices).where(and(eq(financialInvoices.projectId, input.projectId), eq(financialInvoices.issuedAt, closingDate))).orderBy(financialInvoices.id);
    const activeRecords = records.filter(record => record.settlementStatus !== "void");
    const snapshot = { projectId: input.projectId, closingDate: input.closingDate, records: activeRecords.map(record => ({ id: record.id, recordNo: record.recordNo, direction: record.direction, category: record.category, amount: record.amount, settlementStatus: record.settlementStatus })), invoices: invoices.map(invoice => ({ id: invoice.id, invoiceNo: invoice.invoiceNo, invoiceType: invoice.invoiceType, amount: invoice.amount, status: invoice.status })) };
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotHash = createHash("sha256").update(snapshotJson).digest("hex");
    const totalIncome = roundMoney(activeRecords.filter(record => record.direction === "income").reduce((sum, record) => sum + Number(record.amount), 0));
    const totalExpense = roundMoney(activeRecords.filter(record => record.direction === "expense").reduce((sum, record) => sum + Number(record.amount), 0));
    const activeInvoices = invoices.filter(invoice => !["void", "red_flushed"].includes(invoice.status));
    const closingNo = createBusinessNo("DAY");
    await db.insert(dailyAccountingClosures).values({ closingNo, projectId: input.projectId, closingDate, totalIncome: String(totalIncome), totalExpense: String(totalExpense), recordCount: activeRecords.length, invoiceCount: activeInvoices.length, invoiceAmount: String(roundMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0))), snapshotHash, snapshotJson, status: "closed", closedBy: user.id, closedAt: new Date() });
    const [closing] = await db.select({ id: dailyAccountingClosures.id }).from(dailyAccountingClosures).where(eq(dailyAccountingClosures.closingNo, closingNo)).limit(1);
    if (closing && activeRecords.length) await db.update(financialRecords).set({ dailyClosingId: closing.id }).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, closingDate), lt(financialRecords.occurredAt, endExclusive)));
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "close_daily_account", targetType: "daily_accounting_closure", targetId: closingNo, summary: `完成项目日结：${input.closingDate}，支出 ${totalExpense}` });
    return { success: true, closingNo, totalIncome, totalExpense, recordCount: activeRecords.length };
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
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    /** 普通管理人员只能创建待结清原始流水，结算或作废属于高影响财务操作。 */
    if (input.settlementStatus !== "unpaid") await assertSuperAdmin(ctx);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await db.insert(financialRecords).values({ recordNo: createBusinessNo("FIN"), projectId: input.projectId, direction: input.direction, category: input.category, amount: String(roundMoney(input.amount)), occurredAt: new Date(input.occurredAt), settlementStatus: input.settlementStatus, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, evidenceId: input.evidenceId ?? null, remarks: input.remarks ?? null });
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "create_record", targetType: "financial_record", targetId: input.category, summary: `登记项目${input.direction === "income" ? "收入" : "支出"}流水：${input.category}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "finance", eventCode: `financial_${input.direction}`, targetType: "financial_record", targetId: input.category, title: `项目${input.direction === "income" ? "收入" : "支出"}流水已登记`, deepLink: "/mobile/finance" }).catch(() => undefined);
    return { success: true };
  }),

  /** 作废未支付的人工财务流水；来源于计量、采购等业务单据的自动流水不得在此入口调整。 */
  voidRecord: protectedProcedure.input(financialRecordVoidInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertFinanceAccess(ctx);
    if (!canAdjustFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财务流水作废仅限会计或财务负责人办理" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(financialRecords).where(eq(financialRecords.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的财务流水" });
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
    if (!canAdjustFinancialRecord(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "财务流水冲销仅限会计或财务负责人办理" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(financialRecords).where(eq(financialRecords.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目的财务流水" });
    if (record.sourceType) throw new TRPCError({ code: "CONFLICT", message: "来源业务流水须在原业务模块按流程调整，不支持在财务台账直接冲销" });
    if (record.settlementStatus !== "paid") throw new TRPCError({ code: "CONFLICT", message: "仅已支付的人工财务流水可以冲销；未支付流水请使用作废流程" });
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
    const records = await db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))).orderBy(desc(financialRecords.occurredAt));
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
    const payableAmount = roundMoney(records.filter(item => item.direction === "expense" && ["unpaid", "partial"].includes(item.settlementStatus)).reduce((sum, item) => sum + Number(item.amount), 0));
    const cashInflowAmount = roundMoney(records.filter(item => item.direction === "income" && item.settlementStatus !== "void" && (item.sourceType === "measurement_payment" || (item.sourceType !== "measurement_claim" && item.settlementStatus === "paid"))).reduce((sum, item) => sum + Number(item.amount), 0));
    const cashOutflowAmount = roundMoney(records.filter(item => item.direction === "expense" && item.settlementStatus === "paid").reduce((sum, item) => sum + Number(item.amount), 0));
    return { incomeAmount, expenseAmount, profitAmount: roundMoney(incomeAmount - expenseAmount), receivableAmount, payableAmount, cashInflowAmount, cashOutflowAmount, netCashFlowAmount: roundMoney(cashInflowAmount - cashOutflowAmount), records };
  }),
});
