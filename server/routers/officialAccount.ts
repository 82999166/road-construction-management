import { requireAuthenticatedUser } from "../access";
import { getOfficialAccountBindingStatus, createOfficialAccountBindingUrl, createOfficialAccountScanBindingRequest } from "../officialAccountBinding";
import { verifyOfficialAccountBindingFollowStatus } from "../services/officialAccountNotifier";
import { protectedProcedure, router } from "../_core/trpc";

/** 员工自助绑定只返回状态和经签名的跳转地址，永不向浏览器返回 OpenID 或服务号密钥。 */
export const officialAccountRouter = router({
  bindingStatus: protectedProcedure.query(async ({ ctx }) => getOfficialAccountBindingStatus(requireAuthenticatedUser(ctx).id)),
  beginBinding: protectedProcedure.mutation(async ({ ctx }) => createOfficialAccountBindingUrl(requireAuthenticatedUser(ctx).id)),
  beginScanBinding: protectedProcedure.mutation(async ({ ctx }) => createOfficialAccountScanBindingRequest(requireAuthenticatedUser(ctx).id)),
  verifyFollowStatus: protectedProcedure.mutation(async ({ ctx }) => verifyOfficialAccountBindingFollowStatus(requireAuthenticatedUser(ctx).id)),
});
