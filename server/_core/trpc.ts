import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getRoleOperationPermissionDecision, getSuperAdminAccess, type BusinessOperationAction } from "../access";
import type { DepartmentBusinessModule } from "../../shared/department";
import { assertLocalManagerTerminalAccess } from "../localAuth";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * 业务模块的高影响写入不能仅依赖前端隐藏按钮；客户端可直接调用 RPC。
 * 普通管理人员只能在其已授权模块与项目范围内新增、查看，既有记录修改与状态流转由超级管理员负责。
 */
const BUSINESS_ROUTER_PREFIXES = ["construction.", "labor.", "machinery.", "transport.", "purchasing.", "measurement.", "subcontract.", "contract.", "finance.", "evidence."] as const;
const HIGH_IMPACT_MUTATION_SEGMENTS = ["transition", "approve", "pay", "void", "reverse", "ocr", "recordSettlement", "recordPayment"] as const;
const BUSINESS_MODULE_BY_ROUTER: Record<string, DepartmentBusinessModule> = {
  construction: "CONSTRUCTION",
  labor: "LABOR",
  machinery: "MACHINERY",
  transport: "TRANSPORT",
  purchasing: "PURCHASING",
  measurement: "MEASUREMENT",
  /** 分包沿用工程计量部门范围与详细操作权限，金额确认仍由分包路由内的财务岗位状态机二次校验。 */
  subcontract: "MEASUREMENT",
  contract: "CONTRACT",
  finance: "FINANCE",
  evidence: "EVIDENCE",
};
/**
 * 工资条的提交、审核、发放和作废已在 labor 路由内分别实施劳资、会计、财务负责人角色、部门模块、项目范围及状态机校验。
 * 因此不应再由泛化守卫一律要求超级管理员；其余高影响业务突变仍保持统一管理员兜底。
 */
const ROLE_GUARDED_LABOR_MUTATIONS = new Set([
  "labor.payroll.submit",
  "labor.payroll.approve",
  "labor.payroll.pay",
  "labor.payroll.void",
]);

/** 分包的编辑、分配、复核、结算与作废均已在分包路由内按岗位、项目范围和旧状态强制校验。 */
const ROLE_GUARDED_SUBCONTRACT_MUTATIONS = new Set([
  "subcontract.saveTeam",
  "subcontract.savePackage",
  "subcontract.transitionPackage",
]);

function isScopedBusinessMutation(path: string) {
  return BUSINESS_ROUTER_PREFIXES.some(prefix => path.startsWith(prefix));
}

function hasExistingRecordId(input: unknown) {
  return typeof input === "object" && input !== null && "id" in input && (input as { id?: unknown }).id !== undefined && (input as { id?: unknown }).id !== null;
}

function isHighImpactBusinessMutation(path: string) {
  return HIGH_IMPACT_MUTATION_SEGMENTS.some(segment => path.toLowerCase().includes(segment.toLowerCase()));
}

/** 从过程名称推导业务动作，保证前端隐藏按钮或直接 RPC 调用都绕不过角色详细操作权限。 */
function inferBusinessOperationAction(path: string, input: unknown): BusinessOperationAction {
  const normalized = path.toLowerCase();
  if (normalized.includes("transition")) {
    const nextStatus = typeof input === "object" && input !== null
      ? String("nextStatus" in input ? (input as { nextStatus?: unknown }).nextStatus ?? "" : "targetStatus" in input ? (input as { targetStatus?: unknown }).targetStatus ?? "" : "")
      : "";
    if (["void", "locked", "archived", "cancelled"].includes(nextStatus)) return "void";
    if (["settled", "paid", "issued"].includes(nextStatus)) return "settle";
    if (["approved", "rejected", "verified", "certified"].includes(nextStatus)) return "review";
    if (nextStatus === "submitted") return "submit";
  }
  if (normalized.includes("export")) return "export";
  if (normalized.includes("print")) return "print";
  if (["void", "reverse", "cancel", "archive", "revoke"].some(segment => normalized.includes(segment))) return "void";
  if (["settle", "payment", "pay", "closing"].some(segment => normalized.includes(segment))) return "settle";
  if (["approve", "review", "verify", "certify"].some(segment => normalized.includes(segment))) return "review";
  if (["submit", "load", "unload"].some(segment => normalized.includes(segment))) return "submit";
  return hasExistingRecordId(input) ? "edit" : "create";
}

function getBusinessModuleForPath(path: string) {
  const routerName = path.split(".")[0] ?? "";
  return BUSINESS_MODULE_BY_ROUTER[routerName];
}

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/** 初始口令或后台重置口令后，普通本地账号只能改密或安全退出，不能直接读取或写入业务数据。 */
const requireLocalManagerPasswordChange = t.middleware(async opts => {
  const { ctx, next, path } = opts;
  if (ctx.user?.loginMethod === "local_manager" && ctx.user.localPasswordChangeRequired && path !== "auth.changeLocalPassword" && path !== "auth.logout") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先完成初始密码修改后再进入业务工作台" });
  }
  return next({ ctx });
});

/** 本地管理账号的 PC/手机策略由服务端在每个受保护请求上重复校验，防止 Cookie 跨端复用。 */
const requireLocalManagerTerminal = t.middleware(async opts => {
  assertLocalManagerTerminalAccess(opts.ctx);
  return opts.next({ ctx: opts.ctx });
});

const restrictOrdinaryManagerBusinessMutation = t.middleware(async opts => {
  const { ctx, next, path, type, input } = opts;
  if (type !== "mutation" || !isScopedBusinessMutation(path)) {
    return next({ ctx });
  }

  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  const usesDedicatedRoleGuard = ROLE_GUARDED_LABOR_MUTATIONS.has(path) || ROLE_GUARDED_SUBCONTRACT_MUTATIONS.has(path);
  const businessModule = getBusinessModuleForPath(path);
  const operation = inferBusinessOperationAction(path, input);
  const detailedPermission = !isSuperAdmin && businessModule
    ? await getRoleOperationPermissionDecision(ctx, businessModule, operation)
    : null;
  if (detailedPermission?.hasDetailedPermissions && !detailedPermission.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `当前角色未获“${operation}”操作权限，请联系超级管理员在角色详细操作权限中授权`,
    });
  }
  if (!isSuperAdmin && !usesDedicatedRoleGuard && (hasExistingRecordId(input) || isHighImpactBusinessMutation(path))) {
    if (detailedPermission?.hasDetailedPermissions && detailedPermission.allowed) return next({ ctx });
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "普通管理人员仅可在已授权业务范围内新增和查看数据；修改既有记录、审批、结算及作废操作仅限超级管理员",
    });
  }

  return next({ ctx });
});

export const protectedProcedure = t.procedure.use(requireUser).use(requireLocalManagerPasswordChange).use(requireLocalManagerTerminal).use(restrictOrdinaryManagerBusinessMutation);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
