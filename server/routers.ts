import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { adminRouter } from "./routers/admin";
import { evidenceRouter } from "./routers/evidence";
import { financeRouter, measurementRouter, purchasingRouter } from "./routers/finance";
import { laborRouter } from "./routers/labor";
import { messageRouter } from "./routers/messages";
import { mobileRouter } from "./routers/mobile";
import { machineryRouter, transportRouter } from "./routers/operations";

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
