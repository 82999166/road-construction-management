import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lte, or } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { personnelSaveInput, type PersonnelSaveInput, personnelDocumentInput, personnelPositionInput, personnelTeamInput, personnelListInput, personnelInsuranceInput } from "../../shared/personnel";
import { assertCertificateFileSignature } from "../../shared/domain";
import { getDb } from "../db";
import { assertSuperAdmin } from "../access";
import { createContext } from "../_core/context";
import { ENV } from "../_core/env";
import { storagePut, storageGetSignedUrl } from "../storage";
import { encryptSecret, decryptSecret, fingerprintSecret, revealBusinessSecret } from "./secretVault";
import { chinaBusinessDate } from "./chinaBusinessTime";
import { ensureLegacyPayrollSubjects, syncLegacyMirrors, getLegacyCompensation } from "./personnelLegacyBridge";
import { isAliyunOssPhotoStorageKey } from "./aliyunOssPhotoStorage";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ReadDb = Pick<Db, "select" | "insert" | "update">;
type Person = typeof s.personnelPeople.$inferSelect;
export async function requirePersonnelDb() { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" }); return db; }
export async function findPersonnel(db: ReadDb, id: number): Promise<Person> {
  const [person] = await db.select().from(s.personnelPeople).where(eq(s.personnelPeople.id, id)).limit(1);
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "人员档案不存在" }); return person;
}
/** 只显式允许安全字段，不使用删字段的黑名单投影。 */
export function safePersonnel(person: Person, avatarDocumentId: number | null = null) {
  return { id: person.id, personNo: person.personNo, name: person.name, affiliation: person.affiliation, employmentStatus: person.employmentStatus,
    primaryPositionId: person.primaryPositionId, secondaryPositionIds: person.secondaryPositionIds, projectId: person.projectId, teamId: person.teamId,
    entryDate: person.entryDate, exitDate: person.exitDate, gender: person.gender, birthDate: person.birthDate, address: person.address,
    emergencyContactName: person.emergencyContactName, emergencyContactPhoneMasked: revealBusinessSecret(person.emergencyContactPhoneEncrypted),
    remarks: person.remarks, payrollEnabled: person.payrollEnabled, phoneMasked: revealBusinessSecret(person.phoneEncrypted), identityMasked: revealBusinessSecret(person.identityNoEncrypted),
    bankMasked: revealBusinessSecret(person.bankAccountEncrypted), bankName: person.bankName, userId: person.userId, legacyProfileId: person.legacyProfileId,
    legacyWorkerId: person.legacyWorkerId, avatarDocumentId, version: person.version, createdAt: person.createdAt, updatedAt: person.updatedAt };
}
function mappedAvatarDocumentId(person: Person, documents: { id: number; personId: number; evidenceId: number; documentType: string }[]) {
  return documents.find(doc => doc.personId === person.id && doc.documentType === "portrait" && doc.evidenceId === person.avatarEvidenceId)?.id ?? null;
}
const editableFields = ["name", "affiliation", "employmentStatus", "primaryPositionId", "secondaryPositionIds", "projectId", "teamId", "entryDate", "exitDate", "gender", "birthDate", "address", "emergencyContactName", "remarks", "bankName", "userId"] as const;
export function buildPersonnelPatch(input: PersonnelSaveInput, previous?: Person) {
  const patch: Record<string, any> = {};
  for (const field of editableFields) if (input[field] !== undefined) patch[field] = input[field];
  if (input.secondaryPositionIds !== undefined) patch.secondaryPositionIds = Array.from(new Set(input.secondaryPositionIds)).filter(id => id !== input.primaryPositionId);
  else if (!previous) patch.secondaryPositionIds = [];
  const definitions = [
    ["phoneNumber", "clearPhoneNumber", "phoneEncrypted", "phoneFingerprint", "phoneMasked"],
    ["identityNo", "clearIdentityNo", "identityNoEncrypted", "identityNoFingerprint", "identityMasked"],
    ["bankAccount", "clearBankAccount", "bankAccountEncrypted", "bankAccountFingerprint", "bankMasked"],
  ] as const;
  for (const [value, clear, encrypted, fingerprint, masked] of definitions) {
    if (input[clear]) { patch[encrypted] = null; patch[fingerprint] = null; patch[masked] = null; }
    else if (input[value] !== undefined) { const plain = value === "phoneNumber" ? input[value]!.replace(/[\s\-()]/g, "") : input[value]!.trim(); if (value === "phoneNumber" && plain.length < 5) throw new TRPCError({ code: "BAD_REQUEST", message: "手机号有效内容不足" }); patch[encrypted] = encryptSecret(plain); patch[fingerprint] = fingerprintSecret(plain); patch[masked] = plain; }
  }
  if (input.emergencyContactPhone !== undefined) {
    const plain = input.emergencyContactPhone?.trim(); patch.emergencyContactPhoneEncrypted = plain ? encryptSecret(plain) : null; patch.emergencyContactPhoneMasked = plain || null;
  }
  return patch;
}
function safeChanges(previous: Person | undefined, next: Person) {
  const before = previous ? safePersonnel(previous) : {};
  const after = safePersonnel(next);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (["createdAt", "updatedAt", "version"].includes(key)) continue;
    const old = (before as any)[key] ?? null; const value = after[key] ?? null;
    if (JSON.stringify(old) !== JSON.stringify(value)) changes[key] = { before: old, after: value };
  }
  return changes;
}
export function currentPersonnelSalary<T extends { effectiveFrom: string }>(rows: T[], day = chinaBusinessDate(new Date())): T | null {
  return rows.filter(row => row.effectiveFrom <= day).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}
