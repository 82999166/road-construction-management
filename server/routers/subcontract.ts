import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, dailyAccountingClosures, financialRecords, measurementTakeoffRecords, subcontractPackages, subcontractPaymentSettlements, subcontractTeams } from "../../drizzle/schema";
import { getBusinessStatusLabel } from "../../shared/domain";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { encryptSecret, maskSecret } from "../services/secretVault";

const moneySchema = z.number().finite().min(0).max(999999999999.99);
const quantitySchema = z.number().finite().positive().max(999999999999.999);
const packageStatusSchema = z.enum(["draft", "allocated", "confirmed", "settled", "void"]);
const teamStatusSchema = z.enum(["active", "suspended", "closed"]);
const settlementStatusSchema = z.enum(["draft", "submitted", "approved", "paid", "void"]);
const paymentMethodSchema = z.enum(["bank_transfer", "corporate_account", "cash", "wechat", "alipay", "other"]);
const invoiceStatusSchema = z.enum(["missing", "attached", "verified", "rejected"]);

/** 金额统一由服务端计算并以两位小数固化，禁止浏览器以浮点结果直接入库。 */
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 生成分包批次号，避免客户端编号在多人并行分配工程量时冲突。 */
function createPackageNo() {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SP-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 分包付款结算单独立编号，禁止客户端使用包件号或人工编号覆盖历史付款链。 */
function createSubcontractSettlementNo() {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SPAY-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/** 分包既服务于计量也服务于财务结算，两类受授权部门均可进入，具体状态操作仍按岗位收紧。 */
async function assertSubcontractAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0]) {
  try {
    await assertDepartmentBusinessAccess(ctx, "MEASUREMENT");
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
    await assertDepartmentBusinessAccess(ctx, "FINANCE");
  }
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["MEASUREMENT_MANAGER", "PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT", "CASHIER"];
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获工程结算与分包数据访问授权" });
  }
  return roleCodes;
}

/** 项目经理或施工负责人可维护施工队台账和未分配的批次草稿。 */
function canMaintainSubcontractDraft(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER"].includes(role));
}

/** 计量负责人或项目负责人复核分配结果，避免单人分配后直接作为结算依据。 */
function canConfirmSubcontract(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["MEASUREMENT_MANAGER", "PROJECT_MANAGER"].includes(role));
}

/** 最终结算金额确认严格由会计或财务负责人办理。 */
function canSettleSubcontract(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
}

/** 付款由财务负责人或出纳执行；会计审核与实际付款职责分离。 */
function canPaySubcontract(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["FINANCE_MANAGER", "CASHIER"].includes(role));
}

function canViewFullSubcontractAccount(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER"].includes(role));
}

function toSafeTeam(row: typeof subcontractTeams.$inferSelect) {
  const { contactPhoneEncrypted: _encrypted, ...safe } = row;
  return safe;
}

const teamInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  teamName: z.string().trim().min(2, "请填写施工队名称").max(200),
  contactName: z.string().trim().max(100).optional().nullable(),
  /** 留空表示编辑时保留既有密文；传入空字符串才清除联系人电话。 */
  contactPhone: z.string().trim().min(5, "请填写有效联系人电话").max(32).optional(),
  status: teamStatusSchema.default("active"),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const packageInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  measurementTakeoffId: z.number().int().positive().nullable().optional(),
  subcontractTeamId: z.number().int().positive(),
  workItem: z.string().trim().min(2, "请填写分包工作项").max(200),
  workLocation: z.string().trim().max(200).optional().nullable(),
  unit: z.enum(["m3", "m2", "m", "t", "piece", "set", "other"]),
  quantity: quantitySchema,
  /** 关联收方时服务端将以收方单价覆盖该字段，防止将上游金额低估或高估。 */
  upstreamUnitPrice: moneySchema,
  subcontractUnitPrice: moneySchema,
  priceExceptionReason: z.string().trim().min(5, "分包价高于上游单价时必须说明原因").max(500).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const packageTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: packageStatusSchema,
  remarks: z.string().trim().max(500).optional().nullable(),
});

