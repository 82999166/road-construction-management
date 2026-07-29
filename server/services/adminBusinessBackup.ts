import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import {
  attendanceRecords,
  constructionDailyReports,
  dataBackups,
  departmentBusinessScopes,
  evidenceRecords,
  financialRecords,
  freightRateRules,
  inventoryTransactions,
  laborWorkers,
  machineCostRecords,
  machineLeaseRules,
  machines,
  measurementClaims,
  organizations,
  payrollStatements,
  positions,
  projects,
  purchaseCategories,
  purchaseOrders,
  purchaseRequests,
  rolePermissions,
  suppliers,
  systemPermissions,
  systemRoles,
  transportTrips,
  transportVehicles,
  userProfiles,
  userRoleAssignments,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";

const BACKUP_SCOPE_VERSION = "business-v1";
const MAX_BACKUP_ROWS = 100_000;
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** 备份中保留业务关联所需的账号标识，但绝不导出口令摘要、重置材料或第三方令牌。 */
async function collectBusinessSnapshot(db: Database) {
  const rowCountSources = [
    organizations, positions, projects, userProfiles, systemRoles, systemPermissions, rolePermissions, userRoleAssignments,
    departmentBusinessScopes, purchaseCategories, laborWorkers, attendanceRecords, payrollStatements, machines,
    machineLeaseRules, machineCostRecords, transportVehicles, freightRateRules, transportTrips, suppliers,
    purchaseRequests, purchaseOrders, inventoryTransactions, measurementClaims, financialRecords, evidenceRecords,
  ];
  const countRows = await Promise.all(rowCountSources.map(table => db.select({ total: count() }).from(table)));
  const recordCount = countRows.reduce((sum, rows) => sum + Number(rows[0]?.total ?? 0), 0);
  if (recordCount > MAX_BACKUP_ROWS) {
    throw new Error(`当前业务数据共 ${recordCount} 条，超过单次在线逻辑备份上限 ${MAX_BACKUP_ROWS} 条；请联系系统管理员安排离线维护窗口`);
  }

  const [
    organizationRows, positionRows, projectRows, profileRows, roleRows, permissionRows, rolePermissionRows, assignmentRows,
    departmentScopeRows, categoryRows, workerRows, attendanceRows, payrollRows, machineRows, leaseRuleRows, machineCostRows,
    vehicleRows, freightRuleRows, tripRows, supplierRows, requestRows, orderRows, inventoryRows, measurementRows, financeRows,
    evidenceRows, constructionRows, safeUserRows,
  ] = await Promise.all([
    db.select().from(organizations),
    db.select().from(positions),
    db.select().from(projects),
    db.select({ id: userProfiles.id, userId: userProfiles.userId, employeeNo: userProfiles.employeeNo, organizationId: userProfiles.organizationId, positionId: userProfiles.positionId, status: userProfiles.status, createdAt: userProfiles.createdAt, updatedAt: userProfiles.updatedAt }).from(userProfiles),
    db.select().from(systemRoles),
    db.select().from(systemPermissions),
    db.select().from(rolePermissions),
    db.select().from(userRoleAssignments),
    db.select().from(departmentBusinessScopes),
    db.select().from(purchaseCategories),
    db.select().from(laborWorkers),
    db.select().from(attendanceRecords),
    db.select().from(payrollStatements),
    db.select().from(machines),
    db.select().from(machineLeaseRules),
    db.select().from(machineCostRecords),
    db.select().from(transportVehicles),
    db.select().from(freightRateRules),
    db.select().from(transportTrips),
    db.select().from(suppliers),
    db.select().from(purchaseRequests),
    db.select().from(purchaseOrders),
    db.select().from(inventoryTransactions),
    db.select().from(measurementClaims),
    db.select().from(financialRecords),
    db.select().from(evidenceRecords),
    db.select().from(constructionDailyReports),
    db.select({ id: users.id, openId: users.openId, name: users.name, email: users.email, loginMethod: users.loginMethod, localUsername: users.localUsername, localAccountStatus: users.localAccountStatus, localPasswordChangeRequired: users.localPasswordChangeRequired, role: users.role, createdAt: users.createdAt, updatedAt: users.updatedAt, lastSignedIn: users.lastSignedIn }).from(users),
  ]);

  return {
    format: "road-construction-management-logical-backup",
    scopeVersion: BACKUP_SCOPE_VERSION,
    createdAt: new Date().toISOString(),
    recordCount,
    scope: {
      includes: "组织、项目、权限范围、劳务工资、机械运输、采购仓储、计量、财务及影像元数据",
      excludes: "账号口令摘要、第三方接口密钥、系统敏感配置、审计日志和影像文件本体",
      note: "影像文件本体已由对象存储独立保存；本逻辑备份仅保留其业务元数据与文件引用。",
    },
    tables: {
      users: safeUserRows,
      organizations: organizationRows,
      positions: positionRows,
      projects: projectRows,
      userProfiles: profileRows,
      systemRoles: roleRows,
      systemPermissions: permissionRows,
      rolePermissions: rolePermissionRows,
      userRoleAssignments: assignmentRows,
      departmentBusinessScopes: departmentScopeRows,
      purchaseCategories: categoryRows,
      laborWorkers: workerRows,
      attendanceRecords: attendanceRows,
      payrollStatements: payrollRows,
      machines: machineRows,
      machineLeaseRules: leaseRuleRows,
      machineCostRecords: machineCostRows,
      transportVehicles: vehicleRows,
      freightRateRules: freightRuleRows,
      transportTrips: tripRows,
      suppliers: supplierRows,
      purchaseRequests: requestRows,
      purchaseOrders: orderRows,
      inventoryTransactions: inventoryRows,
      measurementClaims: measurementRows,
      financialRecords: financeRows,
      evidenceRecords: evidenceRows,
      constructionDailyReports: constructionRows,
    },
  };
}

/** 创建可审计的业务数据逻辑备份；数据库凭据和密码材料从不进入快照。 */
export async function createBusinessDataBackup(createdBy: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用，无法创建备份");
  const snapshot = await collectBusinessSnapshot(db);
  const payload = JSON.stringify(snapshot);
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `road-construction-business-backup-${stamp}.json`;
  const stored = await storagePut(`admin-backups/${fileName}`, payload, "application/json");
  const [created] = await db.insert(dataBackups).values({
    fileKey: stored.key,
    fileName,
    sha256,
    recordCount: snapshot.recordCount,
    scopeVersion: BACKUP_SCOPE_VERSION,
    createdBy,
  }).$returningId();
  return { id: Number(created?.id), fileName, recordCount: snapshot.recordCount, sha256, scopeVersion: BACKUP_SCOPE_VERSION, createdAt: snapshot.createdAt };
}

/** 仅返回元数据，不泄露对象存储对象路径或临时签名。 */
export async function listBusinessDataBackups() {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用，无法读取备份目录");
  return db
    .select({ id: dataBackups.id, fileName: dataBackups.fileName, sha256: dataBackups.sha256, recordCount: dataBackups.recordCount, scopeVersion: dataBackups.scopeVersion, createdBy: dataBackups.createdBy, createdAt: dataBackups.createdAt })
    .from(dataBackups)
    .orderBy(desc(dataBackups.createdAt))
    .limit(30);
}

type BusinessStatisticsFilter = {
  projectId?: number;
  period?: string;
};

/** 将 YYYY-MM 转换为统一 UTC 月度窗口；所有日期、datetime 与 timestamp 列均使用 Date 边界。 */
function getBusinessPeriodWindow(period?: string) {
  if (!period) return null;
  const [year, month] = period.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("统计期间格式无效");
  }
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const format = (targetYear: number, targetMonth: number) => `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    endExclusive: new Date(Date.UTC(nextYear, nextMonth - 1, 1)),
  };
}

function countOf(rows: Array<{ total: unknown }>) {
  return Number(rows[0]?.total ?? 0);
}

/**
 * 统计仅返回跨模块汇总数量，项目与期间条件始终在服务端作用于真实表。
 * 基础档案使用创建时间作为期间口径；业务单据使用其发生日期或结算期间。
 */
export async function getBusinessModuleStatistics(filter: BusinessStatisticsFilter = {}) {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用，无法读取业务统计");
  const window = getBusinessPeriodWindow(filter.period);
  const projectId = filter.projectId;
  const [constructionRows, workerRows, attendanceRows, payrollRows, machineRows, leaseRuleRows, machineCostRows, vehicleRows, freightRuleRows, tripRows, supplierRows, requestRows, orderRows, inventoryRows, measurementRows, financeRows, evidenceRows] = await Promise.all([
    db.select({ total: count() }).from(constructionDailyReports).where(and(
      projectId === undefined ? undefined : eq(constructionDailyReports.projectId, projectId),
      window ? gte(constructionDailyReports.reportDate, window.start) : undefined,
      window ? lt(constructionDailyReports.reportDate, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(laborWorkers).where(and(
      projectId === undefined ? undefined : eq(laborWorkers.projectId, projectId),
      window ? gte(laborWorkers.createdAt, window.start) : undefined,
      window ? lt(laborWorkers.createdAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(attendanceRecords).where(and(
      projectId === undefined ? undefined : eq(attendanceRecords.projectId, projectId),
      window ? gte(attendanceRecords.attendanceDate, window.start) : undefined,
      window ? lt(attendanceRecords.attendanceDate, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(payrollStatements).where(and(
      projectId === undefined ? undefined : eq(payrollStatements.projectId, projectId),
      window ? eq(payrollStatements.period, filter.period!) : undefined,
    )),
    db.select({ total: count() }).from(machines).where(and(
      projectId === undefined ? undefined : eq(machines.projectId, projectId),
      window ? gte(machines.createdAt, window.start) : undefined,
      window ? lt(machines.createdAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(machineLeaseRules).where(and(
      projectId === undefined ? undefined : eq(machineLeaseRules.projectId, projectId),
      window ? gte(machineLeaseRules.effectiveFrom, window.start) : undefined,
      window ? lt(machineLeaseRules.effectiveFrom, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(machineCostRecords).where(and(
      projectId === undefined ? undefined : eq(machineCostRecords.projectId, projectId),
      window ? gte(machineCostRecords.occurredAt, window.start) : undefined,
      window ? lt(machineCostRecords.occurredAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(transportVehicles).where(and(
      projectId === undefined ? undefined : eq(transportVehicles.projectId, projectId),
      window ? gte(transportVehicles.createdAt, window.start) : undefined,
      window ? lt(transportVehicles.createdAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(freightRateRules).where(and(
      projectId === undefined ? undefined : eq(freightRateRules.projectId, projectId),
      window ? gte(freightRateRules.effectiveFrom, window.start) : undefined,
      window ? lt(freightRateRules.effectiveFrom, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(transportTrips).where(and(
      projectId === undefined ? undefined : eq(transportTrips.projectId, projectId),
      window ? gte(transportTrips.startAt, window.start) : undefined,
      window ? lt(transportTrips.startAt, window.endExclusive) : undefined,
    )),
    projectId === undefined
      ? db.select({ total: count() }).from(suppliers).where(and(
        window ? gte(suppliers.createdAt, window.start) : undefined,
        window ? lt(suppliers.createdAt, window.endExclusive) : undefined,
      ))
      : Promise.resolve([]),
    db.select({ total: count() }).from(purchaseRequests).where(and(
      projectId === undefined ? undefined : eq(purchaseRequests.projectId, projectId),
      window ? gte(purchaseRequests.createdAt, window.start) : undefined,
      window ? lt(purchaseRequests.createdAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(purchaseOrders).where(and(
      projectId === undefined ? undefined : eq(purchaseOrders.projectId, projectId),
      window ? gte(purchaseOrders.orderedAt, window.start) : undefined,
      window ? lt(purchaseOrders.orderedAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(inventoryTransactions).where(and(
      projectId === undefined ? undefined : eq(inventoryTransactions.projectId, projectId),
      window ? gte(inventoryTransactions.occurredAt, window.start) : undefined,
      window ? lt(inventoryTransactions.occurredAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(measurementClaims).where(and(
      projectId === undefined ? undefined : eq(measurementClaims.projectId, projectId),
      window ? eq(measurementClaims.period, filter.period!) : undefined,
    )),
    db.select({ total: count() }).from(financialRecords).where(and(
      projectId === undefined ? undefined : eq(financialRecords.projectId, projectId),
      window ? gte(financialRecords.occurredAt, window.start) : undefined,
      window ? lt(financialRecords.occurredAt, window.endExclusive) : undefined,
    )),
    db.select({ total: count() }).from(evidenceRecords).where(and(
      projectId === undefined ? undefined : eq(evidenceRecords.projectId, projectId),
      window ? gte(evidenceRecords.createdAt, window.start) : undefined,
      window ? lt(evidenceRecords.createdAt, window.endExclusive) : undefined,
    )),
  ]);

  return [
    { code: "CONSTRUCTION", name: "施工现场", route: "/mobile/construction", recordCount: countOf(constructionRows) },
    { code: "LABOR", name: "劳务与工资", route: "/mobile/labor", recordCount: countOf(workerRows) + countOf(attendanceRows) + countOf(payrollRows) },
    { code: "MACHINERY", name: "机械管理", route: "/mobile/machinery", recordCount: countOf(machineRows) + countOf(leaseRuleRows) + countOf(machineCostRows) },
    { code: "TRANSPORT", name: "运输管理", route: "/mobile/transport", recordCount: countOf(vehicleRows) + countOf(freightRuleRows) + countOf(tripRows) },
    { code: "PURCHASING", name: "采购仓储", route: "/mobile/purchasing", recordCount: countOf(supplierRows) + countOf(requestRows) + countOf(orderRows) + countOf(inventoryRows) },
    { code: "MEASUREMENT", name: "工程计量", route: "/mobile/measurement", recordCount: countOf(measurementRows) },
    { code: "FINANCE", name: "财务成本", route: "/mobile/finance", recordCount: countOf(financeRows) },
    { code: "EVIDENCE", name: "现场取证", route: "/mobile/evidence", recordCount: countOf(evidenceRows) },
  ];
}

/** 下载地址只在超级管理员主动请求时生成，数据库中不保存外链。 */
export async function getBusinessDataBackupDownload(id: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库连接暂不可用，无法读取备份");
  const [backup] = await db.select({ id: dataBackups.id, fileName: dataBackups.fileName, fileKey: dataBackups.fileKey, sha256: dataBackups.sha256 }).from(dataBackups).where(eq(dataBackups.id, id)).limit(1);
  if (!backup) throw new Error("指定备份不存在或已被归档");
  return { id: backup.id, fileName: backup.fileName, sha256: backup.sha256, url: await storageGetSignedUrl(backup.fileKey) };
}
