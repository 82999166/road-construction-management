import {
  bigint,
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 基础用户表由 Manus OAuth 登录流程维护。
 * `role` 仅保存模板级管理员标记；实际业务权限由角色分配表管理。
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /** 仅后台创建的普通本地账号使用；OAuth 用户保持为 null。 */
  localUsername: varchar("localUsername", { length: 64 }),
  /** 使用 scrypt 生成的不可逆口令摘要，绝不向客户端或审计日志返回。 */
  localPasswordHash: varchar("localPasswordHash", { length: 256 }),
  /** 停用后服务端会拒绝该本地账号的所有后续会话请求。 */
  localAccountStatus: mysqlEnum("localAccountStatus", ["active", "disabled"]).default("active").notNull(),
  /** 后台创建的本地管理人员可被限制为仅 PC、仅手机或双端登录；OAuth 身份保持双端兼容。 */
  localLoginMode: mysqlEnum("localLoginMode", ["pc", "mobile", "both"]).default("both").notNull(),
  /** 兼容旧账号资料的历史字段；当前本地账号不再强制首次登录改密。 */
  localPasswordChangeRequired: boolean("localPasswordChangeRequired").default(false).notNull(),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, table => ({
  localUsernameUnique: uniqueIndex("users_local_username_unique").on(table.localUsername),
}));

/** 可维护的组织树，支持集团、公司、项目部、部门和班组等节点。 */
export const organizations = mysqlTable(
  "organizations",
  {
    id: int("id").autoincrement().primaryKey(),
    parentId: int("parentId"),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    type: mysqlEnum("type", ["group", "company", "project_department", "department", "team"]).notNull(),
    managerUserId: int("managerUserId"),
    costCenterCode: varchar("costCenterCode", { length: 64 }),
    sortOrder: int("sortOrder").default(0).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("organizations_code_unique").on(table.code),
    parentIndex: index("organizations_parent_index").on(table.parentId),
  }),
);

/** 岗位字典决定可被授予的业务职责，不直接等同于系统权限。 */
export const positions = mysqlTable(
  "positions",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ codeUnique: uniqueIndex("positions_code_unique").on(table.code) }),
);

/** 项目及其可配置的层级树，例如项目、标段、工区、单位工程与作业面。 */
export const projects = mysqlTable(
  "projects",
  {
    id: int("id").autoincrement().primaryKey(),
    parentId: int("parentId"),
    organizationId: int("organizationId"),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    nodeType: varchar("nodeType", { length: 64 }).notNull(),
    projectType: mysqlEnum("projectType", ["highway", "railway", "municipal", "other"]),
    status: mysqlEnum("status", ["planning", "active", "suspended", "completed", "archived"]).default("planning").notNull(),
    startDate: date("startDate"),
    endDate: date("endDate"),
    costCenterCode: varchar("costCenterCode", { length: 64 }),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("projects_code_unique").on(table.code),
    parentIndex: index("projects_parent_index").on(table.parentId),
  }),
);

/** 登录用户与企业员工档案的映射。 */
export const userProfiles = mysqlTable(
  "user_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    employeeNo: varchar("employeeNo", { length: 64 }),
    phoneMasked: varchar("phoneMasked", { length: 32 }),
    organizationId: int("organizationId"),
    positionId: int("positionId"),
    status: mysqlEnum("status", ["pending", "active", "disabled"]).default("pending").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUnique: uniqueIndex("user_profiles_user_unique").on(table.userId),
  }),
);

/** 系统角色，可由 PC 超级管理后台维护。 */
export const systemRoles = mysqlTable(
  "system_roles",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    category: mysqlEnum("category", ["system", "business"]).default("business").notNull(),
    description: text("description"),
    isSystem: boolean("isSystem").default(false).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ codeUnique: uniqueIndex("system_roles_code_unique").on(table.code) }),
);

/** 权限点拆分至菜单、按钮和数据维度，以支持最小授权。 */
export const systemPermissions = mysqlTable(
  "system_permissions",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 128 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    module: varchar("module", { length: 64 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ codeUnique: uniqueIndex("system_permissions_code_unique").on(table.code) }),
);

/** 角色与权限的多对多授权关系。 */
export const rolePermissions = mysqlTable(
  "role_permissions",
  {
    id: int("id").autoincrement().primaryKey(),
    roleId: int("roleId").notNull(),
    permissionId: int("permissionId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ rolePermissionUnique: uniqueIndex("role_permissions_unique").on(table.roleId, table.permissionId) }),
);

/** 用户专属操作权限；某业务模块存在专属权限时，该模块以用户授权覆盖角色权限，仍受部门与项目范围约束。 */
export const userPermissions = mysqlTable(
  "user_permissions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    permissionId: int("permissionId").notNull(),
    grantedBy: int("grantedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userPermissionUnique: uniqueIndex("user_permissions_unique").on(table.userId, table.permissionId),
    userIndex: index("user_permissions_user_index").on(table.userId),
  }),
);

/** 用户的角色授权，同时约束项目/组织数据范围及有效期。 */
export const userRoleAssignments = mysqlTable(
  "user_role_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    roleId: int("roleId").notNull(),
    organizationId: int("organizationId"),
    projectId: int("projectId"),
    validFrom: datetime("validFrom"),
    validTo: datetime("validTo"),
    status: mysqlEnum("status", ["active", "revoked", "expired"]).default("active").notNull(),
    grantedBy: int("grantedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIndex: index("user_role_assignments_user_index").on(table.userId),
    roleIndex: index("user_role_assignments_role_index").on(table.roleId),
  }),
);

/**
 * 部门可办理的业务模块。人员仍通过角色授权表关联到部门与项目范围，
 * 本表则决定该部门整体可以进入哪些业务域；两层授权取交集后才允许办理业务。
 */
export const departmentBusinessScopes = mysqlTable(
  "department_business_scopes",
  {
    id: int("id").autoincrement().primaryKey(),
    organizationId: int("organizationId").notNull(),
    module: mysqlEnum("module", ["CONSTRUCTION", "LABOR", "MACHINERY", "TRANSPORT", "PURCHASING", "MEASUREMENT", "FINANCE", "EVIDENCE"]).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    configuredBy: int("configuredBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    departmentModuleUnique: uniqueIndex("department_business_scopes_unique").on(table.organizationId, table.module),
    organizationIndex: index("department_business_scopes_organization_index").on(table.organizationId),
  }),
);

/** 所有外部接口、业务参数和消息模板的统一配置表。敏感值只保存密文。 */
export const systemSettings = mysqlTable(
  "system_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    category: varchar("category", { length: 64 }).notNull(),
    settingKey: varchar("settingKey", { length: 128 }).notNull(),
    displayName: varchar("displayName", { length: 128 }).notNull(),
    valueJson: text("valueJson"),
    secretEncrypted: text("secretEncrypted"),
    valuePreview: varchar("valuePreview", { length: 256 }),
    isSensitive: boolean("isSensitive").default(false).notNull(),
    status: mysqlEnum("status", ["draft", "published", "disabled"]).default("draft").notNull(),
    version: int("version").default(1).notNull(),
    updatedBy: int("updatedBy"),
    publishedAt: datetime("publishedAt"),
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ settingKeyUnique: uniqueIndex("system_settings_key_unique").on(table.settingKey) }),
);

/** 配置发布记录用于回滚、双人复核和审计追溯。 */
export const configPublishLogs = mysqlTable("config_publish_logs", {
  id: int("id").autoincrement().primaryKey(),
  settingId: int("settingId").notNull(),
  operation: mysqlEnum("operation", ["create", "update", "publish", "disable", "rollback"]).notNull(),
  version: int("version").notNull(),
  operatorId: int("operatorId").notNull(),
  reviewerId: int("reviewerId"),
  snapshotJson: text("snapshotJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** 用户与系统操作的不可篡改审计索引，详细快照可存入对象存储。 */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId"),
    module: varchar("module", { length: 64 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("targetType", { length: 64 }),
    targetId: varchar("targetId", { length: 128 }),
    summary: varchar("summary", { length: 500 }).notNull(),
    beforeJson: text("beforeJson"),
    afterJson: text("afterJson"),
    ipAddress: varchar("ipAddress", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ moduleIndex: index("audit_logs_module_index").on(table.module, table.createdAt) }),
);

/**
 * 超级管理员主动发起的业务数据备份索引。
 * 文件本体位于受控对象存储；本表不保存数据库凭据、密码摘要或可直接访问的外链。
 */
export const dataBackups = mysqlTable(
  "data_backups",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    fileKey: varchar("fileKey", { length: 512 }).notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    recordCount: int("recordCount").notNull(),
    scopeVersion: varchar("scopeVersion", { length: 32 }).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    createdAtIndex: index("data_backups_created_at_index").on(table.createdAt),
    fileKeyUnique: uniqueIndex("data_backups_file_key_unique").on(table.fileKey),
  }),
);

