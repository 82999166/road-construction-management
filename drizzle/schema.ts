import {
  bigint,
  boolean,
  date,
  datetime,
  decimal,
  foreignKey,
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
export const users = mysqlTable(
  "users",
  {
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
    localAccountStatus: mysqlEnum("localAccountStatus", ["active", "disabled"])
      .default("active")
      .notNull(),
    /** 后台创建的本地管理人员可被限制为仅 PC、仅手机或双端登录；OAuth 身份保持双端兼容。 */
    localLoginMode: mysqlEnum("localLoginMode", ["pc", "mobile", "both"])
      .default("both")
      .notNull(),
    /** 兼容旧账号资料的历史字段；当前本地账号不再强制首次登录改密。 */
    localPasswordChangeRequired: boolean("localPasswordChangeRequired")
      .default(false)
      .notNull(),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => ({
    localUsernameUnique: uniqueIndex("users_local_username_unique").on(
      table.localUsername
    ),
  })
);

/** 可维护的组织树，支持集团、公司、项目部、部门和班组等节点。 */
export const organizations = mysqlTable(
  "organizations",
  {
    id: int("id").autoincrement().primaryKey(),
    parentId: int("parentId"),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    type: mysqlEnum("type", [
      "group",
      "company",
      "project_department",
      "department",
      "team",
    ]).notNull(),
    managerUserId: int("managerUserId"),
    costCenterCode: varchar("costCenterCode", { length: 64 }),
    sortOrder: int("sortOrder").default(0).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("organizations_code_unique").on(table.code),
    parentIndex: index("organizations_parent_index").on(table.parentId),
  })
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
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ codeUnique: uniqueIndex("positions_code_unique").on(table.code) })
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
    projectType: mysqlEnum("projectType", [
      "highway",
      "railway",
      "municipal",
      "other",
    ]),
    status: mysqlEnum("status", [
      "planning",
      "active",
      "suspended",
      "completed",
      "archived",
    ])
      .default("planning")
      .notNull(),
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
  })
);

/** 登录用户与企业员工档案的映射。 */
export const userProfiles = mysqlTable(
  "user_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    employeeNo: varchar("employeeNo", { length: 64 }),
    phoneMasked: varchar("phoneMasked", { length: 32 }),
    phoneEncrypted: text("phoneEncrypted"),
    phoneFingerprint: varchar("phoneFingerprint", { length: 64 }),
    bankAccountEncrypted: text("bankAccountEncrypted"),
    bankName: varchar("bankName", { length: 128 }),
    organizationId: int("organizationId"),
    positionId: int("positionId"),
    status: mysqlEnum("status", ["pending", "active", "disabled"])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUnique: uniqueIndex("user_profiles_user_unique").on(table.userId),
    phoneFingerprintUnique: uniqueIndex(
      "user_profiles_phone_fingerprint_unique"
    ).on(table.phoneFingerprint),
  })
);

/** 系统角色，可由 PC 超级管理后台维护。 */
export const systemRoles = mysqlTable(
  "system_roles",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    category: mysqlEnum("category", ["system", "business"])
      .default("business")
      .notNull(),
    description: text("description"),
    isSystem: boolean("isSystem").default(false).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("system_roles_code_unique").on(table.code),
  })
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
  table => ({
    codeUnique: uniqueIndex("system_permissions_code_unique").on(table.code),
  })
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
  table => ({
    rolePermissionUnique: uniqueIndex("role_permissions_unique").on(
      table.roleId,
      table.permissionId
    ),
  })
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
    userPermissionUnique: uniqueIndex("user_permissions_unique").on(
      table.userId,
      table.permissionId
    ),
    userIndex: index("user_permissions_user_index").on(table.userId),
  })
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
    status: mysqlEnum("status", ["active", "revoked", "expired"])
      .default("active")
      .notNull(),
    grantedBy: int("grantedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIndex: index("user_role_assignments_user_index").on(table.userId),
    roleIndex: index("user_role_assignments_role_index").on(table.roleId),
  })
);

/**
 * 部门或具体项目可办理的业务模块。人员仍通过角色授权表关联到部门与项目范围，
 * 本表决定组织范围或已显式授权项目整体可以进入哪些业务域；两层授权取交集后才允许办理业务。
 * 历史组织范围记录保持 organizationId，项目范围记录只使用 projectId，二者不可同时为空。
 */
export const departmentBusinessScopes = mysqlTable(
  "department_business_scopes",
  {
    id: int("id").autoincrement().primaryKey(),
    organizationId: int("organizationId"),
    projectId: int("projectId"),
    module: mysqlEnum("module", [
      "CONSTRUCTION",
      "LABOR",
      "MACHINERY",
      "TRANSPORT",
      "PURCHASING",
      "MEASUREMENT",
      "CONTRACT",
      "FINANCE",
      "DIESEL",
      "EVIDENCE",
    ]).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    configuredBy: int("configuredBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    departmentModuleUnique: uniqueIndex("department_business_scopes_unique").on(
      table.organizationId,
      table.module
    ),
    organizationIndex: index(
      "department_business_scopes_organization_index"
    ).on(table.organizationId),
    projectModuleUnique: uniqueIndex(
      "department_business_scopes_project_module_unique"
    ).on(table.projectId, table.module),
    projectIndex: index("department_business_scopes_project_index").on(
      table.projectId
    ),
  })
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
    status: mysqlEnum("status", ["draft", "published", "disabled"])
      .default("draft")
      .notNull(),
    version: int("version").default(1).notNull(),
    updatedBy: int("updatedBy"),
    publishedAt: datetime("publishedAt"),
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    settingKeyUnique: uniqueIndex("system_settings_key_unique").on(
      table.settingKey
    ),
  })
);

/** 配置发布记录用于回滚、双人复核和审计追溯。 */
export const configPublishLogs = mysqlTable("config_publish_logs", {
  id: int("id").autoincrement().primaryKey(),
  settingId: int("settingId").notNull(),
  operation: mysqlEnum("operation", [
    "create",
    "update",
    "publish",
    "disable",
    "rollback",
  ]).notNull(),
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
  table => ({
    moduleIndex: index("audit_logs_module_index").on(
      table.module,
      table.createdAt
    ),
  })
);

/**
 * 登录失败限流状态。subjectHash 为账号标识的不可逆摘要，避免将手机号、管理员名称或口令
 * 写入限流表；持久化后服务重启或未来多实例部署也不会使锁定窗口自然失效。
 */
export const loginRateLimitStates = mysqlTable(
  "login_rate_limit_states",
  {
    id: int("id").autoincrement().primaryKey(),
    scope: varchar("scope", { length: 64 }).notNull(),
    subjectHash: varchar("subjectHash", { length: 128 }).notNull(),
    failureCount: int("failureCount").default(0).notNull(),
    windowStartedAt: datetime("windowStartedAt").notNull(),
    lastFailureAt: datetime("lastFailureAt").notNull(),
    lockedUntil: datetime("lockedUntil"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scopeSubjectUnique: uniqueIndex("login_rate_limit_scope_subject_unique").on(
      table.scope,
      table.subjectHash
    ),
    lockedUntilIndex: index("login_rate_limit_locked_until_index").on(
      table.lockedUntil
    ),
  })
);

/**
 * 敏感数据访问利用日志。完整账户、原始定位等高风险信息即使允许依法业务使用，
 * 也必须单独记录访问者、项目范围、业务目的、返回记录数和结果，不依赖浏览器端日志。
 */
export const sensitiveDataAccessLogs = mysqlTable(
  "sensitive_data_access_logs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    projectId: int("projectId"),
    module: varchar("module", { length: 64 }).notNull(),
    dataCategory: mysqlEnum("dataCategory", [
      "full_payment_account",
      "raw_location_coordinate",
      "identity_document",
      "other",
    ]).notNull(),
    accessPurpose: varchar("accessPurpose", { length: 300 }).notNull(),
    targetType: varchar("targetType", { length: 64 }),
    targetId: varchar("targetId", { length: 128 }),
    recordCount: int("recordCount").default(0).notNull(),
    result: mysqlEnum("result", ["granted", "denied", "exported", "reviewed"])
      .default("granted")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userTimeIndex: index("sensitive_data_access_logs_user_time_index").on(
      table.userId,
      table.createdAt
    ),
    projectCategoryTimeIndex: index(
      "sensitive_data_access_logs_project_category_time_index"
    ).on(table.projectId, table.dataCategory, table.createdAt),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sensitive_data_access_logs_user_fk",
    }).onDelete("restrict"),
  })
);

/** 追加式审计链的单行状态；数据库触发器在每条审计日志写入时原子推进，不允许业务端更新。 */
export const auditLogChainState = mysqlTable("audit_log_chain_state", {
  id: int("id").primaryKey(),
  lastSequence: bigint("lastSequence", { mode: "number" }).default(0).notNull(),
  lastHash: varchar("lastHash", { length: 64 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** 每条业务审计日志的前序哈希和当前哈希；与日志主表保持一对一，支持后续校验与异常告警。 */
export const auditLogIntegrityEvents = mysqlTable(
  "audit_log_integrity_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    auditLogId: bigint("auditLogId", { mode: "number" }).notNull(),
    sequenceNo: bigint("sequenceNo", { mode: "number" }).notNull(),
    previousHash: varchar("previousHash", { length: 64 }).notNull(),
    entryHash: varchar("entryHash", { length: 64 }).notNull(),
    integrityVersion: varchar("integrityVersion", { length: 32 })
      .default("audit-chain-v1")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    auditLogUnique: uniqueIndex("audit_log_integrity_events_log_unique").on(
      table.auditLogId
    ),
    sequenceUnique: uniqueIndex(
      "audit_log_integrity_events_sequence_unique"
    ).on(table.sequenceNo),
    entryHashUnique: uniqueIndex("audit_log_integrity_events_hash_unique").on(
      table.entryHash
    ),
    auditLogFk: foreignKey({
      columns: [table.auditLogId],
      foreignColumns: [auditLogs.id],
      name: "audit_log_integrity_events_log_fk",
    }).onDelete("restrict"),
  })
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
    fileKeyUnique: uniqueIndex("data_backups_file_key_unique").on(
      table.fileKey
    ),
  })
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
    weather: mysqlEnum("weather", [
      "sunny",
      "cloudy",
      "rainy",
      "snowy",
      "windy",
      "other",
    ])
      .default("other")
      .notNull(),
    workContent: text("workContent").notNull(),
    safetyNotes: varchar("safetyNotes", { length: 1000 }),
    issueNotes: varchar("issueNotes", { length: 1000 }),
    /** 由现场管理人员申报的累计完成比例，范围由服务端校验为 0 至 100。 */
    progressPercent: decimal("progressPercent", { precision: 5, scale: 2 })
      .default("0")
      .notNull(),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "rejected",
      "locked",
    ])
      .default("draft")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    /** 主管审核时填写的回复，确认通过或退回后与审核人、审核时间共同固化。 */
    reviewReply: varchar("reviewReply", { length: 1000 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectDateIndex: index("construction_daily_reports_project_date_index").on(
      table.projectId,
      table.reportDate
    ),
    projectSubmitterDateIndex: index(
      "construction_daily_reports_project_submitter_date_index"
    ).on(table.projectId, table.createdBy, table.reportDate),
    projectStatusIndex: index(
      "construction_daily_reports_project_status_index"
    ).on(table.projectId, table.status),
  })
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
    status: mysqlEnum("status", [
      "pending",
      "sent",
      "failed",
      "skipped",
      "read",
    ])
      .default("pending")
      .notNull(),
    retryCount: int("retryCount").default(0).notNull(),
    sentAt: datetime("sentAt"),
    readAt: datetime("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    channel: mysqlEnum("channel", [
      "legacy_wecom",
      "official_account",
      "in_app",
    ])
      .default("legacy_wecom")
      .notNull(),
    providerMessageId: varchar("providerMessageId", { length: 128 }),
    failureCode: varchar("failureCode", { length: 64 }),
    lastAttemptedAt: datetime("lastAttemptedAt"),
  },
  table => ({
    idempotencyUnique: uniqueIndex("notification_idempotency_unique").on(
      table.idempotencyKey
    ),
  })
);

/** 项目级风险规则；阈值由超级管理员维护，扫描结果始终保存实际计算口径。 */
export const projectRiskRules = mysqlTable(
  "project_risk_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    /** 单次加油量超过核定油箱容量的比例即预警，例如 1.10 表示超过 110%。 */
    maxFuelFillRatio: decimal("maxFuelFillRatio", { precision: 6, scale: 3 })
      .default("1.100")
      .notNull(),
    /** 运输完成的平均速度超过该阈值即提示核验，避免只根据主观时长判断。 */
    maxTransportSpeedKmh: decimal("maxTransportSpeedKmh", {
      precision: 8,
      scale: 2,
    })
      .default("80.00")
      .notNull(),
    /** 实际距离不小于 2 km 且运输耗时高于该值，标记为异常滞留待核验。 */
    maxTransportDurationMinutes: int("maxTransportDurationMinutes")
      .default(360)
      .notNull(),
    /** 已上班但超过该小时数未下班打卡，标记为考勤闭环异常。 */
    maxOpenCheckInHours: int("maxOpenCheckInHours").default(14).notNull(),
    /** 施工日报草稿、退回或逾期未审核超过该小时数，标记为施工管理待办。 */
    maxPendingReportHours: int("maxPendingReportHours").default(24).notNull(),
    /** 是否启用每日整改逾期升级；由平台 Heartbeat 调用，禁止以进程内定时器实现。 */
    overdueEscalationEnabled: boolean("overdueEscalationEnabled")
      .default(false)
      .notNull(),
    /** 中国标准时间的每日升级检查小时（0-23），转换为 Heartbeat UTC cron 后持久化运行。 */
    overdueEscalationHourChina: int("overdueEscalationHourChina")
      .default(9)
      .notNull(),
    /** Heartbeat 平台任务 UID，仅由受认证的调度创建/更新流程写入。 */
    overdueEscalationCronTaskUid: varchar("overdueEscalationCronTaskUid", {
      length: 65,
    }),
    createdBy: int("createdBy"),
    updatedBy: int("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectUnique: uniqueIndex("project_risk_rules_project_unique").on(
      table.projectId
    ),
    overdueCronTaskIndex: index(
      "project_risk_rules_overdue_cron_task_index"
    ).on(table.overdueEscalationCronTaskUid),
  })
);

/** 确定性风险检测结果；仅保存业务编号、数值口径与处置，不复制敏感原始资料。 */
export const projectRiskAlerts = mysqlTable(
  "project_risk_alerts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    businessDate: date("businessDate").notNull(),
    category: mysqlEnum("category", [
      "construction",
      "attendance",
      "fuel",
      "transport",
    ]).notNull(),
    severity: mysqlEnum("severity", ["notice", "warning", "critical"])
      .default("warning")
      .notNull(),
    ruleCode: varchar("ruleCode", { length: 64 }).notNull(),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 128 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: varchar("summary", { length: 1000 }).notNull(),
    /** 仅保存数值、状态与业务编号，不保存姓名、手机号、身份证或设备指纹。 */
    evidenceJson: text("evidenceJson"),
    status: mysqlEnum("status", [
      "open",
      "acknowledged",
      "in_rectification",
      "resolved",
      "ignored",
    ])
      .default("open")
      .notNull(),
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
    projectRuleSourceDateUnique: uniqueIndex("project_risk_alerts_unique").on(
      table.projectId,
      table.ruleCode,
      table.sourceId,
      table.businessDate
    ),
    projectStatusDateIndex: index(
      "project_risk_alerts_project_status_date_index"
    ).on(table.projectId, table.status, table.businessDate),
    projectDueStatusIndex: index(
      "project_risk_alerts_project_due_status_index"
    ).on(table.projectId, table.dueAt, table.status),
  })
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
  table => ({
    projectPeriodIndex: index("project_risk_briefings_project_period_index").on(
      table.projectId,
      table.period,
      table.createdAt
    ),
  })
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
    timezone: varchar("timezone", { length: 64 })
      .default("Asia/Shanghai")
      .notNull(),
    deliveryHour: int("deliveryHour").default(20).notNull(),
    deliveryMinute: int("deliveryMinute").default(0).notNull(),
    includeEmptyProjects: boolean("includeEmptyProjects")
      .default(false)
      .notNull(),
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
    scopeKeyUnique: uniqueIndex(
      "daily_project_digest_schedules_scope_unique"
    ).on(table.scopeKey),
    cronTaskUidIndex: index("daily_project_digest_schedules_task_uid_index").on(
      table.scheduleCronTaskUid
    ),
  })
);

