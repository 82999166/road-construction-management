import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { assertSuperAdmin, requireAuthenticatedUser } from "../access";
import {
  administratorAccountInput,
  administratorAuthorizationInput,
  createAdministrator,
  getAdministratorAuthorization,
  listAdministrators,
  resetAdministratorPassword,
  saveAdministratorAuthorization,
  updateAdministrator,
} from "../services/administratorManagement";

const userIdInput = z.object({ userId: z.number().int().positive() }).strict();

// Driver identities are outside account-governance scope, even with malformed historical grants.
const managementProcedure = protectedProcedure.use(({ ctx, next }) => {
  const user = requireAuthenticatedUser(ctx);
  if (user.loginMethod === "local_driver") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "司机账号不可访问管理员管理",
    });
  }
  return next({ ctx });
});

/** Dedicated super-admin account administration; never delegates to legacy personnel writes. */
export const administratorManagementRouter = router({
  list: managementProcedure.query(async ({ ctx }) => {
    await assertSuperAdmin(ctx);
    return listAdministrators();
  }),
  create: managementProcedure
    .input(
      administratorAccountInput
        .extend({
          initialPassword: z.string().min(8, "初始密码至少 8 位").max(128),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      return createAdministrator(admin.id, input);
    }),
  update: managementProcedure
    .input(
      administratorAccountInput
        .extend({ userId: z.number().int().positive() })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      return updateAdministrator(admin.id, input);
    }),
  resetPassword: managementProcedure
    .input(
      userIdInput
        .extend({ newPassword: z.string().min(8, "新密码至少 8 位").max(128) })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      return resetAdministratorPassword(admin.id, input);
    }),
  authorization: managementProcedure
    .input(userIdInput)
    .query(async ({ ctx, input }) => {
      await assertSuperAdmin(ctx);
      return getAdministratorAuthorization(input.userId);
    }),
  saveAuthorization: managementProcedure
    .input(administratorAuthorizationInput)
    .mutation(async ({ ctx, input }) => {
      const admin = await assertSuperAdmin(ctx);
      return saveAdministratorAuthorization(admin.id, input);
    }),
});