/**
 * 施工日报是施工现场的受控业务主单。
 * 每条日报必须归属具体项目，现场内容、问题和安全说明只保存业务文字，禁止录入身份证、银行卡或密钥等敏感信息。
 */
export const constructionDailyReports = mysqlTable(
  "construction_daily_reports",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    reportDate: date("reportDate").notNull(),
    workArea: varchar("workArea", { length: 200 }).notNull(),
    weather: mysqlEnum("weather", ["sunny", "cloudy", "rainy", "snowy", "windy", "other"]).default("other").notNull(),
    workContent: text("workContent").notNull(),
    safetyNotes: varchar("safetyNotes", { length: 1000 }),
    issueNotes: varchar("issueNotes", { length: 1000 }),
    /** 由现场管理人员申报的累计完成比例，范围由服务端校验为 0 至 100。 */
    progressPercent: decimal("progressPercent", { precision: 5, scale: 2 }).default("0").notNull(),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "rejected", "locked"]).default("draft").notNull(),
    createdBy: int("createdBy").notNull(),
    /** 主管审核时填写的回复，确认通过或退回后与审核人、审核时间共同固化。 */
    reviewReply: varchar("reviewReply", { length: 1000 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectDateIndex: index("construction_daily_reports_project_date_index").on(table.projectId, table.reportDate),
    projectStatusIndex: index("construction_daily_reports_project_status_index").on(table.projectId, table.status),
  }),
);

/** 统一消息投递记录；历史企业微信记录仅保留审计，新业务只写入公众号或站内通道。 */
export const notificationRecords = mysqlTable(
  "notification_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    eventCode: varchar("eventCode", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 160 }).notNull(),
    recipientUserId: int("recipientUserId").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    deepLink: varchar("deepLink", { length: 512 }),
    status: mysqlEnum("status", ["pending", "sent", "failed", "skipped", "read"]).default("pending").notNull(),
    retryCount: int("retryCount").default(0).notNull(),
    sentAt: datetime("sentAt"),
    readAt: datetime("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    channel: mysqlEnum("channel", ["legacy_wecom", "official_account", "in_app"]).default("legacy_wecom").notNull(),
    providerMessageId: varchar("providerMessageId", { length: 128 }),
    failureCode: varchar("failureCode", { length: 64 }),
    lastAttemptedAt: datetime("lastAttemptedAt"),
  },
  table => ({ idempotencyUnique: uniqueIndex("notification_idempotency_unique").on(table.idempotencyKey) }),
);

/** 项目级风险规则；阈值由超级管理员维护，扫描结果始终保存实际计算口径。 */
export const projectRiskRules = mysqlTable(
  "project_risk_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    /** 单次加油量超过核定油箱容量的比例即预警，例如 1.10 表示超过 110%。 */
    maxFuelFillRatio: decimal("maxFuelFillRatio", { precision: 6, scale: 3 }).default("1.100").notNull(),
    /** 运输完成的平均速度超过该阈值即提示核验，避免只根据主观时长判断。 */
    maxTransportSpeedKmh: decimal("maxTransportSpeedKmh", { precision: 8, scale: 2 }).default("80.00").notNull(),
    /** 实际距离不小于 2 km 且运输耗时高于该值，标记为异常滞留待核验。 */
    maxTransportDurationMinutes: int("maxTransportDurationMinutes").default(360).notNull(),
    /** 已上班但超过该小时数未下班打卡，标记为考勤闭环异常。 */
    maxOpenCheckInHours: int("maxOpenCheckInHours").default(14).notNull(),
    /** 施工日报草稿、退回或逾期未审核超过该小时数，标记为施工管理待办。 */
    maxPendingReportHours: int("maxPendingReportHours").default(24).notNull(),
    /** 是否启用每日整改逾期升级；由平台 Heartbeat 调用，禁止以进程内定时器实现。 */
    overdueEscalationEnabled: boolean("overdueEscalationEnabled").default(false).notNull(),
    /** 中国标准时间的每日升级检查小时（0-23），转换为 Heartbeat UTC cron 后持久化运行。 */
    overdueEscalationHourChina: int("overdueEscalationHourChina").default(9).notNull(),
    /** Heartbeat 平台任务 UID，仅由受认证的调度创建/更新流程写入。 */
    overdueEscalationCronTaskUid: varchar("overdueEscalationCronTaskUid", { length: 65 }),
    createdBy: int("createdBy"),
    updatedBy: int("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ projectUnique: uniqueIndex("project_risk_rules_project_unique").on(table.projectId), overdueCronTaskIndex: index("project_risk_rules_overdue_cron_task_index").on(table.overdueEscalationCronTaskUid) }),
);

/** 确定性风险检测结果；仅保存业务编号、数值口径与处置，不复制敏感原始资料。 */
export const projectRiskAlerts = mysqlTable(
  "project_risk_alerts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    businessDate: date("businessDate").notNull(),
    category: mysqlEnum("category", ["construction", "attendance", "fuel", "transport"]).notNull(),
    severity: mysqlEnum("severity", ["notice", "warning", "critical"]).default("warning").notNull(),
    ruleCode: varchar("ruleCode", { length: 64 }).notNull(),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 128 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: varchar("summary", { length: 1000 }).notNull(),
    /** 仅保存数值、状态与业务编号，不保存姓名、手机号、身份证或设备指纹。 */
    evidenceJson: text("evidenceJson"),
    status: mysqlEnum("status", ["open", "acknowledged", "in_rectification", "resolved", "ignored"]).default("open").notNull(),
    notifiedAt: datetime("notifiedAt"),
    /** 整改责任人必须处于本项目有效管理范围内；其姓名不复制到预警记录。 */
    assigneeUserId: int("assigneeUserId"),
    assignedBy: int("assignedBy"),
    assignedAt: datetime("assignedAt"),
    dueAt: datetime("dueAt"),
    rectificationNote: varchar("rectificationNote", { length: 1000 }),
    rectifiedBy: int("rectifiedBy"),
    rectifiedAt: datetime("rectifiedAt"),
    /** 每日逾期升级提醒的最后时间与次数；结合通知幂等键避免同日重复升级。 */
    lastEscalatedAt: datetime("lastEscalatedAt"),
    escalationCount: int("escalationCount").default(0).notNull(),
    acknowledgedBy: int("acknowledgedBy"),
    acknowledgedAt: datetime("acknowledgedAt"),
    resolvedBy: int("resolvedBy"),
    resolvedAt: datetime("resolvedAt"),
    resolutionNote: varchar("resolutionNote", { length: 1000 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectRuleSourceDateUnique: uniqueIndex("project_risk_alerts_unique").on(table.projectId, table.ruleCode, table.sourceId, table.businessDate),
    projectStatusDateIndex: index("project_risk_alerts_project_status_date_index").on(table.projectId, table.status, table.businessDate),
    projectDueStatusIndex: index("project_risk_alerts_project_due_status_index").on(table.projectId, table.dueAt, table.status),
  }),
);

/** AI 仅使用脱敏的风险数量、类型与计算口径生成管理摘要，保留模型与输入快照供人工复核。 */
export const projectRiskBriefings = mysqlTable(
  "project_risk_briefings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    summaryJson: text("summaryJson").notNull(),
    alertSnapshotJson: text("alertSnapshotJson").notNull(),
    generatedBy: int("generatedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ projectPeriodIndex: index("project_risk_briefings_project_period_index").on(table.projectId, table.period, table.createdAt) }),
);

/**
 * 项目每日经营汇总的唯一调度配置。任务 UID 由平台 Heartbeat 返回并持久化，
 * 回调只能按该 UID 查找配置，不能信任请求体中的任意业务标识。
 */
export const dailyProjectDigestSchedules = mysqlTable(
  "daily_project_digest_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    scopeKey: varchar("scopeKey", { length: 64 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    timezone: varchar("timezone", { length: 64 }).default("Asia/Shanghai").notNull(),
    deliveryHour: int("deliveryHour").default(20).notNull(),
    deliveryMinute: int("deliveryMinute").default(0).notNull(),
    includeEmptyProjects: boolean("includeEmptyProjects").default(false).notNull(),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    lastAttemptedAt: datetime("lastAttemptedAt"),
    lastSuccessfulBusinessDate: date("lastSuccessfulBusinessDate"),
    lastResultJson: text("lastResultJson"),
    createdBy: int("createdBy"),
    updatedBy: int("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scopeKeyUnique: uniqueIndex("daily_project_digest_schedules_scope_unique").on(table.scopeKey),
    cronTaskUidIndex: index("daily_project_digest_schedules_task_uid_index").on(table.scheduleCronTaskUid),
  }),
);

/** 每个项目、每个业务日的一份汇总运行快照，用于幂等、审计与失败复核。 */
export const dailyProjectDigestRuns = mysqlTable(
  "daily_project_digest_runs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    scheduleId: int("scheduleId").notNull(),
    projectId: int("projectId").notNull(),
    businessDate: date("businessDate").notNull(),
    status: mysqlEnum("status", ["pending", "completed", "partial", "skipped", "failed"]).default("pending").notNull(),
    summaryJson: text("summaryJson").notNull(),
    recipientCount: int("recipientCount").default(0).notNull(),
    deliveredCount: int("deliveredCount").default(0).notNull(),
    failedCount: int("failedCount").default(0).notNull(),
    completedAt: datetime("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scheduleProjectDateUnique: uniqueIndex("daily_project_digest_runs_schedule_project_date_unique").on(table.scheduleId, table.projectId, table.businessDate),
    scheduleDateIndex: index("daily_project_digest_runs_schedule_date_index").on(table.scheduleId, table.businessDate),
  }),
);

