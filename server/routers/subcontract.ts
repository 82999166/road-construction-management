import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, measurementTakeoffRecords, subcontractPackages, subcontractTeams } from "../../drizzle/schema";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely } from "../services/businessNotifier";
import { encryptSecret, maskSecret } from "../services/secretVault";

const moneySchema = z.number().finite().min(0).max(999999999999.99);
const quantitySchema = z.number().finite().positive().max(999999999999.999);
const packageStatusSchema = z.enum(["draft", "allocated", "confirmed", "settled", "void"]);
const teamStatusSchema = z.enum(["active", "suspended", "closed"]);

/** 金额统一由服务端计算并以两位小数固化，禁止浏览器以浮点结果直接入库。 */
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 生成分包批次号，避免客户端编号在多人并行分配工程量时冲突。 */
function createPackageNo() {
  const dateText = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SP-${dateText}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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
  const allowed = ["MEASUREMENT_MANAGER", "PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"];
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
  remarks: z.string().trim().max(500).optional().nullable(),
});

const packageTransitionInput = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  targetStatus: packageStatusSchema,
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
      confirmed: ["settled", "void"],
    };
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
    if (input.targetStatus === "settled") patch.settledAt = now;
    const result = await db.update(subcontractPackages).set(patch).where(and(eq(subcontractPackages.id, input.id), eq(subcontractPackages.status, record.status)));
    const header = Array.isArray(result) ? result[0] : result;
    if (header && typeof header === "object" && "affectedRows" in header && Number((header as { affectedRows?: unknown }).affectedRows) === 0) {
      throw new TRPCError({ code: "CONFLICT", message: "分包批次已被其他用户更新，请刷新后重试" });
    }
    await db.insert(auditLogs).values({ userId: user.id, module: "subcontract", action: "transition_package", targetType: "subcontract_package", targetId: String(record.id), summary: `分包批次 ${record.packageNo} 状态变更为：${input.targetStatus}` });
    void notifyOfficialAccountBusinessEventSafely({ userId: user.id, module: "measurement", eventCode: `subcontract_${input.targetStatus}`, targetType: "subcontract_package", targetId: String(record.id), title: `分包批次已${input.targetStatus}`, deepLink: "/admin" }).catch(() => undefined);
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
