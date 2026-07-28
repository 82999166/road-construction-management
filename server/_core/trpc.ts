import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getSuperAdminAccess } from "../access";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * 业务模块的高影响写入不能仅依赖前端隐藏按钮；客户端可直接调用 RPC。
 * 普通管理人员只能在其已授权模块与项目范围内新增、查看，既有记录修改与状态流转由超级管理员负责。
 */
const BUSINESS_ROUTER_PREFIXES = ["labor.", "machinery.", "transport.", "purchasing.", "measurement.", "finance.", "evidence."] as const;
const HIGH_IMPACT_MUTATION_SEGMENTS = ["transition", "approve", "pay", "void", "reverse", "ocr", "recordSettlement", "recordPayment"] as const;

function isScopedBusinessMutation(path: string) {
  return BUSINESS_ROUTER_PREFIXES.some(prefix => path.startsWith(prefix));
}

function hasExistingRecordId(input: unknown) {
  return typeof input === "object" && input !== null && "id" in input && (input as { id?: unknown }).id !== undefined && (input as { id?: unknown }).id !== null;
}

function isHighImpactBusinessMutation(path: string) {
  return HIGH_IMPACT_MUTATION_SEGMENTS.some(segment => path.toLowerCase().includes(segment.toLowerCase()));
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

const restrictOrdinaryManagerBusinessMutation = t.middleware(async opts => {
  const { ctx, next, path, type, input } = opts;
  if (type !== "mutation" || !isScopedBusinessMutation(path)) {
    return next({ ctx });
  }

  const { canAccess: isSuperAdmin } = await getSuperAdminAccess(ctx);
  if (!isSuperAdmin && (hasExistingRecordId(input) || isHighImpactBusinessMutation(path))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "普通管理人员仅可在已授权业务范围内新增和查看数据；修改既有记录、审批、结算及作废操作仅限超级管理员",
    });
  }

  return next({ ctx });
});

export const protectedProcedure = t.procedure.use(requireUser).use(requireLocalManagerPasswordChange).use(restrictOrdinaryManagerBusinessMutation);

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
