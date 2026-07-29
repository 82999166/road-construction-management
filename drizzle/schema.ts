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
    wecomUserId: varchar("wecomUserId", { length: 128 }),
    organizationId: int("organizationId"),
    positionId: int("positionId"),
    status: mysqlEnum("status", ["pending", "active", "disabled"]).default("pending").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUnique: uniqueIndex("user_profiles_user_unique").on(table.userId),
    wecomIndex: index("user_profiles_wecom_index").on(table.wecomUserId),
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

/** 企业微信消息发送记录，支持幂等、失败重试和阅读回执。 */
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
    status: mysqlEnum("status", ["pending", "sent", "failed", "read"]).default("pending").notNull(),
    retryCount: int("retryCount").default(0).notNull(),
    sentAt: datetime("sentAt"),
    readAt: datetime("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ idempotencyUnique: uniqueIndex("notification_idempotency_unique").on(table.idempotencyKey) }),
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

/** 公司自有与外租机械统一台账。 */
export const machines = mysqlTable(
  "machines",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId"),
    /** 机械操作员/司机的登录用户标识；允许为空以兼容外租机械暂未绑定人员的场景。 */
    operatorUserId: int("operatorUserId"),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    model: varchar("model", { length: 128 }),
    ownership: mysqlEnum("ownership", ["owned", "leased"]).notNull(),
    supplierName: varchar("supplierName", { length: 200 }),
    plateOrAssetNo: varchar("plateOrAssetNo", { length: 64 }),
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
    occurredAt: datetime("occurredAt").notNull(),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    status: mysqlEnum("status", ["draft", "approved", "settled", "void"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ machineDateIndex: index("machine_cost_records_machine_date_index").on(table.machineId, table.occurredAt) }),
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
    vehicleType: mysqlEnum("vehicleType", ["dump_truck", "tractor", "mixer", "flatbed", "other"]).default("dump_truck").notNull(),
    ownerName: varchar("ownerName", { length: 128 }),
    driverUserId: int("driverUserId"),
    boxLengthMeters: decimal("boxLengthMeters", { precision: 8, scale: 3 }).notNull(),
    boxWidthMeters: decimal("boxWidthMeters", { precision: 8, scale: 3 }).notNull(),
    boxHeightMeters: decimal("boxHeightMeters", { precision: 8, scale: 3 }).notNull(),
    loadFactor: decimal("loadFactor", { precision: 5, scale: 3 }).default("1").notNull(),
    payloadTons: decimal("payloadTons", { precision: 10, scale: 3 }),
    status: mysqlEnum("status", ["active", "suspended", "disabled"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ plateUnique: uniqueIndex("transport_vehicles_plate_unique").on(table.plateNo) }),
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

/** 运输趟次及其由规则快照计算出的金额。 */
export const transportTrips = mysqlTable(
  "transport_trips",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    tripNo: varchar("tripNo", { length: 64 }).notNull(),
    vehicleId: int("vehicleId").notNull(),
    projectId: int("projectId").notNull(),
    freightRuleId: int("freightRuleId").notNull(),
    startAt: datetime("startAt").notNull(),
    endAt: datetime("endAt"),
    actualDistanceKm: decimal("actualDistanceKm", { precision: 10, scale: 3 }),
    volumeCubicMeters: decimal("volumeCubicMeters", { precision: 12, scale: 3 }),
    weightTons: decimal("weightTons", { precision: 12, scale: 3 }),
    calculatedUnitPrice: decimal("calculatedUnitPrice", { precision: 16, scale: 2 }),
    calculatedAmount: decimal("calculatedAmount", { precision: 16, scale: 2 }),
    routeSnapshot: json("routeSnapshot"),
    evidenceId: bigint("evidenceId", { mode: "number" }),
    status: mysqlEnum("status", ["draft", "submitted", "verified", "settled", "void"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tripUnique: uniqueIndex("transport_trips_no_unique").on(table.tripNo),
    vehicleDateIndex: index("transport_trips_vehicle_date_index").on(table.vehicleId, table.startAt),
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
    requestId: bigint("requestId", { mode: "number" }).notNull(),
    projectId: int("projectId").notNull(),
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
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ recordUnique: uniqueIndex("financial_records_no_unique").on(table.recordNo) }),
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
