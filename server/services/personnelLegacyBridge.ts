import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import {
  employeeProfiles, employeePayrollAdvances, laborWorkers, users, userProfiles,
  personnelPeople, personnelSourceLinks, personnelSalaryHistory, personnelAssignments,
  personnelResourceBindings, personnelChanges, personnelTeams, personnelPositions, payrollStatements,
  temporaryDailyWageSettlements, settlementPaymentRecords, transportVehicles, machines,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { chinaBusinessDate } from "./chinaBusinessTime";
import { decryptSecret, fingerprintSecret, revealBusinessSecret } from "./secretVault";

export type BridgeDb = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select" | "insert" | "update">;
export type LegacySourceType = "user" | "profile" | "worker";
type Person = typeof personnelPeople.$inferSelect;
type Profile = typeof employeeProfiles.$inferSelect;
type Worker = typeof laborWorkers.$inferSelect;
export type LegacyCandidate = { sourceType: LegacySourceType; sourceId: number; name: string; projectId: number | null; linkedPersonId: number | null; userId: number | null; legacyProfileId: number | null; legacyWorkerId: number | null };
const key = (type: LegacySourceType, id: number) => `${type}:${id}`;
const conflict = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };
export function legacyDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
function secretFingerprint(cipher: string | null | undefined) { return cipher ? fingerprintSecret(decryptSecret(cipher)) : null; }
function businessValue(cipher: string | null | undefined) {
  try { return revealBusinessSecret(cipher); } catch { return null; }
}
function insertId(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const id = Number((header as { insertId?: number })?.insertId ?? 0);
  if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "保存未返回真实记录编号" });
  return id;
}

/** 只沿真实外键拓展。相同姓名、手机号、证件文本均不是自动归并依据。 */
export function resolveLegacyIdentityGraph(input: {
  sourceType: LegacySourceType; sourceId: number;
  profiles: Pick<Profile, "id" | "userId" | "laborWorkerId">[];
  userIds: number[]; workerIds: number[];
}) {
  const validUsers = new Set(input.userIds), validWorkers = new Set(input.workerIds);
  const found = input.sourceType === "user" ? validUsers.has(input.sourceId) : input.sourceType === "worker" ? validWorkers.has(input.sourceId) : input.profiles.some(p => p.id === input.sourceId);
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "历史人员来源不存在" });
  const nodes = new Map<string, { sourceType: LegacySourceType; sourceId: number }>();
  const add = (sourceType: LegacySourceType, sourceId: number) => nodes.set(key(sourceType, sourceId), { sourceType, sourceId });
  add(input.sourceType, input.sourceId);
  let changed = true;
  while (changed) {
    const before = nodes.size;
    for (const p of input.profiles) {
      if (!nodes.has(key("profile", p.id)) && !(p.userId && nodes.has(key("user", p.userId))) && !(p.laborWorkerId && nodes.has(key("worker", p.laborWorkerId)))) continue;
      add("profile", p.id);
      if (p.userId && validUsers.has(p.userId)) add("user", p.userId);
      if (p.laborWorkerId && validWorkers.has(p.laborWorkerId)) add("worker", p.laborWorkerId);
    }
    changed = nodes.size !== before;
  }
  if (Array.from(nodes.values()).filter(n => n.sourceType === "user").length > 1) conflict("历史关联连通多个不同账号，需人工核对真实身份，不能自动合并");
  return Array.from(nodes.values());
}

export async function listLegacyCandidates(db: BridgeDb, input: { projectIds?: number[]; hasAllProjects?: boolean; search?: string } = {}) {
  const [profiles, workers, accounts, links] = await Promise.all([
    db.select().from(employeeProfiles), db.select().from(laborWorkers),
    db.select({ id: users.id, name: users.name }).from(users), db.select().from(personnelSourceLinks),
  ]);
  const accountById = new Map(accounts.map(u => [u.id, u])), workerById = new Map(workers.map(w => [w.id, w]));
  const linkByKey = new Map(links.map(l => [key(l.sourceType, l.sourceId), l.personId]));
  const rows: LegacyCandidate[] = [
    ...profiles.map(p => ({ sourceType: "profile" as const, sourceId: p.id, name: (p.laborWorkerId ? workerById.get(p.laborWorkerId)?.realName : null) ?? (p.userId ? accountById.get(p.userId)?.name : null) ?? `历史员工档案 #${p.id}`, projectId: p.projectId, userId: p.userId, legacyProfileId: p.id, legacyWorkerId: p.laborWorkerId, linkedPersonId: linkByKey.get(key("profile", p.id)) ?? null })),
    ...workers.map(w => ({ sourceType: "worker" as const, sourceId: w.id, name: w.realName, projectId: w.projectId, userId: null, legacyProfileId: null, legacyWorkerId: w.id, linkedPersonId: linkByKey.get(key("worker", w.id)) ?? null })),
    ...accounts.map(u => ({ sourceType: "user" as const, sourceId: u.id, name: u.name ?? `账号 #${u.id}`, projectId: profiles.find(p => p.userId === u.id)?.projectId ?? null, userId: u.id, legacyProfileId: null, legacyWorkerId: null, linkedPersonId: linkByKey.get(key("user", u.id)) ?? null })),
  ];
  return rows.filter(r => (input.hasAllProjects || (r.projectId !== null && input.projectIds?.includes(r.projectId))) && (!input.search || r.name.includes(input.search.trim())));
}