/** 每个项目、每个业务日的一份汇总运行快照，用于幂等、审计与失败复核。 */
export const dailyProjectDigestRuns = mysqlTable(
  "daily_project_digest_runs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    scheduleId: int("scheduleId").notNull(),
    projectId: int("projectId").notNull(),
    businessDate: date("businessDate").notNull(),
    status: mysqlEnum("status", [
      "pending",
      "completed",
      "partial",
      "skipped",
      "failed",
    ])
      .default("pending")
      .notNull(),
    summaryJson: text("summaryJson").notNull(),
    recipientCount: int("recipientCount").default(0).notNull(),
    deliveredCount: int("deliveredCount").default(0).notNull(),
    failedCount: int("failedCount").default(0).notNull(),
    completedAt: datetime("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scheduleProjectDateUnique: uniqueIndex(
      "daily_project_digest_runs_schedule_project_date_unique"
    ).on(table.scheduleId, table.projectId, table.businessDate),
    scheduleDateIndex: index(
      "daily_project_digest_runs_schedule_date_index"
    ).on(table.scheduleId, table.businessDate),
  })
);

/** 员工关注认证服务号后的通知身份；OpenID 仅保存密文与不可逆指纹。 */
export const officialAccountBindings = mysqlTable(
  "official_account_bindings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    openIdEncrypted: text("openIdEncrypted").notNull(),
    openIdFingerprint: varchar("openIdFingerprint", { length: 64 }).notNull(),
    bindingSource: mysqlEnum("bindingSource", [
      "wechat_oauth",
      "admin_verified",
    ])
      .default("wechat_oauth")
      .notNull(),
    status: mysqlEnum("status", [
      "pending",
      "active",
      "unsubscribed",
      "revoked",
      "disabled",
    ])
      .default("pending")
      .notNull(),
    boundAt: datetime("boundAt"),
    lastVerifiedAt: datetime("lastVerifiedAt"),
    lastFailureAt: datetime("lastFailureAt"),
    failureCount: int("failureCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUnique: uniqueIndex("official_account_bindings_user_unique").on(
      table.userId
    ),
    openIdUnique: uniqueIndex(
      "official_account_bindings_openid_fingerprint_unique"
    ).on(table.openIdFingerprint),
    statusIndex: index("official_account_bindings_status_index").on(
      table.status
    ),
  })
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
    audienceType: mysqlEnum("audienceType", [
      "project",
      "organization",
      "role",
    ]).notNull(),
    projectId: int("projectId"),
    organizationId: int("organizationId"),
    roleCode: varchar("roleCode", { length: 64 }),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "rejected",
      "publishing",
      "published",
      "partial",
      "failed",
      "cancelled",
    ])
      .default("draft")
      .notNull(),
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
    requiresAcknowledgement: boolean("requiresAcknowledgement")
      .default(true)
      .notNull(),
    acknowledgedCount: int("acknowledgedCount").default(0).notNull(),
    /** 仅记录收件人数、用户 ID 与选择范围；绝不包含 OpenID 或解密后的绑定信息。 */
    audienceSnapshotJson: text("audienceSnapshotJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    broadcastNoUnique: uniqueIndex("official_account_broadcasts_no_unique").on(
      table.broadcastNo
    ),
    statusIndex: index("official_account_broadcasts_status_index").on(
      table.status,
      table.updatedAt
    ),
    scopeIndex: index("official_account_broadcasts_scope_index").on(
      table.audienceType,
      table.projectId,
      table.organizationId,
      table.roleCode
    ),
  })
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
    deliveryStatus: mysqlEnum("deliveryStatus", [
      "pending",
      "sent",
      "failed",
      "skipped",
    ])
      .default("pending")
      .notNull(),
    deliveryReason: varchar("deliveryReason", { length: 64 }),
    providerMessageId: varchar("providerMessageId", { length: 128 }),
    attemptedAt: datetime("attemptedAt"),
    deliveredAt: datetime("deliveredAt"),
    acknowledgementStatus: mysqlEnum("acknowledgementStatus", [
      "not_required",
      "pending",
      "acknowledged",
    ])
      .default("pending")
      .notNull(),
    acknowledgedAt: datetime("acknowledgedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    broadcastRecipientUnique: uniqueIndex(
      "official_account_broadcast_deliveries_recipient_unique"
    ).on(table.broadcastId, table.recipientUserId),
    broadcastStatusIndex: index(
      "official_account_broadcast_deliveries_status_index"
    ).on(table.broadcastId, table.deliveryStatus),
    broadcastAcknowledgementIndex: index(
      "official_account_broadcast_deliveries_acknowledgement_index"
    ).on(table.broadcastId, table.acknowledgementStatus),
  })
);

/** 服务号扫码绑定的短时请求；仅保存令牌指纹，扫码事件到达后一次性消费。 */
export const officialAccountBindingRequests = mysqlTable(
  "official_account_binding_requests",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    tokenFingerprint: varchar("tokenFingerprint", { length: 64 }).notNull(),
    expiresAt: datetime("expiresAt").notNull(),
    consumedAt: datetime("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex(
      "official_account_binding_requests_token_unique"
    ).on(table.tokenFingerprint),
    userIndex: index("official_account_binding_requests_user_index").on(
      table.userId
    ),
  })
);

/** 固定 12 类采购字典，后台仅可调整排序和停启用，不能变更标准编码。 */
export const purchaseCategories = mysqlTable(
  "purchase_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    isFixed: boolean("isFixed").default(true).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("purchase_categories_code_unique").on(table.code),
  })
);

/** 劳务实名制人员档案，身份证、银行卡等敏感原值仅以密文存储。 */
export const laborWorkers = mysqlTable(
  "labor_workers",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    teamName: varchar("teamName", { length: 128 }),
    workerCategory: mysqlEnum("workerCategory", [
      "company_admin",
      "labor_team",
      "temporary_daily",
    ])
      .default("labor_team")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    realName: varchar("realName", { length: 64 }).notNull(),
    identityNoEncrypted: text("identityNoEncrypted"),
    phoneEncrypted: text("phoneEncrypted"),
    phoneFingerprint: varchar("phoneFingerprint", { length: 64 }),
    bankAccountEncrypted: text("bankAccountEncrypted"),
    bankName: varchar("bankName", { length: 128 }),
    /** 实名资料由劳资管理人员人工核验后的状态，不替代身份证密文与证照档案。 */
    identityVerificationStatus: mysqlEnum("identityVerificationStatus", [
      "pending",
      "verified",
      "rejected",
    ])
      .default("pending")
      .notNull(),
    /** 审核结论说明不得填写身份证号、银行卡号等敏感原文。 */
    identityVerificationNote: varchar("identityVerificationNote", {
      length: 500,
    }),
    identityVerifiedAt: datetime("identityVerifiedAt"),
    identityVerifiedBy: int("identityVerifiedBy"),
    attendanceStatus: mysqlEnum("attendanceStatus", [
      "pending",
      "active",
      "left",
    ])
      .default("pending")
      .notNull(),
    entryDate: date("entryDate"),
    exitDate: date("exitDate"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectIndex: index("labor_workers_project_index").on(table.projectId),
    phoneFingerprintUnique: uniqueIndex(
      "labor_workers_phone_fingerprint_unique"
    ).on(table.phoneFingerprint),
  })
);

/** 考勤与工时记录，为工资核算提供可追溯来源。 */
export const attendanceRecords = mysqlTable(
  "attendance_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    attendanceDate: date("attendanceDate").notNull(),
    workHours: decimal("workHours", { precision: 7, scale: 2 })
      .default("0")
      .notNull(),
    overtimeHours: decimal("overtimeHours", { precision: 7, scale: 2 })
      .default("0")
      .notNull(),
    /** 现场考勤异常、请假原因及补充说明；不得写入身份证、银行卡等敏感原文。 */
    note: varchar("note", { length: 500 }),
    source: mysqlEnum("source", ["manual", "mobile", "device", "import"])
      .default("manual")
      .notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    status: mysqlEnum("status", ["draft", "confirmed", "locked"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    workerDateUnique: uniqueIndex("attendance_worker_date_unique").on(
      table.workerId,
      table.attendanceDate
    ),
  })
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
    deviceFingerprintHash: varchar("deviceFingerprintHash", {
      length: 128,
    }).notNull(),
    deviceLabel: varchar("deviceLabel", { length: 160 }),
    /** 打卡时反查得到的中文详细地址；反查失败不阻断打卡，但业务列表绝不改为展示坐标。 */
    checkInAddress: varchar("checkInAddress", { length: 500 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    locationAccuracyMeters: decimal("locationAccuracyMeters", {
      precision: 10,
      scale: 2,
    }),
    status: mysqlEnum("status", ["normal", "location_missing"])
      .default("normal")
      .notNull(),
    checkoutAddress: varchar("checkoutAddress", { length: 500 }),
    checkoutLongitude: decimal("checkoutLongitude", {
      precision: 10,
      scale: 7,
    }),
    checkoutLatitude: decimal("checkoutLatitude", { precision: 10, scale: 7 }),
    checkoutLocationAccuracyMeters: decimal("checkoutLocationAccuracyMeters", {
      precision: 10,
      scale: 2,
    }),
    checkoutStatus: mysqlEnum("checkoutStatus", ["normal", "location_missing"]),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userProjectDateUnique: uniqueIndex(
      "attendance_check_ins_user_project_date_unique"
    ).on(table.userId, table.projectId, table.businessDate),
    projectDateIndex: index("attendance_check_ins_project_date_index").on(
      table.projectId,
      table.businessDate
    ),
    deviceIndex: index("attendance_check_ins_device_index").on(
      table.deviceFingerprintHash,
      table.businessDate
    ),
  })
);

/** 考勤设备绑定台账，仅保存服务端生成的设备匿名指纹和可读设备标签。 */
export const attendanceDeviceBindings = mysqlTable(
  "attendance_device_bindings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    deviceFingerprintHash: varchar("deviceFingerprintHash", {
      length: 128,
    }).notNull(),
    deviceLabel: varchar("deviceLabel", { length: 160 }),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    firstBoundAt: datetime("firstBoundAt").notNull(),
    lastUsedAt: datetime("lastUsedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userDeviceUnique: uniqueIndex(
      "attendance_device_bindings_user_device_unique"
    ).on(table.userId, table.deviceFingerprintHash),
    userStatusIndex: index("attendance_device_bindings_user_status_index").on(
      table.userId,
      table.status
    ),
  })
);

/** 工资条记录，金额与状态须经会计审核后才能推送。 */
export const payrollStatements = mysqlTable(
  "payroll_statements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    payableAmount: decimal("payableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    deductionAmount: decimal("deductionAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    actualAmount: decimal("actualAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    bankAccountMasked: varchar("bankAccountMasked", { length: 64 }),
    /** 审核通过后的工资可分笔发放；partial 仅表示存在真实付款明细，不代表已结清。 */
    status: mysqlEnum("status", [
      "draft",
      "reviewing",
      "approved",
      "partial",
      "paid",
      "void",
    ])
      .default("draft")
      .notNull(),
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
  table => ({
    workerProjectPeriodUnique: uniqueIndex(
      "payroll_worker_project_period_unique"
    ).on(table.workerId, table.projectId, table.period),
    projectPeriodStatusIndex: index(
      "payroll_statements_project_period_status_index"
    ).on(table.projectId, table.period, table.status),
  })
);

/**
 * 公司级月度工资草稿生成调度。回调仅按平台签发的 task UID 定位本配置，
 * 不能信任请求体内的期间、人员或项目字段。
 */
export const payrollGenerationSchedules = mysqlTable(
  "payroll_generation_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    scopeKey: varchar("scopeKey", { length: 64 }).notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .default("Asia/Shanghai")
      .notNull(),
    /** 每月第几天为上一个自然月生成工资草稿，默认次月 1 日。 */
    generationDay: int("generationDay").default(1).notNull(),
    generationHour: int("generationHour").default(9).notNull(),
    generationMinute: int("generationMinute").default(5).notNull(),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    lastAttemptedAt: datetime("lastAttemptedAt"),
    lastSuccessfulPeriod: varchar("lastSuccessfulPeriod", { length: 7 }),
    lastResultJson: text("lastResultJson"),
    createdBy: int("createdBy"),
    updatedBy: int("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scopeKeyUnique: uniqueIndex("payroll_generation_schedules_scope_unique").on(
      table.scopeKey
    ),
    cronTaskUidIndex: index("payroll_generation_schedules_task_uid_index").on(
      table.scheduleCronTaskUid
    ),
  })
);

/** 每项目、每期间仅保存一份工资生成运行审计，抵抗 Heartbeat 的重试与并发重放。 */
export const payrollGenerationRuns = mysqlTable(
  "payroll_generation_runs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    scheduleId: int("scheduleId").notNull(),
    projectId: int("projectId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    status: mysqlEnum("status", [
      "completed",
      "partial",
      "skipped",
      "failed",
    ]).notNull(),
    createdCount: int("createdCount").default(0).notNull(),
    skippedCount: int("skippedCount").default(0).notNull(),
    blockedCount: int("blockedCount").default(0).notNull(),
    summaryJson: text("summaryJson").notNull(),
    completedAt: datetime("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    scheduleProjectPeriodUnique: uniqueIndex(
      "payroll_generation_runs_schedule_project_period_unique"
    ).on(table.scheduleId, table.projectId, table.period),
    schedulePeriodIndex: index(
      "payroll_generation_runs_schedule_period_index"
    ).on(table.scheduleId, table.period),
  })
);

/** 临时人员按日结算：审核通过不代表付款，只有登记实际付款后才结算完毕。 */
export const temporaryDailyWageSettlements = mysqlTable(
  "temporary_daily_wage_settlements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    settlementDate: date("settlementDate").notNull(),
    payableAmount: decimal("payableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    deductionAmount: decimal("deductionAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    actualAmount: decimal("actualAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    remarks: varchar("remarks", { length: 500 }),
    /** 临时日结与月度工资使用相同的分笔付款语义。 */
    status: mysqlEnum("status", [
      "draft",
      "reviewing",
      "approved",
      "partial",
      "paid",
      "void",
    ])
      .default("draft")
      .notNull(),
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
  table => ({
    workerDateUnique: uniqueIndex("temporary_daily_wage_worker_date_unique").on(
      table.workerId,
      table.settlementDate
    ),
    projectDateIndex: index("temporary_daily_wage_project_date_index").on(
      table.projectId,
      table.settlementDate,
      table.status
    ),
  })
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
    employeeType: mysqlEnum("employeeType", [
      "management",
      "operator",
      "construction_worker",
    ]).notNull(),
    tradeName: varchar("tradeName", { length: 128 }),
    teamName: varchar("teamName", { length: 128 }),
    employmentStatus: mysqlEnum("employmentStatus", [
      "active",
      "suspended",
      "left",
    ])
      .default("active")
      .notNull(),
    joinedAt: date("joinedAt"),
    leftAt: date("leftAt"),
    salaryBasis: mysqlEnum("salaryBasis", [
      "monthly",
      "daily",
      "hourly",
      "piecework",
    ])
      .default("monthly")
      .notNull(),
    baseSalary: decimal("baseSalary", { precision: 16, scale: 2 }),
    remarks: varchar("remarks", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIndex: index("employee_profiles_user_index").on(table.userId),
    workerIndex: index("employee_profiles_worker_index").on(
      table.laborWorkerId
    ),
    projectTypeIndex: index("employee_profiles_project_type_index").on(
      table.projectId,
      table.employeeType,
      table.employmentStatus
    ),
  })
);

/** 员工工资预支台账。金额只进入劳资业务台账，不在档案详情回显银行卡原值。 */
export const employeePayrollAdvances = mysqlTable(
  "employee_payroll_advances",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    employeeProfileId: int("employeeProfileId").notNull(),
    laborWorkerId: int("laborWorkerId"),
    projectId: int("projectId"),
    advanceDate: date("advanceDate").notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["draft", "approved", "deducted", "void"])
      .default("draft")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    profileDateIndex: index("employee_payroll_advances_profile_date_index").on(
      table.employeeProfileId,
      table.advanceDate,
      table.status
    ),
    workerIndex: index("employee_payroll_advances_worker_index").on(
      table.laborWorkerId
    ),
  })
);

