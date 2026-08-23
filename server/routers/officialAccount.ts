import { requireAuthenticatedUser } from "../access";
import { z } from "zod";
import { getOfficialAccountBindingStatus, createOfficialAccountBindingUrl, createOfficialAccountScanBindingRequest } from "../officialAccountBinding";
import { completeOfficialAccountDriverVehicleBinding, getOfficialAccountDriverBindingRequestStatus, getOfficialAccountDriverPortalSummary } from "../services/officialAccountDriverBinding";
import { verifyOfficialAccountBindingFollowStatus } from "../services/officialAccountNotifier";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

/** 员工自助绑定只返回状态和经签名的跳转地址，永不向浏览器返回 OpenID 或服务号密钥。 */
export const officialAccountRouter = router({
  bindingStatus: protectedProcedure.query(async ({ ctx }) => getOfficialAccountBindingStatus(requireAuthenticatedUser(ctx).id)),
  beginBinding: protectedProcedure.mutation(async ({ ctx }) => createOfficialAccountBindingUrl(requireAuthenticatedUser(ctx).id)),
  beginScanBinding: protectedProcedure.mutation(async ({ ctx }) => createOfficialAccountScanBindingRequest(requireAuthenticatedUser(ctx).id)),
  verifyFollowStatus: protectedProcedure.mutation(async ({ ctx }) => verifyOfficialAccountBindingFollowStatus(requireAuthenticatedUser(ctx).id)),
  driverBindingStatus: publicProcedure.input(z.object({ token: z.string().min(16).max(160) })).query(async ({ input }) => getOfficialAccountDriverBindingRequestStatus(input.token)),
  completeDriverBinding: publicProcedure.input(z.object({ token: z.string().min(16).max(160), plateNo: z.string().trim().min(2).max(32) })).mutation(async ({ input }) => completeOfficialAccountDriverVehicleBinding(input)),
  driverPortalSummary: publicProcedure.input(z.object({ token: z.string().min(16).max(512) })).query(async ({ input }) => getOfficialAccountDriverPortalSummary(input.token)),
});
