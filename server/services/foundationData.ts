import { and, eq } from "drizzle-orm";
import { PURCHASE_CATEGORY_CATALOG } from "../../shared/domain";
import { purchaseCategories, rolePermissions, systemPermissions, systemRoles, systemSettings } from "../../drizzle/schema";
import { SUPERVISOR_REVIEW_AUTO_APPROVE_SETTING_KEY } from "./supervisorReview";
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
    ["construction:read", "施工日报查看", "construction", "read"],
    ["construction:create", "施工日报新增", "construction", "create"],
    ["construction:edit", "施工日报编辑", "construction", "edit"],
    ["construction:submit", "施工日报提交", "construction", "submit"],
    ["construction:review", "施工日报审核", "construction", "review"],
    ["construction:void", "施工日报归档/作废", "construction", "void"],
    ["construction:export", "施工日报导出", "construction", "export"],
    ["construction:print", "施工日报打印", "construction", "print"],
    ["labor:read", "劳务工资查看", "labor", "read"],
    ["labor:create", "劳务工资新增", "labor", "create"],
    ["labor:edit", "劳务工资编辑", "labor", "edit"],
    ["labor:submit", "劳务工资提交", "labor", "submit"],
    ["labor:review", "劳务工资审核", "labor", "review"],
    ["labor:settle", "劳务工资发放", "labor", "settle"],
    ["labor:void", "劳务工资作废", "labor", "void"],
    ["labor:export", "劳务工资导出", "labor", "export"],
    ["labor:print", "劳务工资打印", "labor", "print"],
    ["machinery:read", "机械台账查看", "machinery", "read"],
    ["machinery:create", "机械业务新增", "machinery", "create"],
    ["machinery:edit", "机械业务编辑", "machinery", "edit"],
    ["machinery:review", "机械费用审核", "machinery", "review"],
    ["machinery:settle", "机械费用结算", "machinery", "settle"],
    ["machinery:void", "机械费用作废", "machinery", "void"],
    ["machinery:export", "机械台账导出", "machinery", "export"],
    ["machinery:print", "机械台账打印", "machinery", "print"],
    ["transport:read", "运输台账查看", "transport", "read"],
    ["transport:create", "运输趟次新增", "transport", "create"],
    ["transport:edit", "运输趟次编辑", "transport", "edit"],
    ["transport:submit", "运输趟次提交/刷卡", "transport", "submit"],
    ["transport:review", "运输趟次核验", "transport", "review"],
    ["transport:settle", "运输运费结算", "transport", "settle"],
    ["transport:void", "运输趟次作废", "transport", "void"],
    ["transport:export", "运输台账导出", "transport", "export"],
    ["transport:print", "运输运费打印", "transport", "print"],
    ["purchase:read", "采购仓储查看", "purchase", "read"],
    ["purchase:create", "采购申请/订单新增", "purchase", "create"],
    ["purchase:edit", "采购申请/订单编辑", "purchase", "edit"],
    ["purchase:submit", "采购申请提交", "purchase", "submit"],
    ["purchase:review", "采购订单审核", "purchase", "review"],
    ["purchase:settle", "采购结算", "purchase", "settle"],
    ["purchase:void", "采购单据作废", "purchase", "void"],
    ["purchase:export", "采购仓储导出", "purchase", "export"],
    ["purchase:print", "采购单据打印", "purchase", "print"],
    ["measurement:read", "工程计量查看", "measurement", "read"],
    ["measurement:create", "工程计量新增", "measurement", "create"],
    ["measurement:edit", "工程计量编辑", "measurement", "edit"],
    ["measurement:submit", "工程计量提交", "measurement", "submit"],
    ["measurement:review", "工程计量审核", "measurement", "review"],
    ["measurement:settle", "工程计量结算/确认收入", "measurement", "settle"],
    ["measurement:void", "工程计量作废", "measurement", "void"],
    ["measurement:export", "工程计量导出", "measurement", "export"],
    ["measurement:print", "工程计量打印", "measurement", "print"],
    ["contract:read", "外包合同查看", "contract", "read"],
    ["contract:create", "外包合同新增", "contract", "create"],
    ["contract:edit", "外包合同编辑", "contract", "edit"],
    ["contract:review", "外包合同启用/暂停", "contract", "review"],
    ["contract:void", "外包合同关闭/作废", "contract", "void"],
    ["contract:export", "外包合同导出", "contract", "export"],
    ["contract:print", "外包合同预览/打印", "contract", "print"],
    ["finance:read", "财务成本查看", "finance", "read"],
    ["finance:create", "财务流水/发票新增", "finance", "create"],
    ["finance:edit", "财务流水编辑", "finance", "edit"],
    ["finance:review", "财务发票审核", "finance", "review"],
    ["finance:settle", "财务支付/日结", "finance", "settle"],
    ["finance:void", "财务流水冲销/作废", "finance", "void"],
    ["finance:export", "财务报表导出", "finance", "export"],
    ["finance:print", "财务报表打印", "finance", "print"],
    ["evidence:read", "影像证据查看", "evidence", "read"],
    ["evidence:create", "影像证据上传", "evidence", "create"],
    ["evidence:edit", "影像证据编辑", "evidence", "edit"],
    ["evidence:void", "影像证据作废", "evidence", "void"],
    ["evidence:export", "影像证据导出", "evidence", "export"],
    ["evidence:print", "影像证据打印", "evidence", "print"],
  ] as const;
  /**
   * 基础数据会在多个后台路由上被幂等调用。不能在每次请求中按种子逐条查库，否则云数据库往返会把概览请求放大到十余秒。
   * 先并行读取当前字典，再仅批量插入缺失项；不更新已有记录，保留管理员在生产环境的配置。
   */
  const [existingRoleRows, existingPermissionRows, existingCategories, existingSupervisorReviewSetting] = await Promise.all([
    db.select({ id: systemRoles.id, code: systemRoles.code }).from(systemRoles),
    db.select({ id: systemPermissions.id, code: systemPermissions.code }).from(systemPermissions),
    db.select({ id: purchaseCategories.id }).from(purchaseCategories).limit(1),
    db.select({ id: systemSettings.id }).from(systemSettings).where(eq(systemSettings.settingKey, SUPERVISOR_REVIEW_AUTO_APPROVE_SETTING_KEY)).limit(1),
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
    existingSupervisorReviewSetting.length
      ? Promise.resolve()
      : db.insert(systemSettings).values({ category: "业务审批", settingKey: SUPERVISOR_REVIEW_AUTO_APPROVE_SETTING_KEY, displayName: "上级主管审核自动通过", valueJson: "false", valuePreview: "关闭：需上级主管人工审核", isSensitive: false, status: "published", version: 1, publishedAt: new Date(), remarks: "开启后仅自动通过配置为上级主管审核的业务节点；会计审核、付款、收入确认和终态锁定不受影响。" }),
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