/** 员工关注认证服务号后的通知身份；OpenID 仅保存密文与不可逆指纹。 */
export const officialAccountBindings = mysqlTable(
  "official_account_bindings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    openIdEncrypted: text("openIdEncrypted").notNull(),
    openIdFingerprint: varchar("openIdFingerprint", { length: 64 }).notNull(),
    bindingSource: mysqlEnum("bindingSource", ["wechat_oauth", "admin_verified"]).default("wechat_oauth").notNull(),
    status: mysqlEnum("status", ["pending", "active", "unsubscribed", "revoked", "disabled"]).default("pending").notNull(),
    boundAt: datetime("boundAt"),
    lastVerifiedAt: datetime("lastVerifiedAt"),
    lastFailureAt: datetime("lastFailureAt"),
    failureCount: int("failureCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUnique: uniqueIndex("official_account_bindings_user_unique").on(table.userId),
    openIdUnique: uniqueIndex("official_account_bindings_openid_fingerprint_unique").on(table.openIdFingerprint),
    statusIndex: index("official_account_bindings_status_index").on(table.status),
  }),
);

/**
 * 服务号受控群发主单。群发内容在提交审批后不可直接覆盖，收件人范围在发布时重新解析并保存最小快照，
 * 从而避免将 OpenID、手机号等敏感通知身份复制到业务审批表中。
 */
export const officialAccountBroadcasts = mysqlTable(
  "official_account_broadcasts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    broadcastNo: varchar("broadcastNo", { length: 64 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    deepLink: varchar("deepLink", { length: 512 }),
    audienceType: mysqlEnum("audienceType", ["project", "organization", "role"]).notNull(),
    projectId: int("projectId"),
    organizationId: int("organizationId"),
    roleCode: varchar("roleCode", { length: 64 }),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "rejected", "publishing", "published", "partial", "failed", "cancelled"]).default("draft").notNull(),
    reviewNote: varchar("reviewNote", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    publishedBy: int("publishedBy"),
    publishedAt: datetime("publishedAt"),
    recipientCount: int("recipientCount").default(0).notNull(),
    deliveredCount: int("deliveredCount").default(0).notNull(),
    failedCount: int("failedCount").default(0).notNull(),
    skippedCount: int("skippedCount").default(0).notNull(),
    /** 群发默认要求收件人在系统内确认“收到”，确认数仅统计已成功投递的收件人。 */
    requiresAcknowledgement: boolean("requiresAcknowledgement").default(true).notNull(),
    acknowledgedCount: int("acknowledgedCount").default(0).notNull(),
    /** 仅记录收件人数、用户 ID 与选择范围；绝不包含 OpenID 或解密后的绑定信息。 */
    audienceSnapshotJson: text("audienceSnapshotJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    broadcastNoUnique: uniqueIndex("official_account_broadcasts_no_unique").on(table.broadcastNo),
    statusIndex: index("official_account_broadcasts_status_index").on(table.status, table.updatedAt),
    scopeIndex: index("official_account_broadcasts_scope_index").on(table.audienceType, table.projectId, table.organizationId, table.roleCode),
  }),
);

/** 每次群发按收件人保留独立投递结果，发布重试不会生成重复的服务号通知。 */
export const officialAccountBroadcastDeliveries = mysqlTable(
  "official_account_broadcast_deliveries",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    broadcastId: bigint("broadcastId", { mode: "number" }).notNull(),
    recipientUserId: int("recipientUserId").notNull(),
    /** 发布时冻结的可读人员资料，仅用于受控审计展示，不返回用户内部编号或微信身份。 */
    recipientNameSnapshot: varchar("recipientNameSnapshot", { length: 128 }),
    recipientRoleSnapshot: varchar("recipientRoleSnapshot", { length: 300 }),
    recipientScopeSnapshot: varchar("recipientScopeSnapshot", { length: 500 }),
    notificationRecordId: bigint("notificationRecordId", { mode: "number" }),
    deliveryStatus: mysqlEnum("deliveryStatus", ["pending", "sent", "failed", "skipped"]).default("pending").notNull(),
    deliveryReason: varchar("deliveryReason", { length: 64 }),
    providerMessageId: varchar("providerMessageId", { length: 128 }),
    attemptedAt: datetime("attemptedAt"),
    deliveredAt: datetime("deliveredAt"),
    acknowledgementStatus: mysqlEnum("acknowledgementStatus", ["not_required", "pending", "acknowledged"]).default("pending").notNull(),
    acknowledgedAt: datetime("acknowledgedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    broadcastRecipientUnique: uniqueIndex("official_account_broadcast_deliveries_recipient_unique").on(table.broadcastId, table.recipientUserId),
    broadcastStatusIndex: index("official_account_broadcast_deliveries_status_index").on(table.broadcastId, table.deliveryStatus),
    broadcastAcknowledgementIndex: index("official_account_broadcast_deliveries_acknowledgement_index").on(table.broadcastId, table.acknowledgementStatus),
  }),
);

/** 服务号扫码绑定的短时请求；仅保存令牌指纹，扫码事件到达后一次性消费。 */
export const officialAccountBindingRequests = mysqlTable("official_account_binding_requests", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenFingerprint: varchar("tokenFingerprint", { length: 64 }).notNull(),
  expiresAt: datetime("expiresAt").notNull(),
  consumedAt: datetime("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  tokenUnique: uniqueIndex("official_account_binding_requests_token_unique").on(table.tokenFingerprint),
  userIndex: index("official_account_binding_requests_user_index").on(table.userId),
}));

/** 固定 12 类采购字典，后台仅可调整排序和停启用，不能变更标准编码。 */
export const purchaseCategories = mysqlTable(
  "purchase_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    isFixed: boolean("isFixed").default(true).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ codeUnique: uniqueIndex("purchase_categories_code_unique").on(table.code) }),
);

/** 劳务实名制人员档案，身份证、银行卡等敏感原值仅以密文存储。 */
export const laborWorkers = mysqlTable(
  "labor_workers",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    teamName: varchar("teamName", { length: 128 }),
    workerCategory: mysqlEnum("workerCategory", ["company_admin", "labor_team", "temporary_daily"]).default("labor_team").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    realName: varchar("realName", { length: 64 }).notNull(),
    identityNoEncrypted: text("identityNoEncrypted"),
    phoneEncrypted: text("phoneEncrypted"),
    bankAccountEncrypted: text("bankAccountEncrypted"),
    bankName: varchar("bankName", { length: 128 }),
    /** 实名资料由劳资管理人员人工核验后的状态，不替代身份证密文与证照档案。 */
    identityVerificationStatus: mysqlEnum("identityVerificationStatus", ["pending", "verified", "rejected"]).default("pending").notNull(),
    /** 审核结论说明不得填写身份证号、银行卡号等敏感原文。 */
    identityVerificationNote: varchar("identityVerificationNote", { length: 500 }),
    identityVerifiedAt: datetime("identityVerifiedAt"),
    identityVerifiedBy: int("identityVerifiedBy"),
    attendanceStatus: mysqlEnum("attendanceStatus", ["pending", "active", "left"]).default("pending").notNull(),
    entryDate: date("entryDate"),
    exitDate: date("exitDate"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ projectIndex: index("labor_workers_project_index").on(table.projectId) }),
);

