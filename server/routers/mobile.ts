import { MOBILE_MENU_CATALOG } from "../../shared/domain";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { constructionDailyReports, measurementClaims, notificationRecords, payrollStatements, projects, purchaseRequests, transportTrips } from "../../drizzle/schema";
import { getCurrentDataScope, getCurrentDepartmentAccess, getEffectiveRoleCodes, requireAuthenticatedUser } from "../access";
import { DEPARTMENT_AGNOSTIC_MOBILE_MENUS } from "../../shared/department";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

/** 当前角色是否具备某类移动端业务数据的查看入口；统计数字不能替代详情接口的服务端鉴权。 */
function hasAnyRole(roleCodes: readonly string[], permittedRoles: readonly string[]) {
  return roleCodes.includes("ALL") || permittedRoles.some(role => roleCodes.includes(role));
}

/** 以 UTC 日界线统计今日运输，匹配数据库统一保存 UTC 时间戳的规则，避免服务器时区漂移。 */
function getUtcDayWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/**
 * 将直接项目授权和组织级项目授权收敛为实际项目集合。
 * 返回 null 仅表示全项目授权；返回空数组表示没有任何项目数据访问权，绝不能被解释成全量查询。
 */
async function resolveScopedProjectIds(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  dataScope: Awaited<ReturnType<typeof getCurrentDataScope>>,
) {
  if (dataScope.hasAllProjects) return null;
  if (!dataScope.projectIds.length && !dataScope.organizationIds.length) return [];

  const projectIds = [...dataScope.projectIds];
  if (dataScope.organizationIds.length > 0) {
    const projectRows = await db.select({ id: projects.id, organizationId: projects.organizationId }).from(projects);
    for (const project of projectRows) {
      if (project.organizationId !== null && dataScope.organizationIds.includes(project.organizationId)) {
        projectIds.push(project.id);
      }
    }
  }
  return Array.from(new Set(projectIds));
}

/**
 * 移动端业务工作台路由。菜单由服务端根据实时角色返回，
 * 不依赖客户端缓存，人员被撤权后刷新即可失去入口。
 */