/** 一笔工资预支可明确分配至一张或多张工资条；仅 active 分配参与余额与扣款计算。 */
export const employeePayrollAdvanceAllocations = mysqlTable(
  "employee_payroll_advance_allocations",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    advanceId: bigint("advanceId", { mode: "number" }).notNull(),
    payrollStatementId: bigint("payrollStatementId", {
      mode: "number",
    }).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["active", "reversed"])
      .default("active")
      .notNull(),
    allocatedBy: int("allocatedBy").notNull(),
    allocatedAt: datetime("allocatedAt").notNull(),
    reversedBy: int("reversedBy"),
    reversedAt: datetime("reversedAt"),
    reversalReason: varchar("reversalReason", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    advanceIndex: index(
      "employee_payroll_advance_allocations_advance_index"
    ).on(table.advanceId, table.status),
    payrollIndex: index(
      "employee_payroll_advance_allocations_payroll_index"
    ).on(table.payrollStatementId, table.status),
  })
);
/** 员工保险台账：按保单留存购买日期与到期日期，供后台到期预警和人事审查使用。 */
export const employeeInsurancePolicies = mysqlTable(
  "employee_insurance_policies",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeProfileId: int("employeeProfileId").notNull(),
    insuranceType: mysqlEnum("insuranceType", [
      "work_injury",
      "accident",
      "medical",
      "employer_liability",
      "other",
    ]).notNull(),
    providerName: varchar("providerName", { length: 128 }),
    policyReference: varchar("policyReference", { length: 128 }),
    /** 文件由受控证据库保存；续保新增记录，不覆盖历史保单与附件。 */
    evidenceId: bigint("evidenceId", { mode: "number" }),
    premiumAmount: decimal("premiumAmount", { precision: 16, scale: 2 }),
    coverageAmount: decimal("coverageAmount", { precision: 16, scale: 2 }),
    purchasedAt: date("purchasedAt").notNull(),
    expiresAt: date("expiresAt").notNull(),
    status: mysqlEnum("status", ["active", "expired", "cancelled"])
      .default("active")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    profileExpiryIndex: index(
      "employee_insurance_policies_profile_expiry_index"
    ).on(table.employeeProfileId, table.expiresAt, table.status),
    evidenceIndex: index("employee_insurance_policies_evidence_index").on(
      table.evidenceId
    ),
  })
);

/** 公司自有与外租机械统一台账。 */
export const machines = mysqlTable(
  "machines",
  {
    /** 统一人员身份关联，不改变原操作员账号与权限。 */
    operatorPersonId: int("operatorPersonId"),
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId"),
    /** 机械操作员/司机的登录用户标识；允许为空以兼容外租机械暂未绑定人员的场景。 */
    operatorUserId: int("operatorUserId"),
    /** 机械老板的只读账号绑定；老板只能查看名下设备费用，不获得机械管理录入权限。 */
    ownerUserId: int("ownerUserId"),
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
    fuelTankCapacityLiters: decimal("fuelTankCapacityLiters", {
      precision: 10,
      scale: 2,
    }),
    status: mysqlEnum("status", [
      "idle",
      "working",
      "repairing",
      "offsite",
      "retired",
    ])
      .default("idle")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUnique: uniqueIndex("machines_code_unique").on(table.code),
    ownerProjectIndex: index("machines_owner_project_index").on(
      table.ownerUserId,
      table.projectId
    ),
    operatorPersonIndex: index("machines_operator_person_index").on(
      table.operatorPersonId
    ),
  })
);

/** 机械租赁计价规则，由合同和项目参数配置，而非硬编码。 */
export const machineLeaseRules = mysqlTable(
  "machine_lease_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    machineId: int("machineId").notNull(),
    projectId: int("projectId").notNull(),
    billingType: mysqlEnum("billingType", [
      "monthly",
      "daily",
      "hourly",
      "shift",
    ]).notNull(),
    rate: decimal("rate", { precision: 16, scale: 2 }).notNull(),
    overtimeHourlyRate: decimal("overtimeHourlyRate", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    machineIndex: index("machine_lease_rules_machine_index").on(
      table.machineId,
      table.status
    ),
  })
);

/** 机械油料、修理、加班、进退场等成本明细。 */
export const machineCostRecords = mysqlTable(
  "machine_cost_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    machineId: int("machineId").notNull(),
    projectId: int("projectId").notNull(),
    costType: mysqlEnum("costType", [
      "fuel",
      "repair",
      "overtime",
      "mobilization",
      "other",
    ]).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 3 })
      .default("0")
      .notNull(),
    unitPrice: decimal("unitPrice", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    /** 现场录入的费用名称，例如：液压油、发动机维修、进场拖运。历史记录允许为空。 */
    costName: varchar("costName", { length: 128 }),
    /** 项目部或加油站柴油领用生成的机械油料成本关联；手工成本保持为空。 */
    dieselRefuelRecordId: bigint("dieselRefuelRecordId", { mode: "number" }),
    occurredAt: datetime("occurredAt").notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    /** 机械费用的现场说明、维修内容或票据备注；影像文件仍统一保存于证据表。 */
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    machineDateIndex: index("machine_cost_records_machine_date_index").on(
      table.machineId,
      table.occurredAt
    ),
    dieselRefuelUnique: uniqueIndex(
      "machine_cost_records_diesel_refuel_unique"
    ).on(table.dieselRefuelRecordId),
  })
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
    leaseRate: decimal("leaseRate", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    machineOvertimeRate: decimal("machineOvertimeRate", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    /** 机械产值原始口径。出勤天数按模板采用 30 天月、10 小时工作日折算。 */
    machineWorkDays: decimal("machineWorkDays", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    machineOvertimeHours: decimal("machineOvertimeHours", {
      precision: 10,
      scale: 2,
    })
      .default("0")
      .notNull(),
    driverMonthlyWage: decimal("driverMonthlyWage", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    driverWorkDays: decimal("driverWorkDays", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    driverOvertimeHours: decimal("driverOvertimeHours", {
      precision: 10,
      scale: 2,
    })
      .default("0")
      .notNull(),
    /** 服务端快照计算结果。 */
    machineBaseOutput: decimal("machineBaseOutput", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    machineOvertimeOutput: decimal("machineOvertimeOutput", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    totalOutput: decimal("totalOutput", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    driverOvertimeWage: decimal("driverOvertimeWage", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    driverTotalWage: decimal("driverTotalWage", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    repairAmount: decimal("repairAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    fuelLiters: decimal("fuelLiters", { precision: 14, scale: 3 })
      .default("0")
      .notNull(),
    fuelAmount: decimal("fuelAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    deductionAmount: decimal("deductionAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    shareBaseAmount: decimal("shareBaseAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    machineShareAmount: decimal("machineShareAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    signatureName: varchar("signatureName", { length: 128 }),
    signedAt: datetime("signedAt"),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "settled",
      "void",
    ])
      .default("draft")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectPeriodIndex: index(
      "machine_monthly_statements_project_period_index"
    ).on(table.projectId, table.period, table.status),
    machinePeriodUnique: uniqueIndex(
      "machine_monthly_statements_machine_period_unique"
    ).on(table.machineId, table.projectId, table.period),
  })
);

/**
 * 外租机械按月结算后的付款台账。
 * 月度明细保留成本和分成计算快照，本表只承载收款人、审核、实际付款和不可逆审计，
 * 避免把“已生成结算”误当作“已经付款”。每份月结快照最多生成一张付款结算单。
 */
export const machinePaymentSettlements = mysqlTable(
  "machine_payment_settlements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    settlementNo: varchar("settlementNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    machineId: int("machineId").notNull(),
    monthlyStatementId: bigint("monthlyStatementId", {
      mode: "number",
    }).notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    /** 机械月结快照中的应付机械分成；油料与维修仅作结算依据展示，不自动重复扣减。 */
    grossPayableAmount: decimal("grossPayableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    fuelCostAmount: decimal("fuelCostAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    repairCostAmount: decimal("repairCostAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    manualDeductionAmount: decimal("manualDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    netPayableAmount: decimal("netPayableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    payeeName: varchar("payeeName", { length: 128 }).notNull(),
    payeeAccount: varchar("payeeAccount", { length: 160 }),
    paymentMethod: mysqlEnum("paymentMethod", [
      "bank_transfer",
      "corporate_account",
      "cash",
      "wechat",
      "alipay",
      "other",
    ])
      .default("bank_transfer")
      .notNull(),
    paymentDate: date("paymentDate"),
    paymentReference: varchar("paymentReference", { length: 128 }),
    remarks: varchar("remarks", { length: 500 }),
    /** approved 为金额已核定待付款，partial 为已登记部分实际付款。 */
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "partial",
      "paid",
      "void",
    ])
      .default("draft")
      .notNull(),
    submittedBy: int("submittedBy"),
    submittedAt: datetime("submittedAt"),
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    paidBy: int("paidBy"),
    paidAt: datetime("paidAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    settlementNoUnique: uniqueIndex("machine_payment_settlements_no_unique").on(
      table.settlementNo
    ),
    statementUnique: uniqueIndex(
      "machine_payment_settlements_statement_unique"
    ).on(table.monthlyStatementId),
    projectMachinePeriodIndex: index(
      "machine_payment_settlements_project_machine_period_index"
    ).on(table.projectId, table.machineId, table.period),
    projectStatusIndex: index(
      "machine_payment_settlements_project_status_index"
    ).on(table.projectId, table.status),
    machineForeignKey: foreignKey({
      columns: [table.machineId],
      foreignColumns: [machines.id],
      name: "machine_payment_settlements_machine_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    monthlyStatementForeignKey: foreignKey({
      columns: [table.monthlyStatementId],
      foreignColumns: [machineMonthlyStatements.id],
      name: "machine_payment_settlements_statement_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
  })
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
    shiftCount: decimal("shiftCount", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    shiftRate: decimal("shiftRate", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    workHours: decimal("workHours", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    overtimeHours: decimal("overtimeHours", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    overtimeHourlyRate: decimal("overtimeHourlyRate", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    shiftAmount: decimal("shiftAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    overtimeAmount: decimal("overtimeAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    outputAmount: decimal("outputAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    driverWageAmount: decimal("driverWageAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    driverNameSnapshot: varchar("driverNameSnapshot", { length: 128 }),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "settled",
      "void",
    ])
      .default("draft")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    machineProjectDayUnique: uniqueIndex(
      "machine_daily_operations_machine_project_day_unique"
    ).on(table.machineId, table.projectId, table.occurredOn),
    projectDateIndex: index("machine_daily_operations_project_date_index").on(
      table.projectId,
      table.occurredOn,
      table.status
    ),
  })
);
/** 车辆与机械共用的维修、保养费用台账；不替代既有机械油料/租赁成本明细。 */
export const assetMaintenanceRecords = mysqlTable(
  "asset_maintenance_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    assetType: mysqlEnum("assetType", ["vehicle", "machine"]).notNull(),
    assetId: int("assetId").notNull(),
    projectId: int("projectId").notNull(),
    costCategory: mysqlEnum("costCategory", [
      "maintenance",
      "repair",
    ]).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    occurredAt: datetime("occurredAt").notNull(),
    serviceProvider: varchar("serviceProvider", { length: 160 }),
    meterReading: decimal("meterReading", { precision: 14, scale: 2 }),
    nextDueAt: date("nextDueAt"),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    assetDateIndex: index("asset_maintenance_records_asset_date_index").on(
      table.assetType,
      table.assetId,
      table.occurredAt
    ),
    projectStatusIndex: index(
      "asset_maintenance_records_project_status_index"
    ).on(table.projectId, table.status),
  })
);

/** 渣土车运输车辆档案与货厢参数。 */
export const transportVehicles = mysqlTable(
  "transport_vehicles",
  {
    /** 统一人员身份关联，不改变原司机账号与权限。 */
    driverPersonId: int("driverPersonId"),
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    /** 车辆所属组织由超级管理员维护，用于归属治理；运输趟次仍以 projectId 作为实际业务范围。 */
    organizationId: int("organizationId"),
    plateNo: varchar("plateNo", { length: 32 }).notNull(),
    /** 车辆类型仅描述车辆资源属性，不参与运费计算；默认渣土车兼容既有运输台账。 */
    vehicleType: mysqlEnum("vehicleType", [
      "dump_truck",
      "tractor",
      "mixer",
      "flatbed",
      "pickup",
      "suv",
      "other",
    ])
      .default("dump_truck")
      .notNull(),
    /** 自有、外租或渣土车按趟结算；仅外租车辆允许启用独立租赁规则。 */
    ownership: mysqlEnum("ownership", ["owned", "leased", "trip_settlement"])
      .default("owned")
      .notNull(),
    ownerName: varchar("ownerName", { length: 128 }),
    driverUserId: int("driverUserId"),
    driverName: varchar("driverName", { length: 128 }),
    driverPhoneEncrypted: text("driverPhoneEncrypted"),
    driverPhoneMasked: varchar("driverPhoneMasked", { length: 32 }),
    boxLengthMeters: decimal("boxLengthMeters", {
      precision: 8,
      scale: 3,
    }).notNull(),
    boxWidthMeters: decimal("boxWidthMeters", {
      precision: 8,
      scale: 3,
    }).notNull(),
    boxHeightMeters: decimal("boxHeightMeters", {
      precision: 8,
      scale: 3,
    }).notNull(),
    loadFactor: decimal("loadFactor", { precision: 5, scale: 3 })
      .default("1")
      .notNull(),
    payloadTons: decimal("payloadTons", { precision: 10, scale: 3 }),
    /** 核定油箱容量仅用于柴油领用合理性检测，不替代油表读数。 */
    fuelTankCapacityLiters: decimal("fuelTankCapacityLiters", {
      precision: 10,
      scale: 2,
    }),
    status: mysqlEnum("status", ["active", "suspended", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    plateUnique: uniqueIndex("transport_vehicles_plate_unique").on(
      table.plateNo
    ),
    driverPersonIndex: index("transport_vehicles_driver_person_index").on(
      table.driverPersonId
    ),
  })
);

/** 外部渣土车司机关注服务号后的车辆通知绑定；不创建系统账号，OpenID 只保存密文与不可逆指纹。 */
export const officialAccountDriverBindings = mysqlTable(
  "official_account_driver_bindings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    plateNoSnapshot: varchar("plateNoSnapshot", { length: 32 }).notNull(),
    driverNameSnapshot: varchar("driverNameSnapshot", { length: 128 }),
    driverPhoneMaskedSnapshot: varchar("driverPhoneMaskedSnapshot", {
      length: 32,
    }),
    openIdEncrypted: text("openIdEncrypted").notNull(),
    openIdFingerprint: varchar("openIdFingerprint", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "active",
      "revoked",
      "disabled",
      "unsubscribed",
    ])
      .default("active")
      .notNull(),
    boundAt: datetime("boundAt"),
    lastVerifiedAt: datetime("lastVerifiedAt"),
    lastFailureAt: datetime("lastFailureAt"),
    failureCount: int("failureCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    vehicleIndex: index("official_account_driver_bindings_vehicle_index").on(
      table.vehicleId,
      table.status
    ),
    openIdIndex: index("official_account_driver_bindings_openid_index").on(
      table.openIdFingerprint,
      table.status
    ),
    projectStatusIndex: index(
      "official_account_driver_bindings_project_status_index"
    ).on(table.projectId, table.status),
    vehicleFk: foreignKey({
      columns: [table.vehicleId],
      foreignColumns: [transportVehicles.id],
      name: "official_account_driver_bindings_vehicle_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  })
);

/** 外部司机回复“绑定”后生成的短时链接；仅保存令牌指纹与 OpenID 密文，不在 URL 中暴露 OpenID。 */
export const officialAccountDriverBindingRequests = mysqlTable(
  "official_account_driver_binding_requests",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    tokenFingerprint: varchar("tokenFingerprint", { length: 64 }).notNull(),
    openIdEncrypted: text("openIdEncrypted").notNull(),
    openIdFingerprint: varchar("openIdFingerprint", { length: 64 }).notNull(),
    expiresAt: datetime("expiresAt").notNull(),
    consumedAt: datetime("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tokenUnique: uniqueIndex(
      "official_account_driver_binding_requests_token_unique"
    ).on(table.tokenFingerprint),
    openIdIndex: index(
      "official_account_driver_binding_requests_openid_index"
    ).on(table.openIdFingerprint, table.expiresAt),
  })
);

/** 外部司机微信通知投递审计；不写入内部用户通知表，避免把外部司机伪造成系统账号。 */
export const officialAccountDriverNotificationRecords = mysqlTable(
  "official_account_driver_notification_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    eventCode: varchar("eventCode", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 180 }).notNull(),
    driverBindingId: bigint("driverBindingId", { mode: "number" }),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    deepLink: varchar("deepLink", { length: 512 }),
    status: mysqlEnum("status", ["pending", "sent", "failed", "skipped"])
      .default("pending")
      .notNull(),
    retryCount: int("retryCount").default(0).notNull(),
    sentAt: datetime("sentAt"),
    providerMessageId: varchar("providerMessageId", { length: 128 }),
    failureCode: varchar("failureCode", { length: 64 }),
    lastAttemptedAt: datetime("lastAttemptedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex(
      "official_account_driver_notifications_idempotency_unique"
    ).on(table.idempotencyKey),
    vehicleStatusIndex: index(
      "official_account_driver_notifications_vehicle_status_index"
    ).on(table.vehicleId, table.status),
    projectCreatedIndex: index(
      "official_account_driver_notifications_project_created_index"
    ).on(table.projectId, table.createdAt),
  })
);

/** 外租车辆租金规则；车辆自有时不建立启用规则，历史外租合同继续保留用于结算与审计。 */
export const transportVehicleLeaseRules = mysqlTable(
  "transport_vehicle_lease_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    billingType: mysqlEnum("billingType", [
      "monthly",
      "daily",
      "hourly",
      "shift",
    ]).notNull(),
    rate: decimal("rate", { precision: 16, scale: 2 }).notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    vehicleStatusIndex: index(
      "transport_vehicle_lease_rules_vehicle_status_index"
    ).on(table.vehicleId, table.status),
  })
);

/** 车辆/车主的默认收款资料。账号按业务要求明文维护，但只对运输、会计、财务授权范围可见。 */
export const transportVehiclePayeeAccounts = mysqlTable(
  "transport_vehicle_payee_accounts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    payeeName: varchar("payeeName", { length: 128 }).notNull(),
    paymentMethod: mysqlEnum("paymentMethod", [
      "bank_transfer",
      "corporate_account",
      "cash",
      "wechat",
      "alipay",
      "other",
    ]).notNull(),
    accountName: varchar("accountName", { length: 128 }),
    accountNo: varchar("accountNo", { length: 160 }),
    isDefault: boolean("isDefault").default(false).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    vehicleStatusIndex: index(
      "transport_vehicle_payee_accounts_vehicle_status_index"
    ).on(table.vehicleId, table.status),
    vehicleDefaultIndex: index(
      "transport_vehicle_payee_accounts_vehicle_default_index"
    ).on(table.vehicleId, table.isDefault),
  })
);
/** 日租、小时租、台班外租车辆的实际使用/出勤依据；月租在有效合同月内按周期结算。 */
export const transportVehicleUsageRecords = mysqlTable(
  "transport_vehicle_usage_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    usageDate: date("usageDate").notNull(),
    usageType: mysqlEnum("usageType", ["daily", "hourly", "shift"]).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    /** 被结算后锁定，作废结算单时由受控事务释放。 */
    settlementId: bigint("settlementId", { mode: "number" }),
    status: mysqlEnum("status", ["confirmed", "void"])
      .default("confirmed")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    voidedBy: int("voidedBy"),
    voidedAt: datetime("voidedAt"),
    voidReason: varchar("voidReason", { length: 500 }),
  },
  table => ({
    vehicleDateIndex: index(
      "transport_vehicle_usage_records_vehicle_date_index"
    ).on(table.vehicleId, table.usageDate, table.status),
    projectDateIndex: index(
      "transport_vehicle_usage_records_project_date_index"
    ).on(table.projectId, table.usageDate, table.status),
    settlementIndex: index(
      "transport_vehicle_usage_records_settlement_index"
    ).on(table.settlementId),
  })
);
/** 项目柴油指导单价；项目部供油按生效规则取价，历史领用保留单价快照。 */
export const dieselGuidelinePrices = mysqlTable(
  "diesel_guideline_prices",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    pricePerLiter: decimal("pricePerLiter", {
      precision: 16,
      scale: 2,
    }).notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["draft", "active", "disabled"])
      .default("draft")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectStatusDateIndex: index(
      "diesel_guideline_prices_project_status_date_index"
    ).on(table.projectId, table.status, table.effectiveFrom),
  })
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
    thresholdPercent: decimal("thresholdPercent", { precision: 8, scale: 2 })
      .default("10.00")
      .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectUnique: uniqueIndex("diesel_price_alert_rules_project_unique").on(
      table.projectId
    ),
  })
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
    supplyMethod: mysqlEnum("supplyMethod", [
      "project_supply",
      "external_station",
    ]).notNull(),
    stationOrSupplierName: varchar("stationOrSupplierName", { length: 160 }),
    liters: decimal("liters", { precision: 12, scale: 3 }).notNull(),
    /** 加油站自购填写实际单价；项目部供油由有效指导价快照写入。 */
    actualUnitPrice: decimal("actualUnitPrice", { precision: 16, scale: 2 }),
    appliedUnitPrice: decimal("appliedUnitPrice", {
      precision: 16,
      scale: 2,
    }).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    deductFromFreight: boolean("deductFromFreight").default(false).notNull(),
    refueledAt: datetime("refueledAt").notNull(),
    meterReading: decimal("meterReading", { precision: 14, scale: 2 }),
    receiptNo: varchar("receiptNo", { length: 64 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"])
      .default("draft")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    recordNoUnique: uniqueIndex("diesel_refuel_records_no_unique").on(
      table.recordNo
    ),
    projectDateIndex: index("diesel_refuel_records_project_date_index").on(
      table.projectId,
      table.refueledAt
    ),
    tripStatusIndex: index("diesel_refuel_records_trip_status_index").on(
      table.transportTripId,
      table.status
    ),
    vehicleDateIndex: index("diesel_refuel_records_vehicle_date_index").on(
      table.vehicleId,
      table.refueledAt
    ),
    machineDateIndex: index("diesel_refuel_records_machine_date_index").on(
      table.machineId,
      table.refueledAt
    ),
  })
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
    connectionMode: mysqlEnum("connectionMode", [
      "manual_placeholder",
      "usb",
      "serial",
      "network",
    ])
      .default("manual_placeholder")
      .notNull(),
    status: mysqlEnum("status", ["active", "disabled", "maintenance"])
      .default("active")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    lastConfirmedAt: datetime("lastConfirmedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectDeviceCodeUnique: uniqueIndex(
      "rfid_writer_devices_project_code_unique"
    ).on(table.projectId, table.deviceCode),
    projectStatusIndex: index("rfid_writer_devices_project_status_index").on(
      table.projectId,
      table.status
    ),
  })
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
    /** 解除绑定后保留卡片 UID、项目归属和审计历史，车辆关联为空；卡片不得直接用于运输闭环。 */
    vehicleId: int("vehicleId"),
    writerDeviceId: int("writerDeviceId"),
    cardUidFingerprint: varchar("cardUidFingerprint", { length: 64 }).notNull(),
    cardUidMasked: varchar("cardUidMasked", { length: 32 }).notNull(),
    /** 面向后台台账的非敏感人工管理编号；不等同于芯片 UID，也不写入实体卡。 */
    managementCode: varchar("managementCode", { length: 64 }),
    /** 仅用于管理员在写卡时临时生成载荷和司机本人通知，不向普通列表或事件审计返回。 */
    driverPhoneEncrypted: text("driverPhoneEncrypted"),
    driverPhoneMasked: varchar("driverPhoneMasked", { length: 32 }),
    payloadVersion: int("payloadVersion").default(1).notNull(),
    status: mysqlEnum("status", ["active", "suspended", "revoked"])
      .default("active")
      .notNull(),
    issuedAt: datetime("issuedAt"),
    lastWrittenAt: datetime("lastWrittenAt"),
    revokedAt: datetime("revokedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    cardUidUnique: uniqueIndex("transport_vehicle_rfid_cards_uid_unique").on(
      table.cardUidFingerprint
    ),
    projectManagementCodeUnique: uniqueIndex(
      "transport_vehicle_rfid_cards_project_management_code_unique"
    ).on(table.projectId, table.managementCode),
    vehicleStatusIndex: index(
      "transport_vehicle_rfid_cards_vehicle_status_index"
    ).on(table.vehicleId, table.status),
    projectStatusIndex: index(
      "transport_vehicle_rfid_cards_project_status_index"
    ).on(table.projectId, table.status),
  })
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
    /** 正式 PC 写卡任务将 RC3 载荷和签名深链 AES-GCM 加密暂存；浏览器和普通任务列表均不返回明文。 */
    payloadEncrypted: text("payloadEncrypted"),
    /** manual_confirmation、mobile_web_nfc、pc_bridge。仅 pc_bridge 可由本地桥接回读后自动确认。 */
    executionMode: varchar("executionMode", { length: 32 })
      .default("manual_confirmation")
      .notNull(),
    /** 一次性桥接令牌只存 SHA-256 摘要，过期或完成后失效。 */
    bridgeTokenHash: varchar("bridgeTokenHash", { length: 64 }),
    bridgeTokenExpiresAt: datetime("bridgeTokenExpiresAt"),
    payloadVersion: int("payloadVersion").notNull(),
    status: mysqlEnum("status", [
      "prepared",
      "confirmed",
      "failed",
      "cancelled",
    ])
      .default("prepared")
      .notNull(),
    failureReason: varchar("failureReason", { length: 500 }),
    preparedBy: int("preparedBy").notNull(),
    confirmedBy: int("confirmedBy"),
    confirmedAt: datetime("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    jobNoUnique: uniqueIndex("rfid_card_write_jobs_no_unique").on(table.jobNo),
    cardCreatedIndex: index("rfid_card_write_jobs_card_created_index").on(
      table.cardId,
      table.createdAt
    ),
    projectStatusIndex: index("rfid_card_write_jobs_project_status_index").on(
      table.projectId,
      table.status
    ),
  })
);