/** 考勤与工时记录，为工资核算提供可追溯来源。 */
export const attendanceRecords = mysqlTable(
  "attendance_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    attendanceDate: date("attendanceDate").notNull(),
    workHours: decimal("workHours", { precision: 7, scale: 2 }).default("0").notNull(),
    overtimeHours: decimal("overtimeHours", { precision: 7, scale: 2 }).default("0").notNull(),
    /** 现场考勤异常、请假原因及补充说明；不得写入身份证、银行卡等敏感原文。 */
    note: varchar("note", { length: 500 }),
    source: mysqlEnum("source", ["manual", "mobile", "device", "import"]).default("manual").notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    status: mysqlEnum("status", ["draft", "confirmed", "locked"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ workerDateUnique: uniqueIndex("attendance_worker_date_unique").on(table.workerId, table.attendanceDate) }),
);

/** 移动端一键打卡台账：设备标识仅保存不可逆指纹，定位仅用于现场考勤复核。 */
export const attendanceCheckIns = mysqlTable(
  "attendance_check_ins",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    projectId: int("projectId").notNull(),
    businessDate: date("businessDate").notNull(),
    checkedInAt: datetime("checkedInAt").notNull(),
    /** 下班打卡仅在本人完成当日上班打卡后写入；为空表示当天尚未完成下班打卡。 */
    checkedOutAt: datetime("checkedOutAt"),
    deviceFingerprintHash: varchar("deviceFingerprintHash", { length: 128 }).notNull(),
    deviceLabel: varchar("deviceLabel", { length: 160 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    locationAccuracyMeters: decimal("locationAccuracyMeters", { precision: 10, scale: 2 }),
    status: mysqlEnum("status", ["normal", "location_missing"]).default("normal").notNull(),
    checkoutLongitude: decimal("checkoutLongitude", { precision: 10, scale: 7 }),
    checkoutLatitude: decimal("checkoutLatitude", { precision: 10, scale: 7 }),
    checkoutLocationAccuracyMeters: decimal("checkoutLocationAccuracyMeters", { precision: 10, scale: 2 }),
    checkoutStatus: mysqlEnum("checkoutStatus", ["normal", "location_missing"]),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userProjectDateUnique: uniqueIndex("attendance_check_ins_user_project_date_unique").on(table.userId, table.projectId, table.businessDate),
    projectDateIndex: index("attendance_check_ins_project_date_index").on(table.projectId, table.businessDate),
    deviceIndex: index("attendance_check_ins_device_index").on(table.deviceFingerprintHash, table.businessDate),
  }),
);

/** 考勤设备绑定台账，仅保存服务端生成的设备匿名指纹和可读设备标签。 */
export const attendanceDeviceBindings = mysqlTable(
  "attendance_device_bindings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    deviceFingerprintHash: varchar("deviceFingerprintHash", { length: 128 }).notNull(),
    deviceLabel: varchar("deviceLabel", { length: 160 }),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    firstBoundAt: datetime("firstBoundAt").notNull(),
    lastUsedAt: datetime("lastUsedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userDeviceUnique: uniqueIndex("attendance_device_bindings_user_device_unique").on(table.userId, table.deviceFingerprintHash),
    userStatusIndex: index("attendance_device_bindings_user_status_index").on(table.userId, table.status),
  }),
);

/** 工资条记录，金额与状态须经会计审核后才能推送。 */
export const payrollStatements = mysqlTable(
  "payroll_statements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    payableAmount: decimal("payableAmount", { precision: 16, scale: 2 }).notNull(),
    deductionAmount: decimal("deductionAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    actualAmount: decimal("actualAmount", { precision: 16, scale: 2 }).notNull(),
    bankAccountMasked: varchar("bankAccountMasked", { length: 64 }),
    status: mysqlEnum("status", ["draft", "reviewing", "approved", "paid", "void"]).default("draft").notNull(),
    /** 工资条提交审核时记录责任人；历史数据允许为空，避免破坏既有归档记录。 */
    submittedBy: int("submittedBy"),
    submittedAt: datetime("submittedAt"),
    accountantId: int("accountantId"),
    reviewedAt: datetime("reviewedAt"),
    paidAt: datetime("paidAt"),
    /** 银行或资金系统的付款凭证号；仅保存引用，不保存银行卡、流水详情或支付密钥。 */
    paymentReference: varchar("paymentReference", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ workerProjectPeriodUnique: uniqueIndex("payroll_worker_project_period_unique").on(table.workerId, table.projectId, table.period) }),
);

/** 临时人员按日结算：审核通过不代表付款，只有登记实际付款后才结算完毕。 */
export const temporaryDailyWageSettlements = mysqlTable(
  "temporary_daily_wage_settlements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    settlementDate: date("settlementDate").notNull(),
    payableAmount: decimal("payableAmount", { precision: 16, scale: 2 }).notNull(),
    deductionAmount: decimal("deductionAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    actualAmount: decimal("actualAmount", { precision: 16, scale: 2 }).notNull(),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "reviewing", "approved", "paid", "void"]).default("draft").notNull(),
    submittedBy: int("submittedBy"),
    submittedAt: datetime("submittedAt"),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    paidBy: int("paidBy"),
    paidAt: datetime("paidAt"),
    paymentReference: varchar("paymentReference", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ workerDateUnique: uniqueIndex("temporary_daily_wage_worker_date_unique").on(table.workerId, table.settlementDate), projectDateIndex: index("temporary_daily_wage_project_date_index").on(table.projectId, table.settlementDate, table.status) }),
);

/** 统一员工档案：公司管理人员、机械操作员与施工队工人统一投影，避免将账号与劳务实名档案混为一体。 */
export const employeeProfiles = mysqlTable(
  "employee_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 公司管理人员或机械操作员对应的系统账号；施工队工人可仅关联 laborWorkerId。 */
    userId: int("userId"),
    /** 施工队工人对应的劳务实名档案；公司人员可为空。 */
    laborWorkerId: int("laborWorkerId"),
    projectId: int("projectId"),
    employeeType: mysqlEnum("employeeType", ["management", "operator", "construction_worker"]).notNull(),
    teamName: varchar("teamName", { length: 128 }),
    employmentStatus: mysqlEnum("employmentStatus", ["active", "suspended", "left"]).default("active").notNull(),
    joinedAt: date("joinedAt"),
    leftAt: date("leftAt"),
    salaryBasis: mysqlEnum("salaryBasis", ["monthly", "daily", "hourly", "piecework"]).default("monthly").notNull(),
    baseSalary: decimal("baseSalary", { precision: 16, scale: 2 }),
    remarks: varchar("remarks", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ userIndex: index("employee_profiles_user_index").on(table.userId), workerIndex: index("employee_profiles_worker_index").on(table.laborWorkerId), projectTypeIndex: index("employee_profiles_project_type_index").on(table.projectId, table.employeeType, table.employmentStatus) }),
);

/** 员工保险台账：按保单留存购买日期与到期日期，供后台到期预警和人事审查使用。 */
export const employeeInsurancePolicies = mysqlTable(
  "employee_insurance_policies",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeProfileId: int("employeeProfileId").notNull(),
    insuranceType: mysqlEnum("insuranceType", ["work_injury", "accident", "medical", "employer_liability", "other"]).notNull(),
    providerName: varchar("providerName", { length: 128 }),
    policyReference: varchar("policyReference", { length: 128 }),
    purchasedAt: date("purchasedAt").notNull(),
    expiresAt: date("expiresAt").notNull(),
    status: mysqlEnum("status", ["active", "expired", "cancelled"]).default("active").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ profileExpiryIndex: index("employee_insurance_policies_profile_expiry_index").on(table.employeeProfileId, table.expiresAt, table.status) }),
);

/** 公司自有与外租机械统一台账。 */
export const machines = mysqlTable(
  "machines",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId"),
    /** 机械操作员/司机的登录用户标识；允许为空以兼容外租机械暂未绑定人员的场景。 */
    operatorUserId: int("operatorUserId"),
    /** 机械实际驾驶员可与系统操作员不同；姓名用于项目台账展示，手机号加密存储。 */
    driverName: varchar("driverName", { length: 128 }),
    driverPhoneEncrypted: text("driverPhoneEncrypted"),
    driverPhoneMasked: varchar("driverPhoneMasked", { length: 32 }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    model: varchar("model", { length: 128 }),
    ownership: mysqlEnum("ownership", ["owned", "leased"]).notNull(),
    supplierName: varchar("supplierName", { length: 200 }),
    plateOrAssetNo: varchar("plateOrAssetNo", { length: 64 }),
    /** 核定油箱容量仅用于柴油领用合理性检测，不替代油表读数。 */
    fuelTankCapacityLiters: decimal("fuelTankCapacityLiters", { precision: 10, scale: 2 }),
    status: mysqlEnum("status", ["idle", "working", "repairing", "offsite", "retired"]).default("idle").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ codeUnique: uniqueIndex("machines_code_unique").on(table.code) }),
);

