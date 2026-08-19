import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, outsourceContracts } from "../../drizzle/schema";
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, assertRoleOperationPermission, getEffectiveRoleCodes, requireAuthenticatedUser, type BusinessOperationAction } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

const contractType = z.enum(["transport", "labor_subcontract", "machinery_lease", "material_supply", "other"]);
const pricingMethod = z.enum(["lump_sum", "unit_price", "trip", "ton", "m3", "day", "month", "other"]);
const contractStatus = z.enum(["draft", "active", "suspended", "expired", "closed", "void"]);
const money = z.number().finite().min(0).max(999999999999.99);

function createContractNo() {
  return `CT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function assertContractAccess(ctx: Parameters<typeof requireAuthenticatedUser>[0], action: BusinessOperationAction = "read") {
  await assertDepartmentBusinessAccess(ctx, "CONTRACT");
  const detailedPermission = await assertRoleOperationPermission(ctx, "CONTRACT", action);
  const roleCodes = await getEffectiveRoleCodes(ctx);
  const allowed = ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "TRANSPORT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"];
  // 管理员若已为非标准岗位配置了合同详细操作权限，应以该显式授权为准，不能被历史岗位白名单误拦截。
  const hasExplicitGrantedOperation = detailedPermission.hasDetailedPermissions && detailedPermission.allowed;
  if (!roleCodes.includes("ALL") && !roleCodes.some(role => allowed.includes(role)) && !hasExplicitGrantedOperation) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位未获外包合同管理授权" });
  }
  return roleCodes;
}

function canMaintain(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "TRANSPORT_MANAGER", "FINANCE_MANAGER"].includes(role));
}

function canClose(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.some(role => ["PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"].includes(role));
}

const contractInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  contractType,
  counterpartyName: z.string().trim().min(2, "请填写合同相对方").max(200),
  counterpartyContact: z.string().trim().max(100).optional().nullable(),
  pricingMethod,
  unit: z.string().trim().max(32).optional().nullable(),
  unitPrice: money.optional().nullable(),
  contractAmount: money,
  startDate: z.string().date().optional().nullable(),
  endDate: z.string().date().optional().nullable(),
  attachmentEvidenceId: z.number().int().positive().optional().nullable(),
  contractSummary: z.string().trim().max(1000).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

export const contractRouter = router({
  capabilities: protectedProcedure.query(async ({ ctx }) => {
    const roles = await assertContractAccess(ctx, "read");
    return { canMaintain: canMaintain(roles), canClose: canClose(roles) };
  }),

  list: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), status: contractStatus.optional(), contractType: contractType.optional() })).query(async ({ ctx, input }) => {
    await assertContractAccess(ctx, "read");
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return [];
    const predicates = [eq(outsourceContracts.projectId, input.projectId)];
    if (input.status) predicates.push(eq(outsourceContracts.status, input.status));
    if (input.contractType) predicates.push(eq(outsourceContracts.contractType, input.contractType));
    return db.select().from(outsourceContracts).where(and(...predicates)).orderBy(desc(outsourceContracts.updatedAt));
  }),

  save: protectedProcedure.input(contractInput).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const roles = await assertContractAccess(ctx, input.id ? "edit" : "create");
    if (!canMaintain(roles)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无外包合同维护权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new TRPCError({ code: "BAD_REQUEST", message: "合同结束日期不得早于开始日期" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const values = { projectId: input.projectId, contractType: input.contractType, counterpartyName: input.counterpartyName, counterpartyContact: input.counterpartyContact?.trim() || null, pricingMethod: input.pricingMethod, unit: input.unit?.trim() || null, unitPrice: input.unitPrice === undefined || input.unitPrice === null ? null : String(input.unitPrice.toFixed(2)), contractAmount: String(input.contractAmount.toFixed(2)), startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null, endDate: input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : null, attachmentEvidenceId: input.attachmentEvidenceId ?? null, contractSummary: input.contractSummary?.trim() || null, remarks: input.remarks?.trim() || null };
    let contractId = input.id;
    if (input.id) {
      const [existing] = await db.select().from(outsourceContracts).where(eq(outsourceContracts.id, input.id)).limit(1);
      if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目合同" });
      if (existing.status !== "draft" && existing.status !== "suspended") throw new TRPCError({ code: "CONFLICT", message: "仅草稿或已暂停合同可修改内容" });
      await db.update(outsourceContracts).set(values).where(eq(outsourceContracts.id, input.id));
    } else {
      const contractNo = createContractNo();
      await db.insert(outsourceContracts).values({ ...values, contractNo, status: "draft", createdBy: user.id });
      const [created] = await db.select({ id: outsourceContracts.id }).from(outsourceContracts).where(eq(outsourceContracts.contractNo, contractNo)).limit(1);
      contractId = created?.id;
    }
    if (!contractId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "合同保存后未找到记录" });
    await db.insert(auditLogs).values({ userId: user.id, module: "contract", action: input.id ? "update_outsource_contract" : "create_outsource_contract", targetType: "outsource_contract", targetId: String(contractId), summary: `${input.id ? "维护" : "新建"}外包合同：${input.counterpartyName}，金额 ¥${input.contractAmount.toFixed(2)}` });
    return { success: true, contractId };
  }),

  transition: protectedProcedure.input(z.object({ id: z.number().int().positive(), projectId: z.number().int().positive(), targetStatus: contractStatus })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const transitionAction: BusinessOperationAction = ["closed", "void"].includes(input.targetStatus) ? "void" : input.targetStatus === "active" ? "review" : "edit";
    const roles = await assertContractAccess(ctx, transitionAction);
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [existing] = await db.select().from(outsourceContracts).where(eq(outsourceContracts.id, input.id)).limit(1);
    if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目合同" });
    const targets: Record<string, string[]> = { draft: ["active", "void"], active: ["suspended", "expired", "closed"], suspended: ["active", "closed", "void"] };
    if (!targets[existing.status]?.includes(input.targetStatus)) throw new TRPCError({ code: "CONFLICT", message: "当前合同状态不允许该操作" });
    if (["closed", "void"].includes(input.targetStatus) && !canClose(roles)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无合同关闭或作废权限" });
    if (!["closed", "void"].includes(input.targetStatus) && !canMaintain(roles)) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无合同状态维护权限" });
    await db.update(outsourceContracts).set({ status: input.targetStatus }).where(and(eq(outsourceContracts.id, input.id), eq(outsourceContracts.status, existing.status)));
    await db.insert(auditLogs).values({ userId: user.id, module: "contract", action: "transition_outsource_contract", targetType: "outsource_contract", targetId: String(input.id), summary: `外包合同状态变更为：${input.targetStatus}` });
    return { success: true };
  }),
});