/** 运输价格规则。步长默认 500 米但允许后台按合同修改。 */
export const freightRateRules = mysqlTable(
  "freight_rate_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    materialName: varchar("materialName", { length: 128 }),
    settlementUnit: mysqlEnum("settlementUnit", [
      "cubic_meter",
      "ton",
      "trip",
    ]).notNull(),
    startDistanceKm: decimal("startDistanceKm", { precision: 8, scale: 3 })
      .default("1")
      .notNull(),
    basePricePerUnit: decimal("basePricePerUnit", {
      precision: 16,
      scale: 2,
    }).notNull(),
    stepMeters: int("stepMeters").default(500).notNull(),
    stepIncreasePerUnit: decimal("stepIncreasePerUnit", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    effectiveFrom: date("effectiveFrom").notNull(),
    effectiveTo: date("effectiveTo"),
    status: mysqlEnum("status", ["draft", "active", "disabled"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    projectIndex: index("freight_rate_rules_project_index").on(
      table.projectId,
      table.status
    ),
  })
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
    /** 卸土点统一安全规则；装土点保留默认值但不参与卸土校验。 */
    minimumTransitMinutes: int("minimumTransitMinutes").default(10).notNull(),
    minimumTransitEnabled: boolean("minimumTransitEnabled")
      .default(true)
      .notNull(),
    unloadGeofenceMeters: int("unloadGeofenceMeters").default(300).notNull(),
    unloadGeofenceEnabled: boolean("unloadGeofenceEnabled")
      .default(true)
      .notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectTypeStatusIndex: index(
      "transport_sites_project_type_status_index"
    ).on(table.projectId, table.siteType, table.status),
    projectNameUnique: uniqueIndex(
      "transport_sites_project_type_name_unique"
    ).on(table.projectId, table.siteType, table.name),
    administratorIndex: index("transport_sites_administrator_index").on(
      table.administratorUserId,
      table.status
    ),
  })
);

/** 装土/卸土现场读卡设备台账；设备归属一个启用地点，实际操作仍要求登录用户处于该项目运输权限和地点管理员边界内。 */
export const transportReaderDevices = mysqlTable(
  "transport_reader_devices",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    siteId: int("siteId").notNull(),
    deviceCode: varchar("deviceCode", { length: 128 }).notNull(),
    displayName: varchar("displayName", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["active", "disabled", "maintenance"])
      .default("active")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectDeviceCodeUnique: uniqueIndex(
      "transport_reader_devices_project_code_unique"
    ).on(table.projectId, table.deviceCode),
    siteStatusIndex: index("transport_reader_devices_site_status_index").on(
      table.siteId,
      table.status
    ),
  })
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
    presetDistanceKm: decimal("presetDistanceKm", {
      precision: 10,
      scale: 3,
    }).notNull(),
    /** 车辆装土确认后达到该时间才允许在卸土点闭环；默认 10 分钟，按线路由运输负责人调整。 */
    minimumTransitMinutes: int("minimumTransitMinutes").default(10).notNull(),
    /** 是否将最短运输时间作为卸土硬拦截；关闭后仅留待核验提示。 */
    minimumTransitEnabled: boolean("minimumTransitEnabled")
      .default(true)
      .notNull(),
    /** 卸土手机定位与预设卸土点坐标的最大允许偏差，单位米；默认 300 米。 */
    unloadGeofenceMeters: int("unloadGeofenceMeters").default(300).notNull(),
    /** 是否将卸土点定位范围作为卸土硬拦截；关闭后仅留待核验提示。 */
    unloadGeofenceEnabled: boolean("unloadGeofenceEnabled")
      .default(true)
      .notNull(),
    /** 装土点未刷卡时，是否允许本路线仅由卸土点读卡在安全阈值通过后补齐运输闭环；默认关闭。 */
    unloadOnlyCloseEnabled: boolean("unloadOnlyCloseEnabled")
      .default(false)
      .notNull(),
    isDefault: boolean("isDefault").default(false).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectStatusIndex: index(
      "transport_route_presets_project_status_index"
    ).on(table.projectId, table.status),
    projectSitesUnique: uniqueIndex(
      "transport_route_presets_project_sites_unique"
    ).on(table.projectId, table.loadSiteId, table.unloadSiteId),
  })
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
    invoiceMode: mysqlEnum("invoiceMode", ["nfc_card", "plate_photo"])
      .default("nfc_card")
      .notNull(),
    loadSiteId: int("loadSiteId"),
    unloadSiteId: int("unloadSiteId"),
    startAt: datetime("startAt").notNull(),
    endAt: datetime("endAt"),
    actualDistanceKm: decimal("actualDistanceKm", { precision: 10, scale: 3 }),
    volumeCubicMeters: decimal("volumeCubicMeters", {
      precision: 12,
      scale: 3,
    }),
    weightTons: decimal("weightTons", { precision: 12, scale: 3 }),
    calculatedUnitPrice: decimal("calculatedUnitPrice", {
      precision: 16,
      scale: 2,
    }),
    calculatedAmount: decimal("calculatedAmount", { precision: 16, scale: 2 }),
    /** 仅在结算时由已核准且关联本趟的柴油领用记录汇总，不得由浏览器直接写入。 */
    fuelDeductionAmount: decimal("fuelDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    netSettlementAmount: decimal("netSettlementAmount", {
      precision: 16,
      scale: 2,
    }),
    fuelSettlementSnapshot: json("fuelSettlementSnapshot"),
    routeSnapshot: json("routeSnapshot"),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "verified",
      "settled",
      "void",
    ])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    loadConfirmedAt: datetime("loadConfirmedAt"),
    unloadConfirmedAt: datetime("unloadConfirmedAt"),
    loadConfirmedBy: int("loadConfirmedBy"),
    unloadConfirmedBy: int("unloadConfirmedBy"),
    loadEventId: bigint("loadEventId", { mode: "number" }),
    unloadEventId: bigint("unloadEventId", { mode: "number" }),
    /** 同车同项目在途刷卡会话键，仅在装土确认至卸土确认期间有效，防止重复装土创建并行票据。 */
    nfcTransitKey: varchar("nfcTransitKey", { length: 128 }),
    /** 所有开票来源共用的一车一在途锁；仅在卸土、作废或终态结算后清空，数据库唯一索引兜底并发重复开票。 */
    activeVehicleTransitKey: varchar("activeVehicleTransitKey", {
      length: 128,
    }),
    exceptionStatus: mysqlEnum("exceptionStatus", ["none", "open", "resolved"])
      .default("none")
      .notNull(),
  },
  table => ({
    tripUnique: uniqueIndex("transport_trips_no_unique").on(table.tripNo),
    vehicleDateIndex: index("transport_trips_vehicle_date_index").on(
      table.vehicleId,
      table.startAt
    ),
    projectLoadSiteIndex: index("transport_trips_project_load_site_index").on(
      table.projectId,
      table.loadSiteId,
      table.startAt
    ),
    projectStatusStartIndex: index(
      "transport_trips_project_status_start_index"
    ).on(table.projectId, table.status, table.startAt),
    projectUnloadSiteIndex: index(
      "transport_trips_project_unload_site_index"
    ).on(table.projectId, table.unloadSiteId, table.startAt),
    projectTransitKeyIndex: index("transport_trips_nfc_transit_key_index").on(
      table.projectId,
      table.nfcTransitKey
    ),
    projectActiveVehicleTransitUnique: uniqueIndex(
      "transport_trips_project_active_vehicle_transit_unique"
    ).on(table.projectId, table.activeVehicleTransitKey),
  })
);

/**
 * 渣土车按趟费用结算单。结算周期可覆盖单日或指定日期范围，付款完成后进入不可逆 paid 状态。
 * 收款方式属于本次付款安排而非车辆固定属性，避免同一车主因不同结算要求产生错误历史覆盖。
 */