async function attachSource(db: BridgeDb, personId: number, sourceType: LegacySourceType, sourceId: number, actorUserId: number) {
  const [existing] = await db.select().from(personnelSourceLinks).where(and(eq(personnelSourceLinks.sourceType, sourceType), eq(personnelSourceLinks.sourceId, sourceId))).limit(1);
  if (existing && existing.personId !== personId) conflict("历史来源已关联另一人员，请人工核对，不能自动合并");
  if (!existing) await db.insert(personnelSourceLinks).values({ personId, sourceType, sourceId, createdBy: actorUserId });
}

/** 调用者必须在人事授权、来源全部项目范围校验后开启事务；唯一来源索引使并发采用原子失败。 */
export async function adoptLegacy(db: BridgeDb, input: { sourceType: LegacySourceType; sourceId: number; actorUserId: number; projectIds?: number[]; hasAllProjects?: boolean }) {
  const [profiles, workers, accounts, links] = await Promise.all([
    db.select().from(employeeProfiles), db.select().from(laborWorkers),
    db.select({ id: users.id, name: users.name }).from(users), db.select().from(personnelSourceLinks),
  ]);
  const nodes = resolveLegacyIdentityGraph({ ...input, profiles, userIds: accounts.map(u => u.id), workerIds: workers.map(w => w.id) });
  const nodeKeys = new Set(nodes.map(n => key(n.sourceType, n.sourceId)));
  const relatedProfiles = profiles.filter(p => nodeKeys.has(key("profile", p.id))).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
  const relatedWorkers = workers.filter(w => nodeKeys.has(key("worker", w.id)));
  if (input.hasAllProjects === false && [...relatedProfiles, ...relatedWorkers].some(r => r.projectId === null || !input.projectIds?.includes(r.projectId))) throw new TRPCError({ code: "FORBIDDEN", message: "关联历史来源包含未授权项目，请由人事管理员核对" });
  const personIds = new Set(links.filter(l => nodeKeys.has(key(l.sourceType, l.sourceId))).map(l => l.personId));
  const userId = nodes.find(n => n.sourceType === "user")?.sourceId ?? null;
  if (userId) {
    const [known] = await db.select().from(personnelPeople).where(eq(personnelPeople.userId, userId)).limit(1);
    if (known) personIds.add(known.id);
  }
  if (personIds.size > 1) conflict("真实ID来源已归属不同统一人员，需人工核对，不能自动合并");
  let id = Array.from(personIds)[0];
  if (!id) {
    const profile = relatedProfiles[0];
    const worker = relatedWorkers.find(w => w.id === profile?.laborWorkerId) ?? relatedWorkers[0];
    const [userProfile] = userId ? await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1) : [];
    const affiliation = worker ? worker.workerCategory === "temporary_daily" ? "temporary" : worker.workerCategory === "company_admin" ? "company" : "labor_team" : "company";
    const phoneEncrypted = worker?.phoneEncrypted ?? userProfile?.phoneEncrypted ?? null;
    const bankAccountEncrypted = worker?.bankAccountEncrypted ?? userProfile?.bankAccountEncrypted ?? null;
    const values: typeof personnelPeople.$inferInsert = {
      personNo: `P-${randomUUID()}`, name: worker?.realName ?? accounts.find(u => u.id === userId)?.name ?? `历史员工档案 #${input.sourceId}`,
      affiliation, employmentStatus: profile?.employmentStatus ?? (worker?.attendanceStatus === "left" ? "left" : "active"),
      secondaryPositionIds: [], projectId: profile?.projectId ?? worker?.projectId ?? null,
      entryDate: legacyDate(profile?.joinedAt ?? worker?.entryDate), exitDate: legacyDate(profile?.leftAt ?? worker?.exitDate),
      payrollEnabled: Boolean(profile?.baseSalary !== null && profile?.baseSalary !== undefined && worker),
      userId, legacyProfileId: profile?.id ?? null, legacyWorkerId: worker?.id ?? null,
      phoneEncrypted, phoneFingerprint: worker?.phoneFingerprint ?? userProfile?.phoneFingerprint ?? null, phoneMasked: businessValue(phoneEncrypted),
      identityNoEncrypted: worker?.identityNoEncrypted ?? null, identityNoFingerprint: secretFingerprint(worker?.identityNoEncrypted), identityMasked: businessValue(worker?.identityNoEncrypted),
      bankAccountEncrypted, bankAccountFingerprint: secretFingerprint(bankAccountEncrypted), bankMasked: businessValue(bankAccountEncrypted), bankName: worker?.bankName ?? userProfile?.bankName ?? null,
      createdBy: input.actorUserId, updatedBy: input.actorUserId, version: 1,
    };
    id = insertId(await db.insert(personnelPeople).values(values));
    const effectiveFrom = legacyDate(profile?.joinedAt ?? worker?.entryDate ?? profile?.createdAt ?? worker?.createdAt) ?? chinaBusinessDate(new Date());
    await db.insert(personnelAssignments).values({ personId: id, affiliation, secondaryPositionIds: [], projectId: values.projectId, employmentStatus: values.employmentStatus!, effectiveFrom, version: 1, createdBy: input.actorUserId });
    if (profile) await db.insert(personnelSalaryHistory).values({ personId: id, affiliation, salaryBasis: profile.salaryBasis, baseSalary: profile.baseSalary, payrollEnabled: values.payrollEnabled!, effectiveFrom, createdBy: input.actorUserId });
    await db.insert(personnelChanges).values({ personId: id, action: "adopt_legacy", version: 1, changes: { source: { before: null, after: { sourceType: input.sourceType, sourceId: input.sourceId } } }, createdBy: input.actorUserId });
  }
  for (const n of nodes) await attachSource(db, id, n.sourceType, n.sourceId, input.actorUserId);
  return { success: true as const, id };
}

