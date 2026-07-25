import { and, desc, eq, gte, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  auditLogs,
  financialRecords,
  inventoryTransactions,
  measurementClaims,
  projects,
  purchaseCategories,
  purchaseOrders,
  purchaseRequests,
  suppliers,
} from "../../drizzle/schema";
import {
  assertApprovalTransition,
  assertPurchaseOrderStatusTransition,
  assertPurchaseRequestStatusTransition,
  ConstructionDomainError,
} from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getCurrentDataScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyWecomBusinessEvent } from "../services/businessNotifier";

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

/** 将领域异常转换为稳定的业务错误，禁止将内部堆栈返回移动端。 */
function throwDomainAsBadRequest(error: unknown): never {
  if (error instanceof ConstructionDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
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
  const allowed = ["MEASUREMENT_MANAGER", "FINANCE_MANAGER", "PROJECT_MANAGER", "ACCOUNTANT"];
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

  /** 采购类别由基础数据固定为 12 类，只读返回，业务路由不允许改变标准编码。 */
  categories: protectedProcedure.query(async ({ ctx }) => {
    await assertPurchaseAccess(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(purchaseCategories).where(eq(purchaseCategories.status, "active")).orderBy(purchaseCategories.sortOrder, purchaseCategories.id);
  }),

  listSuppliers: protectedProcedure.query(async ({ ctx }) => {
    await assertPurchaseAccess(ctx);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(suppliers).where(eq(suppliers.status, "active")).orderBy(suppliers.name);
  }),

  /** 保存供应商基础资料；联系方式仅允许以脱敏形式进入本系统。 */
  saveSupplier: protectedProcedure.input(supplierInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertPurchaseAccess(ctx);
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
    if (input.id) await db.update(suppliers).set(values).where(eq(suppliers.id, input.id));
    else await db.insert(suppliers).values(values);
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: input.id ? "update_supplier" : "create_supplier", targetType: "supplier", targetId: String(input.id ?? input.name), summary: `${input.id ? "维护" : "新建"}供应商：${input.name}` });
    return { success: true };
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
      await db.update(purchaseRequests).set({ ...values, status: request.status === "rejected" ? "draft" : "draft" }).where(eq(purchaseRequests.id, input.id));
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
    await db.update(purchaseRequests).set(patch).where(eq(purchaseRequests.id, input.id));
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "transition_request", targetType: "purchase_request", targetId: String(input.id), summary: `采购申请状态变更为：${input.targetStatus}` });
    void notifyWecomBusinessEvent({ userId: user.id, module: "purchasing", eventCode: `purchase_request_${input.targetStatus}`, targetType: "purchase_request", targetId: String(input.id), title: `采购申请已${input.targetStatus}`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
    return { success: true };
  }),

  listOrders: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPurchaseAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, input.projectId)).orderBy(desc(purchaseOrders.updatedAt));
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
    await db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, input.id));
    if (input.targetStatus === "received") await db.update(purchaseRequests).set({ status: "received" }).where(eq(purchaseRequests.id, order.requestId));
    await db.insert(auditLogs).values({ userId: user.id, module: "purchasing", action: "transition_order", targetType: "purchase_order", targetId: String(input.id), summary: `采购订单状态变更为：${input.targetStatus}` });
    void notifyWecomBusinessEvent({ userId: user.id, module: "purchasing", eventCode: `purchase_order_${input.targetStatus}`, targetType: "purchase_order", targetId: String(input.id), title: `采购订单已${input.targetStatus}`, deepLink: "/mobile/purchasing" }).catch(() => undefined);
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
    void notifyWecomBusinessEvent({ userId: user.id, module: "purchasing", eventCode: "purchase_order_settlement", targetType: "purchase_order", targetId: sourceId, title: "采购订单已登记结算", deepLink: "/mobile/purchasing" }).catch(() => undefined);
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

  listClaims: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertMeasurementAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    return db.select().from(measurementClaims).where(eq(measurementClaims.projectId, input.projectId)).orderBy(desc(measurementClaims.updatedAt));
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
      await db.update(measurementClaims).set({ ...values, status: "draft", reviewNote: null }).where(eq(measurementClaims.id, input.id));
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
    await db.update(measurementClaims).set(patch).where(eq(measurementClaims.id, input.id));
    if (input.targetStatus === "settled") {
      const sourceId = String(input.id);
      const existing = await db.select({ id: financialRecords.id }).from(financialRecords).where(and(eq(financialRecords.sourceType, "measurement_claim"), eq(financialRecords.sourceId, sourceId))).limit(1);
      if (existing.length === 0) {
        const incomeAmount = Number(claim.approvedAmount ?? claim.declaredAmount);
        await db.insert(financialRecords).values({ recordNo: createBusinessNo("FIN"), projectId: input.projectId, direction: "income", category: "工程计量收入", amount: String(roundMoney(incomeAmount)), occurredAt: now, settlementStatus: "unpaid", sourceType: "measurement_claim", sourceId, remarks: `由工程计量申报 ${claim.claimNo} 自动确认收入` });
      }
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "measurement", action: "transition_claim", targetType: "measurement_claim", targetId: String(input.id), summary: `工程计量状态变更为：${input.targetStatus}` });
    void notifyWecomBusinessEvent({ userId: user.id, module: "measurement", eventCode: `measurement_${input.targetStatus}`, targetType: "measurement_claim", targetId: String(input.id), title: `工程计量已${input.targetStatus}`, deepLink: "/mobile/measurement" }).catch(() => undefined);
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
    void notifyWecomBusinessEvent({ userId: user.id, module: "measurement", eventCode: "measurement_payment", targetType: "measurement_claim", targetId: sourceId, title: "工程计量已登记回款", deepLink: "/mobile/measurement" }).catch(() => undefined);
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

  listRecords: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), period: periodSchema.optional() })).query(async ({ ctx, input }) => {
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    if (!input.period) return db.select().from(financialRecords).where(eq(financialRecords.projectId, input.projectId)).orderBy(desc(financialRecords.occurredAt));
    const range = getMonthRange(input.period);
    return db.select().from(financialRecords).where(and(eq(financialRecords.projectId, input.projectId), gte(financialRecords.occurredAt, range.start), lt(financialRecords.occurredAt, range.endExclusive))).orderBy(desc(financialRecords.occurredAt));
  }),

  /** 登记真实资金流水，项目、金额、发生时间和结算状态均经服务端校验并审计。 */
  saveRecord: protectedProcedure.input(financialRecordInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    await assertFinanceAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    await db.insert(financialRecords).values({ recordNo: createBusinessNo("FIN"), projectId: input.projectId, direction: input.direction, category: input.category, amount: String(roundMoney(input.amount)), occurredAt: new Date(input.occurredAt), settlementStatus: input.settlementStatus, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, evidenceId: input.evidenceId ?? null, remarks: input.remarks ?? null });
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "create_record", targetType: "financial_record", targetId: input.category, summary: `登记项目${input.direction === "income" ? "收入" : "支出"}流水：${input.category}` });
    void notifyWecomBusinessEvent({ userId: user.id, module: "finance", eventCode: `financial_${input.direction}`, targetType: "financial_record", targetId: input.category, title: `项目${input.direction === "income" ? "收入" : "支出"}流水已登记`, deepLink: "/mobile/finance" }).catch(() => undefined);
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
    await db.update(financialRecords).set({ settlementStatus: "void" }).where(eq(financialRecords.id, record.id));
    await db.insert(auditLogs).values({ userId: user.id, module: "finance", action: "void_financial_record", targetType: "financial_record", targetId: String(record.id), summary: `财务流水已作废：${record.recordNo}；原因：${input.reason}` });
    void notifyWecomBusinessEvent({ userId: user.id, module: "finance", eventCode: "financial_voided", targetType: "financial_record", targetId: String(record.id), title: "项目财务流水已作废", deepLink: "/mobile/finance" }).catch(() => undefined);
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
    void notifyWecomBusinessEvent({ userId: user.id, module: "finance", eventCode: "financial_reversed", targetType: "financial_record", targetId: String(record.id), title: "项目财务流水已冲销", deepLink: "/mobile/finance" }).catch(() => undefined);
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
