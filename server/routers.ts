import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import type { TrpcContext } from "./_core/context";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { changeLocalManagerPassword, loginLocalManager, loginTemporaryAdmin } from "./localAuth";
import { adminRouter } from "./routers/admin";
import { constructionRouter } from "./routers/construction";
import { evidenceRouter } from "./routers/evidence";
import { financeRouter, measurementRouter, purchasingRouter } from "./routers/finance";
import { subcontractRouter } from "./routers/subcontract";
import { contractRouter } from "./routers/contracts";
import { laborRouter } from "./routers/labor";
import { messageRouter } from "./routers/messages";
import { mobileRouter } from "./routers/mobile";
import { machineryRouter, transportRouter } from "./routers/operations";
import { officialAccountRouter } from "./routers/officialAccount";
import { dailyDigestRouter } from "./routers/dailyDigest";
import { broadcastRouter } from "./routers/broadcast";
import { projectRiskRouter } from "./routers/projectRisk";
import { z } from "zod";

/**
 * 将数据库/会话中的完整用户记录收敛为浏览器真正需要的最小资料。
 * 不得在此处扩展 localPasswordHash、localUsername、localAccountStatus 等本地账号内部字段。
 */
function toPublicAuthUser(user: TrpcContext["user"]) {
  if (!user) return null;
  return {
    id: user.id,
    openId: user.openId,
    email: user.email,
    name: user.name,
    loginMethod: user.loginMethod,
    role: user.role,
    /** 为兼容既有客户端保留字段；本地账号已取消首次登录强制改密。 */
    localPasswordChangeRequired: false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignedIn: user.lastSignedIn,
  };
}

/** 应用根路由只负责组合模块；具体业务路由按领域拆分，避免单文件膨胀。 */
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => toPublicAuthUser(opts.ctx.user)),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    localAdminLogin: publicProcedure
      .input(z.object({
        username: z.string().trim().min(1).max(64),
        password: z.string().min(1).max(256),
      }))
      .mutation(({ ctx, input }) => loginTemporaryAdmin(ctx, input)),
    localManagerLogin: publicProcedure
      .input(z.object({
        username: z.string().trim().min(1).max(64),
        password: z.string().min(1).max(256),
      }))
      .mutation(({ ctx, input }) => loginLocalManager(ctx, input)),
    changeLocalPassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string().min(1).max(256),
        newPassword: z.string().min(6, "新密码至少 6 位").max(128),
      }))
      .mutation(({ ctx, input }) => changeLocalManagerPassword(ctx, input)),
  }),
  admin: adminRouter,
  construction: constructionRouter,
  mobile: mobileRouter,
  officialAccount: officialAccountRouter,
  dailyDigest: dailyDigestRouter,
  broadcast: broadcastRouter,
  labor: laborRouter,
  messages: messageRouter,
  evidence: evidenceRouter,
  machinery: machineryRouter,
  transport: transportRouter,
  purchasing: purchasingRouter,
  measurement: measurementRouter,
  subcontract: subcontractRouter,
  contract: contractRouter,
  finance: financeRouter,
  projectRisk: projectRiskRouter,
});

export type AppRouter = typeof appRouter;