export const mobileRouter = router({
  workbench: protectedProcedure.query(async ({ ctx }) => {
    const user = requireAuthenticatedUser(ctx);
    const [roleCodes, dataScope, departmentAccess] = await Promise.all([getEffectiveRoleCodes(ctx), getCurrentDataScope(ctx), getCurrentDepartmentAccess(ctx)]);
    const db = await getDb();
    const unreadMessages = db
      ? (await db.select({ id: notificationRecords.id }).from(notificationRecords).where(and(eq(notificationRecords.recipientUserId, user.id), ne(notificationRecords.status, "read")))).length
      : 0;
    const menus = MOBILE_MENU_CATALOG.filter(menu => {
      // 工作台和消息中心属于所有已登录人员的基础入口；其余业务入口必须同时通过岗位和部门业务范围校验。
      if ((DEPARTMENT_AGNOSTIC_MOBILE_MENUS as readonly string[]).includes(menu.code)) return true;
      // 将只读字面量角色数组提升为字符串数组，便于对不同菜单的角色集合统一比较。
      const menuRoles = menu.roles as readonly string[];
      const hasRoleAccess = roleCodes.includes("ALL") || menuRoles.includes("ALL") || menuRoles.some(role => roleCodes.includes(role));
      const hasDepartmentAccess = departmentAccess.hasAllDepartments || departmentAccess.moduleCodes.includes(menu.code as never);
      return hasRoleAccess && hasDepartmentAccess;
    });

    // 无数据库连接时仅返回已知的未读数降级值；不构造或缓存虚假的业务待办统计。
    if (!db) {
      return {
        user: { id: user.id, name: user.name, roleCodes, departments: departmentAccess.departments, departmentModules: departmentAccess.moduleCodes },
        menus,
        dataScope,
        maskedFields: ["identityNo", "bankAccount", "mobile"],
        statistics: { pendingApprovals: 0, unreadMessages, todayTrips: 0, pendingPayroll: 0 },
      };
    }

    const scopedProjectIds = await resolveScopedProjectIds(db, dataScope);
    const canViewScopedRecords = scopedProjectIds === null || scopedProjectIds.length > 0;
    const { start: todayStart, end: tomorrowStart } = getUtcDayWindow();

    // 统计仅查询当前岗位具有菜单入口的业务类别，并继续施加项目范围，避免通过数字泄露无权项目的业务规模。
    const [pendingConstructionRows, pendingPurchaseRows, pendingMeasurementRows, pendingTransportRows, todayTripRows, pendingPayrollRows] = canViewScopedRecords
      ? await Promise.all([
        hasAnyRole(roleCodes, ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"])
          ? db.select({ id: constructionDailyReports.id }).from(constructionDailyReports).where(and(eq(constructionDailyReports.status, "submitted"), scopedProjectIds === null ? undefined : inArray(constructionDailyReports.projectId, scopedProjectIds)))
          : Promise.resolve([]),
        hasAnyRole(roleCodes, ["PROJECT_MANAGER", "FINANCE_MANAGER"])
          ? db.select({ id: purchaseRequests.id }).from(purchaseRequests).where(and(eq(purchaseRequests.status, "submitted"), scopedProjectIds === null ? undefined : inArray(purchaseRequests.projectId, scopedProjectIds)))
          : Promise.resolve([]),
        hasAnyRole(roleCodes, ["MEASUREMENT_MANAGER", "FINANCE_MANAGER", "PROJECT_MANAGER"])
          ? db.select({ id: measurementClaims.id }).from(measurementClaims).where(and(inArray(measurementClaims.status, ["submitted", "reviewing"]), scopedProjectIds === null ? undefined : inArray(measurementClaims.projectId, scopedProjectIds)))
          : Promise.resolve([]),
        hasAnyRole(roleCodes, ["TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"])
          ? db.select({ id: transportTrips.id }).from(transportTrips).where(and(eq(transportTrips.status, "submitted"), scopedProjectIds === null ? undefined : inArray(transportTrips.projectId, scopedProjectIds)))
          : Promise.resolve([]),
        hasAnyRole(roleCodes, ["TRANSPORT_MANAGER", "DRIVER", "PROJECT_MANAGER", "FINANCE_MANAGER"])
          ? db.select({ id: transportTrips.id }).from(transportTrips).where(and(gte(transportTrips.startAt, todayStart), lt(transportTrips.startAt, tomorrowStart), ne(transportTrips.status, "void"), scopedProjectIds === null ? undefined : inArray(transportTrips.projectId, scopedProjectIds)))
          : Promise.resolve([]),
        hasAnyRole(roleCodes, ["LABOR_MANAGER", "ACCOUNTANT", "FINANCE_MANAGER", "PROJECT_MANAGER"])
          ? db.select({ id: payrollStatements.id }).from(payrollStatements).where(and(eq(payrollStatements.status, "reviewing"), scopedProjectIds === null ? undefined : inArray(payrollStatements.projectId, scopedProjectIds)))
          : Promise.resolve([]),
      ])
      : [[], [], [], [], [], []];

    return {
      user: { id: user.id, name: user.name, roleCodes, departments: departmentAccess.departments, departmentModules: departmentAccess.moduleCodes },
      menus,
      // 数据范围由服务端根据有效授权实时计算，前端只用于展示，不可自行扩大查询范围。
      dataScope,
      // 普通移动端不接收身份证、银行卡、完整手机号等敏感字段，详情接口也必须复用同一脱敏策略。
      maskedFields: ["identityNo", "bankAccount", "mobile"],
      statistics: {
        pendingApprovals: pendingConstructionRows.length + pendingPurchaseRows.length + pendingMeasurementRows.length + pendingTransportRows.length,
        unreadMessages,
        todayTrips: todayTripRows.length,
        pendingPayroll: pendingPayrollRows.length,
      },
    };
  }),
});