/** 机械租赁计价规则，由合同和项目参数配置，而非硬编码。 */
export const machineLeaseRules = mysqlTable(
  "machine_lease_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    machineId: int("machineId").notNull(),
    projectId: int("projectId").notNull(),
    billingType: mysqlEnum("billingType", ["monthly", "daily", "hourly", "shift"]).notNull(),
    rate: decimal("rate", { precision: 16, scale: 2 }).notNull(),
    overtimeHourlyRate: decimal("overtimeHourlyRate", { precision: 16, scale: 2 }).default("0").notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ machineIndex: index("machine_lease_rules_machine_index").on(table.machineId, table.status) }),
);

/** 机械油料、修理、加班、进退场等成本明细。 */
export const machineCostRecords = mysqlTable(
  "machine_cost_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    machineId: int("machineId").notNull(),
    projectId: int("projectId").notNull(),
    costType: mysqlEnum("costType", ["fuel", "repair", "overtime", "mobilization", "other"]).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 3 }).default("0").notNull(),
    unitPrice: decimal("unitPrice", { precision: 16, scale: 2 }).default("0").notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    /** 项目部或加油站柴油领用生成的机械油料成本关联；手工成本保持为空。 */
    dieselRefuelRecordId: bigint("dieselRefuelRecordId", { mode: "number" }),
    occurredAt: datetime("occurredAt").notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    /** 机械费用的现场说明、维修内容或票据备注；影像文件仍统一保存于证据表。 */
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    machineDateIndex: index("machine_cost_records_machine_date_index").on(table.machineId, table.occurredAt),
    dieselRefuelUnique: uniqueIndex("machine_cost_records_diesel_refuel_unique").on(table.dieselRefuelRecordId),
  }),
);

/**
 * 会计机械月度明细结算快照。
 * 以会计模板的“机械产值、司机工资、维修费、油耗、机械分成、签字、备注”为准；
 * 录入端只保存出勤、司机固定工资、加班小时和签字等原始口径，所有金额均由服务端以
 * 当前有效租赁规则与已审核业务成本生成，防止客户端篡改结算金额。
 */
export const machineMonthlyStatements = mysqlTable(
  "machine_monthly_statements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    machineId: int("machineId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    driverUserId: int("driverUserId"),
    /** 与会计表的司机姓名、车主姓名、型号字段对应；生成快照后不随档案改名而覆写历史。 */
    driverNameSnapshot: varchar("driverNameSnapshot", { length: 128 }),
    ownerNameSnapshot: varchar("ownerNameSnapshot", { length: 200 }),
    machineModelSnapshot: varchar("machineModelSnapshot", { length: 128 }),
    leaseBillingType: varchar("leaseBillingType", { length: 16 }).notNull(),
    leaseRate: decimal("leaseRate", { precision: 16, scale: 2 }).default("0").notNull(),
    machineOvertimeRate: decimal("machineOvertimeRate", { precision: 16, scale: 2 }).default("0").notNull(),
    /** 机械产值原始口径。出勤天数按模板采用 30 天月、10 小时工作日折算。 */
    machineWorkDays: decimal("machineWorkDays", { precision: 8, scale: 2 }).default("0").notNull(),
    machineOvertimeHours: decimal("machineOvertimeHours", { precision: 10, scale: 2 }).default("0").notNull(),
    driverMonthlyWage: decimal("driverMonthlyWage", { precision: 16, scale: 2 }).default("0").notNull(),
    driverWorkDays: decimal("driverWorkDays", { precision: 8, scale: 2 }).default("0").notNull(),
    driverOvertimeHours: decimal("driverOvertimeHours", { precision: 10, scale: 2 }).default("0").notNull(),
    /** 服务端快照计算结果。 */
    machineBaseOutput: decimal("machineBaseOutput", { precision: 16, scale: 2 }).default("0").notNull(),
    machineOvertimeOutput: decimal("machineOvertimeOutput", { precision: 16, scale: 2 }).default("0").notNull(),
    totalOutput: decimal("totalOutput", { precision: 16, scale: 2 }).default("0").notNull(),
    driverOvertimeWage: decimal("driverOvertimeWage", { precision: 16, scale: 2 }).default("0").notNull(),
    driverTotalWage: decimal("driverTotalWage", { precision: 16, scale: 2 }).default("0").notNull(),
    repairAmount: decimal("repairAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    fuelLiters: decimal("fuelLiters", { precision: 14, scale: 3 }).default("0").notNull(),
    fuelAmount: decimal("fuelAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    deductionAmount: decimal("deductionAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    shareBaseAmount: decimal("shareBaseAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    machineShareAmount: decimal("machineShareAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    signatureName: varchar("signatureName", { length: 128 }),
    signedAt: datetime("signedAt"),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "settled", "void"]).default("draft").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectPeriodIndex: index("machine_monthly_statements_project_period_index").on(table.projectId, table.period, table.status),
    machinePeriodUnique: uniqueIndex("machine_monthly_statements_machine_period_unique").on(table.machineId, table.projectId, table.period),
  }),
);

/**
 * 单台机械每日作业与收益记录。日度收益、司机工资与工时在此受控留痕；
 * 维修、保养、油料仍分别读取原始成本及柴油台账，避免用前端汇总替代审计凭据。
 */
export const machineDailyOperations = mysqlTable(
  "machine_daily_operations",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    machineId: int("machineId").notNull(),
    occurredOn: date("occurredOn").notNull(),
    operatorUserId: int("operatorUserId"),
    workHours: decimal("workHours", { precision: 8, scale: 2 }).default("0").notNull(),
    overtimeHours: decimal("overtimeHours", { precision: 8, scale: 2 }).default("0").notNull(),
    outputAmount: decimal("outputAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    driverWageAmount: decimal("driverWageAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "settled", "void"]).default("draft").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    machineProjectDayUnique: uniqueIndex("machine_daily_operations_machine_project_day_unique").on(table.machineId, table.projectId, table.occurredOn),
    projectDateIndex: index("machine_daily_operations_project_date_index").on(table.projectId, table.occurredOn, table.status),
  }),
);
/** 车辆与机械共用的维修、保养费用台账；不替代既有机械油料/租赁成本明细。 */
export const assetMaintenanceRecords = mysqlTable(
  "asset_maintenance_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    assetType: mysqlEnum("assetType", ["vehicle", "machine"]).notNull(),
    assetId: int("assetId").notNull(),
    projectId: int("projectId").notNull(),
    costCategory: mysqlEnum("costCategory", ["maintenance", "repair"]).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    occurredAt: datetime("occurredAt").notNull(),
    serviceProvider: varchar("serviceProvider", { length: 160 }),
    meterReading: decimal("meterReading", { precision: 14, scale: 2 }),
    nextDueAt: date("nextDueAt"),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ assetDateIndex: index("asset_maintenance_records_asset_date_index").on(table.assetType, table.assetId, table.occurredAt), projectStatusIndex: index("asset_maintenance_records_project_status_index").on(table.projectId, table.status) }),
);

/** 渣土车运输车辆档案与货厢参数。 */
export const transportVehicles = mysqlTable(
  "transport_vehicles",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    /** 车辆所属组织由超级管理员维护，用于归属治理；运输趟次仍以 projectId 作为实际业务范围。 */
    organizationId: int("organizationId"),
    plateNo: varchar("plateNo", { length: 32 }).notNull(),
    /** 车辆类型仅描述车辆资源属性，不参与运费计算；默认渣土车兼容既有运输台账。 */
    vehicleType: mysqlEnum("vehicleType", ["dump_truck", "tractor", "mixer", "flatbed", "pickup", "suv", "other"]).default("dump_truck").notNull(),
    /** 自有或外租；既有车辆默认自有，外租车辆的租金和租期保存于独立租赁规则表。 */
    ownership: mysqlEnum("ownership", ["owned", "leased"]).default("owned").notNull(),
    ownerName: varchar("ownerName", { length: 128 }),
    driverUserId: int("driverUserId"),
    driverName: varchar("driverName", { length: 128 }),
    driverPhoneEncrypted: text("driverPhoneEncrypted"),
    driverPhoneMasked: varchar("driverPhoneMasked", { length: 32 }),
    boxLengthMeters: decimal("boxLengthMeters", { precision: 8, scale: 3 }).notNull(),
    boxWidthMeters: decimal("boxWidthMeters", { precision: 8, scale: 3 }).notNull(),
    boxHeightMeters: decimal("boxHeightMeters", { precision: 8, scale: 3 }).notNull(),
    loadFactor: decimal("loadFactor", { precision: 5, scale: 3 }).default("1").notNull(),
    payloadTons: decimal("payloadTons", { precision: 10, scale: 3 }),
    /** 核定油箱容量仅用于柴油领用合理性检测，不替代油表读数。 */
    fuelTankCapacityLiters: decimal("fuelTankCapacityLiters", { precision: 10, scale: 2 }),
    status: mysqlEnum("status", ["active", "suspended", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ plateUnique: uniqueIndex("transport_vehicles_plate_unique").on(table.plateNo) }),
);

