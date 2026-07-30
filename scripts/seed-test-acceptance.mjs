import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  attendanceRecords,
  auditLogs,
  departmentBusinessScopes,
  laborWorkers,
  organizations,
  payrollStatements,
  projects,
  systemRoles,
  userProfiles,
  userRoleAssignments,
  users,
} from "../drizzle/schema.ts";
import { ensureFoundationData } from "../server/services/foundationData.ts";

const credentialPath = "/home/ubuntu/.road-construction-management-test-acceptance.json";
const username = "test.labor.manager";
const userOpenId = `local-manager:${username}`;
const currentDate = new Date();
const currentYear = currentDate.getUTCFullYear();
const currentMonth = currentDate.getUTCMonth();
const payrollPeriod = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
const validFrom = new Date(Date.UTC(currentYear, currentMonth, 1));
const validTo = new Date(Date.UTC(currentYear + 1, currentMonth, 1));

function buildPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function createPassword() {
  return `TestLabor-${randomBytes(10).toString("base64url")}-A1!`;
}

async function readPreviousCredentials() {
  try {
    const payload = JSON.parse(await readFile(credentialPath, "utf8"));
    if (payload?.username === username && typeof payload.password === "string" && payload.password.length >= 12) {
      return payload;
    }
  } catch {
    // 首次运行或凭据文件不存在时生成新的仅本地测试口令。
  }
  return { username, password: createPassword() };
}

async function persistCredentials(payload) {
  await writeFile(credentialPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialPath, 0o600);
}

async function selectOne(db, query) {
  const rows = await query;
  return rows[0] ?? null;
}

async function upsertOrganization(db, { code, name }) {
  const existing = await selectOne(db, db.select().from(organizations).where(eq(organizations.code, code)).limit(1));
  const values = { code, name, type: "project_department", parentId: null, managerUserId: null, costCenterCode: "TEST-ACCEPT", sortOrder: 9900, status: "active" };
  if (existing) {
    await db.update(organizations).set(values).where(eq(organizations.id, existing.id));
    return existing.id;
  }
  await db.insert(organizations).values(values);
  const created = await selectOne(db, db.select().from(organizations).where(eq(organizations.code, code)).limit(1));
  if (!created) throw new Error(`未能创建测试组织：${code}`);
  return created.id;
}

async function upsertProject(db, { code, name, organizationId }) {
  const existing = await selectOne(db, db.select().from(projects).where(eq(projects.code, code)).limit(1));
  const values = {
    code,
    name,
    parentId: null,
    organizationId,
    nodeType: "project",
    projectType: "municipal",
    status: "active",
    startDate: validFrom,
    endDate: validTo,
    costCenterCode: "TEST-ACCEPT",
    sortOrder: 9900,
  };
  if (existing) {
    await db.update(projects).set(values).where(eq(projects.id, existing.id));
    return existing.id;
  }
  await db.insert(projects).values(values);
  const created = await selectOne(db, db.select().from(projects).where(eq(projects.code, code)).limit(1));
  if (!created) throw new Error(`未能创建测试项目：${code}`);
  return created.id;
}

async function upsertWorker(db, { projectId, realName }) {
  const existing = await selectOne(
    db,
    db.select().from(laborWorkers).where(and(eq(laborWorkers.projectId, projectId), eq(laborWorkers.realName, realName))).limit(1),
  );
  const values = {
    projectId,
    teamName: "测试验收劳务班组",
    realName,
    identityNoEncrypted: null,
    phoneEncrypted: null,
    bankAccountEncrypted: null,
    bankName: null,
    identityVerificationStatus: "pending",
    identityVerificationNote: "测试样本，不含任何真实个人信息。",
    identityVerifiedAt: null,
    identityVerifiedBy: null,
    attendanceStatus: "active",
    entryDate: validFrom,
    exitDate: null,
  };
  if (existing) {
    await db.update(laborWorkers).set(values).where(eq(laborWorkers.id, existing.id));
    return existing.id;
  }
  await db.insert(laborWorkers).values(values);
  const created = await selectOne(
    db,
    db.select().from(laborWorkers).where(and(eq(laborWorkers.projectId, projectId), eq(laborWorkers.realName, realName))).limit(1),
  );
  if (!created) throw new Error(`未能创建测试劳务人员：${realName}`);
  return created.id;
}

