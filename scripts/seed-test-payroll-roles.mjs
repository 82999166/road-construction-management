import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  auditLogs,
  projects,
  systemRoles,
  userProfiles,
  userRoleAssignments,
  users,
} from "../drizzle/schema.ts";

const credentialPath = "/home/ubuntu/.road-construction-management-test-acceptance.json";
const currentDate = new Date();
const currentYear = currentDate.getUTCFullYear();
const currentMonth = currentDate.getUTCMonth();
const validFrom = new Date(Date.UTC(currentYear, currentMonth, 1));
const validTo = new Date(Date.UTC(currentYear + 1, currentMonth, 1));

function buildPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

function createPassword() {
  return `TestPayroll-${randomBytes(10).toString("base64url")}-A1!`;
}

async function selectOne(db, query) {
  const rows = await query;
  return rows[0] ?? null;
}

async function saveCredentials(payload) {
  await writeFile(credentialPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialPath, 0o600);
}

async function upsertPayrollActor(db, { key, username, displayName, roleCode, employeeNo, project, superAdminId, credential }) {
  const password = credential?.password ?? createPassword();
  const existingUser = await selectOne(db, db.select().from(users).where(eq(users.localUsername, username)).limit(1));
  const userValues = {
    openId: `local-manager:${username}`,
    name: displayName,
    email: null,
    loginMethod: "local_manager",
    localUsername: username,
    localPasswordHash: buildPasswordHash(password),
    localAccountStatus: "active",
    localPasswordChangeRequired: false,
    role: "user",
    lastSignedIn: new Date(),
  };
  if (existingUser) await db.update(users).set(userValues).where(eq(users.id, existingUser.id));
  else await db.insert(users).values(userValues);
  const testUser = await selectOne(db, db.select().from(users).where(eq(users.localUsername, username)).limit(1));
  if (!testUser) throw new Error(`未能创建测试账号：${username}`);

  const profileValues = {
    userId: testUser.id,
    employeeNo,
    phoneMasked: null,
    wecomUserId: null,
    organizationId: project.organizationId,
    positionId: null,
    status: "active",
  };
  const existingProfile = await selectOne(db, db.select().from(userProfiles).where(eq(userProfiles.userId, testUser.id)).limit(1));
  if (existingProfile) await db.update(userProfiles).set(profileValues).where(eq(userProfiles.id, existingProfile.id));
  else await db.insert(userProfiles).values(profileValues);

  const assignedRole = await selectOne(db, db.select().from(systemRoles).where(eq(systemRoles.code, roleCode)).limit(1));
  if (!assignedRole) throw new Error(`基础角色不存在：${roleCode}`);
  const assignments = await db.select().from(userRoleAssignments).where(eq(userRoleAssignments.userId, testUser.id));
  const matchingAssignment = assignments.find(item => item.roleId === assignedRole.id && item.projectId === project.id);
  const staleIds = assignments.filter(item => item.id !== matchingAssignment?.id && item.status === "active").map(item => item.id);
  if (staleIds.length) {
    await db.update(userRoleAssignments).set({ status: "revoked", grantedBy: superAdminId ?? null }).where(inArray(userRoleAssignments.id, staleIds));
  }
  const assignmentValues = {
    userId: testUser.id,
    roleId: assignedRole.id,
    organizationId: null,
    projectId: project.id,
    validFrom,
    validTo,
    status: "active",
    grantedBy: superAdminId ?? null,
  };
  if (matchingAssignment) await db.update(userRoleAssignments).set(assignmentValues).where(eq(userRoleAssignments.id, matchingAssignment.id));
  else await db.insert(userRoleAssignments).values(assignmentValues);

  return { key, username, password, userId: testUser.id, roleCode, projectId: project.id };
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置，无法生成测试工资流程角色");
const credentials = JSON.parse(await readFile(credentialPath, "utf8"));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

try {
  const project = await selectOne(db, db.select().from(projects).where(eq(projects.id, credentials.authorizedProjectId)).limit(1));
  if (!project?.organizationId) throw new Error("已授权测试项目或所属组织不存在");
  const superAdmin = await selectOne(db, db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1));
  const actorDefinitions = [
    { key: "accountant", username: "test.payroll.accountant", displayName: "测试工资会计", roleCode: "ACCOUNTANT", employeeNo: "TEST-ACC-001" },
    { key: "finance", username: "test.payroll.finance", displayName: "测试财务负责人", roleCode: "FINANCE_MANAGER", employeeNo: "TEST-FIN-001" },
  ];
  const actors = {};
  for (const definition of actorDefinitions) {
    actors[definition.key] = await upsertPayrollActor(db, {
      ...definition,
      project,
      superAdminId: superAdmin?.id,
      credential: credentials.actors?.[definition.key],
    });
  }
  await db.insert(auditLogs).values({
    userId: superAdmin?.id ?? null,
    module: "test",
    action: "seed_payroll_acceptance_roles",
    targetType: "test_acceptance",
    targetId: String(credentials.authorizedProjectId),
    summary: `生成或刷新测试会计与财务负责人账号，授权项目 #${credentials.authorizedProjectId}，仅用于工资审核与发放验收。`,
  });
  const nextCredentials = { ...credentials, actors, updatedAt: new Date().toISOString() };
  await saveCredentials(nextCredentials);
  console.log(JSON.stringify({
    authorizedProjectId: credentials.authorizedProjectId,
    actors: Object.values(actors).map(({ key, username, userId, roleCode, projectId }) => ({ key, username, userId, roleCode, projectId })),
  }, null, 2));
} finally {
  await connection.end();
}

process.exit(0);