/** 外租车辆租金规则；车辆自有时不建立启用规则，历史外租合同继续保留用于结算与审计。 */
export const transportVehicleLeaseRules = mysqlTable(
  "transport_vehicle_lease_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    billingType: mysqlEnum("billingType", ["monthly", "daily", "hourly", "shift"]).notNull(),
    rate: decimal("rate", { precision: 16, scale: 2 }).notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ vehicleStatusIndex: index("transport_vehicle_lease_rules_vehicle_status_index").on(table.vehicleId, table.status) }),
);

/** 项目柴油指导单价；项目部供油按生效规则取价，历史领用保留单价快照。 */
export const dieselGuidelinePrices = mysqlTable(
  "diesel_guideline_prices",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    pricePerLiter: decimal("pricePerLiter", { precision: 16, scale: 2 }).notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["draft", "active", "disabled"]).default("draft").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ projectStatusDateIndex: index("diesel_guideline_prices_project_status_date_index").on(table.projectId, table.status, table.effectiveFrom) }),
);

/**
 * 项目柴油价格异常预警规则。实际现金单价相对同一项目同一供应商的上一笔有效现金单价
 * 超过阈值时，服务端在柴油审计中留痕并向对账台账返回异常标识；历史油价快照不被修改。
 */
export const dieselPriceAlertRules = mysqlTable(
  "diesel_price_alert_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    thresholdPercent: decimal("thresholdPercent", { precision: 8, scale: 2 }).default("10.00").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ projectUnique: uniqueIndex("diesel_price_alert_rules_project_unique").on(table.projectId) }),
);

/**
 * 柴油领用/加油台账。车辆项目部供油可在运输结算中扣减，机械供油自动计入机械油料成本；
 * 所有金额均由服务端按升数和价格快照计算，避免前端修改金额。
 */
export const dieselRefuelRecords = mysqlTable(
  "diesel_refuel_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    recordNo: varchar("recordNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    assetType: mysqlEnum("assetType", ["vehicle", "machine"]).notNull(),
    vehicleId: int("vehicleId"),
    machineId: int("machineId"),
    /** 车辆需从运费扣油款时必须关联具体运输趟次；已结算趟次不得重复领用。 */
    transportTripId: bigint("transportTripId", { mode: "number" }),
    supplyMethod: mysqlEnum("supplyMethod", ["project_supply", "external_station"]).notNull(),
    stationOrSupplierName: varchar("stationOrSupplierName", { length: 160 }),
    liters: decimal("liters", { precision: 12, scale: 3 }).notNull(),
    /** 加油站自购填写实际单价；项目部供油由有效指导价快照写入。 */
    actualUnitPrice: decimal("actualUnitPrice", { precision: 16, scale: 2 }),
    appliedUnitPrice: decimal("appliedUnitPrice", { precision: 16, scale: 2 }).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    deductFromFreight: boolean("deductFromFreight").default(false).notNull(),
    refueledAt: datetime("refueledAt").notNull(),
    meterReading: decimal("meterReading", { precision: 14, scale: 2 }),
    receiptNo: varchar("receiptNo", { length: 64 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"]).default("draft").notNull(),
    createdBy: int("createdBy").notNull(),
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    recordNoUnique: uniqueIndex("diesel_refuel_records_no_unique").on(table.recordNo),
    projectDateIndex: index("diesel_refuel_records_project_date_index").on(table.projectId, table.refueledAt),
    tripStatusIndex: index("diesel_refuel_records_trip_status_index").on(table.transportTripId, table.status),
    vehicleDateIndex: index("diesel_refuel_records_vehicle_date_index").on(table.vehicleId, table.refueledAt),
    machineDateIndex: index("diesel_refuel_records_machine_date_index").on(table.machineId, table.refueledAt),
  }),
);

/**
 * 射频卡写卡器台账。当前仅维护型号与使用状态，实际 USB/串口/网络硬件协议后续以受控设备适配器接入，
 * 任何前端都不得直接向本地硬件发出未审计写卡指令。
 */
export const rfidWriterDevices = mysqlTable(
  "rfid_writer_devices",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    deviceCode: varchar("deviceCode", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 128 }).notNull(),
    /** 用户要求先预留的写卡器型号；可为空以兼容采购前的登记。 */
    model: varchar("model", { length: 128 }),
    connectionMode: mysqlEnum("connectionMode", ["manual_placeholder", "usb", "serial", "network"]).default("manual_placeholder").notNull(),
    status: mysqlEnum("status", ["active", "disabled", "maintenance"]).default("active").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    lastConfirmedAt: datetime("lastConfirmedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectDeviceCodeUnique: uniqueIndex("rfid_writer_devices_project_code_unique").on(table.projectId, table.deviceCode),
    projectStatusIndex: index("rfid_writer_devices_project_status_index").on(table.projectId, table.status),
  }),
);

/**
 * 车辆与射频卡的受控绑定。卡 UID 与司机电话均为个人/设备标识，只存不可逆指纹或 AES-GCM 密文；
 * 卡片实际载荷由写卡任务在管理员确认时临时生成，数据库不保存可直接克隆的明文卡片内容。
 */
export const transportVehicleRfidCards = mysqlTable(
  "transport_vehicle_rfid_cards",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    vehicleId: int("vehicleId").notNull(),
    writerDeviceId: int("writerDeviceId"),
    cardUidFingerprint: varchar("cardUidFingerprint", { length: 64 }).notNull(),
    cardUidMasked: varchar("cardUidMasked", { length: 32 }).notNull(),
    /** 仅用于管理员在写卡时临时生成载荷和司机本人通知，不向普通列表或事件审计返回。 */
    driverPhoneEncrypted: text("driverPhoneEncrypted"),
    driverPhoneMasked: varchar("driverPhoneMasked", { length: 32 }),
    payloadVersion: int("payloadVersion").default(1).notNull(),
    status: mysqlEnum("status", ["active", "suspended", "revoked"]).default("active").notNull(),
    issuedAt: datetime("issuedAt"),
    lastWrittenAt: datetime("lastWrittenAt"),
    revokedAt: datetime("revokedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    cardUidUnique: uniqueIndex("transport_vehicle_rfid_cards_uid_unique").on(table.cardUidFingerprint),
    vehicleStatusIndex: index("transport_vehicle_rfid_cards_vehicle_status_index").on(table.vehicleId, table.status),
    projectStatusIndex: index("transport_vehicle_rfid_cards_project_status_index").on(table.projectId, table.status),
  }),
);

/** 每次写卡、补写或挂失均生成任务与载荷指纹，硬件确认失败也要留下审计而不得静默覆盖。 */
export const rfidCardWriteJobs = mysqlTable(
  "rfid_card_write_jobs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    jobNo: varchar("jobNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    vehicleId: int("vehicleId").notNull(),
    cardId: bigint("cardId", { mode: "number" }).notNull(),
    writerDeviceId: int("writerDeviceId"),
    action: mysqlEnum("action", ["issue", "rewrite", "revoke"]).notNull(),
    payloadFingerprint: varchar("payloadFingerprint", { length: 64 }).notNull(),
    payloadVersion: int("payloadVersion").notNull(),
    status: mysqlEnum("status", ["prepared", "confirmed", "failed", "cancelled"]).default("prepared").notNull(),
    failureReason: varchar("failureReason", { length: 500 }),
    preparedBy: int("preparedBy").notNull(),
    confirmedBy: int("confirmedBy"),
    confirmedAt: datetime("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    jobNoUnique: uniqueIndex("rfid_card_write_jobs_no_unique").on(table.jobNo),
    cardCreatedIndex: index("rfid_card_write_jobs_card_created_index").on(table.cardId, table.createdAt),
    projectStatusIndex: index("rfid_card_write_jobs_project_status_index").on(table.projectId, table.status),
  }),
);

/** 运输价格规则。步长默认 500 米但允许后台按合同修改。 */
export const freightRateRules = mysqlTable(
  "freight_rate_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    materialName: varchar("materialName", { length: 128 }),
    settlementUnit: mysqlEnum("settlementUnit", ["cubic_meter", "ton", "trip"]).notNull(),
    startDistanceKm: decimal("startDistanceKm", { precision: 8, scale: 3 }).default("1").notNull(),
    basePricePerUnit: decimal("basePricePerUnit", { precision: 16, scale: 2 }).notNull(),
    stepMeters: int("stepMeters").default(500).notNull(),
    stepIncreasePerUnit: decimal("stepIncreasePerUnit", { precision: 16, scale: 2 }).default("0").notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["draft", "active", "disabled"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ projectIndex: index("freight_rate_rules_project_index").on(table.projectId, table.status) }),
);