export const transportVehicleSettlements = mysqlTable(
  "transport_vehicle_settlements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    settlementNo: varchar("settlementNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    vehicleId: int("vehicleId").notNull(),
    periodStart: date("periodStart").notNull(),
    periodEnd: date("periodEnd").notNull(),
    /** 按趟、外租使用/租赁或经审核的调整结算；历史单据默认兼容 trip。 */
    settlementKind: mysqlEnum("settlementKind", ["trip", "lease", "adjustment"])
      .default("trip")
      .notNull(),
    basisDescription: varchar("basisDescription", { length: 500 }),
    tripCount: int("tripCount").notNull(),
    totalVolumeCubicMeters: decimal("totalVolumeCubicMeters", {
      precision: 14,
      scale: 3,
    })
      .default("0")
      .notNull(),
    grossFreightAmount: decimal("grossFreightAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    fuelDeductionAmount: decimal("fuelDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    /** 车辆配件、维修等经审核资产费用扣款，与柴油扣款分列保留。 */
    assetDeductionAmount: decimal("assetDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    /** 前期待收补款在本期运费中抵扣；原始补款与本次抵扣均通过独立分配表可追溯。 */
    carryForwardDeductionAmount: decimal("carryForwardDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    netPayableAmount: decimal("netPayableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    payeeName: varchar("payeeName", { length: 128 }).notNull(),
    /** 人工付款需要原文账户信息以便制作银行导入表；仅受运输/财务权限和项目范围保护。 */
    payeeAccount: varchar("payeeAccount", { length: 160 }),
    paymentMethod: mysqlEnum("paymentMethod", [
      "bank_transfer",
      "corporate_account",
      "cash",
      "wechat",
      "alipay",
      "other",
    ])
      .default("bank_transfer")
      .notNull(),
    paymentDate: date("paymentDate"),
    paymentReference: varchar("paymentReference", { length: 128 }),
    remarks: varchar("remarks", { length: 500 }),
    /** receivable 表示扣款超过本期应付，offset 表示已在后期抵扣；均不产生负数付款。 */
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "partial",
      "paid",
      "receivable",
      "offset",
      "void",
    ])
      .default("draft")
      .notNull(),
    submittedBy: int("submittedBy"),
    submittedAt: datetime("submittedAt"),
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    paidBy: int("paidBy"),
    paidAt: datetime("paidAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    settlementNoUnique: uniqueIndex(
      "transport_vehicle_settlements_no_unique"
    ).on(table.settlementNo),
    projectVehiclePeriodIndex: index(
      "transport_vehicle_settlements_project_vehicle_period_index"
    ).on(table.projectId, table.vehicleId, table.periodStart, table.periodEnd),
    projectStatusIndex: index(
      "transport_vehicle_settlements_project_status_index"
    ).on(table.projectId, table.status),
    vehicleForeignKey: foreignKey({
      columns: [table.vehicleId],
      foreignColumns: [transportVehicles.id],
      name: "transport_vehicle_settlements_vehicle_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
  })
);

/** 结算单逐趟快照。一个运输趟次只能归属一张非历史迁移结算单，避免重复付款。 */
export const transportVehicleSettlementItems = mysqlTable(
  "transport_vehicle_settlement_items",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    settlementId: bigint("settlementId", { mode: "number" }).notNull(),
    tripId: bigint("tripId", { mode: "number" }).notNull(),
    tripNo: varchar("tripNo", { length: 64 }).notNull(),
    tripDate: date("tripDate").notNull(),
    volumeCubicMeters: decimal("volumeCubicMeters", { precision: 14, scale: 3 })
      .default("0")
      .notNull(),
    grossFreightAmount: decimal("grossFreightAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    fuelDeductionAmount: decimal("fuelDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    netPayableAmount: decimal("netPayableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    settlementTripUnique: uniqueIndex(
      "transport_vehicle_settlement_items_trip_unique"
    ).on(table.tripId),
    settlementIndex: index(
      "transport_vehicle_settlement_items_settlement_index"
    ).on(table.settlementId),
    settlementForeignKey: foreignKey({
      columns: [table.settlementId],
      foreignColumns: [transportVehicleSettlements.id],
      name: "transport_vehicle_settlement_items_settlement_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    tripForeignKey: foreignKey({
      columns: [table.tripId],
      foreignColumns: [transportTrips.id],
      name: "transport_vehicle_settlement_items_trip_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
  })
);

/**
 * 实际资金收付的唯一事实来源。每笔记录关联具体结算单、付款凭证与财务流水；
 * 业务主单的应付额不会被当作现金流重复入账。
 */
export const settlementPaymentRecords = mysqlTable(
  "settlement_payment_records",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    /** 所有实际收付均落入同一付款明细；分包也必须逐笔关联付款凭证。 */
    settlementType: mysqlEnum("settlementType", [
      "transport_vehicle",
      "machine",
      "payroll",
      "daily_wage",
      "subcontract",
    ]).notNull(),
    settlementId: bigint("settlementId", { mode: "number" }).notNull(),
    direction: mysqlEnum("direction", ["expense", "income"]).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    paymentDate: date("paymentDate").notNull(),
    paymentMethod: mysqlEnum("paymentMethod", [
      "bank_transfer",
      "corporate_account",
      "cash",
      "wechat",
      "alipay",
      "other",
    ]).notNull(),
    payeeNameSnapshot: varchar("payeeNameSnapshot", { length: 128 }).notNull(),
    payeeAccountSnapshot: varchar("payeeAccountSnapshot", { length: 160 }),
    paymentReference: varchar("paymentReference", { length: 128 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["active", "reversed"])
      .default("active")
      .notNull(),
    paidBy: int("paidBy").notNull(),
    paidAt: datetime("paidAt").notNull(),
    reversedBy: int("reversedBy"),
    reversedAt: datetime("reversedAt"),
    reversalReason: varchar("reversalReason", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    settlementIndex: index("settlement_payment_records_settlement_index").on(
      table.settlementType,
      table.settlementId,
      table.status
    ),
    projectDateIndex: index("settlement_payment_records_project_date_index").on(
      table.projectId,
      table.paymentDate,
      table.status
    ),
    projectDateTypeStatusIndex: index(
      "settlement_payment_records_project_date_type_status_index"
    ).on(
      table.projectId,
      table.paymentDate,
      table.settlementType,
      table.status
    ),
    evidenceIndex: index("settlement_payment_records_evidence_index").on(
      table.evidenceId
    ),
  })
);
/** 车辆待收补款用于后期结算抵扣的分配记录；不覆盖原始油料或运输金额。 */
export const transportVehicleCarryForwardOffsets = mysqlTable(
  "transport_vehicle_carry_forward_offsets",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    vehicleId: int("vehicleId").notNull(),
    sourceSettlementId: bigint("sourceSettlementId", {
      mode: "number",
    }).notNull(),
    targetSettlementId: bigint("targetSettlementId", {
      mode: "number",
    }).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["active", "reversed"])
      .default("active")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    reversedBy: int("reversedBy"),
    reversedAt: datetime("reversedAt"),
    reversalReason: varchar("reversalReason", { length: 500 }),
  },
  table => ({
    sourceIndex: index("transport_vehicle_carry_offsets_source_index").on(
      table.sourceSettlementId,
      table.status
    ),
    targetIndex: index("transport_vehicle_carry_offsets_target_index").on(
      table.targetSettlementId,
      table.status
    ),
    vehicleIndex: index("transport_vehicle_carry_offsets_vehicle_index").on(
      table.vehicleId,
      table.status
    ),
  })
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
    source: mysqlEnum("source", [
      "card_reader",
      "manual_review",
      "offline_replay",
    ])
      .default("card_reader")
      .notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 160 }).notNull(),
    deviceId: varchar("deviceId", { length: 128 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    cardFingerprint: varchar("cardFingerprint", { length: 64 }),
    payloadFingerprint: varchar("payloadFingerprint", { length: 64 }),
    occurredAt: datetime("occurredAt").notNull(),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    validationStatus: mysqlEnum("validationStatus", [
      "accepted",
      "duplicate",
      "rejected",
      "needs_review",
    ])
      .default("accepted")
      .notNull(),
    validationReason: varchar("validationReason", { length: 500 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex(
      "transport_card_events_idempotency_unique"
    ).on(table.idempotencyKey),
    tripIndex: index("transport_card_events_trip_index").on(
      table.tripId,
      table.occurredAt
    ),
    vehicleIndex: index("transport_card_events_vehicle_index").on(
      table.vehicleId,
      table.occurredAt
    ),
    siteEventIndex: index("transport_card_events_site_event_index").on(
      table.siteId,
      table.eventType,
      table.occurredAt
    ),
  })
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
    amount: decimal("amount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    description: text("description").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "ordered",
      "received",
      "stocked",
      "closed",
      "rejected",
    ])
      .default("draft")
      .notNull(),
    /** 审批、入库和关闭责任人用于单据全流程追溯；历史数据允许为空。 */
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    stockedBy: int("stockedBy"),
    stockedAt: datetime("stockedAt"),
    closedAt: datetime("closedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("purchase_requests_no_unique").on(
      table.requestNo
    ),
  })
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
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    organizationIndex: index("suppliers_organization_index").on(
      table.organizationId
    ),
    nameIndex: index("suppliers_name_index").on(table.name),
  })
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
    procurementMode: mysqlEnum("procurementMode", [
      "request",
      "small_direct",
      "imported",
    ])
      .default("request")
      .notNull(),
    categoryId: int("categoryId"),
    itemDescription: varchar("itemDescription", { length: 500 }),
    /** 清单采购数量与单价由服务端计算金额快照；历史订单允许为空以兼容。 */
    quantity: decimal("quantity", { precision: 16, scale: 3 }),
    unitPrice: decimal("unitPrice", { precision: 16, scale: 2 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    /** 独立验收依据，不改写历史采购数量或金额。 */
    inventoryItemName: varchar("inventoryItemName", { length: 200 }),
    inventoryUnit: varchar("inventoryUnit", { length: 32 }),
    receiptExpectedQuantity: decimal("receiptExpectedQuantity", {
      precision: 14,
      scale: 3,
    }),
    receiptBasisReason: varchar("receiptBasisReason", { length: 500 }),
    /** 默认无发票；发生发票时关联原始照片或 PDF 审计附件。 */
    hasInvoice: boolean("hasInvoice").default(false).notNull(),
    invoiceEvidenceId: bigint("invoiceEvidenceId", { mode: "number" }),
    ocrSummary: varchar("ocrSummary", { length: 500 }),
    supplierId: int("supplierId"),
    /** 历史导入订单保留实际采购者快照；常规订单可为空并在界面回退至创建人。 */
    purchaserName: varchar("purchaserName", { length: 128 }),
    /** 车辆或机械零配件采购必须关联具体资产，普通采购保持为空。 */
    assetType: mysqlEnum("assetType", ["vehicle", "machine"]),
    assetId: int("assetId"),
    /** 已从关联资产租赁/运费结算中扣减时保存唯一结算单号，防止重复扣款。 */
    assetDeductionReference: varchar("assetDeductionReference", { length: 64 }),
    assetDeductedAt: datetime("assetDeductedAt"),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    orderedAt: datetime("orderedAt").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "confirmed",
      "received",
      "closed",
      "void",
    ])
      .default("draft")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    confirmedBy: int("confirmedBy"),
    confirmedAt: datetime("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    orderNoUnique: uniqueIndex("purchase_orders_no_unique").on(table.orderNo),
    requestIndex: index("purchase_orders_request_index").on(table.requestId),
    procurementModeIndex: index("purchase_orders_mode_index").on(
      table.projectId,
      table.procurementMode,
      table.status
    ),
    projectIndex: index("purchase_orders_project_index").on(
      table.projectId,
      table.status
    ),
    assetIndex: index("purchase_orders_asset_index").on(
      table.projectId,
      table.assetType,
      table.assetId,
      table.status
    ),
    assetDeductionIndex: index("purchase_orders_asset_deduction_index").on(
      table.projectId,
      table.assetType,
      table.assetId,
      table.assetDeductionReference
    ),
  })
);

/** 库存只保留可审计的收发流水，余额由服务器按项目、物料和单位聚合计算。 */
export const inventoryTransactions = mysqlTable(
  "inventory_transactions",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    requestId: bigint("requestId", { mode: "number" }),
    purchaseOrderId: bigint("purchaseOrderId", { mode: "number" }),
    /** 入库、领用或退库的采购/验收凭证；文件本体只保存于对象存储。 */
    evidenceId: bigint("evidenceId", { mode: "number" }),
    transactionNo: varchar("transactionNo", { length: 64 }).notNull(),
    transactionType: mysqlEnum("transactionType", [
      "inbound",
      "outbound",
      "return",
    ]).notNull(),
    itemName: varchar("itemName", { length: 200 }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    /** 旧流水保留原价，新流水仅按版本化移动加权/原领用退库。 */
    originalOutboundId: bigint("originalOutboundId", { mode: "number" }),
    costRuleVersion: varchar("costRuleVersion", { length: 32 })
      .default("legacy_v1")
      .notNull(),
    costingUnitCost: decimal("costingUnitCost", { precision: 24, scale: 8 }),
    exceptionReason: varchar("exceptionReason", { length: 500 }),
    quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: decimal("unitCost", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    occurredAt: datetime("occurredAt").notNull(),
    operatorId: int("operatorId").notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    transactionNoUnique: uniqueIndex("inventory_transactions_no_unique").on(
      table.transactionNo
    ),
    projectItemIndex: index("inventory_transactions_project_item_index").on(
      table.projectId,
      table.itemName,
      table.unit
    ),
    evidenceIndex: index("inventory_transactions_evidence_index").on(
      table.evidenceId
    ),
    originalOutboundIndex: index(
      "inventory_transactions_original_outbound_index"
    ).on(table.originalOutboundId),
    purchaseOrderIndex: index("inventory_transactions_purchase_order_index").on(
      table.purchaseOrderId
    ),
  })
);

/** 工程计量申报与审核台账。 */
export const measurementClaims = mysqlTable(
  "measurement_claims",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    claimNo: varchar("claimNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    declaredAmount: decimal("declaredAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    approvedAmount: decimal("approvedAmount", { precision: 16, scale: 2 }),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "reviewing",
      "approved",
      "settled",
      "rejected",
      "void",
    ])
      .default("draft")
      .notNull(),
    submittedBy: int("submittedBy").notNull(),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    accountantId: int("accountantId"),
    settledAt: datetime("settledAt"),
    reviewNote: varchar("reviewNote", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    claimUnique: uniqueIndex("measurement_claims_no_unique").on(table.claimNo),
  })
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
    unit: mysqlEnum("unit", [
      "m3",
      "m2",
      "m",
      "t",
      "piece",
      "set",
      "other",
    ]).notNull(),
    quantity: decimal("quantity", { precision: 16, scale: 3 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    declaredAmount: decimal("declaredAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    takeoffDate: date("takeoffDate").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "reviewing",
      "approved",
      "rejected",
      "locked",
      "void",
    ])
      .default("draft")
      .notNull(),
    submittedBy: int("submittedBy").notNull(),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    reviewNote: varchar("reviewNote", { length: 500 }),
    lockedAt: datetime("lockedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    takeoffNoUnique: uniqueIndex("measurement_takeoff_records_no_unique").on(
      table.takeoffNo
    ),
    projectStatusDateIndex: index(
      "measurement_takeoff_records_project_status_date_index"
    ).on(table.projectId, table.status, table.takeoffDate),
    claimIndex: index("measurement_takeoff_records_claim_index").on(
      table.measurementClaimId
    ),
  })
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
    takeoffEvidenceUnique: uniqueIndex(
      "measurement_takeoff_evidences_unique"
    ).on(table.takeoffId, table.evidenceId),
    takeoffIndex: index("measurement_takeoff_evidences_takeoff_index").on(
      table.takeoffId
    ),
  })
);

/** 项目分包施工队台账；与劳务班组不同，专用于工程量分批分包与结算对照。 */
export const subcontractTeams = mysqlTable(
  "subcontract_teams",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    teamName: varchar("teamName", { length: 200 }).notNull(),
    contactName: varchar("contactName", { length: 100 }),
    contactPhoneEncrypted: text("contactPhoneEncrypted"),
    contactPhoneMasked: varchar("contactPhoneMasked", { length: 32 }),
    status: mysqlEnum("status", ["active", "suspended", "closed"])
      .default("active")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectTeamUnique: uniqueIndex("subcontract_teams_project_name_unique").on(
      table.projectId,
      table.teamName
    ),
    projectStatusIndex: index("subcontract_teams_project_status_index").on(
      table.projectId,
      table.status
    ),
  })
);

