import { MOBILE_MENU_CATALOG } from "../../shared/domain";
import { and, eq, ne } from "drizzle-orm";
import { notificationRecords } from "../../drizzle/schema";
import { getCurrentDataScope, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

/**
 * 移动端业务工作台路由。菜单由服务端根据实时角色返回，
 * 不依赖客户端缓存，人员被撤权后刷新即可失去入口。
 */
export const mobileRouter = router({
  workbench: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthenticatedUser(ctx);
    const [roleCodes, dataScope] = await Promise.all([getEffectiveRoleCodes(ctx), getCurrentDataScope(ctx)]);
    const db = await getDb();
    const unreadMessages = db
      ? (await db.select({ id: notificationRecords.id }).from(notificationRecords).where(and(eq(notificationRecords.recipientUserId, user.id), ne(notificationRecords.status, "read")))).length
      : 0;
    const menus = MOBILE_MENU_CATALOG.filter(menu => {
      if (roleCodes.includes("ALL")) return true;
      // 将只读字面量角色数组提升为字符串数组，便于对不同菜单的角色集合统一比较。
      const menuRoles = menu.roles as readonly string[];
      return menuRoles.includes("ALL") || menuRoles.some(role => roleCodes.includes(role));
    });
    return {
      user: { id: user.id, name: user.name, roleCodes },
      menus,
      // 数据范围由服务端根据有效授权实时计算，前端只用于展示，不可自行扩大查询范围。
      dataScope,
      // 普通移动端不接收身份证、银行卡、完整手机号等敏感字段，详情接口也必须复用同一脱敏策略。
      maskedFields: ["identityNo", "bankAccount", "mobile"],
      statistics: { pendingApprovals: 0, unreadMessages, todayTrips: 0, pendingPayroll: 0 },
    };
  }),
});