/** 装土点和卸土点由项目运输管理员维护；每个现场可指定一名负责刷卡确认的管理员。 */
export const transportSites = mysqlTable(
  "transport_sites",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    siteType: mysqlEnum("siteType", ["load", "unload"]).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    address: varchar("address", { length: 500 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    administratorUserId: int("administratorUserId"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectTypeStatusIndex: index("transport_sites_project_type_status_index").on(table.projectId, table.siteType, table.status),
    projectNameUnique: uniqueIndex("transport_sites_project_type_name_unique").on(table.projectId, table.siteType, table.name),
    administratorIndex: index("transport_sites_administrator_index").on(table.administratorUserId, table.status),
  }),
);

/** 项目装卸路线预设：票据只选择路线，服务端锁定装卸点、里程与生效运价快照。 */
export const transportRoutePresets = mysqlTable(
  "transport_route_presets",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    loadSiteId: int("loadSiteId").notNull(),
    unloadSiteId: int("unloadSiteId").notNull(),
    freightRuleId: int("freightRuleId").notNull(),
    presetDistanceKm: decimal("presetDistanceKm", { precision: 10, scale: 3 }).notNull(),
    isDefault: boolean("isDefault").default(false).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ projectStatusIndex: index("transport_route_presets_project_status_index").on(table.projectId, table.status), projectSitesUnique: uniqueIndex("transport_route_presets_project_sites_unique").on(table.projectId, table.loadSiteId, table.unloadSiteId) }),
);

/** 运输趟次及其由规则快照计算出的金额。 */
export const transportTrips = mysqlTable(
 "transport_trips",
 {
   id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
   tripNo: varchar("tripNo", { length: 64 }).notNull(),
   vehicleId: int("vehicleId").notNull(),
   projectId: int("projectId").notNull(),
   freightRuleId: int("freightRuleId").notNull(),
   /** 票据来源：默认 NFC 车辆卡闭环；车牌直拍为卡片缺失时的有影像备用票据，须人工核验。 */
   invoiceMode: mysqlEnum("invoiceMode", ["nfc_card", "plate_photo"]).default("nfc_card").notNull(),
   loadSiteId: int("loadSiteId"),
   unloadSiteId: int("unloadSiteId"),
   startAt: datetime("startAt").notNull(),
   endAt: datetime("endAt"),
   actualDistanceKm: decimal("actualDistanceKm", { precision: 10, scale: 3 }),
   volumeCubicMeters: decimal("volumeCubicMeters", { precision: 12, scale: 3 }),
   weightTons: decimal("weightTons", { precision: 12, scale: 3 }),
   calculatedUnitPrice: decimal("calculatedUnitPrice", { precision: 16, scale: 2 }),
   calculatedAmount: decimal("calculatedAmount", { precision: 16, scale: 2 }),
   /** 仅在结算时由已核准且关联本趟的柴油领用记录汇总，不得由浏览器直接写入。 */
   fuelDeductionAmount: decimal("fuelDeductionAmount", { precision: 16, scale: 2 }).default("0").notNull(),
   netSettlementAmount: decimal("netSettlementAmount", { precision: 16, scale: 2 }),
   fuelSettlementSnapshot: json("fuelSettlementSnapshot"),
   routeSnapshot: json("routeSnapshot"),
   evidenceId: bigint("evidenceId", { mode: "number" }),
   status: mysqlEnum("status", ["draft", "submitted", "verified", "settled", "void"]).default("draft").notNull(),
   createdAt: timestamp("createdAt").defaultNow().notNull(),
   updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
   loadConfirmedAt: datetime("loadConfirmedAt"),
   unloadConfirmedAt: datetime("unloadConfirmedAt"),
   loadConfirmedBy: int("loadConfirmedBy"),
   unloadConfirmedBy: int("unloadConfirmedBy"),
   loadEventId: bigint("loadEventId", { mode: "number" }),
   unloadEventId: bigint("unloadEventId", { mode: "number" }),
   exceptionStatus: mysqlEnum("exceptionStatus", ["none", "open", "resolved"]).default("none").notNull(),
 },
 table => ({
   tripUnique: uniqueIndex("transport_trips_no_unique").on(table.tripNo),
   vehicleDateIndex: index("transport_trips_vehicle_date_index").on(table.vehicleId, table.startAt),
   projectLoadSiteIndex: index("transport_trips_project_load_site_index").on(table.projectId, table.loadSiteId, table.startAt),
   projectUnloadSiteIndex: index("transport_trips_project_unload_site_index").on(table.projectId, table.unloadSiteId, table.startAt),
 }),
);

/** 装土与卸土刷卡原子事件；设备重传和乱序均留痕并进入人工复核。 */
export const transportCardEvents = mysqlTable(
  "transport_card_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    tripId: bigint("tripId", { mode: "number" }).notNull(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    eventType: mysqlEnum("eventType", ["load", "unload"]).notNull(),
    siteId: int("siteId"),
    operatorUserId: int("operatorUserId"),
    source: mysqlEnum("source", ["card_reader", "manual_review", "offline_replay"]).default("card_reader").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 160 }).notNull(),
    deviceId: varchar("deviceId", { length: 128 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    cardFingerprint: varchar("cardFingerprint", { length: 64 }),
    payloadFingerprint: varchar("payloadFingerprint", { length: 64 }),
    occurredAt: datetime("occurredAt").notNull(),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    validationStatus: mysqlEnum("validationStatus", ["accepted", "duplicate", "rejected", "needs_review"]).default("accepted").notNull(),
    validationReason: varchar("validationReason", { length: 500 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("transport_card_events_idempotency_unique").on(table.idempotencyKey),
    tripIndex: index("transport_card_events_trip_index").on(table.tripId, table.occurredAt),
    vehicleIndex: index("transport_card_events_vehicle_index").on(table.vehicleId, table.occurredAt),
    siteEventIndex: index("transport_card_events_site_event_index").on(table.siteId, table.eventType, table.occurredAt),
  }),
);

/** 采购申请主单。采购明细、入库、领用通过业务服务层按单据关联。 */
export const purchaseRequests = mysqlTable(
  "purchase_requests",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    requestNo: varchar("requestNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    categoryId: int("categoryId").notNull(),
    requesterId: int("requesterId").notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).default("0").notNull(),
    description: text("description").notNull(),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "ordered", "received", "stocked", "closed", "rejected"]).default("draft").notNull(),
    /** 审批、入库和关闭责任人用于单据全流程追溯；历史数据允许为空。 */
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    stockedBy: int("stockedBy"),
    stockedAt: datetime("stockedAt"),
    closedAt: datetime("closedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ requestUnique: uniqueIndex("purchase_requests_no_unique").on(table.requestNo) }),
);

/** 供应商主数据按组织维护，联系方式不在移动端面向无关岗位暴露。 */
export const suppliers = mysqlTable(
  "suppliers",
  {
    id: int("id").autoincrement().primaryKey(),
    organizationId: int("organizationId"),
    name: varchar("name", { length: 200 }).notNull(),
    unifiedSocialCreditCode: varchar("unifiedSocialCreditCode", { length: 64 }),
    contactName: varchar("contactName", { length: 64 }),
    contactPhoneMasked: varchar("contactPhoneMasked", { length: 32 }),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    organizationIndex: index("suppliers_organization_index").on(table.organizationId),
    nameIndex: index("suppliers_name_index").on(table.name),
  }),
);