/** 未改/undefined/空文本保留；null 是显式清空。旧业务表单不得用空字符串误删敏感信息。 */
export function omitUnchangedLegacyFields<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

function priorDay(day: string) { return new Date(new Date(`${day}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10); }
function categoryFor(person: Person) { return person.affiliation === "company" ? "company_admin" as const : person.affiliation === "temporary" ? "temporary_daily" as const : "labor_team" as const; }
function affectedRows(result: any) { return Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0); }

/** 保留原source的全局唯一电话指纹；只有明确同master的别名才可共享密文，绝不按电话合并。 */
async function compatiblePhoneFingerprint(db: BridgeDb, person: Person, workerId: number | null) {
  if (!person.phoneFingerprint) return null;
  const workers = await db.select({ id: laborWorkers.id }).from(laborWorkers).where(eq(laborWorkers.phoneFingerprint, person.phoneFingerprint));
  const others = workers.filter(w => w.id !== workerId);
  if (others.length) {
    const links = await db.select().from(personnelSourceLinks).where(and(eq(personnelSourceLinks.sourceType, "worker"), inArray(personnelSourceLinks.sourceId, others.map(w => w.id))));
    if (others.some(w => !links.some(l => l.sourceType === "worker" && l.sourceId === w.id && l.personId === person.id))) conflict("手机号已被另一实名工资主体使用；不会按手机号合并或覆盖，请人工核对");
  }
  const accounts = await db.select({ userId: userProfiles.userId }).from(userProfiles).where(eq(userProfiles.phoneFingerprint, person.phoneFingerprint));
  if (accounts.some(a => a.userId !== person.userId)) conflict("手机号已被另一账号使用，请人工核对，不会修改登录身份");
  return others.length ? null : person.phoneFingerprint;
}

async function closeLegacyScope(db: BridgeDb, worker: Worker | undefined, profile: Profile | undefined, today: string, personId: number) {
  const end = priorDay(today); // profile工资有效范围为闭区间，转人当日属于新主体。
  const links = await db.select().from(personnelSourceLinks).where(eq(personnelSourceLinks.personId, personId));
  const workerIds = links.filter(l => l.personId === personId && l.sourceType === "worker").map(l => l.sourceId);
  const profileIds = links.filter(l => l.personId === personId && l.sourceType === "profile").map(l => l.sourceId);
  const workers = workerIds.length ? await db.select().from(laborWorkers).where(inArray(laborWorkers.id, workerIds)).for("update") : [];
  const profiles = profileIds.length ? await db.select().from(employeeProfiles).where(inArray(employeeProfiles.id, profileIds)).for("update") : [];
  // 同person已确认的历史重复别名也关闭本阶段，不能留下可反复计薪的幽灵任职范围。
  const stageWorkers = workers.filter(w => worker && w.projectId === worker.projectId && w.workerCategory === worker.workerCategory);
  if (worker && !stageWorkers.some(w => w.id === worker.id)) stageWorkers.push(worker);
  const stageWorkerIds = stageWorkers.map(w => w.id);
  const stageProfiles = profiles.filter(p => p.id === profile?.id || p.projectId === (worker?.projectId ?? profile?.projectId) && (p.laborWorkerId !== null ? stageWorkerIds.includes(p.laborWorkerId) : p.userId !== null && p.userId === profile?.userId));
  if (profile && !stageProfiles.some(p => p.id === profile.id)) stageProfiles.push(profile);
  for (const old of stageWorkers) if (!old.exitDate) await db.update(laborWorkers).set({ attendanceStatus: "left", exitDate: new Date(`${end}T00:00:00Z`) }).where(eq(laborWorkers.id, old.id));
  for (const old of stageProfiles) if (!old.leftAt) await db.update(employeeProfiles).set({ employmentStatus: "left", leftAt: new Date(`${end}T00:00:00Z`) }).where(eq(employeeProfiles.id, old.id));
}

/** 必须在core CAS同一事务内调用。锁master后准备新兼容主体，原主体/源链接/财务记录不搬迁、不克隆。 */
export async function ensureLegacyPayrollSubjects(db: BridgeDb, person: Person, actorUserId: number) {
  const [master] = await db.select().from(personnelPeople).where(eq(personnelPeople.id, person.id)).limit(1).for("update");
  if (!master || master.version !== person.version) conflict("人员版本已变更，请刷新后重试，不能并发创建重复工资主体");
  const today = chinaBusinessDate(new Date());
  let workerId = master.legacyWorkerId, profileId = master.legacyProfileId;
  const [worker] = workerId ? await db.select().from(laborWorkers).where(eq(laborWorkers.id, workerId)).limit(1).for("update") : [];
  const [profile] = profileId ? await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, profileId)).limit(1) : [];
  if (workerId && !worker || profileId && !profile) conflict("已关联的工资主体不存在，不能自动替换历史主体");
  if (profile && (profile.laborWorkerId !== null && profile.laborWorkerId !== workerId || profile.userId !== null && profile.userId !== person.userId)) conflict("历史员工档案身份与统一人员不一致，不能替换历史工资关联");
  if (workerId) await attachSource(db, person.id, "worker", workerId, actorUserId);
  if (profileId) await attachSource(db, person.id, "profile", profileId, actorUserId);
  if (!person.payrollEnabled || person.affiliation === "external") {
    if (person.payrollEnabled && person.affiliation === "external") throw new TRPCError({ code: "BAD_REQUEST", message: "外部人员的运费或租金不属于人员工资，不能创建计薪主体" });
    const histories = await db.select().from(personnelSalaryHistory).where(eq(personnelSalaryHistory.personId, person.id));
    // 未来首次开启所准备的主体不会被当前false开关提前关闭；真实关闭保留旧主体作历史查询。
    const futureSubject = Boolean(legacyDate(worker?.entryDate) && legacyDate(worker?.entryDate)! > today || legacyDate(profile?.joinedAt) && legacyDate(profile?.joinedAt)! > today);
    if (!futureSubject && (person.affiliation === "external" || histories.some(h => h.payrollEnabled && h.effectiveFrom <= today))) await closeLegacyScope(db, worker, profile, today, person.id);
    return { legacyProfileId: profileId, legacyWorkerId: workerId };
  }
  if (!person.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "启用工资前必须指定归属项目" });
  const workerCategory = categoryFor(person);
  const transition = Boolean(worker && (worker.projectId !== person.projectId || worker.workerCategory !== workerCategory || worker.exitDate) || profile && (profile.projectId !== null && profile.projectId !== person.projectId || profile.leftAt));
  if (transition) { await closeLegacyScope(db, worker, profile, today, person.id); workerId = null; profileId = null; }
  const salaryRows = !master.payrollEnabled ? await db.select().from(personnelSalaryHistory).where(eq(personnelSalaryHistory.personId, person.id)) : [];
  const futureStart = salaryRows.filter(h => h.payrollEnabled && h.affiliation === person.affiliation && h.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]?.effectiveFrom;
  const joinedAt = futureStart ?? (transition ? today : person.entryDate ?? today);
  if (!workerId) {
    const phoneFingerprint = await compatiblePhoneFingerprint(db, person, null);
    workerId = insertId(await db.insert(laborWorkers).values({ projectId: person.projectId, workerCategory, realName: person.name, attendanceStatus: person.employmentStatus === "left" ? "left" : "active", entryDate: new Date(`${joinedAt}T00:00:00Z`), phoneEncrypted: person.phoneEncrypted, phoneFingerprint, identityNoEncrypted: person.identityNoEncrypted, bankAccountEncrypted: person.bankAccountEncrypted, bankName: person.bankName }));
    await attachSource(db, person.id, "worker", workerId, actorUserId);
  }
  if (!profileId) {
    profileId = insertId(await db.insert(employeeProfiles).values({ userId: person.userId, laborWorkerId: workerId, projectId: person.projectId, employeeType: person.affiliation === "company" ? "management" : "construction_worker", employmentStatus: person.employmentStatus, joinedAt: new Date(`${joinedAt}T00:00:00Z`), salaryBasis: person.affiliation === "temporary" ? "daily" : "monthly" }));
    await attachSource(db, person.id, "profile", profileId, actorUserId);
  } else if (profile?.laborWorkerId === null || profile?.projectId === null) {
    // 仅补首次采用的缺失外键，不移动已存在主体。
    await db.update(employeeProfiles).set({ laborWorkerId: workerId, projectId: person.projectId }).where(eq(employeeProfiles.id, profileId));
  }
  if (master.legacyProfileId !== profileId || master.legacyWorkerId !== workerId) {
    const result = await db.update(personnelPeople).set({ legacyProfileId: profileId, legacyWorkerId: workerId }).where(and(eq(personnelPeople.id, person.id), eq(personnelPeople.version, person.version)));
    if (!affectedRows(result)) conflict("人员版本冲突，工资主体创建必须同事务回滚");
  }
  return { legacyProfileId: profileId, legacyWorkerId: workerId };
}

export async function syncLegacyMirrors(db: BridgeDb, person: Person) {
  const pointers = await ensureLegacyPayrollSubjects(db, person, person.updatedBy ?? person.createdBy);
  person = { ...person, ...pointers };
  if (person.legacyWorkerId && person.affiliation !== "external") {
    const phoneFingerprint = await compatiblePhoneFingerprint(db, person, person.legacyWorkerId);
    const [team] = person.teamId ? await db.select({ name: personnelTeams.name }).from(personnelTeams).where(eq(personnelTeams.id, person.teamId)).limit(1) : [];
    const [worker] = await db.select().from(laborWorkers).where(eq(laborWorkers.id, person.legacyWorkerId)).limit(1);
    if (!worker) conflict("当前工资主体不存在");
    if (!worker.exitDate && worker.projectId === person.projectId && worker.workerCategory === categoryFor(person)) await db.update(laborWorkers).set({ realName: person.name, teamName: team?.name ?? worker.teamName, phoneEncrypted: person.phoneEncrypted, phoneFingerprint, identityNoEncrypted: person.identityNoEncrypted, bankAccountEncrypted: person.bankAccountEncrypted, bankName: person.bankName, attendanceStatus: person.employmentStatus === "left" ? "left" : person.employmentStatus === "active" ? "active" : "pending", exitDate: person.exitDate ? new Date(`${person.exitDate}T00:00:00Z`) : null }).where(eq(laborWorkers.id, person.legacyWorkerId));
  }
  if (person.legacyProfileId && person.affiliation !== "external") {
    const [profile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, person.legacyProfileId)).limit(1);
    if (!profile) conflict("当前员工兼容档案不存在");
    const histories = await db.select().from(personnelSalaryHistory).where(eq(personnelSalaryHistory.personId, person.id));
    const current = histories.filter(h => h.effectiveFrom <= chinaBusinessDate(new Date())).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (!profile.leftAt && profile.projectId === person.projectId) await db.update(employeeProfiles).set({ employmentStatus: person.employmentStatus, leftAt: person.exitDate ? new Date(`${person.exitDate}T00:00:00Z`) : null, ...(current ? { salaryBasis: current.salaryBasis, baseSalary: current.baseSalary } : {}) }).where(eq(employeeProfiles.id, person.legacyProfileId));
  }
  // 当前资源展示mirror可更新，历史运单、作业姓名快照与登录授权绝不改写。
  const resourceContact = { driverName: person.name, driverPhoneEncrypted: person.phoneEncrypted, driverPhoneMasked: person.phoneMasked };
  await db.update(transportVehicles).set(resourceContact).where(eq(transportVehicles.driverPersonId, person.id));
  await db.update(machines).set(resourceContact).where(eq(machines.operatorPersonId, person.id));
}

/** 旧模块仅允许维护本域字段；已统一的核心字段一旦变化必须走人事版本/历史保存。 */
export async function assertLegacyCoreEditSafe(db: BridgeDb, sourceType: "profile" | "worker", sourceId: number, incoming: Record<string, unknown>, existing: Record<string, unknown>) {
  const [link] = await db.select().from(personnelSourceLinks).where(and(eq(personnelSourceLinks.sourceType, sourceType), eq(personnelSourceLinks.sourceId, sourceId))).limit(1);
  if (!link || link.sourceType !== sourceType || link.sourceId !== sourceId) return;
  const fields = sourceType === "worker" ? ["realName", "projectId", "workerCategory", "teamName", "phone", "identityNo", "bankAccount", "bankName", "entryDate", "exitDate", "attendanceStatus"] : ["userId", "laborWorkerId", "projectId", "employeeType", "tradeName", "teamName", "employmentStatus", "joinedAt", "leftAt", "salaryBasis", "baseSalary", "phoneNumber", "bankAccount", "bankName"];
  for (const field of fields) {
    const value = incoming[field];
    if (value === undefined || value === "") continue;
    let prior = existing[field];
    if (field === "phone" || field === "phoneNumber") prior = existing.phoneEncrypted ? decryptSecret(String(existing.phoneEncrypted)).replace(/[\s\-()]/g, "") : null;
    if (field === "identityNo") prior = existing.identityNoEncrypted ? decryptSecret(String(existing.identityNoEncrypted)) : null;
    if (field === "bankAccount") prior = existing.bankAccountEncrypted ? decryptSecret(String(existing.bankAccountEncrypted)) : null;
    const normalize = (v: unknown) => v instanceof Date ? legacyDate(v) : v === null || v === undefined ? null : String(v);
    if (normalize(value) !== normalize(prior)) throw new TRPCError({ code: "FORBIDDEN", message: "该人员已纳入统一人事档案；核心身份、归属、薪资或联系方式请通过人员档案入口维护，业务权限不能越权修改主档" });
  }
}

export async function getLegacyCompensation(db: BridgeDb, input: { profileIds: number[]; workerIds: number[]; period?: string }) {
  const [payroll, dailyWage, advances] = await Promise.all([
    input.workerIds.length ? db.select().from(payrollStatements).where(and(inArray(payrollStatements.workerId, input.workerIds), input.period ? eq(payrollStatements.period, input.period) : undefined)) : [],
    input.workerIds.length ? db.select().from(temporaryDailyWageSettlements).where(inArray(temporaryDailyWageSettlements.workerId, input.workerIds)) : [],
    input.profileIds.length ? db.select().from(employeePayrollAdvances).where(inArray(employeePayrollAdvances.employeeProfileId, input.profileIds)) : [],
  ]);
  const dailyRows = dailyWage.filter(r => !input.period || legacyDate(r.settlementDate)?.startsWith(input.period));
  const filters = [payroll.length ? and(eq(settlementPaymentRecords.settlementType, "payroll"), inArray(settlementPaymentRecords.settlementId, payroll.map(p => p.id))) : undefined, dailyRows.length ? and(eq(settlementPaymentRecords.settlementType, "daily_wage"), inArray(settlementPaymentRecords.settlementId, dailyRows.map(p => p.id))) : undefined].filter(Boolean);
  const records = filters.length ? await db.select({ id: settlementPaymentRecords.id, projectId: settlementPaymentRecords.projectId, settlementType: settlementPaymentRecords.settlementType, settlementId: settlementPaymentRecords.settlementId, amount: settlementPaymentRecords.amount, direction: settlementPaymentRecords.direction, paymentDate: settlementPaymentRecords.paymentDate, paymentMethod: settlementPaymentRecords.paymentMethod, status: settlementPaymentRecords.status, paidAt: settlementPaymentRecords.paidAt }).from(settlementPaymentRecords).where(or(...filters)) : [];
  const paid = (type: "payroll" | "daily_wage", id: number) => Math.round(records.filter(r => r.settlementType === type && r.settlementId === id && r.status === "active" && r.direction === "expense").reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  return { payroll: payroll.map(p => ({ ...p, paymentReference: undefined, paidAmount: paid("payroll", p.id) })), dailyWage: dailyRows.map(p => ({ ...p, paymentReference: undefined, paidAmount: paid("daily_wage", p.id) })), advances: advances.filter(a => !input.period || legacyDate(a.advanceDate)?.startsWith(input.period)), payments: records };
}

export function resolveResourceLoginBinding(personUserId: number | null, previousUserId: number | null, requestedUserId?: number | null) {
  if (requestedUserId !== undefined && requestedUserId !== null && requestedUserId !== personUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "登录账号不是所选人员的真实关联账号，不能保留或授予他人的门户权限" });
  return requestedUserId === undefined ? previousUserId === personUserId ? previousUserId : null : requestedUserId;
}
export async function resolveResourcePerson(db: BridgeDb, input: { personId: number | null; projectId: number; previousUserId: number | null; requestedUserId?: number | null; assetType?: "vehicle" | "machine" }) {
  if (!input.personId) return { personId: null, userId: input.requestedUserId === undefined ? null : input.requestedUserId, name: null, phoneEncrypted: null, phoneMasked: null };
  const [person] = await db.select().from(personnelPeople).where(eq(personnelPeople.id, input.personId)).limit(1);
  if (!person || person.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "所选人员不存在或不属于当前资源项目" });
  const positionIds = Array.from(new Set([person.primaryPositionId, ...(person.secondaryPositionIds ?? [])].filter((id): id is number => id !== null)));
  const positions = positionIds.length ? await db.select().from(personnelPositions).where(inArray(personnelPositions.id, positionIds)) : [];
  const required = input.assetType === "machine" ? ["operator", "driver"] : ["driver"];
  if (input.assetType && !positions.some(p => p.status === "active" && required.includes(p.category))) throw new TRPCError({ code: "BAD_REQUEST", message: "所选人员没有启用中的对应司机/操作员岗位" });
  if (person.employmentStatus !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "已离场人员不能新绑定当前资源" });
  return { personId: person.id, userId: resolveResourceLoginBinding(person.userId, input.previousUserId, input.requestedUserId), name: person.name, phoneEncrypted: person.phoneEncrypted, phoneMasked: person.phoneMasked };
}

/** asset行锁串行同日换班；append事件按createdAt/id排序，旧记录只关闭范围、不删除或覆盖人员。仅今日即时。 */
export async function saveResourceBinding(db: BridgeDb, input: { personId: number | null; assetType: "vehicle" | "machine"; assetId: number; effectiveFrom: string; effectiveTo?: string | null; actorUserId: number; projectId: number; requestedUserId?: number | null }) {
  const today = chinaBusinessDate(new Date());
  if (input.effectiveFrom !== today || input.effectiveTo) throw new TRPCError({ code: "BAD_REQUEST", message: "当前资源换人仅支持今日即时生效，不会将未来或过去绑定误写为当前授权" });
  const asset = input.assetType === "vehicle" ? (await db.select().from(transportVehicles).where(eq(transportVehicles.id, input.assetId)).limit(1).for("update"))[0] : (await db.select().from(machines).where(eq(machines.id, input.assetId)).limit(1).for("update"))[0];
  if (!asset || asset.projectId !== input.projectId) throw new TRPCError({ code: "CONFLICT", message: "资源项目已变更，请刷新后重试" });
  const oldPersonId = "driverPersonId" in asset ? asset.driverPersonId : asset.operatorPersonId;
  const oldUserId = "driverUserId" in asset ? asset.driverUserId : asset.operatorUserId;
  const resolved = await resolveResourcePerson(db, { ...input, previousUserId: oldUserId });
  if (oldPersonId !== input.personId) {
    const histories = await db.select().from(personnelResourceBindings).where(and(eq(personnelResourceBindings.assetType, input.assetType), eq(personnelResourceBindings.assetId, input.assetId))).for("update");
    if (histories.some(h => h.effectiveFrom > today)) conflict("资源存在未来绑定历史，请人工核对；当前入口仅支持今日即时换班");
    if (oldPersonId && !histories.some(h => h.personId === oldPersonId && !h.effectiveTo)) {
      const baseline = legacyDate(asset.createdAt) ?? today;
      await db.insert(personnelResourceBindings).values({ personId: oldPersonId, assetType: input.assetType, assetId: input.assetId, projectId: input.projectId, effectiveFrom: baseline, effectiveTo: today, createdAt: asset.createdAt ?? new Date(), createdBy: input.actorUserId });
    }
    await db.update(personnelResourceBindings).set({ effectiveTo: today }).where(and(eq(personnelResourceBindings.assetType, input.assetType), eq(personnelResourceBindings.assetId, input.assetId), isNull(personnelResourceBindings.effectiveTo)));
    if (input.personId) await db.insert(personnelResourceBindings).values({ personId: input.personId, assetType: input.assetType, assetId: input.assetId, projectId: input.projectId, effectiveFrom: today, createdAt: new Date(), createdBy: input.actorUserId });
  }
  if (oldPersonId !== resolved.personId || oldUserId !== resolved.userId) {
    // Resource history无账号字段，在既有变更日志保留真实旧登录关联；绝不改users/rolePermissions。
    const ids = Array.from(new Set([oldPersonId, resolved.personId].filter((id): id is number => id !== null && id !== undefined)));
    for (const personId of ids) {
      const [subject] = await db.select().from(personnelPeople).where(eq(personnelPeople.id, personId)).limit(1);
      if (!subject) conflict("资源原绑定人员不存在，不能丢失其历史登录关联");
      await db.insert(personnelChanges).values({ personId, action: "resource_binding", version: subject.version, changes: { resourceBinding: { before: { assetType: input.assetType, assetId: input.assetId, projectId: input.projectId, personId: oldPersonId, userId: oldUserId }, after: { assetType: input.assetType, assetId: input.assetId, projectId: input.projectId, personId: resolved.personId, userId: resolved.userId } } }, createdBy: input.actorUserId, createdAt: new Date() });
    }
  }
  const contacts = { driverName: resolved.name, driverPhoneEncrypted: resolved.phoneEncrypted, driverPhoneMasked: resolved.phoneMasked };
  if (input.assetType === "vehicle") await db.update(transportVehicles).set({ ...contacts, driverPersonId: resolved.personId, driverUserId: resolved.userId }).where(and(eq(transportVehicles.id, input.assetId), eq(transportVehicles.projectId, input.projectId)));
  else await db.update(machines).set({ ...contacts, operatorPersonId: resolved.personId, operatorUserId: resolved.userId }).where(and(eq(machines.id, input.assetId), eq(machines.projectId, input.projectId)));
  return { success: true as const };
}

export type CompensationRange = { start: string; end: string };
export function payrollSubjectRange(profile: { joinedAt: Date | string | null; leftAt: Date | string | null }, period: string): CompensationRange | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new TRPCError({ code: "BAD_REQUEST", message: "工资期间格式必须为YYYY-MM" });
  const [year, month] = period.split("-").map(Number);
  const start = [period + "-01", legacyDate(profile.joinedAt)].filter((d): d is string => Boolean(d)).sort().at(-1)!;
  const end = [new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), legacyDate(profile.leftAt)].filter((d): d is string => Boolean(d)).sort()[0];
  return start <= end ? { start, end } : null;
}
export function historicalCompensationRanges(range: CompensationRange | null, history: { effectiveFrom: string; payrollEnabled: boolean; affiliation: string }[], channel: "monthly" | "daily") {
  if (!range) return [];
  const versions = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return versions.flatMap((v, i) => {
    if (!v.payrollEnabled || (channel === "daily" ? v.affiliation !== "temporary" : v.affiliation === "external" || v.affiliation === "temporary")) return [];
    const start = v.effectiveFrom > range.start ? v.effectiveFrom : range.start;
    const next = versions[i + 1]?.effectiveFrom;
    const end = next && next <= range.end ? priorDay(next) : range.end;
    return start <= end ? [{ start, end }] : [];
  });
}
const overlaps = (a: CompensationRange, b: CompensationRange) => a.start <= b.end && b.start <= a.end;

/** A2历史工资route可用：全部profile aliases按旧项目/任职范围和当期历史资格解析，不看当前开关。调用者逐profile做项目权限校验。 */
export async function getPersonnelPayrollProfilesForPeriod(db: BridgeDb, personId: number, period: string) {
  const links = await db.select().from(personnelSourceLinks).where(and(eq(personnelSourceLinks.personId, personId), eq(personnelSourceLinks.sourceType, "profile")));
  const ids = links.filter(l => l.personId === personId && l.sourceType === "profile").map(l => l.sourceId);
  if (!ids.length) return [];
  const [profiles, history] = await Promise.all([db.select().from(employeeProfiles).where(inArray(employeeProfiles.id, ids)), db.select().from(personnelSalaryHistory).where(eq(personnelSalaryHistory.personId, personId))]);
  return profiles.filter(p => ids.includes(p.id) && p.laborWorkerId && p.projectId).flatMap(p => {
    const ranges = historicalCompensationRanges(payrollSubjectRange(p, period), history, "monthly");
    return ranges.length ? [{ employeeProfileId: p.id, workerId: p.laborWorkerId!, projectId: p.projectId!, ranges }] : [];
  });
}

/** 先锁master再锁worker，与core转人事务一致；全source aliases按任职阶段而非当前归属防双算。 */
export async function assertCompensationChannel(db: BridgeDb, input: { workerId: number; projectId: number; period: string; channel: "monthly" | "daily"; lock?: boolean; historicalEligibility?: boolean; settlementDate?: string }) {
  const [link] = await db.select().from(personnelSourceLinks).where(and(eq(personnelSourceLinks.sourceType, "worker"), eq(personnelSourceLinks.sourceId, input.workerId))).limit(1);
  let person: Person | undefined;
  if (link?.sourceType === "worker" && link.sourceId === input.workerId) {
    const query = db.select().from(personnelPeople).where(eq(personnelPeople.id, link.personId)).limit(1);
    [person] = await (input.lock ? query.for("update") : query);
    if (!person) conflict("工资来源对应的统一人员不存在");
  }
  const workerQuery = db.select().from(laborWorkers).where(eq(laborWorkers.id, input.workerId)).limit(1);
  const [worker] = await (input.lock ? workerQuery.for("update") : workerQuery);
  if (!worker || worker.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "工资实名主体不存在或项目不一致" });
  let workerIds = [worker.id];
  if (person) {
    const aliasesQuery = db.select().from(personnelSourceLinks).where(and(eq(personnelSourceLinks.personId, person.id), eq(personnelSourceLinks.sourceType, "worker")));
    const aliases = await (input.lock ? aliasesQuery.for("update") : aliasesQuery);
    workerIds = Array.from(new Set([worker.id, ...aliases.filter(a => a.personId === person!.id && a.sourceType === "worker").map(a => a.sourceId)]));
  }
  if (!person && input.channel === "monthly" && worker.workerCategory === "temporary_daily") throw new TRPCError({ code: "BAD_REQUEST", message: "临时日结人员应使用日结通道，不能重复生成月度工资" });
  if (input.channel === "daily" && worker.workerCategory !== "temporary_daily") throw new TRPCError({ code: "BAD_REQUEST", message: "仅临时日结人员可创建日结记录" });
  const profileQuery = db.select().from(employeeProfiles).where(inArray(employeeProfiles.laborWorkerId, workerIds));
  const profiles = person ? await (input.lock ? profileQuery.for("update") : profileQuery) : [];
  const historyQuery = person ? db.select().from(personnelSalaryHistory).where(eq(personnelSalaryHistory.personId, person.id)) : null;
  const history = historyQuery ? await (input.lock ? historyQuery.for("update") : historyQuery) : [];
  const fullMonth = payrollSubjectRange({ joinedAt: null, leftAt: null }, input.period)!;
  const subjectRanges = (workerId: number) => {
    const subjects = profiles.filter(p => p.laborWorkerId === workerId);
    return subjects.length ? subjects.map(p => payrollSubjectRange(p, input.period)).filter((r): r is CompensationRange => r !== null) : [fullMonth];
  };
  const candidate = (person ? subjectRanges(worker.id).flatMap(r => historicalCompensationRanges(r, history, input.channel)) : subjectRanges(worker.id)).filter(r => !input.settlementDate || r.start <= input.settlementDate && r.end >= input.settlementDate);
  if (person && !candidate.length) throw new TRPCError({ code: "BAD_REQUEST", message: "所选期间无该历史任职主体的有效计薪资格，请核对薪资历史和日结/月薪通道" });
  const monthlyQuery = db.select().from(payrollStatements).where(and(inArray(payrollStatements.workerId, workerIds), eq(payrollStatements.period, input.period), ne(payrollStatements.status, "void")));
  const monthly = await (input.lock ? monthlyQuery.for("update") : monthlyQuery);
  const dailyQuery = db.select().from(temporaryDailyWageSettlements).where(and(inArray(temporaryDailyWageSettlements.workerId, workerIds), ne(temporaryDailyWageSettlements.status, "void")));
  const daily = await (input.lock ? dailyQuery.for("update") : dailyQuery);
  if (input.channel === "monthly") {
    if (daily.some(d => { const day = legacyDate(d.settlementDate); return d.status !== "void" && day && candidate.some(r => r.start <= day && r.end >= day); })) conflict("同人员同期间已有日结记录，不能重复创建月度工资");
    if (monthly.some(m => m.status !== "void" && m.period === input.period && (m.workerId !== worker.id || m.projectId !== input.projectId) && (m.projectId === input.projectId || subjectRanges(m.workerId).some(r => candidate.some(c => overlaps(c, r)))))) conflict("同人员其他历史实名主体已有本期间工资，不能重复制单");
  } else {
    if (monthly.some(m => m.status !== "void" && m.period === input.period && subjectRanges(m.workerId).some(r => candidate.some(c => overlaps(c, r))))) conflict("同人员同期间已有月度工资，不能重复创建日结");
    if (daily.some(d => d.status !== "void" && d.workerId !== worker.id && legacyDate(d.settlementDate) === input.settlementDate)) conflict("同人员其他历史实名主体已有当日日结，不能重复制单");
  }
  return { worker, person, workerIds };
}
