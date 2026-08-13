import { and, eq } from "drizzle-orm";
import { PURCHASE_CATEGORY_CATALOG } from "../../shared/domain";
import { purchaseCategories, rolePermissions, systemPermissions, systemRoles } from "../../drizzle/schema";
import type { getDb } from "../db";

/**
 * 仅初始化不可缺少的系统字典，不创建项目、人员、单据等业务演示数据。
 * 这样上线后不会让演示数据混入真实工程数据。
 */
export async function ensureFoundationData(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const roleSeed = [
    { code: "SUPER_ADMIN", name: "超级管理员", category: "system" as const, description: "可管理全部后台配置与权限", isSystem: true },
    { code: "PROJECT_MANAGER", name: "项目经理", category: "business" as const, description: "负责项目经营与现场统筹", isSystem: true },
    { code: "CONSTRUCTION_MANAGER", name: "施工管理员", category: "business" as const, description: "负责施工现场记录与进度", isSystem: true },
    { code: "SAFETY_MANAGER", name: "安全管理员", category: "business" as const, description: "负责安全检查与隐患闭环", isSystem: true },
    { code: "LABOR_MANAGER", name: "劳资管理员", category: "business" as const, description: "负责实名制、考勤和工资", isSystem: true },
    { code: "MACHINERY_MANAGER", name: "机械管理员", category: "business" as const, description: "负责机械台账与结算", isSystem: true },
    { code: "TRANSPORT_MANAGER", name: "运输管理员", category: "business" as const, description: "负责渣土运输与运费", isSystem: true },
    { code: "DRIVER", name: "司机", category: "business" as const, description: "负责车辆趟次与取证", isSystem: true },
    { code: "PURCHASER", name: "采购员", category: "business" as const, description: "负责采购申请和采购执行", isSystem: true },
    { code: "WAREHOUSE_MANAGER", name: "仓管员", category: "business" as const, description: "负责验收、入库与领用", isSystem: true },
    { code: "LOGISTICS_MANAGER", name: "后勤管理员", category: "business" as const, description: "负责后勤和营地保障", isSystem: true },
    { code: "MEASUREMENT_MANAGER", name: "计量管理员", category: "business" as const, description: "负责工程计量申报", isSystem: true },
    { code: "FINANCE_MANAGER", name: "财务负责人", category: "business" as const, description: "负责财务审核与成本分析", isSystem: true },
    { code: "ACCOUNTANT", name: "会计", category: "business" as const, description: "负责会计审查、发票认证、日结封存与凭证归档，不执行付款或冲销", isSystem: true },
    { code: "CASHIER", name: "出纳", category: "business" as const, description: "负责已批准业务的支付、回款和现金流执行，不审核自身支付", isSystem: true },
    { code: "AUDIT_VIEWER", name: "审计只读", category: "business" as const, description: "只读查看授权项目的财务、利润、发票、日结和审计资料，不录入、不审核、不支付", isSystem: true },
  ];

  const permissionSeed = [
    ["admin:overview:read", "后台概览查看", "admin", "read"],
    ["admin:organization:manage", "组织架构管理", "admin", "manage"],
    ["admin:position:manage", "岗位字典管理", "admin", "manage"],
    ["admin:project:manage", "项目层级管理", "admin", "manage"],
    ["admin:personnel:manage", "人员与授权管理", "admin", "manage"],
    ["admin:role:manage", "角色权限管理", "admin", "manage"],
    ["admin:settings:manage", "系统设置草稿管理", "admin", "manage"],
    ["admin:settings:publish", "系统设置发布", "admin", "publish"],
    ["admin:settings:rollback", "系统设置版本回滚", "admin", "rollback"],
    ["admin:integration:test", "外部接口测试", "admin", "test"],
    ["admin:message_template:manage", "微信公众号消息模板管理", "admin", "manage"],
    ["admin:assignment:expiry", "授权有效期管理", "admin", "manage"],
    ["admin:data_scope:manage", "组织项目数据范围管理", "admin", "manage"],
    ["admin:sensitive_field:manage", "敏感字段脱敏规则管理", "admin", "manage"],
    ["admin:audit:read", "审计日志查看", "admin", "read"],
    ["mobile:workbench:read", "移动端工作台", "mobile", "read"],
    ["mobile:construction:manage", "施工现场业务办理", "construction", "manage"],
    ["mobile:labor:manage", "劳务工资业务办理", "labor", "manage"],
    ["mobile:machinery:manage", "机械业务办理", "machinery", "manage"],
    ["mobile:transport:manage", "运输业务办理", "transport", "manage"],
    ["mobile:purchase:manage", "采购仓储业务办理", "purchase", "manage"],
    ["mobile:measurement:manage", "计量结算业务办理", "measurement", "manage"],
    ["mobile:finance:manage", "财务成本业务办理", "finance", "manage"],
    ["mobile:evidence:manage", "水印影像取证", "evidence", "manage"],
    ["mobile:message:read", "消息中心查看", "message", "read"],
  ] as const;
  /**
   * 基础数据会在多个后台路由上被幂等调用。不能在每次请求中按种子逐条查库，否则云数据库往返会把概览请求放大到十余秒。
   * 先并行读取当前字典，再仅批量插入缺失项；不更新已有记录，保留管理员在生产环境的配置。
   */
  const [existingRoleRows, existingPermissionRows, existingCategories] = await Promise.all([
    db.select({ id: systemRoles.id, code: systemRoles.code }).from(systemRoles),
    db.select({ id: systemPermissions.id, code: systemPermissions.code }).from(systemPermissions),
    db.select({ id: purchaseCategories.id }).from(purchaseCategories).limit(1),
  ]);
  const existingRoleCodes = new Set(existingRoleRows.map(item => item.code));
  const existingPermissionCodes = new Set(existingPermissionRows.map(item => item.code));
  const missingRoles = roleSeed.filter(role => !existingRoleCodes.has(role.code));
  const missingPermissions = permissionSeed
    .filter(([code]) => !existingPermissionCodes.has(code))
    .map(([code, name, module, action]) => ({ code, name, module, action }));

  await Promise.all([
    missingRoles.length ? db.insert(systemRoles).values(missingRoles) : Promise.resolve(),
    missingPermissions.length ? db.insert(systemPermissions).values(missingPermissions) : Promise.resolve(),
    existingCategories.length === 0
      ? db.insert(purchaseCategories).values(PURCHASE_CATEGORY_CATALOG.map(item => ({ ...item, isFixed: true, status: "active" as const })))
      : Promise.resolve(),
  ]);

  // 新安装时需要在插入后读取主键；已有系统则直接复用第一轮查询结果，避免额外往返。
  const superAdmin = existingRoleRows.find(role => role.code === "SUPER_ADMIN")
    ? existingRoleRows.filter(role => role.code === "SUPER_ADMIN")
    : await db.select({ id: systemRoles.id, code: systemRoles.code }).from(systemRoles).where(eq(systemRoles.code, "SUPER_ADMIN")).limit(1);
  const permissions = missingPermissions.length
    ? await db.select({ id: systemPermissions.id, code: systemPermissions.code }).from(systemPermissions)
    : existingPermissionRows;

  // 超级管理员默认具备全部权限，但授权关系仍写入台账，便于审计和后续权限矩阵展示。
  if (superAdmin[0]) {
    const existingMappings = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, superAdmin[0].id));
    const existingPermissionIds = new Set(existingMappings.map(item => item.permissionId));
    const missingMappings = permissions
      .filter(permission => !existingPermissionIds.has(permission.id))
      .map(permission => ({ roleId: superAdmin[0]!.id, permissionId: permission.id }));
    if (missingMappings.length) await db.insert(rolePermissions).values(missingMappings);
  }
}