async function upsertAttendance(db, { workerId, projectId, dayOffset }) {
  const attendanceDate = new Date(Date.UTC(currentYear, currentMonth, Math.min(dayOffset, 25)));
  const existing = await selectOne(
    db,
    db.select().from(attendanceRecords).where(and(eq(attendanceRecords.workerId, workerId), eq(attendanceRecords.attendanceDate, attendanceDate))).limit(1),
  );
  const values = {
    workerId,
    projectId,
    attendanceDate,
    workHours: "8.00",
    overtimeHours: "1.00",
    note: "测试验收考勤样本。",
    source: "import",
    status: "confirmed",
    evidenceId: null,
  };
  if (existing) await db.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, existing.id));
  else await db.insert(attendanceRecords).values(values);
}

async function upsertPayroll(db, { workerId, projectId, submittedBy }) {
  const existing = await selectOne(
    db,
    db.select().from(payrollStatements).where(and(eq(payrollStatements.workerId, workerId), eq(payrollStatements.projectId, projectId), eq(payrollStatements.period, payrollPeriod))).limit(1),
  );
  const values = {
    workerId,
    projectId,
    period: payrollPeriod,
    payableAmount: "8800.00",
    deductionAmount: "300.00",
    actualAmount: "8500.00",
    bankAccountMasked: "测试账户 ****0001",
    status: "draft",
    submittedBy: null,
    submittedAt: null,
    accountantId: null,
    reviewedAt: null,
    paidAt: null,
    paymentReference: null,
  };
  if (existing) {
    await db.update(payrollStatements).set(values).where(eq(payrollStatements.id, existing.id));
    return existing.id;
  }
  await db.insert(payrollStatements).values(values);
  const created = await selectOne(
    db,
    db.select().from(payrollStatements).where(and(eq(payrollStatements.workerId, workerId), eq(payrollStatements.projectId, projectId), eq(payrollStatements.period, payrollPeriod))).limit(1),
  );
  if (!created) throw new Error("未能创建测试工资条");
  return created.id;
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置，无法生成测试验收数据");

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

try {
  await ensureFoundationData(db);
  const credentials = await readPreviousCredentials();
  const superAdmin = await selectOne(db, db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1));
  const existingUser = await selectOne(db, db.select().from(users).where(eq(users.localUsername, username)).limit(1));
  const userValues = {
    openId: userOpenId,
    name: "测试劳资管理员",
    email: null,
    loginMethod: "local_manager",
    localUsername: username,
    localPasswordHash: buildPasswordHash(credentials.password),
    localAccountStatus: "active",
    localPasswordChangeRequired: false,
    role: "user",
    lastSignedIn: new Date(),
  };
  if (existingUser) {
    await db.update(users).set(userValues).where(eq(users.id, existingUser.id));
  } else {
    await db.insert(users).values(userValues);
  }
  const testUser = await selectOne(db, db.select().from(users).where(eq(users.localUsername, username)).limit(1));
  if (!testUser) throw new Error("未能创建测试普通管理人员账号");

  const laborDepartmentId = await upsertOrganization(db, { code: "TEST-ACCEPT-LABOR-DEPT", name: "测试验收劳务项目部" });
  const outsideDepartmentId = await upsertOrganization(db, { code: "TEST-ACCEPT-OUTSIDE-DEPT", name: "测试验收越权项目部" });
  const authorizedProjectId = await upsertProject(db, { code: "TEST-ACCEPT-LABOR-A", name: "测试验收劳务项目（已授权）", organizationId: laborDepartmentId });
  const outsideProjectId = await upsertProject(db, { code: "TEST-ACCEPT-LABOR-B", name: "测试验收劳务项目（未授权）", organizationId: outsideDepartmentId });

  const existingProfile = await selectOne(db, db.select().from(userProfiles).where(eq(userProfiles.userId, testUser.id)).limit(1));
  const profileValues = { userId: testUser.id, employeeNo: "TEST-LABOR-MGR-001", phoneMasked: null, wecomUserId: null, organizationId: laborDepartmentId, positionId: null, status: "active" };
  if (existingProfile) await db.update(userProfiles).set(profileValues).where(eq(userProfiles.id, existingProfile.id));
  else await db.insert(userProfiles).values(profileValues);

  const existingScope = await selectOne(
    db,
    db.select().from(departmentBusinessScopes).where(and(eq(departmentBusinessScopes.organizationId, laborDepartmentId), eq(departmentBusinessScopes.module, "LABOR"))).limit(1),
  );
  const scopeValues = { organizationId: laborDepartmentId, module: "LABOR", status: "active", configuredBy: superAdmin?.id ?? null };
  if (existingScope) await db.update(departmentBusinessScopes).set(scopeValues).where(eq(departmentBusinessScopes.id, existingScope.id));
  else await db.insert(departmentBusinessScopes).values(scopeValues);

  const laborRole = await selectOne(db, db.select().from(systemRoles).where(eq(systemRoles.code, "LABOR_MANAGER")).limit(1));
  if (!laborRole) throw new Error("基础角色 LABOR_MANAGER 不存在");
  const assignments = await db.select().from(userRoleAssignments).where(eq(userRoleAssignments.userId, testUser.id));
  const matchingAssignment = assignments.find(item => item.roleId === laborRole.id && item.projectId === authorizedProjectId);
  const otherAssignmentIds = assignments.filter(item => item.id !== matchingAssignment?.id).map(item => item.id);
  if (otherAssignmentIds.length) {
    await db.update(userRoleAssignments).set({ status: "revoked", grantedBy: superAdmin?.id ?? null }).where(inArray(userRoleAssignments.id, otherAssignmentIds));
  }
  const assignmentValues = {
    userId: testUser.id,
    roleId: laborRole.id,
    organizationId: null,
    projectId: authorizedProjectId,
    validFrom,
    validTo,
    status: "active",
    grantedBy: superAdmin?.id ?? null,
  };
  if (matchingAssignment) await db.update(userRoleAssignments).set(assignmentValues).where(eq(userRoleAssignments.id, matchingAssignment.id));
  else await db.insert(userRoleAssignments).values(assignmentValues);

  const authorizedWorkerId = await upsertWorker(db, { projectId: authorizedProjectId, realName: "测试劳务人员一号" });
  const outsideWorkerId = await upsertWorker(db, { projectId: outsideProjectId, realName: "测试越权人员二号" });
  await Promise.all([
    upsertAttendance(db, { workerId: authorizedWorkerId, projectId: authorizedProjectId, dayOffset: 3 }),
    upsertAttendance(db, { workerId: authorizedWorkerId, projectId: authorizedProjectId, dayOffset: 7 }),
    upsertAttendance(db, { workerId: authorizedWorkerId, projectId: authorizedProjectId, dayOffset: 12 }),
  ]);
  const authorizedPayrollId = await upsertPayroll(db, { workerId: authorizedWorkerId, projectId: authorizedProjectId, submittedBy: testUser.id });
  await upsertPayroll(db, { workerId: outsideWorkerId, projectId: outsideProjectId, submittedBy: superAdmin?.id ?? testUser.id });

  await db.insert(auditLogs).values({
    userId: superAdmin?.id ?? null,
    module: "test",
    action: "seed_acceptance_data",
    targetType: "test_acceptance",
    targetId: username,
    summary: `生成或刷新测试劳务验收数据：仅授权项目 #${authorizedProjectId}，未授权项目 #${outsideProjectId}，期间 ${payrollPeriod}。`,
  });

  await persistCredentials({
    username,
    password: credentials.password,
    userId: testUser.id,
    authorizedProjectId,
    outsideProjectId,
    authorizedWorkerId,
    authorizedPayrollId,
    payrollPeriod,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    actors: credentials.actors ?? {},
    generatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ username, userId: testUser.id, authorizedProjectId, outsideProjectId, authorizedWorkerId, authorizedPayrollId, payrollPeriod }, null, 2));
} finally {
  await connection.end();
}

// 该脚本仅用于一次性测试样本生成；显式退出可避免 tsx 保留导入链中的句柄。
process.exit(0);