/** 将已确认的项目部收方工程量分批下达给施工队，并独立记录分包结算快照。 */
export const subcontractPackages = mysqlTable(
  "subcontract_packages",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    packageNo: varchar("packageNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    measurementTakeoffId: bigint("measurementTakeoffId", { mode: "number" }),
    subcontractTeamId: bigint("subcontractTeamId", {
      mode: "number",
    }).notNull(),
    workItem: varchar("workItem", { length: 200 }).notNull(),
    workLocation: varchar("workLocation", { length: 200 }),
    unit: mysqlEnum("unit", [
      "m3",
      "m2",
      "m",
      "t",
      "piece",
      "set",
      "other",
    ]).notNull(),
    quantity: decimal("quantity", { precision: 16, scale: 3 }).notNull(),
    upstreamUnitPrice: decimal("upstreamUnitPrice", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    subcontractUnitPrice: decimal("subcontractUnitPrice", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    upstreamAmount: decimal("upstreamAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    subcontractAmount: decimal("subcontractAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    marginAmount: decimal("marginAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    /** 分包单价高于上游单价时必须留存业务原因，并在确认与付款前完成双岗复核。 */
    priceExceptionReason: varchar("priceExceptionReason", { length: 500 }),
    confirmedBy: int("confirmedBy"),
    confirmedAt: datetime("confirmedAt"),
    priceExceptionReviewedBy: int("priceExceptionReviewedBy"),
    priceExceptionReviewedAt: datetime("priceExceptionReviewedAt"),
    status: mysqlEnum("status", [
      "draft",
      "allocated",
      "confirmed",
      "settled",
      "void",
    ])
      .default("draft")
      .notNull(),
    allocatedAt: datetime("allocatedAt"),
    settledAt: datetime("settledAt"),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    packageNoUnique: uniqueIndex("subcontract_packages_no_unique").on(
      table.packageNo
    ),
    projectStatusIndex: index("subcontract_packages_project_status_index").on(
      table.projectId,
      table.status
    ),
    teamIndex: index("subcontract_packages_team_index").on(
      table.subcontractTeamId
    ),
    takeoffIndex: index("subcontract_packages_takeoff_index").on(
      table.measurementTakeoffId
    ),
  })
);

/**
 * 分包包件的应付付款结算单。
 * 包件确认只代表工程量与单价复核；本表才承载收款人、发票/税票、会计审核与实际付款。
 * 每个包件仅允许一张结算单，实际付款后不可作废，避免将“分包结算”错误等同于“已付款”。
 */
export const subcontractPaymentSettlements = mysqlTable(
  "subcontract_payment_settlements",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    settlementNo: varchar("settlementNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    packageId: bigint("packageId", { mode: "number" }).notNull(),
    subcontractTeamId: bigint("subcontractTeamId", {
      mode: "number",
    }).notNull(),
    packageNoSnapshot: varchar("packageNoSnapshot", { length: 64 }).notNull(),
    workItemSnapshot: varchar("workItemSnapshot", { length: 200 }).notNull(),
    quantitySnapshot: decimal("quantitySnapshot", {
      precision: 16,
      scale: 3,
    }).notNull(),
    unitSnapshot: varchar("unitSnapshot", { length: 16 }).notNull(),
    grossPayableAmount: decimal("grossPayableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    manualDeductionAmount: decimal("manualDeductionAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    netPayableAmount: decimal("netPayableAmount", {
      precision: 16,
      scale: 2,
    }).notNull(),
    invoiceStatus: mysqlEnum("invoiceStatus", [
      "missing",
      "attached",
      "verified",
      "rejected",
    ])
      .default("missing")
      .notNull(),
    invoiceNo: varchar("invoiceNo", { length: 128 }),
    invoiceEvidenceId: bigint("invoiceEvidenceId", { mode: "number" }),
    payeeName: varchar("payeeName", { length: 128 }).notNull(),
    payeeAccount: varchar("payeeAccount", { length: 160 }),
    paymentMethod: mysqlEnum("paymentMethod", [
      "bank_transfer",
      "corporate_account",
      "cash",
      "wechat",
      "alipay",
      "other",
    ])
      .default("bank_transfer")
      .notNull(),
    paymentDate: date("paymentDate"),
    paymentReference: varchar("paymentReference", { length: 128 }),
    remarks: varchar("remarks", { length: 500 }),
    /** approved 为金额已核定待付款，partial 为已登记部分实际付款。 */
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "approved",
      "partial",
      "paid",
      "void",
    ])
      .default("draft")
      .notNull(),
    submittedBy: int("submittedBy"),
    submittedAt: datetime("submittedAt"),
    approvedBy: int("approvedBy"),
    approvedAt: datetime("approvedAt"),
    paidBy: int("paidBy"),
    paidAt: datetime("paidAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    settlementNoUnique: uniqueIndex(
      "subcontract_payment_settlements_no_unique"
    ).on(table.settlementNo),
    packageUnique: uniqueIndex(
      "subcontract_payment_settlements_package_unique"
    ).on(table.packageId),
    projectStatusIndex: index(
      "subcontract_payment_settlements_project_status_index"
    ).on(table.projectId, table.status),
    teamIndex: index("subcontract_payment_settlements_team_index").on(
      table.subcontractTeamId
    ),
    packageForeignKey: foreignKey({
      columns: [table.packageId],
      foreignColumns: [subcontractPackages.id],
      name: "subcontract_payment_settlements_package_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    teamForeignKey: foreignKey({
      columns: [table.subcontractTeamId],
      foreignColumns: [subcontractTeams.id],
      name: "subcontract_payment_settlements_team_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
  })
);

/** 项目外包合同台账：运输、劳务分包、机械租赁等合同只保存受控业务摘要与计价快照，附件影像另行归档。 */
export const outsourceContracts = mysqlTable(
  "outsource_contracts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    contractNo: varchar("contractNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    contractType: mysqlEnum("contractType", [
      "transport",
      "labor_subcontract",
      "machinery_lease",
      "material_supply",
      "other",
    ]).notNull(),
    counterpartyName: varchar("counterpartyName", { length: 200 }).notNull(),
    counterpartyContact: varchar("counterpartyContact", { length: 100 }),
    pricingMethod: mysqlEnum("pricingMethod", [
      "lump_sum",
      "unit_price",
      "trip",
      "ton",
      "m3",
      "day",
      "month",
      "other",
    ]).notNull(),
    unit: varchar("unit", { length: 32 }),
    unitPrice: decimal("unitPrice", { precision: 16, scale: 2 }),
    contractAmount: decimal("contractAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    startDate: date("startDate"),
    endDate: date("endDate"),
    status: mysqlEnum("status", [
      "draft",
      "active",
      "suspended",
      "expired",
      "closed",
      "void",
    ])
      .default("draft")
      .notNull(),
    attachmentEvidenceId: bigint("attachmentEvidenceId", { mode: "number" }),
    contractSummary: varchar("contractSummary", { length: 1000 }),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    contractNoUnique: uniqueIndex("outsource_contracts_no_unique").on(
      table.contractNo
    ),
    projectStatusIndex: index("outsource_contracts_project_status_index").on(
      table.projectId,
      table.status
    ),
    projectTypeIndex: index("outsource_contracts_project_type_index").on(
      table.projectId,
      table.contractType
    ),
  })
);

/**
 * 纳税主体仅用于项目财税辅助、导出和审计归集；不在本系统生成申报表、税款或税务机关回执。
 */
export const taxEntityProfiles = mysqlTable(
  "tax_entity_profiles",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    entityName: varchar("entityName", { length: 200 }).notNull(),
    taxpayerIdentifier: varchar("taxpayerIdentifier", { length: 64 }).notNull(),
    taxMethod: mysqlEnum("taxMethod", [
      "general",
      "small_scale",
      "simplified",
      "other",
    ])
      .default("general")
      .notNull(),
    registeredLocation: varchar("registeredLocation", { length: 300 }),
    status: mysqlEnum("status", ["active", "suspended", "archived"])
      .default("active")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    taxpayerIdentifierUnique: uniqueIndex(
      "tax_entity_profiles_identifier_unique"
    ).on(table.taxpayerIdentifier),
    statusIndex: index("tax_entity_profiles_status_index").on(table.status),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "tax_entity_profiles_creator_fk",
    }).onDelete("restrict"),
  })
);

/**
 * 项目税务辅助档案记录实际项目所在地、计税方法和合同不含税口径。
 * 该档案只能协助持证人员准备资料，任何税率与申报税额都不得由系统自动虚构。
 */
export const projectTaxProfiles = mysqlTable(
  "project_tax_profiles",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    taxEntityId: bigint("taxEntityId", { mode: "number" }).notNull(),
    projectLocation: varchar("projectLocation", { length: 300 }).notNull(),
    taxMethod: mysqlEnum("taxMethod", [
      "general",
      "small_scale",
      "simplified",
      "other",
    ])
      .default("general")
      .notNull(),
    contractExTaxAmount: decimal("contractExTaxAmount", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    contractTaxRate: decimal("contractTaxRate", { precision: 7, scale: 4 })
      .default("0")
      .notNull(),
    crossRegionConstruction: boolean("crossRegionConstruction")
      .default(false)
      .notNull(),
    subcontractDeductionMethod: mysqlEnum("subcontractDeductionMethod", [
      "not_applicable",
      "supporting_document",
      "other",
    ])
      .default("not_applicable")
      .notNull(),
    remarks: varchar("remarks", { length: 500 }),
    status: mysqlEnum("status", ["active", "archived"])
      .default("active")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectUnique: uniqueIndex("project_tax_profiles_project_unique").on(
      table.projectId
    ),
    entityIndex: index("project_tax_profiles_entity_index").on(
      table.taxEntityId,
      table.status
    ),
    entityFk: foreignKey({
      columns: [table.taxEntityId],
      foreignColumns: [taxEntityProfiles.id],
      name: "project_tax_profiles_entity_fk",
    }).onDelete("restrict"),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "project_tax_profiles_creator_fk",
    }).onDelete("restrict"),
  })
);

/**
 * 财税辅助事项是对分包扣除凭证、印花税、薪税待处理、跨地区预缴和税会差异的人工资料清单，
 * 只保存真实来源、人工确认金额和回执引用，不承担自动算税或税务申报。
 */
export const taxAuxiliaryEntries = mysqlTable(
  "tax_auxiliary_entries",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    taxEntityId: bigint("taxEntityId", { mode: "number" }).notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    entryType: mysqlEnum("entryType", [
      "vat_input",
      "vat_output",
      "subcontract_deduction",
      "stamp_duty",
      "payroll_handoff",
      "cross_region_prepayment",
      "book_tax_difference",
      "other",
    ]).notNull(),
    sourceType: varchar("sourceType", { length: 64 }),
    sourceId: varchar("sourceId", { length: 128 }),
    subject: varchar("subject", { length: 300 }).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    taxBaseAmount: decimal("taxBaseAmount", { precision: 16, scale: 2 }),
    referenceTaxRate: decimal("referenceTaxRate", { precision: 7, scale: 4 }),
    reportedTaxAmount: decimal("reportedTaxAmount", {
      precision: 16,
      scale: 2,
    }),
    documentReference: varchar("documentReference", { length: 200 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    status: mysqlEnum("status", [
      "pending",
      "handed_off",
      "receipt_recorded",
      "void",
    ])
      .default("pending")
      .notNull(),
    notes: varchar("notes", { length: 1000 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectPeriodTypeIndex: index(
      "tax_auxiliary_entries_project_period_type_index"
    ).on(table.projectId, table.period, table.entryType, table.status),
    sourceIndex: index("tax_auxiliary_entries_source_index").on(
      table.sourceType,
      table.sourceId
    ),
    entityFk: foreignKey({
      columns: [table.taxEntityId],
      foreignColumns: [taxEntityProfiles.id],
      name: "tax_auxiliary_entries_entity_fk",
    }).onDelete("restrict"),
    evidenceFk: foreignKey({
      columns: [table.evidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "tax_auxiliary_entries_evidence_fk",
    }).onDelete("restrict"),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "tax_auxiliary_entries_creator_fk",
    }).onDelete("restrict"),
  })
);

/**
 * 正式财务软件或电子税务局的资料交接批次。快照哈希固定生成时的真实业务数据，
 * 后续只能登记外部回执引用，不可回写或伪造外部系统处理结果。
 */
export const taxHandoffBatches = mysqlTable(
  "tax_handoff_batches",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    batchNo: varchar("batchNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    taxEntityId: bigint("taxEntityId", { mode: "number" }).notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    handoffType: mysqlEnum("handoffType", [
      "vat_invoice",
      "financial_ledger",
      "payroll",
      "contract_tax",
      "cross_region",
      "combined",
    ]).notNull(),
    format: mysqlEnum("format", ["csv"]).default("csv").notNull(),
    recordCount: int("recordCount").default(0).notNull(),
    snapshotHash: varchar("snapshotHash", { length: 64 }).notNull(),
    snapshotJson: text("snapshotJson").notNull(),
    receiptReference: varchar("receiptReference", { length: 200 }),
    receiptEvidenceId: bigint("receiptEvidenceId", { mode: "number" }),
    status: mysqlEnum("status", [
      "generated",
      "handed_off",
      "receipt_recorded",
      "void",
    ])
      .default("generated")
      .notNull(),
    generatedBy: int("generatedBy").notNull(),
    generatedAt: datetime("generatedAt").notNull(),
    receiptRecordedBy: int("receiptRecordedBy"),
    receiptRecordedAt: datetime("receiptRecordedAt"),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    batchNoUnique: uniqueIndex("tax_handoff_batches_no_unique").on(
      table.batchNo
    ),
    projectPeriodIndex: index("tax_handoff_batches_project_period_index").on(
      table.projectId,
      table.period,
      table.handoffType,
      table.status
    ),
    entityFk: foreignKey({
      columns: [table.taxEntityId],
      foreignColumns: [taxEntityProfiles.id],
      name: "tax_handoff_batches_entity_fk",
    }).onDelete("restrict"),
    receiptEvidenceFk: foreignKey({
      columns: [table.receiptEvidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "tax_handoff_batches_receipt_evidence_fk",
    }).onDelete("restrict"),
    generatorFk: foreignKey({
      columns: [table.generatedBy],
      foreignColumns: [users.id],
      name: "tax_handoff_batches_generator_fk",
    }).onDelete("restrict"),
    receiptRecorderFk: foreignKey({
      columns: [table.receiptRecordedBy],
      foreignColumns: [users.id],
      name: "tax_handoff_batches_receipt_recorder_fk",
    }).onDelete("restrict"),
  })
);

/**
 * 工资薪金累计预扣辅助测算快照。收入来源由已审核/已付款工资事实重新汇总，
 * 专项扣除、累计已扣税额和外部实际扣缴额必须由会计按真实资料录入；本表不构成申报记录。
 */