const settlementDraftInput = z.object({
  projectId: z.number().int().positive(),
  packageId: z.number().int().positive(),
  payeeName: z.string().trim().min(2, "请填写收款人").max(128),
  payeeAccount: z.string().trim().max(160).optional().nullable(),
  paymentMethod: paymentMethodSchema.default("bank_transfer"),
  manualDeductionAmount: moneySchema.default(0),
  invoiceStatus: invoiceStatusSchema.default("missing"),
  invoiceNo: z.string().trim().max(128).optional().nullable(),
  invoiceEvidenceId: z.number().int().positive().optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const settlementTransitionInput = z.object({
  projectId: z.number().int().positive(),
  id: z.number().int().positive(),
  targetStatus: settlementStatusSchema,
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "付款日期格式应为 YYYY-MM-DD").optional(),
  paymentReference: z.string().trim().max(128).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

/**
 * 工程结算与分包：工程量按施工队分批下达，并保留上游、分包与差额的服务端快照。
 * 浏览器只能读取手机号掩码；分包金额及状态机均不信任客户端结果。
 */
export const subcontractRouter = router({
  capabilities: protectedProcedure.query(async ({ ctx }) => {
    const roleCodes = await assertSubcontractAccess(ctx);
    return {
      canMaintainDraft: canMaintainSubcontractDraft(roleCodes),
      canConfirm: canConfirmSubcontract(roleCodes),
      canSettle: canSettleSubcontract(roleCodes),
      canPay: canPaySubcontract(roleCodes),
      canViewFullAccount: canViewFullSubcontractAccount(roleCodes),
    };
  }),

  listTeams: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), status: teamStatusSchema.optional() })).query(async ({ ctx, input }) => {
    await assertSubcontractAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const where = input.status
      ? and(eq(subcontractTeams.projectId, input.projectId), eq(subcontractTeams.status, input.status))
      : eq(subcontractTeams.projectId, input.projectId);
    const rows = await db.select().from(subcontractTeams).where(where).orderBy(desc(subcontractTeams.updatedAt));
    return rows.map(toSafeTeam);
  }),

  saveTeam: protectedProcedure.input(teamInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertSubcontractAccess(ctx);
    if (!canMaintainSubcontractDraft(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "项目经理或施工负责人方可维护施工队台账" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

    let existing: typeof subcontractTeams.$inferSelect | undefined;
    if (input.id) {
      const [row] = await db.select().from(subcontractTeams).where(eq(subcontractTeams.id, input.id)).limit(1);
      if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目施工队" });
      existing = row;
    }
    const values = {
      projectId: input.projectId,
      teamName: input.teamName,
      contactName: input.contactName?.trim() || null,
      contactPhoneEncrypted: input.contactPhone === undefined ? existing?.contactPhoneEncrypted ?? null : input.contactPhone ? encryptSecret(input.contactPhone) : null,
      contactPhoneMasked: input.contactPhone === undefined ? existing?.contactPhoneMasked ?? null : input.contactPhone ? maskSecret(input.contactPhone) : null,
      status: input.status,
      remarks: input.remarks?.trim() || null,
    };
    let teamId = input.id;
    if (input.id) {
      await db.update(subcontractTeams).set(values).where(eq(subcontractTeams.id, input.id));
    } else {
      await db.insert(subcontractTeams).values({ ...values, createdBy: user.id });
      const [created] = await db.select({ id: subcontractTeams.id }).from(subcontractTeams).where(and(eq(subcontractTeams.projectId, input.projectId), eq(subcontractTeams.teamName, input.teamName))).limit(1);
      teamId = created?.id;
    }
    if (!teamId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "施工队保存后未找到记录" });
    await db.insert(auditLogs).values({ userId: user.id, module: "subcontract", action: input.id ? "update_team" : "create_team", targetType: "subcontract_team", targetId: String(teamId), summary: `${input.id ? "维护" : "新建"}施工队台账：${input.teamName}` });
    return { success: true, teamId };
  }),

  listPackages: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), subcontractTeamId: z.number().int().positive().optional(), status: packageStatusSchema.optional() })).query(async ({ ctx, input }) => {
    await assertSubcontractAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const predicates = [eq(subcontractPackages.projectId, input.projectId)];
    if (input.subcontractTeamId) predicates.push(eq(subcontractPackages.subcontractTeamId, input.subcontractTeamId));
    if (input.status) predicates.push(eq(subcontractPackages.status, input.status));
    const [rows, teams, takeoffs] = await Promise.all([
      db.select().from(subcontractPackages).where(and(...predicates)).orderBy(desc(subcontractPackages.updatedAt)),
      db.select({ id: subcontractTeams.id, teamName: subcontractTeams.teamName, status: subcontractTeams.status }).from(subcontractTeams).where(eq(subcontractTeams.projectId, input.projectId)),
      db.select({ id: measurementTakeoffRecords.id, takeoffNo: measurementTakeoffRecords.takeoffNo, status: measurementTakeoffRecords.status }).from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.projectId, input.projectId)),
    ]);
    const teamById = new Map(teams.map(team => [team.id, team]));
    const takeoffById = new Map(takeoffs.map(takeoff => [takeoff.id, takeoff]));
    return rows.map(row => ({
      ...row,
      teamName: teamById.get(row.subcontractTeamId)?.teamName ?? "施工队已停用或不存在",
      teamStatus: teamById.get(row.subcontractTeamId)?.status ?? null,
      takeoffNo: row.measurementTakeoffId ? takeoffById.get(row.measurementTakeoffId)?.takeoffNo ?? null : null,
      takeoffStatus: row.measurementTakeoffId ? takeoffById.get(row.measurementTakeoffId)?.status ?? null : null,
    }));
  }),

  savePackage: protectedProcedure.input(packageInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertSubcontractAccess(ctx);
    if (!canMaintainSubcontractDraft(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "项目经理或施工负责人方可维护分包草稿" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });

    let existing: typeof subcontractPackages.$inferSelect | undefined;
    if (input.id) {
      const [row] = await db.select().from(subcontractPackages).where(eq(subcontractPackages.id, input.id)).limit(1);
      if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目分包批次" });
      if (row.status !== "draft") throw new TRPCError({ code: "CONFLICT", message: "仅草稿分包批次可修改" });
      existing = row;
    }

    const [team] = await db.select().from(subcontractTeams).where(eq(subcontractTeams.id, input.subcontractTeamId)).limit(1);
    if (!team || team.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目施工队" });
    if (team.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "停用或已关闭的施工队不可承接新的分包批次" });

    let takeoff: typeof measurementTakeoffRecords.$inferSelect | undefined;
    if (input.measurementTakeoffId) {
      const [row] = await db.select().from(measurementTakeoffRecords).where(eq(measurementTakeoffRecords.id, input.measurementTakeoffId)).limit(1);
      if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目关联收方记录" });
      if (!(["approved", "locked"] as string[]).includes(row.status)) throw new TRPCError({ code: "CONFLICT", message: "仅已审核或已锁定收方可作为分包工程量依据" });
      takeoff = row;
      if (input.unit !== row.unit) throw new TRPCError({ code: "BAD_REQUEST", message: "分包单位必须与关联收方单位一致" });
      const allocatedRows = await db.select({ id: subcontractPackages.id, quantity: subcontractPackages.quantity, status: subcontractPackages.status }).from(subcontractPackages).where(eq(subcontractPackages.measurementTakeoffId, row.id));
      const allocatedQuantity = allocatedRows
        .filter(item => item.id !== input.id && item.status !== "void")
        .reduce((sum, item) => sum + Number(item.quantity), 0);
      if (allocatedQuantity + input.quantity > Number(row.quantity) + 0.000001) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `本次分包工程量超过关联收方可分配余额（剩余 ${Math.max(0, Number(row.quantity) - allocatedQuantity).toFixed(3)}）` });
      }
    }

    const upstreamUnitPrice = takeoff ? Number(takeoff.unitPrice) : input.upstreamUnitPrice;
    const upstreamAmount = roundMoney(input.quantity * upstreamUnitPrice);
    const subcontractAmount = roundMoney(input.quantity * input.subcontractUnitPrice);
    const marginAmount = roundMoney(upstreamAmount - subcontractAmount);
    // 兼容已发布的PC/手机草稿表单：在增加专用字段前，业务人员一直在备注中填写变更/抢险说明。
    // 保存时归档到独立字段，后续确认仍必须由项目与计量双岗复核。
    const priceExceptionReason = input.priceExceptionReason?.trim() || input.remarks?.trim() || null;
    if (marginAmount < 0 && !priceExceptionReason) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "分包价高于上游单价时，请在备注中填写价格倒挂原因后再保存" });
    }
    const values = {
      projectId: input.projectId,
      measurementTakeoffId: input.measurementTakeoffId ?? null,
      subcontractTeamId: input.subcontractTeamId,
      workItem: takeoff?.workItem ?? input.workItem,
      workLocation: (takeoff?.workLocation ?? input.workLocation?.trim()) || null,
      unit: input.unit,
      quantity: String(input.quantity),
      upstreamUnitPrice: String(roundMoney(upstreamUnitPrice)),
      subcontractUnitPrice: String(roundMoney(input.subcontractUnitPrice)),
      upstreamAmount: String(upstreamAmount),
      subcontractAmount: String(subcontractAmount),
      marginAmount: String(marginAmount),
      priceExceptionReason: marginAmount < 0 ? priceExceptionReason : null,
      remarks: input.remarks?.trim() || null,
    };
    let packageId = input.id;
    if (input.id) {
      await db.update(subcontractPackages).set(values).where(and(eq(subcontractPackages.id, input.id), eq(subcontractPackages.status, "draft")));
    } else {
      const packageNo = createPackageNo();
      await db.insert(subcontractPackages).values({ ...values, packageNo, status: "draft", createdBy: user.id });
      const [created] = await db.select({ id: subcontractPackages.id }).from(subcontractPackages).where(eq(subcontractPackages.packageNo, packageNo)).limit(1);
      packageId = created?.id;
    }
    if (!packageId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "分包批次保存后未找到记录" });
    await db.insert(auditLogs).values({ userId: user.id, module: "subcontract", action: input.id ? "update_package" : "create_package", targetType: "subcontract_package", targetId: String(packageId), summary: `${input.id ? "维护" : "新建"}分包批次：${values.workItem}，测算差额 ${marginAmount}` });
    return { success: true, packageId, upstreamAmount, subcontractAmount, marginAmount };
  }),

  transitionPackage: protectedProcedure.input(packageTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertSubcontractAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [record] = await db.select().from(subcontractPackages).where(eq(subcontractPackages.id, input.id)).limit(1);
    if (!record || record.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目分包批次" });
    const allowedTargets: Record<string, string[]> = {
      draft: ["allocated", "void"],
      allocated: ["confirmed", "void"],
      confirmed: ["void"],
    };
    if (input.targetStatus === "settled") {
      throw new TRPCError({ code: "CONFLICT", message: "已确认分包包件必须通过应付结算单完成审核与付款，不能直接标记结算" });
    }
    if (!allowedTargets[record.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前分包批次状态不允许该操作" });
    if (["allocated"].includes(input.targetStatus) && !canMaintainSubcontractDraft(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无分包分配权限" });
    if (["confirmed"].includes(input.targetStatus) && !canConfirmSubcontract(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无分包复核确认权限" });
    if (["settled"].includes(input.targetStatus) && !canSettleSubcontract(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无分包最终结算确认权限" });
    if (input.targetStatus === "void") {
      const canVoid = record.status === "confirmed" ? canSettleSubcontract(roleCodes) : canMaintainSubcontractDraft(roleCodes) || canConfirmSubcontract(roleCodes);
      if (!canVoid) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无此状态下的分包作废权限" });
    }
    const now = new Date();
    const patch: Partial<typeof subcontractPackages.$inferInsert> = { status: input.targetStatus };
    if (input.remarks !== undefined) patch.remarks = input.remarks?.trim() || null;
    if (input.targetStatus === "allocated") patch.allocatedAt = now;
    if (input.targetStatus === "confirmed") {
      if (Number(record.marginAmount) < 0 && !record.priceExceptionReason) {
        throw new TRPCError({ code: "CONFLICT", message: "价格倒挂的分包包件缺少原因，不能确认" });
      }
      patch.confirmedBy = user.id;
      patch.confirmedAt = now;
      if (Number(record.marginAmount) < 0) {
        patch.priceExceptionReviewedBy = user.id;
        patch.priceExceptionReviewedAt = now;
      }
    }
    const result = await db.update(subcontractPackages).set(patch).where(and(eq(subcontractPackages.id, input.id), eq(subcontractPackages.status, record.status)));
    const header = Array.isArray(result) ? result[0] : result;
    if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
      throw new TRPCError({ code: "CONFLICT", message: "分包批次已被其他用户更新，请刷新后重试" });
    }
    const packageStatusLabel = getBusinessStatusLabel(input.targetStatus);
    await db.insert(auditLogs).values({ userId: user.id, module: "subcontract", action: "transition_package", targetType: "subcontract_package", targetId: String(record.id), summary: `分包批次 ${record.packageNo} 状态变更为：${packageStatusLabel}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: `subcontract_${input.targetStatus}`, targetType: "subcontract_package", targetId: String(record.id), title: `分包批次${packageStatusLabel}`, deepLink: "/admin" }).catch(() => undefined);
    return { success: true };
  }),

  listPaymentSettlements: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), status: settlementStatusSchema.optional() })).query(async ({ ctx, input }) => {
    const roleCodes = await assertSubcontractAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(subcontractPaymentSettlements).where(input.status
      ? and(eq(subcontractPaymentSettlements.projectId, input.projectId), eq(subcontractPaymentSettlements.status, input.status))
      : eq(subcontractPaymentSettlements.projectId, input.projectId)).orderBy(desc(subcontractPaymentSettlements.updatedAt));
    const showFullAccount = canViewFullSubcontractAccount(roleCodes);
    return rows.map(row => ({
      ...row,
      payeeAccount: !row.payeeAccount || showFullAccount
        ? row.payeeAccount
        : `${row.payeeAccount.slice(0, 4)}****${row.payeeAccount.slice(-4)}`,
      payeeAccountMasked: !row.payeeAccount ? null : `${row.payeeAccount.slice(0, 4)}****${row.payeeAccount.slice(-4)}`,
    }));
  }),

  createPaymentSettlement: protectedProcedure.input(settlementDraftInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertSubcontractAccess(ctx);
    if (!canSettleSubcontract(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅会计或财务负责人可建立分包应付结算单" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [pkg] = await db.select().from(subcontractPackages).where(eq(subcontractPackages.id, input.packageId)).limit(1);
    if (!pkg || pkg.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目分包包件" });
    if (pkg.status !== "confirmed") throw new TRPCError({ code: "CONFLICT", message: "仅已确认分包包件可建立应付结算单" });
    if (Number(pkg.marginAmount) < 0 && (!pkg.priceExceptionReviewedBy || !pkg.priceExceptionReviewedAt)) {
      throw new TRPCError({ code: "CONFLICT", message: "价格倒挂包件尚未完成双岗复核，不能建立付款结算单" });
    }
    const [team] = await db.select().from(subcontractTeams).where(eq(subcontractTeams.id, pkg.subcontractTeamId)).limit(1);
    if (!team || team.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "分包施工队不存在或不属于当前项目" });
    const [existing] = await db.select({ id: subcontractPaymentSettlements.id }).from(subcontractPaymentSettlements).where(eq(subcontractPaymentSettlements.packageId, pkg.id)).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "该分包包件已存在应付结算单，不可重复建立" });
    if (input.manualDeductionAmount > Number(pkg.subcontractAmount)) throw new TRPCError({ code: "BAD_REQUEST", message: "人工扣款不能超过分包应付金额" });
    if (input.manualDeductionAmount > 0 && !input.remarks?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "存在人工扣款时必须填写扣款原因" });
    if (input.invoiceStatus === "verified" && (!input.invoiceNo?.trim() || !input.invoiceEvidenceId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "已验真发票必须填写发票号并关联凭证" });
    }
    const grossPayableAmount = roundMoney(Number(pkg.subcontractAmount));
    const netPayableAmount = roundMoney(grossPayableAmount - input.manualDeductionAmount);
    const settlementNo = createSubcontractSettlementNo();
    await db.transaction(async tx => {
      await tx.insert(subcontractPaymentSettlements).values({
        settlementNo,
        projectId: input.projectId,
        packageId: pkg.id,
        subcontractTeamId: pkg.subcontractTeamId,
        packageNoSnapshot: pkg.packageNo,
        workItemSnapshot: pkg.workItem,
        quantitySnapshot: pkg.quantity,
        unitSnapshot: pkg.unit,
        grossPayableAmount: String(grossPayableAmount),
        manualDeductionAmount: String(roundMoney(input.manualDeductionAmount)),
        netPayableAmount: String(netPayableAmount),
        invoiceStatus: input.invoiceStatus,
        invoiceNo: input.invoiceNo?.trim() || null,
        invoiceEvidenceId: input.invoiceEvidenceId ?? null,
        payeeName: input.payeeName,
        payeeAccount: input.payeeAccount?.trim() || null,
        paymentMethod: input.paymentMethod,
        remarks: input.remarks?.trim() || null,
        status: "draft",
        createdBy: user.id,
      });
      await tx.insert(auditLogs).values({ userId: user.id, module: "subcontract", action: "create_payment_settlement", targetType: "subcontract_payment_settlement", targetId: settlementNo, summary: `建立分包应付结算单 ${settlementNo}：包件 ${pkg.packageNo}，净应付 ${netPayableAmount.toFixed(2)}` });
    });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "finance", eventCode: "subcontract_payment_draft", targetType: "subcontract_payment_settlement", targetId: settlementNo, title: "分包应付结算单已建立", deepLink: "/admin" }).catch(() => undefined);
    return { success: true, settlementNo, grossPayableAmount, netPayableAmount };
  }),

  transitionPaymentSettlement: protectedProcedure.input(settlementTransitionInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roleCodes = await assertSubcontractAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [settlement] = await db.select().from(subcontractPaymentSettlements).where(eq(subcontractPaymentSettlements.id, input.id)).limit(1);
    if (!settlement || settlement.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目分包应付结算单" });
    const allowedTargets: Record<string, string[]> = { draft: ["submitted", "void"], submitted: ["approved", "void"], approved: ["paid", "void"] };
    if (!allowedTargets[settlement.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前分包付款结算单状态不允许该操作" });
    if (["submitted", "approved", "void"].includes(input.targetStatus) && !canSettleSubcontract(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无分包结算提交、审核或作废权限" });
    if (input.targetStatus === "approved" && settlement.submittedBy === user.id && !roleCodes.includes("ALL")) throw new TRPCError({ code: "FORBIDDEN", message: "提交人与会计审核人必须职责分离" });
    if (input.targetStatus === "paid" && !canPaySubcontract(roleCodes)) throw new TRPCError({ code: "FORBIDDEN", message: "仅出纳或财务负责人可登记分包付款" });
    if (input.targetStatus === "paid" && settlement.approvedBy === user.id && !roleCodes.includes("ALL")) throw new TRPCError({ code: "FORBIDDEN", message: "会计审核人与实际付款人必须职责分离" });
    if (input.targetStatus === "paid" && !input.paymentDate) throw new TRPCError({ code: "BAD_REQUEST", message: "登记付款时必须填写付款日期" });
    const paymentDate = input.targetStatus === "paid" ? new Date(`${input.paymentDate}T12:00:00`) : null;
    if (input.targetStatus === "paid") {
      const [closure] = await db.select({ status: dailyAccountingClosures.status }).from(dailyAccountingClosures).where(and(eq(dailyAccountingClosures.projectId, input.projectId), eq(dailyAccountingClosures.closingDate, paymentDate!))).limit(1);
      if (closure && ["closed", "archived"].includes(closure.status)) throw new TRPCError({ code: "CONFLICT", message: "付款日期已封存，须由财务负责人先授权反结账后再登记付款" });
    }
    const now = new Date();
    await db.transaction(async tx => {
      const patch: Partial<typeof subcontractPaymentSettlements.$inferInsert> = { status: input.targetStatus };
      if (input.remarks !== undefined) patch.remarks = input.remarks?.trim() || null;
      if (input.targetStatus === "submitted") {
        patch.submittedBy = user.id;
        patch.submittedAt = now;
      }
      if (input.targetStatus === "approved") {
        patch.approvedBy = user.id;
        patch.approvedAt = now;
      }
      if (input.targetStatus === "paid") {
        patch.paidBy = user.id;
        patch.paidAt = now;
        patch.paymentDate = paymentDate!;
        patch.paymentReference = input.paymentReference?.trim() || null;
      }
      await tx.update(subcontractPaymentSettlements).set(patch).where(and(eq(subcontractPaymentSettlements.id, settlement.id), eq(subcontractPaymentSettlements.status, settlement.status)));
      if (input.targetStatus === "paid") {
        await tx.update(subcontractPackages).set({ status: "settled", settledAt: now }).where(and(eq(subcontractPackages.id, settlement.packageId), eq(subcontractPackages.status, "confirmed")));
        await tx.insert(financialRecords).values({
          recordNo: `F-${settlement.settlementNo}`,
          projectId: input.projectId,
          direction: "expense",
          category: "分包付款",
          amount: settlement.netPayableAmount,
          occurredAt: paymentDate!,
          settlementStatus: "paid",
          sourceType: "subcontract_payment_settlement",
          sourceId: String(settlement.id),
          evidenceId: settlement.invoiceEvidenceId,
          remarks: `分包付款结算单 ${settlement.settlementNo}${input.paymentReference?.trim() ? `；付款参考号 ${input.paymentReference.trim()}` : ""}`,
        });
      }
      await tx.insert(auditLogs).values({ userId: user.id, module: "subcontract", action: "transition_payment_settlement", targetType: "subcontract_payment_settlement", targetId: String(settlement.id), summary: `分包应付结算单 ${settlement.settlementNo} 状态变更为：${getBusinessStatusLabel(input.targetStatus)}` });
    });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "finance", eventCode: `subcontract_payment_${input.targetStatus}`, targetType: "subcontract_payment_settlement", targetId: String(settlement.id), title: `分包应付结算单${getBusinessStatusLabel(input.targetStatus)}`, deepLink: "/admin" }).catch(() => undefined);
    return { success: true };
  }),

  summary: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertSubcontractAccess(ctx);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { upstreamAmount: 0, subcontractAmount: 0, marginAmount: 0, packageCount: 0, byStatus: [] as Array<{ status: string; packageCount: number; upstreamAmount: number; subcontractAmount: number; marginAmount: number }> };
    const rows = await db.select().from(subcontractPackages).where(eq(subcontractPackages.projectId, input.projectId));
    const effectiveRows = rows.filter(row => row.status !== "void");
    const summarize = (items: typeof rows) => ({
      packageCount: items.length,
      upstreamAmount: roundMoney(items.reduce((sum, item) => sum + Number(item.upstreamAmount), 0)),
      subcontractAmount: roundMoney(items.reduce((sum, item) => sum + Number(item.subcontractAmount), 0)),
      marginAmount: roundMoney(items.reduce((sum, item) => sum + Number(item.marginAmount), 0)),
    });
    const statuses = ["draft", "allocated", "confirmed", "settled", "void"] as const;
    return {
      ...summarize(effectiveRows),
      byStatus: statuses.map(status => ({ status, ...summarize(rows.filter(row => row.status === status)) })),
    };
  }),
});