/** 采购订单承接已审批申请，金额由服务器按订单快照保存，避免移动端覆盖历史金额。 */
export const purchaseOrders = mysqlTable(
  "purchase_orders",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    orderNo: varchar("orderNo", { length: 64 }).notNull(),
    /** 常规订单必须关联已批准申请；小额免申请订单允许为空但必须保存分类、说明和影像证据。 */
    requestId: bigint("requestId", { mode: "number" }),
    projectId: int("projectId").notNull(),
    procurementMode: mysqlEnum("procurementMode", ["request", "small_direct"]).default("request").notNull(),
    categoryId: int("categoryId"),
    itemDescription: varchar("itemDescription", { length: 500 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    ocrSummary: varchar("ocrSummary", { length: 500 }),
    supplierId: int("supplierId"),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    orderedAt: datetime("orderedAt").notNull(),
    status: mysqlEnum("status", ["draft", "confirmed", "received", "closed", "void"]).default("draft").notNull(),
    createdBy: int("createdBy").notNull(),
    confirmedBy: int("confirmedBy"),
    confirmedAt: datetime("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    orderNoUnique: uniqueIndex("purchase_orders_no_unique").on(table.orderNo),
    requestIndex: index("purchase_orders_request_index").on(table.requestId),
    procurementModeIndex: index("purchase_orders_mode_index").on(table.projectId, table.procurementMode, table.status),
    projectIndex: index("purchase_orders_project_index").on(table.projectId, table.status),
  }),
);

/** 库存只保留可审计的收发流水，余额由服务器按项目、物料和单位聚合计算。 */
export const inventoryTransactions = mysqlTable(
  "inventory_transactions",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    requestId: bigint("requestId", { mode: "number" }),
    purchaseOrderId: bigint("purchaseOrderId", { mode: "number" }),
    transactionNo: varchar("transactionNo", { length: 64 }).notNull(),
    transactionType: mysqlEnum("transactionType", ["inbound", "outbound", "return"]).notNull(),
    itemName: varchar("itemName", { length: 200 }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: decimal("unitCost", { precision: 16, scale: 2 }).default("0").notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    occurredAt: datetime("occurredAt").notNull(),
    operatorId: int("operatorId").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    transactionNoUnique: uniqueIndex("inventory_transactions_no_unique").on(table.transactionNo),
    projectItemIndex: index("inventory_transactions_project_item_index").on(table.projectId, table.itemName, table.unit),
  }),
);

/** 工程计量申报与审核台账。 */
export const measurementClaims = mysqlTable(
  "measurement_claims",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    claimNo: varchar("claimNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    declaredAmount: decimal("declaredAmount", { precision: 16, scale: 2 }).notNull(),
    approvedAmount: decimal("approvedAmount", { precision: 16, scale: 2 }),
    status: mysqlEnum("status", ["draft", "submitted", "reviewing", "approved", "settled", "rejected", "void"]).default("draft").notNull(),
    submittedBy: int("submittedBy").notNull(),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    accountantId: int("accountantId"),
    settledAt: datetime("settledAt"),
    reviewNote: varchar("reviewNote", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ claimUnique: uniqueIndex("measurement_claims_no_unique").on(table.claimNo) }),
);

/** 项目部现场计量收方记录；金额仅在审核后按受控规则汇入计量申报，防止前端直接改写申报金额。 */
export const measurementTakeoffRecords = mysqlTable(
  "measurement_takeoff_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    takeoffNo: varchar("takeoffNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    measurementClaimId: bigint("measurementClaimId", { mode: "number" }),
    workItem: varchar("workItem", { length: 200 }).notNull(),
    workLocation: varchar("workLocation", { length: 200 }).notNull(),
    unit: mysqlEnum("unit", ["m3", "m2", "m", "t", "piece", "set", "other"]).notNull(),
    quantity: decimal("quantity", { precision: 16, scale: 3 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 16, scale: 2 }).default("0").notNull(),
    declaredAmount: decimal("declaredAmount", { precision: 16, scale: 2 }).notNull(),
    takeoffDate: date("takeoffDate").notNull(),
    status: mysqlEnum("status", ["draft", "submitted", "reviewing", "approved", "rejected", "locked", "void"]).default("draft").notNull(),
    submittedBy: int("submittedBy").notNull(),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    reviewNote: varchar("reviewNote", { length: 500 }),
    lockedAt: datetime("lockedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    takeoffNoUnique: uniqueIndex("measurement_takeoff_records_no_unique").on(table.takeoffNo),
    projectStatusDateIndex: index("measurement_takeoff_records_project_status_date_index").on(table.projectId, table.status, table.takeoffDate),
    claimIndex: index("measurement_takeoff_records_claim_index").on(table.measurementClaimId),
  }),
);

/** 收方记录可关联多张水印影像、签认单或监理证据；文件实体始终存于对象存储。 */
export const measurementTakeoffEvidences = mysqlTable(
  "measurement_takeoff_evidences",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    takeoffId: bigint("takeoffId", { mode: "number" }).notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }).notNull(),
    linkedBy: int("linkedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    takeoffEvidenceUnique: uniqueIndex("measurement_takeoff_evidences_unique").on(table.takeoffId, table.evidenceId),
    takeoffIndex: index("measurement_takeoff_evidences_takeoff_index").on(table.takeoffId),
  }),
);

/** 收入、支出、应收应付和现金流的统一财务流水。 */
export const financialRecords = mysqlTable(
  "financial_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    recordNo: varchar("recordNo", { length: 64 }).notNull(),
    projectId: int("projectId"),
    direction: mysqlEnum("direction", ["income", "expense"]).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    occurredAt: datetime("occurredAt").notNull(),
    settlementStatus: mysqlEnum("settlementStatus", ["unpaid", "partial", "paid", "void"]).default("unpaid").notNull(),
    sourceType: varchar("sourceType", { length: 64 }),
    sourceId: varchar("sourceId", { length: 128 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    dailyClosingId: bigint("dailyClosingId", { mode: "number" }),
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ recordUnique: uniqueIndex("financial_records_no_unique").on(table.recordNo) }),
);

/** 成本、收入和付款凭证的发票台账；金额、税额和状态均由服务端校验并保留原始审计链。 */
export const financialInvoices = mysqlTable(
  "financial_invoices",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    financialRecordId: bigint("financialRecordId", { mode: "number" }),
    invoiceNo: varchar("invoiceNo", { length: 64 }).notNull(),
    invoiceCode: varchar("invoiceCode", { length: 64 }),
    counterpartyName: varchar("counterpartyName", { length: 200 }).notNull(),
    invoiceType: mysqlEnum("invoiceType", ["vat_special", "vat_normal", "electronic", "receipt", "other"]).notNull(),
    direction: mysqlEnum("direction", ["income", "expense"]).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    taxAmount: decimal("taxAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    taxRate: decimal("taxRate", { precision: 7, scale: 4 }).default("0").notNull(),
    issuedAt: date("issuedAt").notNull(),
    verifiedAt: datetime("verifiedAt"),
    status: mysqlEnum("status", ["issued", "verified", "void", "red_flushed"]).default("issued").notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    voidReason: varchar("voidReason", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectInvoiceNoUnique: uniqueIndex("financial_invoices_project_no_unique").on(table.projectId, table.invoiceNo),
    projectStatusDateIndex: index("financial_invoices_project_status_date_index").on(table.projectId, table.status, table.issuedAt),
    financialRecordIndex: index("financial_invoices_financial_record_index").on(table.financialRecordId),
  }),
);

/** 后勤每日开支日结封存快照；已关闭或归档日期不得再写入底层财务流水。 */
export const dailyAccountingClosures = mysqlTable(
  "daily_accounting_closures",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    closingNo: varchar("closingNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    closingDate: date("closingDate").notNull(),
    totalIncome: decimal("totalIncome", { precision: 16, scale: 2 }).default("0").notNull(),
    totalExpense: decimal("totalExpense", { precision: 16, scale: 2 }).default("0").notNull(),
    recordCount: int("recordCount").default(0).notNull(),
    invoiceCount: int("invoiceCount").default(0).notNull(),
    invoiceAmount: decimal("invoiceAmount", { precision: 16, scale: 2 }).default("0").notNull(),
    snapshotHash: varchar("snapshotHash", { length: 64 }).notNull(),
    snapshotJson: text("snapshotJson").notNull(),
    status: mysqlEnum("status", ["closed", "archived", "void"]).default("closed").notNull(),
    closedBy: int("closedBy").notNull(),
    closedAt: datetime("closedAt").notNull(),
    archivedBy: int("archivedBy"),
    archivedAt: datetime("archivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    closingNoUnique: uniqueIndex("daily_accounting_closures_no_unique").on(table.closingNo),
    projectDateUnique: uniqueIndex("daily_accounting_closures_project_date_unique").on(table.projectId, table.closingDate),
  }),
);

/** 水印相机、票据 OCR、GPS 等影像证据的元数据；文件本体保存至对象存储。 */
export const evidenceRecords = mysqlTable(
  "evidence_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId"),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 128 }),
    fileKey: varchar("fileKey", { length: 512 }).notNull(),
    fileName: varchar("fileName", { length: 255 }),
    mimeType: varchar("mimeType", { length: 128 }),
    ocrResultJson: text("ocrResultJson"),
    watermarkJson: text("watermarkJson"),
    longitude: decimal("longitude", { precision: 11, scale: 7 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    capturedAt: datetime("capturedAt"),
    uploadedBy: int("uploadedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ sourceIndex: index("evidence_records_source_index").on(table.sourceType, table.sourceId) }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