export const payrollTaxWithholdingEntries = mysqlTable(
  "payroll_tax_withholding_entries",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    workerId: int("workerId").notNull(),
    projectId: int("projectId").notNull(),
    taxEntityId: bigint("taxEntityId", { mode: "number" }).notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    incomeType: mysqlEnum("incomeType", [
      "resident_wage_salary",
      "labor_remuneration",
      "nonresident_wage_salary",
      "manual_review",
    ]).notNull(),
    sourceGrossIncome: decimal("sourceGrossIncome", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    sourceDocumentCount: int("sourceDocumentCount").default(0).notNull(),
    cumulativeGrossIncome: decimal("cumulativeGrossIncome", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    cumulativeExemptIncome: decimal("cumulativeExemptIncome", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    employmentMonths: int("employmentMonths").default(0).notNull(),
    cumulativeBasicDeduction: decimal("cumulativeBasicDeduction", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    cumulativeSocialInsuranceDeduction: decimal(
      "cumulativeSocialInsuranceDeduction",
      { precision: 16, scale: 2 }
    )
      .default("0")
      .notNull(),
    cumulativeSpecialAdditionalDeduction: decimal(
      "cumulativeSpecialAdditionalDeduction",
      { precision: 16, scale: 2 }
    )
      .default("0")
      .notNull(),
    cumulativeOtherDeduction: decimal("cumulativeOtherDeduction", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    cumulativeTaxableIncome: decimal("cumulativeTaxableIncome", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    applicableRate: decimal("applicableRate", { precision: 7, scale: 4 }),
    quickDeduction: decimal("quickDeduction", { precision: 16, scale: 2 }),
    calculatedCumulativeTax: decimal("calculatedCumulativeTax", {
      precision: 16,
      scale: 2,
    }),
    cumulativeTaxWithheldBefore: decimal("cumulativeTaxWithheldBefore", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    calculatedCurrentWithholding: decimal("calculatedCurrentWithholding", {
      precision: 16,
      scale: 2,
    }),
    externallyWithheldThisPeriod: decimal("externallyWithheldThisPeriod", {
      precision: 16,
      scale: 2,
    }),
    externalReference: varchar("externalReference", { length: 200 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    calculationSnapshotJson: text("calculationSnapshotJson").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "reviewed",
      "handed_off",
      "receipt_recorded",
      "void",
    ])
      .default("draft")
      .notNull(),
    reviewNote: varchar("reviewNote", { length: 1000 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    workerEntityPeriodUnique: uniqueIndex(
      "payroll_tax_withholding_worker_entity_period_unique"
    ).on(table.workerId, table.taxEntityId, table.period, table.incomeType),
    projectPeriodIndex: index(
      "payroll_tax_withholding_project_period_index"
    ).on(table.projectId, table.period, table.status),
    workerFk: foreignKey({
      columns: [table.workerId],
      foreignColumns: [laborWorkers.id],
      name: "payroll_tax_withholding_worker_fk",
    }).onDelete("restrict"),
    entityFk: foreignKey({
      columns: [table.taxEntityId],
      foreignColumns: [taxEntityProfiles.id],
      name: "payroll_tax_withholding_entity_fk",
    }).onDelete("restrict"),
    evidenceFk: foreignKey({
      columns: [table.evidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "payroll_tax_withholding_evidence_fk",
    }).onDelete("restrict"),
    reviewerFk: foreignKey({
      columns: [table.reviewedBy],
      foreignColumns: [users.id],
      name: "payroll_tax_withholding_reviewer_fk",
    }).onDelete("restrict"),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "payroll_tax_withholding_creator_fk",
    }).onDelete("restrict"),
  })
);

/**
 * 合同印花税资料登记。合同金额快照来自真实外包合同，但计税依据、税目、税率和实际税额必须经专业人员确认。
 */
export const contractTaxRegistrations = mysqlTable(
  "contract_tax_registrations",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    contractId: bigint("contractId", { mode: "number" }).notNull(),
    projectId: int("projectId").notNull(),
    taxEntityId: bigint("taxEntityId", { mode: "number" }).notNull(),
    contractNoSnapshot: varchar("contractNoSnapshot", { length: 64 }).notNull(),
    contractTypeSnapshot: varchar("contractTypeSnapshot", {
      length: 64,
    }).notNull(),
    counterpartyNameSnapshot: varchar("counterpartyNameSnapshot", {
      length: 200,
    }).notNull(),
    contractDate: date("contractDate"),
    contractAmountSnapshot: decimal("contractAmountSnapshot", {
      precision: 16,
      scale: 2,
    })
      .default("0")
      .notNull(),
    contractEvidenceId: bigint("contractEvidenceId", { mode: "number" }),
    taxItem: varchar("taxItem", { length: 100 }),
    taxBaseAmount: decimal("taxBaseAmount", { precision: 16, scale: 2 }),
    referenceTaxRate: decimal("referenceTaxRate", { precision: 7, scale: 4 }),
    professionallyConfirmedTaxAmount: decimal(
      "professionallyConfirmedTaxAmount",
      { precision: 16, scale: 2 }
    ),
    paymentReference: varchar("paymentReference", { length: 200 }),
    paymentEvidenceId: bigint("paymentEvidenceId", { mode: "number" }),
    status: mysqlEnum("status", [
      "pending_review",
      "confirmed",
      "handed_off",
      "receipt_recorded",
      "not_applicable",
      "void",
    ])
      .default("pending_review")
      .notNull(),
    reviewNote: varchar("reviewNote", { length: 1000 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    contractUnique: uniqueIndex(
      "contract_tax_registrations_contract_unique"
    ).on(table.contractId),
    projectStatusIndex: index(
      "contract_tax_registrations_project_status_index"
    ).on(table.projectId, table.status),
    contractFk: foreignKey({
      columns: [table.contractId],
      foreignColumns: [outsourceContracts.id],
      name: "contract_tax_registrations_contract_fk",
    }).onDelete("restrict"),
    entityFk: foreignKey({
      columns: [table.taxEntityId],
      foreignColumns: [taxEntityProfiles.id],
      name: "contract_tax_registrations_entity_fk",
    }).onDelete("restrict"),
    contractEvidenceFk: foreignKey({
      columns: [table.contractEvidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "contract_tax_registrations_contract_evidence_fk",
    }).onDelete("restrict"),
    paymentEvidenceFk: foreignKey({
      columns: [table.paymentEvidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "contract_tax_registrations_payment_evidence_fk",
    }).onDelete("restrict"),
    reviewerFk: foreignKey({
      columns: [table.reviewedBy],
      foreignColumns: [users.id],
      name: "contract_tax_registrations_reviewer_fk",
    }).onDelete("restrict"),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "contract_tax_registrations_creator_fk",
    }).onDelete("restrict"),
  })
);

/**
 * 跨地区建筑服务预缴资料台账，按项目和期间记录真实登记号、分包扣除凭证和实际完税信息；
 * 金额为空或待复核时不得被解释为零税额或已完成预缴。
 */
export const crossRegionConstructionTaxLedgers = mysqlTable(
  "cross_region_construction_tax_ledgers",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    taxEntityId: bigint("taxEntityId", { mode: "number" }).notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    projectLocationSnapshot: varchar("projectLocationSnapshot", {
      length: 300,
    }).notNull(),
    taxMethodSnapshot: mysqlEnum("taxMethodSnapshot", [
      "general",
      "small_scale",
      "simplified",
      "other",
    ]).notNull(),
    projectRegistrationReference: varchar("projectRegistrationReference", {
      length: 200,
    }),
    revenueIncludingTaxAmount: decimal("revenueIncludingTaxAmount", {
      precision: 16,
      scale: 2,
    }),
    subcontractDeductionAmount: decimal("subcontractDeductionAmount", {
      precision: 16,
      scale: 2,
    }),
    subcontractDeductionReference: varchar("subcontractDeductionReference", {
      length: 200,
    }),
    deductionEvidenceId: bigint("deductionEvidenceId", { mode: "number" }),
    prepaidVatAmount: decimal("prepaidVatAmount", { precision: 16, scale: 2 }),
    taxPaymentReference: varchar("taxPaymentReference", { length: 200 }),
    taxPaymentEvidenceId: bigint("taxPaymentEvidenceId", { mode: "number" }),
    status: mysqlEnum("status", [
      "pending_review",
      "ready_for_handoff",
      "receipt_recorded",
      "not_applicable",
      "void",
    ])
      .default("pending_review")
      .notNull(),
    reviewNote: varchar("reviewNote", { length: 1000 }),
    reviewedBy: int("reviewedBy"),
    reviewedAt: datetime("reviewedAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectPeriodUnique: uniqueIndex(
      "cross_region_construction_tax_project_period_unique"
    ).on(table.projectId, table.period),
    entityPeriodIndex: index(
      "cross_region_construction_tax_entity_period_index"
    ).on(table.taxEntityId, table.period, table.status),
    entityFk: foreignKey({
      columns: [table.taxEntityId],
      foreignColumns: [taxEntityProfiles.id],
      name: "cross_region_construction_tax_entity_fk",
    }).onDelete("restrict"),
    deductionEvidenceFk: foreignKey({
      columns: [table.deductionEvidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "cross_region_construction_tax_deduction_evidence_fk",
    }).onDelete("restrict"),
    paymentEvidenceFk: foreignKey({
      columns: [table.taxPaymentEvidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "cross_region_construction_tax_payment_evidence_fk",
    }).onDelete("restrict"),
    reviewerFk: foreignKey({
      columns: [table.reviewedBy],
      foreignColumns: [users.id],
      name: "cross_region_construction_tax_reviewer_fk",
    }).onDelete("restrict"),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "cross_region_construction_tax_creator_fk",
    }).onDelete("restrict"),
  })
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
    settlementStatus: mysqlEnum("settlementStatus", [
      "unpaid",
      "partial",
      "paid",
      "void",
    ])
      .default("unpaid")
      .notNull(),
    sourceType: varchar("sourceType", { length: 64 }),
    sourceId: varchar("sourceId", { length: 128 }),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    dailyClosingId: bigint("dailyClosingId", { mode: "number" }),
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    recordUnique: uniqueIndex("financial_records_no_unique").on(table.recordNo),
    projectSettlementOccurredIndex: index(
      "financial_records_project_settlement_occurred_index"
    ).on(table.projectId, table.settlementStatus, table.occurredAt),
  })
);

/**
 * 发票原件主档是全公司范围唯一的电子凭证事实。
 * 项目台账只能通过下方的 financialInvoices 分摊该原件，不能复制一张原票进行跨项目报销或抵扣。
 */
export const financialInvoiceOriginals = mysqlTable(
  "financial_invoice_originals",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    /** 发票代码、号码、销方、方向、日期、价税金额组成的服务端规范化指纹。 */
    originalFingerprint: varchar("originalFingerprint", {
      length: 128,
    }).notNull(),
    invoiceNo: varchar("invoiceNo", { length: 64 }).notNull(),
    invoiceCode: varchar("invoiceCode", { length: 64 }),
    counterpartyName: varchar("counterpartyName", { length: 200 }).notNull(),
    invoiceType: mysqlEnum("invoiceType", [
      "vat_special",
      "vat_normal",
      "electronic",
      "receipt",
      "other",
    ]).notNull(),
    direction: mysqlEnum("direction", ["income", "expense"]).notNull(),
    totalAmount: decimal("totalAmount", { precision: 16, scale: 2 }).notNull(),
    totalTaxAmount: decimal("totalTaxAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    taxRate: decimal("taxRate", { precision: 7, scale: 4 })
      .default("0")
      .notNull(),
    issuedAt: date("issuedAt").notNull(),
    /** 原始 PDF、OFD 或影像归档；旧数据允许为空，但新建电子凭证必须关联受控证据。 */
    evidenceId: bigint("evidenceId", { mode: "number" }),
    structuredPayloadJson: text("structuredPayloadJson"),
    verificationStatus: mysqlEnum("verificationStatus", [
      "pending",
      "manual_verified",
      "external_verified",
      "failed",
      "not_required",
    ])
      .default("pending")
      .notNull(),
    verificationReference: varchar("verificationReference", { length: 200 }),
    verificationCheckedAt: datetime("verificationCheckedAt"),
    /** 红冲只关联同一原件链，不允许用自由文本伪造红冲关系。 */
    redFlushOriginalId: bigint("redFlushOriginalId", { mode: "number" }),
    redFlushReason: varchar("redFlushReason", { length: 500 }),
    status: mysqlEnum("status", ["issued", "verified", "void", "red_flushed"])
      .default("issued")
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    fingerprintUnique: uniqueIndex(
      "financial_invoice_originals_fingerprint_unique"
    ).on(table.originalFingerprint),
    statusDateIndex: index("financial_invoice_originals_status_date_index").on(
      table.status,
      table.issuedAt
    ),
    evidenceIndex: index("financial_invoice_originals_evidence_index").on(
      table.evidenceId
    ),
    redFlushIndex: index("financial_invoice_originals_red_flush_index").on(
      table.redFlushOriginalId
    ),
    evidenceFk: foreignKey({
      columns: [table.evidenceId],
      foreignColumns: [evidenceRecords.id],
      name: "financial_invoice_originals_evidence_fk",
    }).onDelete("restrict"),
    creatorFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "financial_invoice_originals_creator_fk",
    }).onDelete("restrict"),
    redFlushFk: foreignKey({
      columns: [table.redFlushOriginalId],
      foreignColumns: [table.id],
      name: "financial_invoice_originals_red_flush_fk",
    }).onDelete("restrict"),
  })
);

/** 成本、收入和付款凭证的项目分摊台账；金额、税额和状态均由服务端校验并保留原始审计链。 */
export const financialInvoices = mysqlTable(
  "financial_invoices",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    /** 指向全局原件主档；历史记录由迁移回填，待复核记录不得继续用于抵扣或报销。 */
    originalId: bigint("originalId", { mode: "number" }),
    financialRecordId: bigint("financialRecordId", { mode: "number" }),
    invoiceNo: varchar("invoiceNo", { length: 64 }).notNull(),
    invoiceCode: varchar("invoiceCode", { length: 64 }),
    counterpartyName: varchar("counterpartyName", { length: 200 }).notNull(),
    invoiceType: mysqlEnum("invoiceType", [
      "vat_special",
      "vat_normal",
      "electronic",
      "receipt",
      "other",
    ]).notNull(),
    direction: mysqlEnum("direction", ["income", "expense"]).notNull(),
    amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
    taxAmount: decimal("taxAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    taxRate: decimal("taxRate", { precision: 7, scale: 4 })
      .default("0")
      .notNull(),
    issuedAt: date("issuedAt").notNull(),
    verifiedAt: datetime("verifiedAt"),
    status: mysqlEnum("status", ["issued", "verified", "void", "red_flushed"])
      .default("issued")
      .notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    /** 本项目实际分摊金额；同一原件全部有效分摊累计不得超过原件价税合计。 */
    allocatedAmount: decimal("allocatedAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    allocationPurpose: mysqlEnum("allocationPurpose", [
      "expense_deduction",
      "reimbursement",
      "income_collection",
      "reference_only",
    ])
      .default("expense_deduction")
      .notNull(),
    allocationStatus: mysqlEnum("allocationStatus", [
      "active",
      "void",
      "red_flushed",
      "legacy_review",
    ])
      .default("active")
      .notNull(),
    voidReason: varchar("voidReason", { length: 500 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    projectInvoiceNoUnique: uniqueIndex(
      "financial_invoices_project_no_unique"
    ).on(table.projectId, table.invoiceNo),
    projectStatusDateIndex: index(
      "financial_invoices_project_status_date_index"
    ).on(table.projectId, table.status, table.issuedAt),
    financialRecordIndex: index("financial_invoices_financial_record_index").on(
      table.financialRecordId
    ),
    originalIndex: index("financial_invoices_original_index").on(
      table.originalId,
      table.allocationStatus
    ),
    originalFk: foreignKey({
      columns: [table.originalId],
      foreignColumns: [financialInvoiceOriginals.id],
      name: "financial_invoices_original_fk",
    }).onDelete("restrict"),
  })
);

/** 后勤每日开支日结封存快照；已关闭或归档日期不得再写入底层财务流水。 */
export const dailyAccountingClosures = mysqlTable(
  "daily_accounting_closures",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    closingNo: varchar("closingNo", { length: 64 }).notNull(),
    projectId: int("projectId").notNull(),
    closingDate: date("closingDate").notNull(),
    totalIncome: decimal("totalIncome", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    totalExpense: decimal("totalExpense", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    recordCount: int("recordCount").default(0).notNull(),
    invoiceCount: int("invoiceCount").default(0).notNull(),
    invoiceAmount: decimal("invoiceAmount", { precision: 16, scale: 2 })
      .default("0")
      .notNull(),
    snapshotHash: varchar("snapshotHash", { length: 64 }).notNull(),
    snapshotJson: text("snapshotJson").notNull(),
    /** 反结账期间明确标识为 reopened，禁止把允许调整误记为作废。 */
    status: mysqlEnum("status", ["closed", "archived", "void", "reopened"])
      .default("closed")
      .notNull(),
    revision: int("revision").default(1).notNull(),
    closedBy: int("closedBy").notNull(),
    closedAt: datetime("closedAt").notNull(),
    reopenedBy: int("reopenedBy"),
    reopenedAt: datetime("reopenedAt"),
    reopenReason: varchar("reopenReason", { length: 500 }),
    archivedBy: int("archivedBy"),
    archivedAt: datetime("archivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    closingNoUnique: uniqueIndex("daily_accounting_closures_no_unique").on(
      table.closingNo
    ),
    projectDateUnique: uniqueIndex(
      "daily_accounting_closures_project_date_unique"
    ).on(table.projectId, table.closingDate),
  })
);

/**
 * 日结每次封存、授权反结账均留存独立版本快照；主表只保存当前版本，事件表保存不可覆盖的历史审计链。
 */