async function validateReferences(tx: ReadDb, next: Person, previous?: Person) {
  if (next.projectId !== null) { const [project] = await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, next.projectId)).limit(1); if (!project) throw new TRPCError({ code: "BAD_REQUEST", message: "所选项目不存在" }); }
  if (next.teamId !== null) { const [team] = await tx.select().from(s.personnelTeams).where(eq(s.personnelTeams.id, next.teamId)).limit(1); if (!team || team.projectId !== next.projectId || (team.status !== "active" && previous?.teamId !== team.id)) throw new TRPCError({ code: "BAD_REQUEST", message: "施工队未启用或不属于所选项目" }); }
  const ids = Array.from(new Set([next.primaryPositionId, ...next.secondaryPositionIds].filter((x): x is number => x !== null)));
  if (ids.length) { const positions = await tx.select().from(s.personnelPositions).where(inArray(s.personnelPositions.id, ids)); const priorIds = new Set([previous?.primaryPositionId, ...(previous?.secondaryPositionIds ?? [])]); if (positions.length !== ids.length || positions.some(p => p.status !== "active" && !priorIds.has(p.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "所选岗位不存在或已停用" }); }
  if (next.entryDate && next.exitDate && next.exitDate < next.entryDate) throw new TRPCError({ code: "BAD_REQUEST", message: "离职日期不能早于入职日期" });
  if (next.affiliation === "external" && next.payrollEnabled) throw new TRPCError({ code: "BAD_REQUEST", message: "外部运费或机械租金不是工资，外部人员不能启用计薪" });
  if (next.payrollEnabled && !next.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "启用计薪须选择真实项目" });
  if (next.userId !== null && next.userId !== previous?.userId) {
    const [user] = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, next.userId)).limit(1);
    if (!user) throw new TRPCError({ code: "BAD_REQUEST", message: "所选账号不存在" });
    const links = await tx.select().from(s.personnelSourceLinks).where(and(eq(s.personnelSourceLinks.sourceType, "user"), eq(s.personnelSourceLinks.sourceId, next.userId)));
    if (links.some(link => link.personId !== next.id)) throw new TRPCError({ code: "CONFLICT", message: "该账号已经属于其他人员档案" });
    const profiles = await tx.select({ id: s.employeeProfiles.id }).from(s.employeeProfiles).where(eq(s.employeeProfiles.userId, next.userId)).limit(1);
    if (profiles.length && !links.length) throw new TRPCError({ code: "BAD_REQUEST", message: "该账号已有历史人员主体，请先按真实账号ID引入档案，不能直接关联历史身份" });
    if (previous?.userId) throw new TRPCError({ code: "BAD_REQUEST", message: "已关联账号不能直接替换；请核实真实身份，避免历史记录归错人" });
  }
  if (previous?.userId && next.userId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "已确认的历史账号身份不能从人员档案清除" });
}
function affected(result: any) { return Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0); }
function duplicate(error: any) { return error?.code === "ER_DUP_ENTRY" || error?.cause?.code === "ER_DUP_ENTRY"; }
async function assertPersonnelPhoneUnique(tx: ReadDb, fingerprint: string, previous?: Person) {
  const [people, workers, accounts, links] = await Promise.all([
    tx.select({ id: s.personnelPeople.id }).from(s.personnelPeople).where(eq(s.personnelPeople.phoneFingerprint, fingerprint)),
    tx.select({ id: s.laborWorkers.id }).from(s.laborWorkers).where(eq(s.laborWorkers.phoneFingerprint, fingerprint)),
    tx.select({ userId: s.userProfiles.userId }).from(s.userProfiles).where(eq(s.userProfiles.phoneFingerprint, fingerprint)),
    previous ? tx.select().from(s.personnelSourceLinks).where(eq(s.personnelSourceLinks.personId, previous.id)) : [],
  ]);
  if (people.some(p => p.id !== previous?.id)) throw new TRPCError({ code: "CONFLICT", message: "手机号已属于其他人员档案，不能重复建档或自动合并" });
  for (const worker of workers) {
    if (!previous || worker.id !== previous.legacyWorkerId && !links.some(x => x.sourceType === "worker" && x.sourceId === worker.id)) throw new TRPCError({ code: "CONFLICT", message: "手机号已属于未确认的历史工人主体，请按真实编号引入，不能按手机号合并" });
    const owners = await tx.select().from(s.personnelSourceLinks).where(and(eq(s.personnelSourceLinks.sourceType, "worker"), eq(s.personnelSourceLinks.sourceId, worker.id)));
    if (owners.some(x => x.personId !== previous.id)) throw new TRPCError({ code: "CONFLICT", message: "该手机号历史主体已属于其他人员" });
  }
  for (const account of accounts) {
    if (!previous || account.userId !== previous.userId && !links.some(x => x.sourceType === "user" && x.sourceId === account.userId)) throw new TRPCError({ code: "CONFLICT", message: "手机号已属于未确认的历史账号，请按真实账号编号引入，不能按手机号合并" });
    const owners = await tx.select().from(s.personnelSourceLinks).where(and(eq(s.personnelSourceLinks.sourceType, "user"), eq(s.personnelSourceLinks.sourceId, account.userId)));
    if (owners.some(x => x.personId !== previous.id)) throw new TRPCError({ code: "CONFLICT", message: "该手机号历史账号已属于其他人员" });
  }
}
/** 版本CAS与源链接/历史/工资主体/镜像同一事务，失败全部回滚。 */
export async function saveDirectoryPerson(rawInput: PersonnelSaveInput, actorId: number, suppliedDb?: Db) {
  const input = personnelSaveInput.parse(rawInput); const db = suppliedDb ?? await requirePersonnelDb(); const today = chinaBusinessDate(new Date());
  try { return await db.transaction(async tx => {
    const previous = input.id ? await findPersonnel(tx, input.id) : undefined;
    if (previous && previous.version !== input.version) throw new TRPCError({ code: "CONFLICT", message: "档案已被其他人修改，请刷新后重试" });
    const patch = buildPersonnelPatch(input, previous);
    if (patch.phoneFingerprint) await assertPersonnelPhoneUnique(tx, patch.phoneFingerprint, previous);
    const salaryRows = previous ? await tx.select().from(s.personnelSalaryHistory).where(eq(s.personnelSalaryHistory.personId, previous.id)) : [];
    const current = currentPersonnelSalary(salaryRows, today);
    const nextSalary = { salaryBasis: input.salaryBasis ?? current?.salaryBasis ?? (input.affiliation === "temporary" ? "daily" : "monthly"), baseSalary: input.baseSalary === undefined ? current?.baseSalary ?? null : input.baseSalary === null ? null : Number(input.baseSalary).toFixed(2), payrollEnabled: input.payrollEnabled, affiliation: input.affiliation };
    if (nextSalary.payrollEnabled && input.affiliation === "external") throw new TRPCError({ code: "BAD_REQUEST", message: "外部人员不能启用工资计薪" });
    if (input.affiliation === "temporary" && nextSalary.payrollEnabled && nextSalary.salaryBasis === "monthly") throw new TRPCError({ code: "BAD_REQUEST", message: "临时工使用日结，不得重复生成月薪" });
    const meaningfulInitialSalary = input.payrollEnabled || input.baseSalary !== undefined && input.baseSalary !== null;
    const salaryChanged = current ? Object.keys(nextSalary).some(key => (current as any)[key] !== (nextSalary as any)[key]) : meaningfulInitialSalary;
    const effectiveFrom = input.salaryEffectiveFrom ?? today;
    if (salaryChanged && previous && !input.salaryEffectiveFrom) throw new TRPCError({ code: "BAD_REQUEST", message: "变更计薪设置须明确生效日期" });
    if (salaryChanged && previous && effectiveFrom < today) throw new TRPCError({ code: "BAD_REQUEST", message: "不能追溯覆盖历史薪资；请走原历史工资审核流程" });
    if (salaryChanged && salaryRows.some(row => row.effectiveFrom === effectiveFrom)) throw new TRPCError({ code: "CONFLICT", message: "该生效日期已有薪资版本，请选择新的生效日期；历史版本不能覆盖" });
    if (salaryChanged && input.affiliation !== previous?.affiliation && effectiveFrom !== today && previous) throw new TRPCError({ code: "BAD_REQUEST", message: "归属立即生效，联动计薪资格请采用今天生效的薪资版本" });
    patch.payrollEnabled = salaryChanged && effectiveFrom <= today ? nextSalary.payrollEnabled : current?.payrollEnabled ?? false;
    const prospective = { projectId: null, teamId: null, userId: null, entryDate: null, exitDate: null, primaryPositionId: null, ...previous, ...patch, id: previous?.id ?? 0 } as Person;
    await validateReferences(tx, prospective, previous);
    const version = (previous?.version ?? 0) + 1; let personId: number;
    if (previous) { const result = await tx.update(s.personnelPeople).set({ ...patch, version, updatedBy: actorId }).where(and(eq(s.personnelPeople.id, previous.id), eq(s.personnelPeople.version, input.version!))); if (!affected(result)) throw new TRPCError({ code: "CONFLICT", message: "档案版本冲突，请刷新后重试" }); personId = previous.id; }
    else { const [result] = await tx.insert(s.personnelPeople).values({ ...patch, name: input.name, affiliation: input.affiliation, employmentStatus: input.employmentStatus, secondaryPositionIds: patch.secondaryPositionIds, personNo: `P-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`, version, createdBy: actorId, updatedBy: actorId } as typeof s.personnelPeople.$inferInsert); personId = Number(result.insertId); }
    let person = await findPersonnel(tx, personId);
    if (person.userId && person.userId !== previous?.userId) await tx.insert(s.personnelSourceLinks).values({ personId, sourceType: "user", sourceId: person.userId, createdBy: actorId });
    if (salaryChanged) await tx.insert(s.personnelSalaryHistory).values({ ...nextSalary, personId, effectiveFrom, createdBy: actorId });
    const assignmentKeys = ["affiliation", "primaryPositionId", "secondaryPositionIds", "projectId", "teamId", "employmentStatus"] as const;
    if (!previous || assignmentKeys.some(k => JSON.stringify(previous[k]) !== JSON.stringify(person[k]))) await tx.insert(s.personnelAssignments).values({ personId, affiliation: person.affiliation, primaryPositionId: person.primaryPositionId, secondaryPositionIds: person.secondaryPositionIds, projectId: person.projectId, teamId: person.teamId, employmentStatus: person.employmentStatus, effectiveFrom: today, version, createdBy: actorId });
    if (nextSalary.payrollEnabled && person.affiliation !== "external") await ensureLegacyPayrollSubjects(tx, { ...person, payrollEnabled: true }, actorId);
    person = await findPersonnel(tx, personId);
    await syncLegacyMirrors(tx, person);
    const changes = safeChanges(previous, person);
    if (salaryChanged) changes.salarySetting = { before: current ? { salaryBasis: current.salaryBasis, baseSalary: current.baseSalary, payrollEnabled: current.payrollEnabled, affiliation: current.affiliation } : null, after: { ...nextSalary, effectiveFrom } };
    await tx.insert(s.personnelChanges).values({ personId, action: previous ? "update" : "create", version, changes, createdBy: actorId });
    return { success: true as const, id: personId, personNo: person.personNo, version };
  }); } catch (error) { if (duplicate(error)) throw new TRPCError({ code: "CONFLICT", message: "身份、账号或生效版本已存在，请刷新并核实档案，不能重复建档" }); throw error; }
}
export async function personnelOptions() {
  const db = await requirePersonnelDb();
  const [projects, positions, teams, users, vehicles, machines] = await Promise.all([
    db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects).orderBy(asc(s.projects.sortOrder), asc(s.projects.id)),
    db.select().from(s.personnelPositions).orderBy(asc(s.personnelPositions.id)),
    db.select().from(s.personnelTeams).orderBy(asc(s.personnelTeams.name)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).orderBy(asc(s.users.id)),
    db.select({ id: s.transportVehicles.id, projectId: s.transportVehicles.projectId, plateNo: s.transportVehicles.plateNo }).from(s.transportVehicles),
    db.select({ id: s.machines.id, projectId: s.machines.projectId, code: s.machines.code, name: s.machines.name }).from(s.machines),
  ]); return { projects, positions, teams, users, vehicles, machines };
}
export async function listDirectoryPeople(input: Parameters<typeof personnelListInput.parse>[0]) {
  const filter = personnelListInput.parse(input); const db = await requirePersonnelDb();
  const [people, positions, projects, teams, salaries, sources, policies, documents] = await Promise.all([db.select().from(s.personnelPeople).orderBy(desc(s.personnelPeople.id)), db.select().from(s.personnelPositions), db.select().from(s.projects), db.select().from(s.personnelTeams), db.select().from(s.personnelSalaryHistory), db.select().from(s.personnelSourceLinks), db.select({ employeeProfileId: s.employeeInsurancePolicies.employeeProfileId, expiresAt: s.employeeInsurancePolicies.expiresAt, status: s.employeeInsurancePolicies.status }).from(s.employeeInsurancePolicies), db.select({ id: s.personnelDocuments.id, evidenceId: s.personnelDocuments.evidenceId, personId: s.personnelDocuments.personId, documentType: s.personnelDocuments.documentType, expiresAt: s.personnelDocuments.expiresAt }).from(s.personnelDocuments)]);
  const positionById = new Map(positions.map(p => [p.id, p]));
  return people.filter(p => (!filter?.search || `${p.name} ${p.personNo}`.toLowerCase().includes(filter.search.toLowerCase())) && (!filter?.affiliation || p.affiliation === filter.affiliation) && (!filter?.status || p.employmentStatus === filter.status) && (!filter?.projectId || p.projectId === filter.projectId) && (!filter?.teamId || p.teamId === filter.teamId) && (!filter?.positionId || p.primaryPositionId === filter.positionId || p.secondaryPositionIds.includes(filter.positionId))).map(p => {
    const salary = currentPersonnelSalary(salaries.filter(x => x.personId === p.id));
    const profileIds = Array.from(new Set([...sources.filter(x => x.personId === p.id && x.sourceType === "profile").map(x => x.sourceId), ...(p.legacyProfileId ? [p.legacyProfileId] : [])]));
    const insurance = summarizePersonnelInsurance([...policies.filter(x => profileIds.includes(x.employeeProfileId) && x.status !== "cancelled").map(x => ({ expiresAt: chinaBusinessDate(x.expiresAt), active: x.status !== "expired" })), ...documents.filter(x => x.personId === p.id && x.documentType === "insurance").map(x => ({ expiresAt: x.expiresAt, active: true }))]);
    return { ...safePersonnel(p, mappedAvatarDocumentId(p, documents)), ...insurance, historicalDuplicateProfileCount: Math.max(0, profileIds.length - 1), payrollEnabled: salary?.payrollEnabled ?? p.payrollEnabled, positionName: p.primaryPositionId ? positionById.get(p.primaryPositionId)?.name ?? null : null, secondaryPositionNames: p.secondaryPositionIds.map(id => positionById.get(id)?.name).filter((x): x is string => !!x), projectName: projects.find(x => x.id === p.projectId)?.name ?? null, teamName: teams.find(x => x.id === p.teamId)?.name ?? null, salaryBasis: salary?.salaryBasis ?? null, baseSalary: salary?.baseSalary ?? null };
  });
}
/** 有有效保单优先；同时保留过期数，未知有效期的附件不冒充有效保险。 */
export function summarizePersonnelInsurance(rows: { expiresAt: string | null; active: boolean }[], today = chinaBusinessDate(new Date())) {
  const dated = rows.filter((x): x is { expiresAt: string; active: boolean } => !!x.expiresAt);
  const valid = dated.filter(x => x.active && x.expiresAt >= today);
  const expiredInsuranceCount = dated.filter(x => !x.active || x.expiresAt < today).length;
  const horizon = chinaBusinessDate(new Date(new Date(`${today}T00:00:00Z`).getTime() + 30 * 86400000));
  const expiringInsuranceCount = valid.filter(x => x.expiresAt <= horizon).length;
  const insuranceStatus: "none" | "active" | "expiring" | "expired" = valid.length ? (valid.some(x => x.expiresAt > horizon) ? "active" : "expiring") : expiredInsuranceCount ? "expired" : "none";
  return { insuranceStatus, expiredInsuranceCount, expiringInsuranceCount, insuranceExpiresAt: valid.map(x => x.expiresAt).sort()[0] ?? null };
}
export async function directoryDetail(personId: number, period?: string) {
  const db = await requirePersonnelDb(); const raw = await findPersonnel(db, personId);
  const [sourceLinks, assignments, salaryHistory, documents, changes, resourceHistory, positions, projectRows, teamRows] = await Promise.all([
    db.select().from(s.personnelSourceLinks).where(eq(s.personnelSourceLinks.personId, personId)), db.select().from(s.personnelAssignments).where(eq(s.personnelAssignments.personId, personId)).orderBy(desc(s.personnelAssignments.id)),
    db.select().from(s.personnelSalaryHistory).where(eq(s.personnelSalaryHistory.personId, personId)).orderBy(desc(s.personnelSalaryHistory.effectiveFrom)), db.select().from(s.personnelDocuments).where(eq(s.personnelDocuments.personId, personId)),
    db.select().from(s.personnelChanges).where(eq(s.personnelChanges.personId, personId)).orderBy(desc(s.personnelChanges.id)), db.select().from(s.personnelResourceBindings).where(eq(s.personnelResourceBindings.personId, personId)).orderBy(desc(s.personnelResourceBindings.effectiveFrom)), db.select().from(s.personnelPositions), db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects), db.select().from(s.personnelTeams),
  ]);
  const workerIds = Array.from(new Set([...sourceLinks.filter(x => x.sourceType === "worker").map(x => x.sourceId), ...(raw.legacyWorkerId ? [raw.legacyWorkerId] : [])]));
  const profileIds = Array.from(new Set([...sourceLinks.filter(x => x.sourceType === "profile").map(x => x.sourceId), ...(raw.legacyProfileId ? [raw.legacyProfileId] : [])]));
  const profileRows = profileIds.length ? await db.select({ id: s.employeeProfiles.id, projectId: s.employeeProfiles.projectId, joinedAt: s.employeeProfiles.joinedAt, leftAt: s.employeeProfiles.leftAt, laborWorkerId: s.employeeProfiles.laborWorkerId }).from(s.employeeProfiles).where(inArray(s.employeeProfiles.id, profileIds)) : [];
  const payrollSubjects = profileRows.filter(p => p.projectId && p.laborWorkerId).map(p => ({ employeeProfileId: p.id, projectId: p.projectId!, projectName: projectRows.find(x => x.id === p.projectId)?.name ?? null, joinedAt: p.joinedAt ? chinaBusinessDate(p.joinedAt) : null, leftAt: p.leftAt ? chinaBusinessDate(p.leftAt) : null, workerId: p.laborWorkerId! }));
  const [attendanceRows, compensation, insuranceRows, vehicleRows, machineRows] = await Promise.all([
    workerIds.length ? db.select().from(s.attendanceRecords).where(inArray(s.attendanceRecords.workerId, workerIds)) : [],
    getLegacyCompensation(db, { profileIds, workerIds, period }),
    profileIds.length ? db.select().from(s.employeeInsurancePolicies).where(inArray(s.employeeInsurancePolicies.employeeProfileId, profileIds)) : [],
    db.select({ id: s.transportVehicles.id, projectId: s.transportVehicles.projectId, plateNo: s.transportVehicles.plateNo, driverPersonId: s.transportVehicles.driverPersonId, driverUserId: s.transportVehicles.driverUserId }).from(s.transportVehicles).where(raw.userId ? or(eq(s.transportVehicles.driverPersonId, personId), eq(s.transportVehicles.driverUserId, raw.userId)) : eq(s.transportVehicles.driverPersonId, personId)),
    db.select({ id: s.machines.id, projectId: s.machines.projectId, code: s.machines.code, name: s.machines.name, operatorPersonId: s.machines.operatorPersonId, operatorUserId: s.machines.operatorUserId }).from(s.machines).where(raw.userId ? or(eq(s.machines.operatorPersonId, personId), eq(s.machines.operatorUserId, raw.userId)) : eq(s.machines.operatorPersonId, personId)),
  ]);
  const rows = attendanceRows.filter(row => !period || chinaBusinessDate(row.attendanceDate).startsWith(period));
  const salary = currentPersonnelSalary(salaryHistory); const positionName = positions.find(x => x.id === raw.primaryPositionId)?.name ?? null;
  return { person: { ...safePersonnel(raw, mappedAvatarDocumentId(raw, documents)), payrollEnabled: salary?.payrollEnabled ?? raw.payrollEnabled, positionName, secondaryPositionNames: raw.secondaryPositionIds.map(id => positions.find(x => x.id === id)?.name).filter((x): x is string => !!x), projectName: projectRows.find(x => x.id === raw.projectId)?.name ?? null, teamName: teamRows.find(x => x.id === raw.teamId)?.name ?? null, salaryBasis: salary?.salaryBasis ?? null, baseSalary: salary?.baseSalary ?? null }, sourceLinks, assignments, salaryHistory, payrollSubjects,
    attendance: { rows, days: new Set(rows.map(r => chinaBusinessDate(r.attendanceDate))).size, workHours: rows.reduce((n, r) => n + Number(r.workHours), 0), overtimeHours: rows.reduce((n, r) => n + Number(r.overtimeHours), 0) }, compensation,
    resources: { vehicles: vehicleRows, machines: machineRows, history: resourceHistory }, documents,
    changes, insurance: insuranceRows.map(row => ({ id: row.id, employeeProfileId: row.employeeProfileId, insuranceType: row.insuranceType, providerName: row.providerName, premiumAmount: row.premiumAmount, coverageAmount: row.coverageAmount, purchasedAt: row.purchasedAt, expiresAt: row.expiresAt, status: row.status, evidenceId: row.evidenceId, hasAttachment: !!row.evidenceId, remarks: row.remarks })) };
}
export async function saveDirectoryPosition(input: typeof personnelPositionInput._output) {
  const db = await requirePersonnelDb();
  try { if (input.id) { const result = await db.update(s.personnelPositions).set({ name: input.name, category: input.category, ...(input.status !== undefined ? { status: input.status } : {}) }).where(eq(s.personnelPositions.id, input.id)); if (!affected(result)) { const [row] = await db.select().from(s.personnelPositions).where(eq(s.personnelPositions.id, input.id)); if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "岗位不存在" }); } return { success: true as const, id: input.id }; }
    const [result] = await db.insert(s.personnelPositions).values(input); return { success: true as const, id: Number(result.insertId) };
  } catch (error) { if (duplicate(error)) throw new TRPCError({ code: "CONFLICT", message: "同名岗位已存在" }); throw error; }
}
export async function saveDirectoryTeam(input: typeof personnelTeamInput._output) {
  const db = await requirePersonnelDb();
  return db.transaction(async tx => {
    const [project] = await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, input.projectId)).limit(1); if (!project) throw new TRPCError({ code: "BAD_REQUEST", message: "所选项目不存在" });
    if (input.id) { const [team] = await tx.select().from(s.personnelTeams).where(eq(s.personnelTeams.id, input.id)).limit(1); if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "施工队不存在" }); if (team.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "施工队项目不能直接变更，请在目标项目新建施工队" }); await tx.update(s.personnelTeams).set(Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "id" && v !== undefined))).where(eq(s.personnelTeams.id, input.id)); return { success: true as const, id: input.id }; }
    const [result] = await tx.insert(s.personnelTeams).values(input); return { success: true as const, id: Number(result.insertId) };
  });
}

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export function decodePersonnelDocument(base64: string, mimeType: "image/jpeg" | "image/png" | "application/pdf") {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: "附件编码无效" });
  const bytes = Buffer.from(base64, "base64"); if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES || bytes.toString("base64") !== base64) throw new TRPCError({ code: "BAD_REQUEST", message: "附件为空、编码无效或超过8MB" });
  try { assertCertificateFileSignature(bytes, mimeType); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "附件内容与声明类型不符，仅支持JPEG、PNG和PDF" }); } return bytes;
}
export async function uploadPersonnelDocument(rawInput: typeof personnelDocumentInput._output, actorId: number) {
  const input = personnelDocumentInput.parse(rawInput);
  const db = await requirePersonnelDb(); const person = await findPersonnel(db, input.personId); const bytes = decodePersonnelDocument(input.base64Data, input.mimeType);
  // 现通用storage代理是公开的，故只上传AES-GCM密文，绝不上传敏感原件。
  const stored = await storagePut(`personnel-private/${randomUUID()}.encrypted`, encryptSecret(bytes.toString("base64")), "application/octet-stream");
  return db.transaction(async tx => {
    const current = await findPersonnel(tx, person.id); if (current.version !== person.version) throw new TRPCError({ code: "CONFLICT", message: "上传时档案发生变化，请刷新后重试" });
    const [evidence] = await tx.insert(s.evidenceRecords).values({ projectId: person.projectId, sourceType: "personnel_private", sourceId: String(person.id), fileKey: stored.key, fileName: path.basename(input.fileName).replace(/[\r\n]/g, ""), mimeType: input.mimeType, contentSha256: createHash("sha256").update(bytes).digest("hex"), contentBytes: bytes.length, uploadedBy: actorId });
    const [document] = await tx.insert(s.personnelDocuments).values({ personId: person.id, projectId: person.projectId, documentType: input.documentType, name: input.name, expiresAt: input.expiresAt, evidenceId: Number(evidence.insertId), createdBy: actorId });
    const version = person.version + (input.documentType === "portrait" ? 1 : 0);
    const changes: Record<string, { before: unknown; after: unknown }> = { document: { before: null, after: { id: Number(document.insertId), name: input.name, documentType: input.documentType } } };
    if (input.documentType === "portrait") {
      const priorDocuments = await tx.select().from(s.personnelDocuments).where(eq(s.personnelDocuments.personId, person.id));
      changes.avatarDocumentId = { before: mappedAvatarDocumentId(person, priorDocuments), after: Number(document.insertId) };
      const result = await tx.update(s.personnelPeople).set({ avatarEvidenceId: Number(evidence.insertId), version, updatedBy: actorId }).where(and(eq(s.personnelPeople.id, person.id), eq(s.personnelPeople.version, person.version)));
      if (!affected(result)) throw new TRPCError({ code: "CONFLICT", message: "头像上传时档案发生变化，请刷新后重试" });
    }
    await tx.insert(s.personnelChanges).values({ personId: person.id, action: "upload_document", version, changes, createdBy: actorId });
    return { success: true as const, id: Number(document.insertId), version, ...(input.documentType === "portrait" ? { avatarDocumentId: Number(document.insertId) } : {}) };
  });
}
async function authorizedDocument(db: ReadDb, personId: number, documentId: number) {
  await findPersonnel(db, personId);
  const [doc] = await db.select().from(s.personnelDocuments).where(and(eq(s.personnelDocuments.id, documentId), eq(s.personnelDocuments.personId, personId))).limit(1);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "附件不属于该人员" });
  const [evidence] = await db.select().from(s.evidenceRecords).where(eq(s.evidenceRecords.id, doc.evidenceId)).limit(1);
  if (!evidence || evidence.status !== "active" || evidence.sourceType !== "personnel_private" || evidence.sourceId !== String(personId) || evidence.projectId !== doc.projectId || !evidence.fileKey.startsWith("personnel-private/") || !["image/jpeg", "image/png", "application/pdf"].includes(evidence.mimeType ?? "") || !evidence.contentBytes || evidence.contentBytes > MAX_DOCUMENT_BYTES || doc.documentType === "portrait" && !["image/jpeg", "image/png"].includes(evidence.mimeType ?? "")) throw new TRPCError({ code: "FORBIDDEN", message: "附件来源或项目授权不一致，不能预览" });
  return evidence;
}
const MAX_LEGACY_INSURANCE_BYTES = 15 * 1024 * 1024;
async function assertPersonProfile(db: ReadDb, person: Person, profileId: number) {
  const links = await db.select().from(s.personnelSourceLinks).where(and(eq(s.personnelSourceLinks.sourceType, "profile"), eq(s.personnelSourceLinks.sourceId, profileId)));
  if (links.some(link => link.personId !== person.id) || !links.some(link => link.personId === person.id) && person.legacyProfileId !== profileId) throw new TRPCError({ code: "FORBIDDEN", message: "保单或工资主体不属于该人员的真实历史主体" });
  const [profile] = await db.select().from(s.employeeProfiles).where(eq(s.employeeProfiles.id, profileId)).limit(1);
  if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "历史员工主体不存在" });
  return profile;
}
/** 期间内的真实旧主体；多项目/多profile明确要求选择，绝不猜今天pointer。 */
export async function resolvePersonnelPayrollProfile(input: { personId: number; period: string; employeeProfileId?: number; projectId?: number }) {
  const db = await requirePersonnelDb(); const person = await findPersonnel(db, input.personId);
  const [links, history] = await Promise.all([db.select().from(s.personnelSourceLinks).where(eq(s.personnelSourceLinks.personId, person.id)), db.select().from(s.personnelSalaryHistory).where(eq(s.personnelSalaryHistory.personId, person.id))]);
  const ids = Array.from(new Set([...links.filter(x => x.sourceType === "profile").map(x => x.sourceId), ...(person.legacyProfileId ? [person.legacyProfileId] : [])]));
  if (input.employeeProfileId && !ids.includes(input.employeeProfileId)) throw new TRPCError({ code: "FORBIDDEN", message: "所选工资主体不属于该人员" });
  const start = `${input.period}-01`; const end = chinaBusinessDate(new Date(Date.UTC(Number(input.period.slice(0, 4)), Number(input.period.slice(5)), 0)));
  const versions = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const eligibleRanges = versions.map((v, i) => ({ ...v, endExclusive: versions[i + 1]?.effectiveFrom ?? "9999-12-31" })).filter(v => v.payrollEnabled && v.affiliation !== "external" && v.affiliation !== "temporary" && v.effectiveFrom <= end && v.endExclusive > start);
  if (!eligibleRanges.length) throw new TRPCError({ code: "BAD_REQUEST", message: "所选期间没有启用公司/施工队月度工资的生效薪资历史；外部费用和临时日结不能生成月薪" });
  const profiles = ids.length ? await db.select().from(s.employeeProfiles).where(inArray(s.employeeProfiles.id, ids)) : [];
  const candidates = profiles.filter(p => p.projectId && p.laborWorkerId && (!input.employeeProfileId || p.id === input.employeeProfileId) && (!input.projectId || p.projectId === input.projectId) && eligibleRanges.some(v => {
    const rangeStart = [start, v.effectiveFrom, p.joinedAt ? chinaBusinessDate(p.joinedAt) : start].sort().at(-1)!;
    const rangeEnd = [end, p.leftAt ? chinaBusinessDate(p.leftAt) : end].sort()[0];
    return rangeStart <= rangeEnd && rangeStart < v.endExclusive;
  }));
  if (!candidates.length) throw new TRPCError({ code: "BAD_REQUEST", message: "所选期间缺少有效项目与考勤工资主体，请核实历史档案" });
  if (candidates.length !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `所选期间有多个真实工资主体，请明确选择employeeProfileId：${candidates.map(p => `${p.id}(项目${p.projectId})`).join("、")}` });
  await assertPersonProfile(db, person, candidates[0].id);
  return candidates[0].id;
}
/** 保留原保险字段校验/审计语义，但原caller不支持tx；主档CAS、保险与审计必须原子。 */
export async function savePersonnelInsurance(rawInput: typeof personnelInsuranceInput._output, actorId: number) {
  const input = personnelInsuranceInput.parse(rawInput); const db = await requirePersonnelDb();
  return db.transaction(async tx => {
    const person = await findPersonnel(tx, input.personId);
    if (person.version !== input.version) throw new TRPCError({ code: "CONFLICT", message: "人员档案已变化，请刷新后重试" });
    const version = person.version + 1;
    const cas = await tx.update(s.personnelPeople).set({ version, updatedBy: actorId }).where(and(eq(s.personnelPeople.id, person.id), eq(s.personnelPeople.version, input.version)));
    if (!affected(cas)) throw new TRPCError({ code: "CONFLICT", message: "保险登记版本冲突，请刷新后重试" });
    const [existing] = input.id ? await tx.select().from(s.employeeInsurancePolicies).where(eq(s.employeeInsurancePolicies.id, input.id)).limit(1) : [];
    if (input.id && !existing) throw new TRPCError({ code: "NOT_FOUND", message: "保单不存在，不能覆盖" });
    let profile: typeof s.employeeProfiles.$inferSelect | undefined;
    if (existing) profile = await assertPersonProfile(tx, person, existing.employeeProfileId);
    else if (person.legacyProfileId) profile = await assertPersonProfile(tx, person, person.legacyProfileId);
    if (!existing && (!profile || profile.projectId !== person.projectId)) {
      const linked = await tx.select().from(s.personnelSourceLinks).where(and(eq(s.personnelSourceLinks.personId, person.id), eq(s.personnelSourceLinks.sourceType, "profile")));
      const candidates = linked.length ? (await tx.select().from(s.employeeProfiles).where(inArray(s.employeeProfiles.id, linked.map(x => x.sourceId)))).filter(p => p.projectId === person.projectId) : [];
      if (candidates.length > 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前项目存在多个真实保险主体，请先明确当前主档保险主体，不能猜身份" });
      if (candidates.length === 1) profile = await assertPersonProfile(tx, person, candidates[0].id);
    }
    if (!existing && (!profile || profile.projectId !== person.projectId)) {
      if (!person.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "登记新保险须先将人员分配至真实项目" });
      const [project] = await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, person.projectId)).limit(1);
      if (!project) throw new TRPCError({ code: "BAD_REQUEST", message: "保险所属项目不存在" });
      // 只建保险元数据主体，无账号/worker/工资金额/权限；历史主体保持原项目与记录。
      const [created] = await tx.insert(s.employeeProfiles).values({ userId: null, laborWorkerId: null, projectId: person.projectId, employeeType: person.affiliation === "temporary" || person.affiliation === "labor_team" ? "construction_worker" : "management", employmentStatus: person.employmentStatus, salaryBasis: "monthly", baseSalary: null });
      const profileId = Number(created.insertId);
      await tx.insert(s.personnelSourceLinks).values({ personId: person.id, sourceType: "profile", sourceId: profileId, createdBy: actorId });
      if (!person.legacyProfileId) await tx.update(s.personnelPeople).set({ legacyProfileId: profileId }).where(eq(s.personnelPeople.id, person.id));
      profile = await assertPersonProfile(tx, { ...person, legacyProfileId: profileId }, profileId);
    }
    if (!profile) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少真实保险主体" });
    const retained = <K extends "providerName" | "policyReference" | "evidenceId" | "premiumAmount" | "coverageAmount" | "remarks">(key: K) => input[key] === undefined ? existing?.[key] ?? null : input[key];
    const evidenceId = retained("evidenceId");
    if (evidenceId) {
      const [evidence] = await tx.select().from(s.evidenceRecords).where(eq(s.evidenceRecords.id, Number(evidenceId))).limit(1);
      if (!evidence || evidence.status !== "active" || evidence.sourceType !== "employee_insurance_policy" || evidence.sourceId !== String(profile.id) || evidence.projectId !== profile.projectId) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件不属于该真实员工主体；新加密保险附件请在人员文档中维护" });
    }
    const values = { employeeProfileId: profile.id, insuranceType: input.insuranceType, providerName: retained("providerName") as string | null, policyReference: retained("policyReference") as string | null, evidenceId: evidenceId as number | null, premiumAmount: retained("premiumAmount") === null ? null : String(retained("premiumAmount")), coverageAmount: retained("coverageAmount") === null ? null : String(retained("coverageAmount")), purchasedAt: new Date(`${input.purchasedAt}T00:00:00Z`), expiresAt: new Date(`${input.expiresAt}T00:00:00Z`), status: input.status, remarks: retained("remarks") as string | null };
    let policyId = existing?.id;
    if (existing) await tx.update(s.employeeInsurancePolicies).set(values).where(eq(s.employeeInsurancePolicies.id, existing.id));
    else { const [created] = await tx.insert(s.employeeInsurancePolicies).values(values); policyId = Number(created.insertId); }
    const safePolicy = (row: any) => row ? { id: policyId, employeeProfileId: row.employeeProfileId, insuranceType: row.insuranceType, providerName: row.providerName, premiumAmount: row.premiumAmount, coverageAmount: row.coverageAmount, purchasedAt: chinaBusinessDate(row.purchasedAt), expiresAt: chinaBusinessDate(row.expiresAt), status: row.status, remarks: row.remarks } : null;
    await tx.insert(s.personnelChanges).values({ personId: person.id, action: "save_insurance", version, changes: { insurance: { before: safePolicy(existing), after: safePolicy(values) } }, createdBy: actorId });
    await tx.insert(s.auditLogs).values({ userId: actorId, module: "personnel", action: existing ? "update_employee_insurance" : "create_employee_insurance", targetType: "employee_insurance", targetId: String(policyId), summary: `${existing ? "维护" : "登记"}员工保险：${input.insuranceType}` });
    return { success: true as const, id: policyId!, version };
  });
}
async function authorizedInsuranceDocument(db: ReadDb, personId: number, policyId: number) {
  const person = await findPersonnel(db, personId);
  const [policy] = await db.select().from(s.employeeInsurancePolicies).where(eq(s.employeeInsurancePolicies.id, policyId)).limit(1);
  if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "保单不存在" });
  const profile = await assertPersonProfile(db, person, policy.employeeProfileId);
  if (!profile || !policy.evidenceId) throw new TRPCError({ code: "NOT_FOUND", message: "保单缺少有效档案或附件" });
  const [evidence] = await db.select().from(s.evidenceRecords).where(eq(s.evidenceRecords.id, policy.evidenceId)).limit(1);
  if (!evidence || evidence.status !== "active" || evidence.sourceType !== "employee_insurance_policy" || evidence.sourceId !== String(profile.id) || evidence.projectId !== profile.projectId || !["image/jpeg", "image/png", "application/pdf"].includes(evidence.mimeType ?? "") || !evidence.contentBytes || evidence.contentBytes > MAX_LEGACY_INSURANCE_BYTES || !/^[a-f0-9]{64}$/.test(evidence.contentSha256 ?? "")) throw new TRPCError({ code: "FORBIDDEN", message: "保单附件来源或项目授权不一致，不能预览" });
  return evidence;
}
type PreviewTarget = { kind: "document"; documentId: number } | { kind: "insurance"; policyId: number };
const previewTokens = new Map<string, PreviewTarget & { actorId: number; personId: number; evidenceId: number; expires: number }>();
function issuePreviewToken(personId: number, actorId: number, evidence: typeof s.evidenceRecords.$inferSelect, target: PreviewTarget) {
  const now = Date.now();
  for (const [token, item] of Array.from(previewTokens.entries())) if (item.expires <= now) previewTokens.delete(token);
  if (previewTokens.size >= 1000) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "预览请求繁忙，请稍后重试" });
  const token = randomUUID().replace(/-/g, ""); const expires = now + 120_000; previewTokens.set(token, { ...target, actorId, personId, evidenceId: evidence.id, expires });
  return { url: `/api/personnel-documents/preview/${token}`, fileName: evidence.fileName, mimeType: evidence.mimeType, expiresAt: new Date(expires) };
}
export async function previewPersonnelDocument(personId: number, documentId: number, actorId: number) {
  const evidence = await authorizedDocument(await requirePersonnelDb(), personId, documentId);
  return issuePreviewToken(personId, actorId, evidence, { kind: "document", documentId });
}
export async function previewInsuranceDocument(personId: number, policyId: number, actorId: number) {
  const evidence = await authorizedInsuranceDocument(await requirePersonnelDb(), personId, policyId);
  return issuePreviewToken(personId, actorId, evidence, { kind: "insurance", policyId });
}
/** URL仅用于服务端拉取，绝不发给浏览器；远端流严格设上限。 */
async function readPersonnelStorage(fileKey: string, limit: number): Promise<Buffer> {
  if (ENV.selfHostStorageDir && !isAliyunOssPhotoStorageKey(fileKey)) {
    const root = path.resolve(ENV.selfHostStorageDir); const filePath = path.resolve(root, fileKey);
    if (!filePath.startsWith(root + path.sep)) throw new Error("invalid key");
    const bytes = await fs.readFile(filePath); if (bytes.length > limit) throw new Error("document too large"); return Buffer.from(bytes);
  }
  const signed = await storageGetSignedUrl(fileKey); if (!/^https:\/\//.test(signed)) throw new Error("invalid storage URL");
  const response = await fetch(signed, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error("document unavailable");
  if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error("document too large"); }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error("document too large"); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks, size);
}
/** 父代理在Express入口注册；令牌短时、单次、绑定登录用户，HTTP重验人员/证据来源。 */
export function registerPersonnelDocumentPreview(app: Express) {
  app.get("/api/personnel-documents/preview/:token", async (req, res) => {
    res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer");
    try {
      const item = previewTokens.get(String(req.params.token)); if (!item || item.expires <= Date.now()) { res.status(410).send("预览链接已过期，请重新打开"); return; }
      const ctx = await createContext({ req, res, info: {} as any }); const actor = await assertSuperAdmin(ctx); if (actor.id !== item.actorId) { res.status(403).send("附件预览未经授权"); return; }
      if (item.expires <= Date.now() || !previewTokens.delete(String(req.params.token))) { res.status(410).send("预览链接已过期或已使用，请重新打开"); return; }
      const db = await requirePersonnelDb();
      const evidence = item.kind === "document" ? await authorizedDocument(db, item.personId, item.documentId) : await authorizedInsuranceDocument(db, item.personId, item.policyId);
      if (evidence.id !== item.evidenceId) throw new TRPCError({ code: "FORBIDDEN", message: "附件关联已变化，请重新预览" });
      const stored = await readPersonnelStorage(evidence.fileKey, item.kind === "document" ? MAX_DOCUMENT_BYTES * 2 : MAX_LEGACY_INSURANCE_BYTES);
      const mimeType = evidence.mimeType as "image/jpeg" | "image/png" | "application/pdf";
      const bytes = item.kind === "document" ? decodePersonnelDocument(decryptSecret(stored.toString("utf8")), mimeType) : stored;
      assertCertificateFileSignature(bytes, mimeType);
      if (bytes.length !== evidence.contentBytes || createHash("sha256").update(bytes).digest("hex") !== evidence.contentSha256) throw new Error("document integrity failed");
      res.set("Cache-Control", "no-store"); res.set("Content-Type", evidence.mimeType!); res.set("X-Content-Type-Options", "nosniff"); res.set("Content-Disposition", "inline"); res.set("Content-Security-Policy", "sandbox"); res.send(bytes);
    } catch (error) { const status = error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code) ? 403 : 404; res.status(status).send("附件不可预览，请重新授权或联系管理员"); }
  });
}
