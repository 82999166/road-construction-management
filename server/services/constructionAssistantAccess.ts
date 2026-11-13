import { TRPCError } from "@trpc/server";
import {
  assertDepartmentBusinessAccess,
  getEffectiveRoleCodes,
  type BusinessOperationAction,
} from "../access";
import type { TrpcContext } from "../_core/context";

/** 与施工主路由一致的部门/岗位校验；write 允许实际 create 或 edit 任一授予。 */
export async function assertConstructionAccess(
  ctx: TrpcContext,
  action: BusinessOperationAction | "write" = "read"
) {
  if (action === "write") {
    try {
      await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION", "create");
    } catch (error) {
      // 只回退明确的授权拒绝；数据库、网络或其它内部异常必须原样拒绝请求。
      if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN")
        throw error;
      await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION", "edit");
    }
  } else {
    await assertDepartmentBusinessAccess(ctx, "CONSTRUCTION", action);
  }
  const roles = await getEffectiveRoleCodes(ctx);
  if (
    !roles.includes("ALL") &&
    !roles.some(role =>
      ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"].includes(
        role
      )
    )
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前岗位未获施工现场业务授权",
    });
  }
}
export { assertProjectInCurrentScope } from "../access";