export const dailyAccountingClosureEvents = mysqlTable(
  "daily_accounting_closure_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    closureId: bigint("closureId", { mode: "number" }).notNull(),
    projectId: int("projectId").notNull(),
    revision: int("revision").notNull(),
    eventType: mysqlEnum("eventType", ["closed", "reopened"]).notNull(),
    snapshotHash: varchar("snapshotHash", { length: 64 }),
    snapshotJson: text("snapshotJson"),
    reason: varchar("reason", { length: 500 }),
    performedBy: int("performedBy").notNull(),
    performedAt: datetime("performedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    closureRevisionEventUnique: uniqueIndex(
      "daily_closure_events_revision_unique"
    ).on(table.closureId, table.revision, table.eventType),
    projectPerformedIndex: index(
      "daily_closure_events_project_performed_index"
    ).on(table.projectId, table.performedAt),
    closureFk: foreignKey({
      columns: [table.closureId],
      foreignColumns: [dailyAccountingClosures.id],
      name: "daily_closure_events_closure_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
  })
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
    /** 上传时以服务端读取的真实字节计算，供归档完整性校验；不信任客户端的文件名或 MIME 声明。 */
    contentSha256: varchar("contentSha256", { length: 64 }),
    contentBytes: int("contentBytes"),
    ocrResultJson: text("ocrResultJson"),
    watermarkJson: text("watermarkJson"),
    longitude: decimal("longitude", { precision: 11, scale: 7 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    capturedAt: datetime("capturedAt"),
    /** 保留期限由经授权的资料政策设置；为空代表尚未确定，不得被系统解释为可删除。 */
    retentionUntil: date("retentionUntil"),
    status: mysqlEnum("status", ["active", "deleted"])
      .default("active")
      .notNull(),
    deletedAt: datetime("deletedAt"),
    deletedBy: int("deletedBy"),
    deletionReason: varchar("deletionReason", { length: 500 }),
    uploadedBy: int("uploadedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    sourceIndex: index("evidence_records_source_index").on(
      table.sourceType,
      table.sourceId
    ),
    projectStatusCreatedIndex: index(
      "evidence_records_project_status_created_index"
    ).on(table.projectId, table.status, table.createdAt),
    contentHashIndex: index("evidence_records_content_hash_index").on(
      table.contentSha256
    ),
    deletedByFk: foreignKey({
      columns: [table.deletedBy],
      foreignColumns: [users.id],
      name: "evidence_records_deleted_by_fk",
    }).onDelete("restrict"),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** 人员主档独立于账号与工资旧主体；敏感原文只存服务端密文。 */
export const personnelPeople = mysqlTable(
  "personnel_people",
  {
    id: int("id").autoincrement().primaryKey(),
    personNo: varchar("personNo", { length: 48 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    affiliation: mysqlEnum("affiliation", [
      "company",
      "temporary",
      "labor_team",
      "external",
    ]).notNull(),
    employmentStatus: mysqlEnum("employmentStatus", [
      "active",
      "suspended",
      "left",
    ])
      .default("active")
      .notNull(),
    primaryPositionId: int("primaryPositionId"),
    secondaryPositionIds: json("secondaryPositionIds")
      .$type<number[]>()
      .notNull(),
    projectId: int("projectId"),
    teamId: int("teamId"),
    entryDate: date("entryDate", { mode: "string" }),
    exitDate: date("exitDate", { mode: "string" }),
    gender: mysqlEnum("gender", ["male", "female", "unspecified"]),
    birthDate: date("birthDate", { mode: "string" }),
    address: varchar("address", { length: 500 }),
    emergencyContactName: varchar("emergencyContactName", { length: 128 }),
    emergencyContactPhoneEncrypted: text("emergencyContactPhoneEncrypted"),
    emergencyContactPhoneMasked: varchar("emergencyContactPhoneMasked", {
      length: 64,
    }),
    remarks: varchar("remarks", { length: 1000 }),
    avatarEvidenceId: bigint("avatarEvidenceId", { mode: "number" }),
    payrollEnabled: boolean("payrollEnabled").default(false).notNull(),
    phoneEncrypted: text("phoneEncrypted"),
    phoneFingerprint: varchar("phoneFingerprint", { length: 64 }),
    phoneMasked: varchar("phoneMasked", { length: 64 }),
    identityNoEncrypted: text("identityNoEncrypted"),
    identityNoFingerprint: varchar("identityNoFingerprint", { length: 64 }),
    identityMasked: varchar("identityMasked", { length: 64 }),
    bankAccountEncrypted: text("bankAccountEncrypted"),
    bankAccountFingerprint: varchar("bankAccountFingerprint", { length: 64 }),
    bankMasked: varchar("bankMasked", { length: 64 }),
    bankName: varchar("bankName", { length: 128 }),
    userId: int("userId"),
    legacyProfileId: int("legacyProfileId"),
    legacyWorkerId: int("legacyWorkerId"),
    version: int("version").default(1).notNull(),
    createdBy: int("createdBy").notNull(),
    updatedBy: int("updatedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  t => ({
    personNoUnique: uniqueIndex("personnel_people_no_unique").on(t.personNo),
    userUnique: uniqueIndex("personnel_people_user_unique").on(t.userId),
    phoneUnique: uniqueIndex("personnel_people_phone_unique").on(
      t.phoneFingerprint
    ),
    identityUnique: uniqueIndex("personnel_people_identity_unique").on(
      t.identityNoFingerprint
    ),
    projectIndex: index("personnel_people_project_index").on(
      t.projectId,
      t.employmentStatus
    ),
  })
);
export const personnelPositions = mysqlTable(
  "personnel_positions",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    category: mysqlEnum("category", [
      "management",
      "technical",
      "business",
      "driver",
      "operator",
      "construction",
      "other",
    ]).notNull(),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  t => ({
    nameUnique: uniqueIndex("personnel_positions_name_unique").on(t.name),
  })
);
export const personnelTeams = mysqlTable(
  "personnel_teams",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    projectId: int("projectId").notNull(),
    leaderName: varchar("leaderName", { length: 128 }),
    remarks: varchar("remarks", { length: 1000 }),
    status: mysqlEnum("status", ["active", "disabled"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  t => ({
    projectNameUnique: uniqueIndex("personnel_teams_project_name_unique").on(
      t.projectId,
      t.name
    ),
  })
);
export const personnelSourceLinks = mysqlTable(
  "personnel_source_links",
  {
    id: int("id").autoincrement().primaryKey(),
    personId: int("personId").notNull(),
    sourceType: mysqlEnum("sourceType", [
      "user",
      "profile",
      "worker",
    ]).notNull(),
    sourceId: int("sourceId").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    sourceUnique: uniqueIndex("personnel_source_unique").on(
      t.sourceType,
      t.sourceId
    ),
    personIndex: index("personnel_source_person_index").on(t.personId),
  })
);
export const personnelAssignments = mysqlTable(
  "personnel_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    personId: int("personId").notNull(),
    affiliation: mysqlEnum("affiliation", [
      "company",
      "temporary",
      "labor_team",
      "external",
    ]).notNull(),
    primaryPositionId: int("primaryPositionId"),
    secondaryPositionIds: json("secondaryPositionIds")
      .$type<number[]>()
      .notNull(),
    projectId: int("projectId"),
    teamId: int("teamId"),
    employmentStatus: mysqlEnum("employmentStatus", [
      "active",
      "suspended",
      "left",
    ]).notNull(),
    effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
    version: int("version").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    personVersionUnique: uniqueIndex(
      "personnel_assignments_person_version_unique"
    ).on(t.personId, t.version),
  })
);
export const personnelSalaryHistory = mysqlTable(
  "personnel_salary_history",
  {
    id: int("id").autoincrement().primaryKey(),
    personId: int("personId").notNull(),
    salaryBasis: mysqlEnum("salaryBasis", [
      "monthly",
      "daily",
      "hourly",
      "piecework",
    ]).notNull(),
    baseSalary: decimal("baseSalary", { precision: 16, scale: 2 }),
    payrollEnabled: boolean("payrollEnabled").notNull(),
    affiliation: mysqlEnum("affiliation", [
      "company",
      "temporary",
      "labor_team",
      "external",
    ]).notNull(),
    effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    personEffectiveUnique: uniqueIndex(
      "personnel_salary_person_effective_unique"
    ).on(t.personId, t.effectiveFrom),
  })
);
export const personnelResourceBindings = mysqlTable(
  "personnel_resource_bindings",
  {
    id: int("id").autoincrement().primaryKey(),
    personId: int("personId").notNull(),
    assetType: mysqlEnum("assetType", ["vehicle", "machine"]).notNull(),
    assetId: int("assetId").notNull(),
    projectId: int("projectId"),
    effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
    effectiveTo: date("effectiveTo", { mode: "string" }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    assetDateIndex: index("personnel_resource_asset_date_index").on(
      t.assetType,
      t.assetId,
      t.effectiveFrom
    ),
    personIndex: index("personnel_resource_person_index").on(t.personId),
  })
);
export const personnelDocuments = mysqlTable(
  "personnel_documents",
  {
    id: int("id").autoincrement().primaryKey(),
    personId: int("personId").notNull(),
    projectId: int("projectId"),
    documentType: mysqlEnum("documentType", [
      "portrait",
      "identity",
      "driver_license",
      "operator_certificate",
      "contract",
      "insurance",
      "other",
    ]).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    expiresAt: date("expiresAt", { mode: "string" }),
    evidenceId: bigint("evidenceId", { mode: "number" }).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    personIndex: index("personnel_documents_person_index").on(t.personId),
    evidenceUnique: uniqueIndex("personnel_documents_evidence_unique").on(
      t.evidenceId
    ),
  })
);
export const personnelChanges = mysqlTable(
  "personnel_changes",
  {
    id: int("id").autoincrement().primaryKey(),
    personId: int("personId").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    version: int("version").notNull(),
    changes: json("changes")
      .$type<Record<string, { before: unknown; after: unknown }>>()
      .notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    personIndex: index("personnel_changes_person_index").on(
      t.personId,
      t.createdAt
    ),
  })
);

/** 车辆全周期兼容扩展：旧产权、结算快照和七种 vehicleType 保持原样。 */
export const vehicleFleetProfiles = mysqlTable("vehicle_fleet_profiles", {
  vehicleId: int("vehicleId").primaryKey(),
  projectId: int("projectId").notNull(),
  version: int("version").default(1).notNull(),
  propertyType: mysqlEnum("propertyType", ["company_owned", "rented", "partner"]).notNull(),
  settlementMode: mysqlEnum("settlementMode", ["monthly", "daily", "hourly", "shift", "trip", "ton", "volume", "none"]).notNull(),
  purpose: mysqlEnum("purpose", ["general", "trailer"]).default("general").notNull(),
  vin: varchar("vin", { length: 32 }), brandModel: varchar("brandModel", { length: 160 }),
  registeredOn: date("registeredOn", { mode: "string" }), energyType: varchar("energyType", { length: 64 }),
  emissionStandard: varchar("emissionStandard", { length: 64 }),
  effectiveCapacityM3: decimal("effectiveCapacityM3", { precision: 10, scale: 3 }), trailerVehicleId: int("trailerVehicleId"),
  technicalStatus: mysqlEnum("technicalStatus", ["normal", "repair", "safety_hold"]).default("normal").notNull(),
  dispatchStatus: mysqlEnum("dispatchStatus", ["standby", "working", "paused"]).default("standby").notNull(),
  projectStatus: mysqlEnum("projectStatus", ["pending", "on_site", "exited"]).default("on_site").notNull(),
  archived: boolean("archived").default(false).notNull(), remarks: varchar("remarks", { length: 1000 }),
  createdBy: int("createdBy").notNull(), updatedBy: int("updatedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, t => ({ projectIndex: index("vehicle_fleet_project_index").on(t.projectId, t.archived), trailerIndex: index("vehicle_fleet_trailer_index").on(t.trailerVehicleId) }));
/** 车辆项目/实际驾驶责任 UTC 精确区间；人员身份历史仍复用 personnel_resource_bindings。 */
export const vehicleAssignments = mysqlTable("vehicle_assignments", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), fromProjectId: int("fromProjectId"),
  action: mysqlEnum("action", ["enter", "transfer", "exit", "handover", "baseline"]).notNull(),
  driverPersonId: int("driverPersonId"), driverUserId: int("driverUserId"), driverBindingId: bigint("driverBindingId", { mode: "number" }),
  effectiveFrom: datetime("effectiveFrom").notNull(), effectiveTo: datetime("effectiveTo"),
  meterReading: decimal("meterReading", { precision: 14, scale: 2 }), condition: varchar("condition", { length: 1000 }).notNull(), reason: varchar("reason", { length: 1000 }).notNull(),
  createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ vehicleRange: index("vehicle_assignment_range").on(t.vehicleId, t.effectiveFrom), driverRange: index("vehicle_assignment_driver_range").on(t.driverBindingId, t.effectiveFrom), projectIndex: index("vehicle_assignment_project").on(t.projectId) }));
/** 车主/司机只读账务显式授权；不会写用户角色、岗位或运输管理权限。 */
export const vehicleAccessGrants = mysqlTable("vehicle_access_grants", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), userId: int("userId"), driverBindingId: bigint("driverBindingId", { mode: "number" }),
  role: mysqlEnum("role", ["owner", "driver"]).notNull(), scope: mysqlEnum("scope", ["service_period", "all_history"]).notNull(),
  effectiveFrom: datetime("effectiveFrom").notNull(), effectiveTo: datetime("effectiveTo"), revokedAt: datetime("revokedAt"), revokedBy: int("revokedBy"),
  validFrom: datetime("validFrom").notNull(), validTo: datetime("validTo"),
  reason: varchar("reason", { length: 1000 }).notNull(), createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ subjectIndex: index("vehicle_grant_subject").on(t.userId, t.driverBindingId), vehicleIndex: index("vehicle_grant_vehicle").on(t.vehicleId, t.projectId) }));
/** 证照续办只新增；附件存受控key，不存可公开访问链接。 */
export const vehicleDocuments = mysqlTable("vehicle_documents", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(),
  kind: mysqlEnum("kind", ["vehicle_registration", "transport_permit", "insurance", "inspection", "annual_review", "other"]).notNull(), title: varchar("title", { length: 160 }).notNull(),
  applicable: boolean("applicable").notNull(), validFrom: date("validFrom", { mode: "string" }), validTo: date("validTo", { mode: "string" }),
  verificationStatus: mysqlEnum("verificationStatus", ["pending", "verified", "rejected", "not_applicable"]).default("pending").notNull(), verifiedBy: int("verifiedBy"), verifiedAt: datetime("verifiedAt"), verificationNote: varchar("verificationNote", { length: 1000 }),
  fileKey: varchar("fileKey", { length: 512 }).notNull(), originalName: varchar("originalName", { length: 200 }).notNull(), mimeType: varchar("mimeType", { length: 64 }).notNull(), contentBytes: int("contentBytes").notNull(), contentSha256: varchar("contentSha256", { length: 64 }).notNull(),
  createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ vehicleIndex: index("vehicle_document_vehicle").on(t.vehicleId, t.projectId, t.kind) }));
export const vehicleInspections = mysqlTable("vehicle_inspections", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), occurredAt: datetime("occurredAt").notNull(), driverPersonId: int("driverPersonId"),
  meterReading: decimal("meterReading", { precision: 14, scale: 2 }), items: json("items").$type<{ key: string; result: "pass" | "fail" | "unknown"; note?: string }[]>().notNull(), safetyFault: boolean("safetyFault").notNull(), notes: varchar("notes", { length: 1000 }).notNull(),
  createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ vehicleIndex: index("vehicle_inspection_vehicle").on(t.vehicleId, t.projectId, t.occurredAt) }));
/** 工单只关联原费用，不再记账；修复、验收、放行严格分离。 */
export const vehicleWorkOrders = mysqlTable("vehicle_work_orders", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), inspectionId: int("inspectionId").notNull(),
  status: mysqlEnum("status", ["reported", "repairing", "awaiting_acceptance", "accepted", "released"]).default("reported").notNull(),
  safetyFault: boolean("safetyFault").notNull(), fault: varchar("fault", { length: 1000 }).notNull(), serviceProvider: varchar("serviceProvider", { length: 160 }), laborHours: decimal("laborHours", { precision: 10, scale: 2 }), partsDescription: varchar("partsDescription", { length: 1000 }),
  costBearer: mysqlEnum("costBearer", ["company", "owner", "shared"]), maintenanceRecordId: bigint("maintenanceRecordId", { mode: "number" }), purchaseOrderIds: json("purchaseOrderIds").$type<number[]>().notNull(),
  stoppedAt: datetime("stoppedAt").notNull(), repairedAt: datetime("repairedAt"), acceptedAt: datetime("acceptedAt"), acceptedBy: int("acceptedBy"), releasedAt: datetime("releasedAt"), releasedBy: int("releasedBy"),
  createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ vehicleIndex: index("vehicle_work_order_vehicle").on(t.vehicleId, t.projectId, t.status), maintenanceUnique: uniqueIndex("vehicle_work_order_maintenance_unique").on(t.maintenanceRecordId) }));
export const vehicleMaintenancePlans = mysqlTable("vehicle_maintenance_plans", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), title: varchar("title", { length: 160 }).notNull(), dueOn: date("dueOn", { mode: "string" }), dueMileage: decimal("dueMileage", { precision: 14, scale: 2 }), lastMileage: decimal("lastMileage", { precision: 14, scale: 2 }), source: varchar("source", { length: 1000 }).notNull(), completedAt: datetime("completedAt"),
  createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ vehicleIndex: index("vehicle_maintenance_plan_vehicle").on(t.vehicleId, t.projectId) }));
export const vehicleSpecialRecords = mysqlTable("vehicle_special_records", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), kind: mysqlEnum("kind", ["earthwork", "monitoring"]).notNull(), recordedAt: datetime("recordedAt").notNull(),
  data: json("data").$type<Record<string, string | boolean | null>>().notNull(), reason: varchar("reason", { length: 1000 }).notNull(), source: varchar("source", { length: 32 }).default("manual").notNull(),
  createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ vehicleIndex: index("vehicle_special_vehicle").on(t.vehicleId, t.projectId, t.kind) }));
export const vehicleChanges = mysqlTable("vehicle_changes", {
  id: int("id").autoincrement().primaryKey(), vehicleId: int("vehicleId").notNull(), projectId: int("projectId").notNull(), version: int("version").notNull(), action: varchar("action", { length: 64 }).notNull(),
  changes: json("changes").$type<Record<string, unknown>>().notNull(), createdBy: int("createdBy").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => ({ versionUnique: uniqueIndex("vehicle_change_version_unique").on(t.vehicleId, t.version) }));
