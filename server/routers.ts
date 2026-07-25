import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { loginTemporaryAdmin } from "./localAuth";
import { adminRouter } from "./routers/admin";
import { evidenceRouter } from "./routers/evidence";
import { financeRouter, measurementRouter, purchasingRouter } from "./routers/finance";
import { laborRouter } from "./routers/labor";
import { messageRouter } from "./routers/messages";
import { mobileRouter } from "./routers/mobile";
import { machineryRouter, transportRouter } from "./routers/operations";
import { z } from "zod";

/** 应用根路由只负责组合模块；具体业务路由按领域拆分，避免单文件膨胀。 */
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
  }),
  admin: adminRouter,
  mobile: mobileRouter,
  labor: laborRouter,
  messages: messageRouter,
  evidence: evidenceRouter,
  machinery: machineryRouter,
  transport: transportRouter,
  purchasing: purchasingRouter,
  measurement: measurementRouter,
  finance: financeRouter,
});

export type AppRouter = typeof appRouter;
