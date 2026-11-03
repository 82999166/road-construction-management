import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { getTableName, getTableColumns } from "drizzle-orm";
import * as s from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({ db: null as any, objects: new Map<string, string | Buffer>(), put: vi.fn(), ensure: vi.fn(), sync: vi.fn(), compensation: vi.fn(), actor: { id: 7 }, deny: false }));
vi.mock("drizzle-orm", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual,
    eq: (col: any, value: any) => ({ kind: "eq", col: col.name, value }),
    inArray: (col: any, value: any) => ({ kind: "in", col: col.name, value }),
    and: (...items: any[]) => ({ kind: "and", items }), or: (...items: any[]) => ({ kind: "or", items }),
    lte: (col: any, value: any) => ({ kind: "lte", col: col.name, value }), asc: () => null, desc: () => null,
  };
});
vi.mock("../db", () => ({ getDb: () => mocks.db }));
vi.mock("./personnelLegacyBridge", () => ({ ensureLegacyPayrollSubjects: mocks.ensure, syncLegacyMirrors: mocks.sync, getLegacyCompensation: mocks.compensation }));
vi.mock("../storage", () => ({ storagePut: mocks.put, storageGetSignedUrl: vi.fn() }));
vi.mock("../_core/env", () => ({ ENV: { selfHostStorageDir: "/mock-private" } }));
vi.mock("node:fs/promises", () => ({ default: { readFile: async (file: string) => mocks.objects.get(file.replace("/mock-private/", "")) } }));
vi.mock("./aliyunOssPhotoStorage", () => ({ isAliyunOssPhotoStorageKey: (key: string) => key.startsWith("aliyun-oss/") }));
vi.mock("../_core/context", () => ({ createContext: () => ({ user: mocks.actor }) }));
vi.mock("../access", () => ({ assertSuperAdmin: () => { if (mocks.deny) throw new TRPCError({ code: "FORBIDDEN" }); return mocks.actor; } }));
import { buildPersonnelPatch, currentPersonnelSalary, decodePersonnelDocument, directoryDetail, listDirectoryPeople, personnelOptions, previewPersonnelDocument, previewInsuranceDocument, savePersonnelInsurance, resolvePersonnelPayrollProfile, registerPersonnelDocumentPreview, safePersonnel, saveDirectoryPerson, summarizePersonnelInsurance, uploadPersonnelDocument } from "./personnelDirectory";
import { decryptSecret, encryptSecret } from "./secretVault";
import { chinaBusinessDate } from "./chinaBusinessTime";

function matches(row: any, p: any): boolean { if (!p) return true; if (p.kind === "eq") return row[p.col] === p.value; if (p.kind === "in") return p.value.includes(row[p.col]); if (p.kind === "and") return p.items.every((x: any) => matches(row, x)); if (p.kind === "or") return p.items.some((x: any) => matches(row, x)); if (p.kind === "lte") return row[p.col] <= p.value; throw new Error("unknown predicate"); }
function memoryDb() {
  const state: Record<string, any[]> = {}; const writes: any[] = []; let forceConflict = false;
  function rows(table: any) { const name = getTableName(table); return state[name] ?? (state[name] = []); }
  const db: any = {
    state, writes, forceCasConflict: () => { forceConflict = true; },
    seed(table: any, input: any[]) { rows(table).push(...input); },
    select(selection?: any) { let table: any; let predicate: any; let limit = Infinity;
      const q: any = { from(t: any) { table = t; return q; }, where(p: any) { predicate = p; return q; }, limit(n: number) { limit = n; return q; }, orderBy() { return q; }, for() { return q; }, then(resolve: any, reject: any) { try { const result = rows(table).filter(row => matches(row, predicate)).slice(0, limit).map(row => selection ? Object.fromEntries(Object.entries(selection).map(([key, col]: any) => [key, row[col.name]])) : { ...row }); return Promise.resolve(result).then(resolve, reject); } catch(e) { return Promise.reject(e).then(resolve,reject); } } }; return q;
    },
    insert(table: any) { return { values(input: any) { const values = Array.isArray(input) ? input : [input]; const ids: number[] = []; for (const value of values) { const list = rows(table); const id = Math.max(0, ...list.map(x => x.id)) + 1; const defaults = Object.fromEntries(Object.keys(getTableColumns(table)).map(key => [key, null])); const row = { ...defaults, id, status: "active", createdAt: new Date(), updatedAt: new Date(), version: 1, ...value }; list.push(row); ids.push(id); writes.push({ type: "insert", table: getTableName(table), value: { ...row } }); } return Promise.resolve([{ insertId: ids[0], affectedRows: values.length }]); } }; },
    update(table: any) { return { set(value: any) { return { async where(predicate: any) { if (getTableName(table) === "personnel_people" && value.version && forceConflict) return [{ affectedRows: 0 }]; const found = rows(table).filter(row => matches(row, predicate)); for (const row of found) Object.assign(row, value); writes.push({ type: "update", table: getTableName(table), value }); return [{ affectedRows: found.length }]; } }; } }; },
    async transaction(callback: any) { const before = structuredClone(state); const writeLength = writes.length; try { return await callback(db); } catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, before); writes.length = writeLength; throw error; } },
  }; return db;
}
const person = (extra: Record<string, any> = {}) => ({ id: 1, personNo: "P-TEST", name: "真实工人", affiliation: "company", employmentStatus: "active", primaryPositionId: null, secondaryPositionIds: [], projectId: null, teamId: null, entryDate: null, exitDate: null, gender: null, birthDate: null, address: "原地址", emergencyContactName: "原联系人", emergencyContactPhoneEncrypted: encryptSecret("13900000001"), emergencyContactPhoneMasked: "*******0001", phoneEncrypted: encryptSecret("13800000001"), phoneFingerprint: "old-fingerprint", phoneMasked: "*******0001", identityNoEncrypted: null, identityNoFingerprint: null, identityMasked: null, bankAccountEncrypted: null, bankAccountFingerprint: null, bankMasked: null, bankName: null, userId: null, legacyProfileId: null, legacyWorkerId: null, payrollEnabled: false, remarks: "原备注", avatarEvidenceId: null, version: 1, createdBy: 7, updatedBy: 7, createdAt: new Date(), updatedAt: new Date(), ...extra }) as typeof s.personnelPeople.$inferSelect;
const baseInput = { name: "真实工人", affiliation: "company" as const, primaryPositionId: null, employmentStatus: "active" as const, payrollEnabled: false };
const today = () => chinaBusinessDate(new Date());
const tomorrow = () => chinaBusinessDate(new Date(Date.now() + 86400000));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
beforeEach(() => {
  vi.clearAllMocks(); process.env.JWT_SECRET = "personnel-core-test-secret"; mocks.db = memoryDb(); mocks.objects.clear(); mocks.actor = { id: 7 }; mocks.deny = false;
  mocks.ensure.mockResolvedValue({ legacyProfileId: null, legacyWorkerId: null }); mocks.sync.mockResolvedValue(undefined);
  mocks.compensation.mockResolvedValue({ payroll: [], dailyWage: [], advances: [], payments: [] });
  mocks.put.mockImplementation(async (key: string, data: string) => { mocks.objects.set(key, data); return { key, url: `/manus-storage/${key}` }; });
});
afterEach(() => { vi.useRealTimers(); });

describe("统一人员核心事务行为", () => {
  it.each(["company", "temporary", "labor_team", "external"] as const)("%s可以不创建账号录入，稳定personId且无工资空壳", async affiliation => {
    const result = await saveDirectoryPerson({ ...baseInput, affiliation }, 7, mocks.db); expect(result.success).toBe(true); expect(result.id).toBe(1); expect(result.personNo).toMatch(/^P-/);
    expect(mocks.db.state.personnel_people[0].userId).toBeNull(); expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.db.state.personnel_salary_history ?? []).toHaveLength(0);
    expect(mocks.db.writes.some((w: any) => ["users", "user_role_assignments", "payroll_statements"].includes(w.table))).toBe(false);
  });
  it("undefined保留基础及敏感资料，null明确清空，姓名更新稳定ID/版本/审计", async () => {
    mocks.db.seed(s.personnelPeople, [person()]);
    const result = await saveDirectoryPerson({ ...baseInput, id: 1, version: 1, name: "更正姓名", address: null }, 7, mocks.db);
    const saved = mocks.db.state.personnel_people[0]; expect(result).toMatchObject({ id: 1, personNo: "P-TEST", version: 2 }); expect(saved.address).toBeNull(); expect(saved.emergencyContactName).toBe("原联系人"); expect(decryptSecret(saved.phoneEncrypted)).toBe("13800000001");
    const change = mocks.db.state.personnel_changes[0]; expect(change.changes.name).toEqual({ before: "真实工人", after: "更正姓名" }); expect(JSON.stringify(change)).not.toContain("13800000001"); expect(JSON.stringify(change)).not.toContain("v1.");
  });
  it("敏感写入加密指纹脱敏，更新仅审计脱敏值，可显式清空", async () => {
    mocks.db.seed(s.personnelPeople, [person()]); await saveDirectoryPerson({ ...baseInput, id: 1, version: 1, phoneNumber: "13812345678", identityNo: "110101199001010011", bankAccount: "6222000012345678" }, 7, mocks.db);
    const saved = mocks.db.state.personnel_people[0]; expect(decryptSecret(saved.phoneEncrypted)).toBe("13812345678"); expect(saved.phoneFingerprint).toHaveLength(64); expect(saved.identityNoFingerprint).toHaveLength(64);
    const safe = safePersonnel(saved); expect(JSON.stringify(safe)).not.toContain("13812345678"); expect(JSON.stringify(safe)).not.toContain("Encrypted"); expect(JSON.stringify(mocks.db.state.personnel_changes)).not.toContain("6222000012345678");
    await saveDirectoryPerson({ ...baseInput, id: 1, version: 2, clearPhoneNumber: true }, 7, mocks.db); expect(saved.phoneEncrypted).toBeNull(); expect(saved.phoneFingerprint).toBeNull();
  });
  it("旧版本及CAS失败都拒绝，事务内不留下工资或日志", async () => {
    mocks.db.seed(s.personnelPeople, [person({ version: 3 })]); await expect(saveDirectoryPerson({ ...baseInput, id: 1, version: 2 }, 7, mocks.db)).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.db.forceCasConflict(); await expect(saveDirectoryPerson({ ...baseInput, id: 1, version: 3, name: "冲突更改" }, 7, mocks.db)).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.db.state.personnel_people[0].name).toBe("真实工人"); expect(mocks.db.writes).toHaveLength(0);
  });
  it("兼容工资主体失败时主档、任职、薪资全回滚", async () => {
    mocks.db.seed(s.projects, [{ id: 10 }]); mocks.ensure.mockRejectedValue(new Error("工资主体不一致"));
    await expect(saveDirectoryPerson({ ...baseInput, projectId: 10, payrollEnabled: true, salaryBasis: "monthly", baseSalary: 5000 }, 7, mocks.db)).rejects.toThrow("工资主体不一致"); expect(mocks.db.state.personnel_people ?? []).toHaveLength(0); expect(mocks.db.state.personnel_salary_history ?? []).toHaveLength(0); expect(mocks.db.writes).toHaveLength(0);
  });
  it("将来工资追加历史但当前薪资和旧历史不改", async () => {
    mocks.db.seed(s.projects, [{ id: 10 }]); mocks.db.seed(s.personnelPeople, [person({ projectId: 10, payrollEnabled: true })]);
    mocks.db.seed(s.personnelSalaryHistory, [{ id: 1, personId: 1, salaryBasis: "monthly", baseSalary: "5000.00", payrollEnabled: true, affiliation: "company", effectiveFrom: "2020-01-01" }]);
    await saveDirectoryPerson({ ...baseInput, id: 1, version: 1, projectId: 10, payrollEnabled: true, baseSalary: 6000, salaryEffectiveFrom: tomorrow() }, 7, mocks.db);
    const rows = mocks.db.state.personnel_salary_history; expect(rows).toHaveLength(2); expect(rows[0].baseSalary).toBe("5000.00"); expect(currentPersonnelSalary(rows)?.baseSalary).toBe("5000.00"); expect(currentPersonnelSalary(rows, tomorrow())?.baseSalary).toBe("6000.00"); expect(mocks.db.writes.some((w: any) => w.table === "personnel_salary_history" && w.type === "update")).toBe(false);
  });
  it("追溯工资、重复生效日期、临时月薪及外部工资拒绝", async () => {
    mocks.db.seed(s.projects, [{ id: 10 }]); mocks.db.seed(s.personnelPeople, [person({ projectId: 10, payrollEnabled: true })]); mocks.db.seed(s.personnelSalaryHistory, [{ id: 1, personId: 1, salaryBasis: "monthly", baseSalary: "5000.00", payrollEnabled: true, affiliation: "company", effectiveFrom: today() }]);
    await expect(saveDirectoryPerson({ ...baseInput, id: 1, version: 1, payrollEnabled: true, baseSalary: 6000, salaryEffectiveFrom: "2020-01-01" }, 7, mocks.db)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(saveDirectoryPerson({ ...baseInput, id: 1, version: 1, payrollEnabled: true, baseSalary: 6000, salaryEffectiveFrom: today() }, 7, mocks.db)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(saveDirectoryPerson({ ...baseInput, affiliation: "temporary", projectId: 10, payrollEnabled: true, salaryBasis: "monthly" }, 7, mocks.db)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(saveDirectoryPerson({ ...baseInput, affiliation: "external", payrollEnabled: true }, 7, mocks.db)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("施工队必须属于真实项目，不能任意关联其他账号的源主体", async () => {
    mocks.db.seed(s.projects, [{ id: 10 }]); mocks.db.seed(s.personnelTeams, [{ id: 2, projectId: 11, status: "active" }]);
    await expect(saveDirectoryPerson({ ...baseInput, projectId: 10, teamId: 2 }, 7, mocks.db)).rejects.toThrow("施工队");
    mocks.db.seed(s.users, [{ id: 20 }]); mocks.db.seed(s.personnelSourceLinks, [{ id: 1, personId: 99, sourceType: "user", sourceId: 20 }]);
    await expect(saveDirectoryPerson({ ...baseInput, userId: 20 }, 7, mocks.db)).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.db.state.personnel_source_links = []; mocks.db.seed(s.employeeProfiles, [{ id: 9, userId: 20 }]); await expect(saveDirectoryPerson({ ...baseInput, userId: 20 }, 7, mocks.db)).rejects.toThrow("真实账号ID引入");
  });
});
describe("真实详情和只读投影", () => {
  it("查询无seed或业务写副作用；历史profile去重及保险按真实源聚合", async () => {
    mocks.db.seed(s.personnelPeople, [person({ legacyProfileId: 5 })]); mocks.db.seed(s.personnelSourceLinks, [{ id: 1, personId: 1, sourceType: "profile", sourceId: 5 }, { id: 2, personId: 1, sourceType: "profile", sourceId: 6 }]); mocks.db.seed(s.employeeInsurancePolicies, [{ id: 1, employeeProfileId: 5, status: "active", expiresAt: new Date("2020-01-01T00:00:00Z") }, { id: 2, employeeProfileId: 6, status: "active", expiresAt: new Date("2099-01-01T00:00:00Z") }]);
    const rows = await listDirectoryPeople(undefined); expect(rows[0]).toMatchObject({ historicalDuplicateProfileCount: 1, insuranceStatus: "active", expiredInsuranceCount: 1 }); await personnelOptions(); expect(mocks.db.writes).toHaveLength(0);
  });
  it("detail跨多个真实worker汇集考勤与付款，不把actualAmount当实付", async () => {
    mocks.db.seed(s.personnelPeople, [person({ legacyWorkerId: 3, legacyProfileId: 5 })]); mocks.db.seed(s.personnelSourceLinks, [{ id: 1, personId: 1, sourceType: "worker", sourceId: 3 }, { id: 2, personId: 1, sourceType: "worker", sourceId: 4 }, { id: 3, personId: 1, sourceType: "profile", sourceId: 6 }]);
    mocks.db.seed(s.attendanceRecords, [{ id: 1, workerId: 3, attendanceDate: new Date("2026-11-01T00:00:00Z"), workHours: "8", overtimeHours: "1" }, { id: 2, workerId: 4, attendanceDate: new Date("2026-11-02T00:00:00Z"), workHours: "6", overtimeHours: "2" }, { id: 3, workerId: 99, attendanceDate: new Date("2026-11-02T00:00:00Z"), workHours: "10", overtimeHours: "0" }]);
    mocks.compensation.mockResolvedValue({ payroll: [{ id: 7, actualAmount: "5000", paidAmount: "2000" }], dailyWage: [], advances: [], payments: [{ id: 9, amount: "2000", status: "active" }] }); const detail = await directoryDetail(1, "2026-11"); expect(detail.attendance).toMatchObject({ days: 2, workHours: 14, overtimeHours: 3 }); expect(mocks.compensation).toHaveBeenCalledWith(mocks.db, { workerIds: [3, 4], profileIds: [6, 5], period: "2026-11" }); expect(detail.compensation.payroll[0].paidAmount).toBe("2000"); expect(detail.documents).toEqual([]); expect(detail.resources.history).toEqual([]); expect(mocks.db.writes).toHaveLength(0);
  });
  it("有效优先且保留过期/临近到期数量", () => {
    expect(summarizePersonnelInsurance([{ expiresAt: "2026-11-20", active: true }, { expiresAt: "2027-01-01", active: true }, { expiresAt: "2026-10-01", active: true }], "2026-11-03")).toMatchObject({ insuranceStatus: "active", expiringInsuranceCount: 1, expiredInsuranceCount: 1 });
    expect(summarizePersonnelInsurance([{ expiresAt: "2026-11-20", active: true }], "2026-11-03").insuranceStatus).toBe("expiring"); expect(summarizePersonnelInsurance([{ expiresAt: null, active: true }]).insuranceStatus).toBe("none");
  });
});
describe("附件受控上传预览", () => {
  async function uploaded() { mocks.db.seed(s.personnelPeople, [person()]); return uploadPersonnelDocument({ personId: 1, name: "证件", documentType: "identity", fileName: "../证件.png", mimeType: "image/png", base64Data: png.toString("base64") }, 7); }
  function route() { let handler: any; registerPersonnelDocumentPreview({ get: (_: string, callback: any) => { handler = callback; } } as any); return async (url: string) => { const result: any = { headers: {}, statusCode: 200, body: null, status(code: number) { this.statusCode = code; return this; }, send(body: any) { this.body = body; return this; }, set(k: string, v: string) { this.headers[k] = v; return this; } }; await handler({ params: { token: url.split("/").at(-1) } }, result); return result; }; }
  it("严格类型、大小、base64校验，非法字节不进入存储", () => {
    expect(() => decodePersonnelDocument(png.toString("base64"), "application/pdf")).toThrow("声明类型"); expect(() => decodePersonnelDocument("abc?", "image/png")).toThrow("编码"); expect(() => decodePersonnelDocument(Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"), "image/png")).toThrow("8MB");
  });
  it("仅存加密bytes，URL不包含object key，预览绑定用户一次消费", async () => {
    const doc = await uploaded(); const evidence = mocks.db.state.evidence_records[0]; expect(evidence.sourceType).toBe("personnel_private"); expect(evidence.fileName).toBe("证件.png"); expect(mocks.put.mock.calls[0][2]).toBe("application/octet-stream"); expect(mocks.objects.get(evidence.fileKey)).not.toContain(png.toString("base64"));
    const preview = await previewPersonnelDocument(1, doc.id, 7); expect(preview.url).not.toContain(evidence.fileKey); const http = route();
    mocks.actor = { id: 8 }; expect((await http(preview.url)).statusCode).toBe(403); mocks.actor = { id: 7 }; const response = await http(preview.url); expect(response.statusCode).toBe(200); expect(response.body).toEqual(png); expect(response.headers["Cache-Control"]).toBe("no-store"); expect((await http(preview.url)).statusCode).toBe(410);
  });
  it("不能预览另一person，证据source/project不匹配和已删除拒绝", async () => {
    const doc = await uploaded(); mocks.db.seed(s.personnelPeople, [person({ id: 2 })]); await expect(previewPersonnelDocument(2, doc.id, 7)).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.db.state.evidence_records[0].sourceId = "2"; await expect(previewPersonnelDocument(1, doc.id, 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.db.state.evidence_records[0].sourceId = "1"; mocks.db.state.evidence_records[0].projectId = 99; await expect(previewPersonnelDocument(1, doc.id, 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.db.state.evidence_records[0].projectId = null; mocks.db.state.evidence_records[0].status = "deleted"; await expect(previewPersonnelDocument(1, doc.id, 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("两分钟过期、HTTP重验来源且不泄露对象路径", async () => {
    vi.useFakeTimers(); const doc = await uploaded(); const preview = await previewPersonnelDocument(1, doc.id, 7); vi.advanceTimersByTime(120001); const http = route(); expect((await http(preview.url)).statusCode).toBe(410);
    const next = await previewPersonnelDocument(1, doc.id, 7); mocks.db.state.evidence_records[0].sourceId = "2"; const result = await http(next.url); expect(result.statusCode).toBe(403); expect(result.body).not.toContain("personnel-private");
  });
});

function previewHttp() {
  let handler: any;
  registerPersonnelDocumentPreview({ get: (_: string, callback: any) => { handler = callback; } } as any);
  return async (url: string) => {
    const result: any = { headers: {}, statusCode: 200, body: null, status(code: number) { this.statusCode = code; return this; }, send(body: any) { this.body = body; return this; }, set(k: string, v: string) { this.headers[k] = v; return this; } };
    await handler({ params: { token: url.split('/').at(-1) } }, result); return result;
  };
}
function legacyInsurance(extra: Record<string, any> = {}) {
  mocks.db.seed(s.personnelPeople, [person({ projectId: 20, legacyProfileId: 5 })]);
  mocks.db.seed(s.employeeProfiles, [{ id: 5, projectId: 10 }, { id: 6, projectId: 11 }]);
  mocks.db.seed(s.personnelSourceLinks, [{ id: 1, personId: 1, sourceType: 'profile', sourceId: 5 }, { id: 2, personId: 1, sourceType: 'profile', sourceId: 6 }]);
  mocks.db.seed(s.employeeInsurancePolicies, [{ id: 8, employeeProfileId: 6, evidenceId: 9, insuranceType: 'accident', purchasedAt: new Date('2026-01-01'), expiresAt: new Date('2026-12-31'), status: 'active', providerName: '旧保险公司', policyReference: 'SECRET-POLICY', premiumAmount: '123.45', coverageAmount: '100000.00', remarks: '旧备注', ...extra }]);
  mocks.db.seed(s.evidenceRecords, [{ id: 9, projectId: 11, sourceType: 'employee_insurance_policy', sourceId: '6', fileKey: 'employee-insurance/6/old.png', fileName: 'old.png', mimeType: 'image/png', contentBytes: png.length, contentSha256: createHash('sha256').update(png).digest('hex'), status: 'active' }]);
  mocks.objects.set('employee-insurance/6/old.png', png);
}
describe('旧保险附件安全预览行为', () => {
  it('全部真实profile源可预览，原profile项目授权不猜今天人员项目，旧原件不改写', async () => {
    legacyInsurance(); const preview = await previewInsuranceDocument(1, 8, 7);
    expect(Object.keys(preview).sort()).toEqual(['url', 'fileName', 'mimeType', 'expiresAt'].sort());
    expect(preview.url).not.toContain('employee-insurance'); const http = previewHttp(); const result = await http(preview.url);
    expect(result.statusCode).toBe(200); expect(result.body).toEqual(png); expect(result.headers['Cache-Control']).toBe('no-store'); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.db.writes).toHaveLength(0);
  });
  it('其他员工保单、source冲突、证据错误profile项目或删除均拒绝', async () => {
    legacyInsurance(); mocks.db.seed(s.personnelPeople, [person({ id: 2 })]);
    await expect(previewInsuranceDocument(2, 8, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mocks.db.state.personnel_source_links[1].personId = 2; await expect(previewInsuranceDocument(1, 8, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mocks.db.state.personnel_source_links[1].personId = 1; const e = mocks.db.state.evidence_records[0]; e.sourceId = '5'; await expect(previewInsuranceDocument(1, 8, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    e.sourceId = '6'; e.projectId = 10; await expect(previewInsuranceDocument(1, 8, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' }); e.projectId = 11; e.status = 'deleted'; await expect(previewInsuranceDocument(1, 8, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('未授权actor不消耗token，已使用token重用及并发重用拒绝', async () => {
    legacyInsurance(); const p = await previewInsuranceDocument(1, 8, 7); const http = previewHttp();
    mocks.deny = true; expect((await http(p.url)).statusCode).toBe(403); mocks.deny = false; mocks.actor = { id: 8 }; expect((await http(p.url)).statusCode).toBe(403); mocks.actor = { id: 7 };
    const results = await Promise.all([http(p.url), http(p.url)]); expect(results.map(x => x.statusCode).sort()).toEqual([200, 410]); expect((await http(p.url)).statusCode).toBe(410);
  });
  it('两分钟有效期与HTTP每次重新验证source、policy证据绑定', async () => {
    vi.useFakeTimers(); legacyInsurance(); const http = previewHttp(); const p = await previewInsuranceDocument(1, 8, 7); vi.advanceTimersByTime(120001); expect((await http(p.url)).statusCode).toBe(410);
    const p2 = await previewInsuranceDocument(1, 8, 7); mocks.db.state.personnel_source_links[1].personId = 2; expect((await http(p2.url)).statusCode).toBe(403);
    mocks.db.state.personnel_source_links[1].personId = 1; const p3 = await previewInsuranceDocument(1, 8, 7); mocks.db.state.employee_insurance_policies[0].evidenceId = null; expect((await http(p3.url)).statusCode).toBe(404);
  });
  it('原件完整性与路径穿越拒绝，不泄永久url/key', async () => {
    legacyInsurance(); const http = previewHttp(); const p = await previewInsuranceDocument(1, 8, 7); mocks.objects.set('employee-insurance/6/old.png', Buffer.concat([png, Buffer.from([99])])); expect((await http(p.url)).statusCode).toBe(404);
    mocks.db.state.evidence_records[0].fileKey = '../private'; const p2 = await previewInsuranceDocument(1, 8, 7); const result = await http(p2.url); expect(result.statusCode).toBe(404); expect(result.body).not.toContain('../private');
  });
});
describe('头像加密文档与版本真实维护', () => {
  const portrait = (bytes = png, mimeType: 'image/png' | 'image/jpeg' | 'application/pdf' = 'image/png') => ({ personId: 1, name: '头像照片', documentType: 'portrait' as const, fileName: 'portrait.png', mimeType, base64Data: bytes.toString('base64') });
  it('portrait只接受JPEG/PNG，PDF、伪MIME与超限均不存储', async () => {
    mocks.db.seed(s.personnelPeople, [person()]); await expect(uploadPersonnelDocument(portrait(Buffer.from('%PDF-1.4'), 'application/pdf'), 7)).rejects.toThrow('JPEG或PNG');
    await expect(uploadPersonnelDocument(portrait(Buffer.from('%PDF-1.4')), 7)).rejects.toMatchObject({ code: 'BAD_REQUEST' }); await expect(uploadPersonnelDocument(portrait(Buffer.alloc(8 * 1024 * 1024 + 1)), 7)).rejects.toThrow('8MB'); expect(mocks.put).not.toHaveBeenCalled();
  });
  it('同一人换头像更新pointer/CAS/version/安全审计，list/detail只返回avatarDocumentId', async () => {
    mocks.db.seed(s.personnelPeople, [person()]); const a = await uploadPersonnelDocument(portrait(), 7); const b = await uploadPersonnelDocument(portrait(Buffer.from([0xff, 0xd8, 0xff, 1]), 'image/jpeg'), 7);
    expect(a).toMatchObject({ avatarDocumentId: 1, version: 2 }); expect(b).toMatchObject({ avatarDocumentId: 2, version: 3 }); const p = mocks.db.state.personnel_people[0]; expect(p.avatarEvidenceId).toBe(2);
    expect(mocks.db.state.personnel_documents).toHaveLength(2); expect(mocks.db.state.personnel_changes[1].changes.avatarDocumentId).toEqual({ before: 1, after: 2 });
    expect((await listDirectoryPeople(undefined))[0].avatarDocumentId).toBe(2); const detail = await directoryDetail(1); expect(detail.person.avatarDocumentId).toBe(2); expect(detail.person).not.toHaveProperty('avatarEvidenceId');
    const e = mocks.db.state.evidence_records[1]; expect(mocks.objects.get(e.fileKey)).not.toContain('/9j/'); expect(decryptSecret(mocks.objects.get(e.fileKey) as string)).toBe(Buffer.from([0xff, 0xd8, 0xff, 1]).toString('base64')); expect(JSON.stringify(detail.person)).not.toMatch(/personnel-private|evidenceKey|\/manus-storage|https:/); expect(mocks.put.mock.calls.every(c => c[2] === 'application/octet-stream')).toBe(true);
    const preview = await previewPersonnelDocument(1, b.id, 7); expect((await previewHttp()(preview.url)).body).toEqual(Buffer.from([0xff, 0xd8, 0xff, 1]));
  });
  it('头像CAS冲突时文档证据日志一起回滚，旧avatar不被替换', async () => {
    mocks.db.seed(s.personnelPeople, [person({ avatarEvidenceId: 50 })]); mocks.db.forceCasConflict(); await expect(uploadPersonnelDocument(portrait(), 7)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.db.state.personnel_people[0]).toMatchObject({ avatarEvidenceId: 50, version: 1 }); expect(mocks.db.state.personnel_documents ?? []).toHaveLength(0); expect(mocks.db.state.evidence_records ?? []).toHaveLength(0); expect(mocks.db.writes).toHaveLength(0);
  });
});
describe('保险元数据授权与原子事务', () => {
  const input = { personId: 1, version: 1, insuranceType: 'accident' as const, purchasedAt: '2026-01-01', expiresAt: '2026-12-31', status: 'active' as const };
  it('不计薪无账号人员可真实买保险，只建无工资身份，后续不重复生成', async () => {
    mocks.db.seed(s.personnelPeople, [person({ projectId: 10 })]); mocks.db.seed(s.projects, [{ id: 10 }]); const a = await savePersonnelInsurance({ ...input, premiumAmount: 120, coverageAmount: 100000 }, 7); expect(a).toMatchObject({ id: 1, version: 2 });
    expect(mocks.db.state.employee_profiles[0]).toMatchObject({ userId: null, laborWorkerId: null, projectId: 10, baseSalary: null }); expect(mocks.db.state.personnel_people[0].payrollEnabled).toBe(false); expect(mocks.db.state.employee_insurance_policies[0].premiumAmount).toBe('120'); expect(mocks.db.state.personnel_source_links[0]).toMatchObject({ personId: 1, sourceType: 'profile', sourceId: 1 });
    await savePersonnelInsurance({ ...input, version: 2 }, 7); expect(mocks.db.state.employee_profiles).toHaveLength(1); expect(mocks.db.state.personnel_salary_history ?? []).toHaveLength(0); expect(mocks.db.writes.some((w: any) => ['users', 'user_role_assignments', 'payroll_statements'].includes(w.table))).toBe(false);
  });
  it('历史任一合法profile保单可编辑，undefined保留保单号金额旧附件，null明确清空', async () => {
    legacyInsurance(); await savePersonnelInsurance({ ...input, id: 8, providerName: '新保险公司' }, 7); const row = mocks.db.state.employee_insurance_policies[0]; expect(row).toMatchObject({ employeeProfileId: 6, evidenceId: 9, policyReference: 'SECRET-POLICY', premiumAmount: '123.45', coverageAmount: '100000.00', providerName: '新保险公司', remarks: '旧备注' });
    expect(JSON.stringify(mocks.db.state.personnel_changes)).not.toContain('SECRET-POLICY'); expect(mocks.db.state.audit_logs[0].action).toBe('update_employee_insurance');
    await savePersonnelInsurance({ ...input, id: 8, version: 2, evidenceId: null, policyReference: null, premiumAmount: null }, 7); expect(row).toMatchObject({ evidenceId: null, policyReference: null, premiumAmount: null, coverageAmount: '100000.00' });
  });
  it('外人保单、旧错源附件与新personnel_private附件拒绝且主档CAS全部回滚', async () => {
    legacyInsurance(); mocks.db.state.employee_insurance_policies[0].employeeProfileId = 99; await expect(savePersonnelInsurance({ ...input, id: 8 }, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(mocks.db.state.personnel_people[0].version).toBe(1);
    mocks.db.state.employee_insurance_policies[0].employeeProfileId = 6; mocks.db.state.evidence_records[0].sourceType = 'personnel_private'; await expect(savePersonnelInsurance({ ...input, id: 8, evidenceId: 9 }, 7)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(mocks.db.state.personnel_people[0].version).toBe(1); expect(mocks.db.writes).toHaveLength(0);
  });
  it('版本冲突/日期金额无效或无真实项目不会写入空主体', async () => {
    mocks.db.seed(s.personnelPeople, [person()]); await expect(savePersonnelInsurance({ ...input, version: 2 }, 7)).rejects.toMatchObject({ code: 'CONFLICT' }); await expect(savePersonnelInsurance({ ...input, expiresAt: '2025-12-31' }, 7)).rejects.toThrow('不得早于'); await expect(savePersonnelInsurance({ ...input, premiumAmount: -1 }, 7)).rejects.toThrow(); await expect(savePersonnelInsurance(input, 7)).rejects.toMatchObject({ code: 'BAD_REQUEST' }); expect(mocks.db.state.employee_profiles ?? []).toHaveLength(0); expect(mocks.db.writes).toHaveLength(0);
  });
});
describe('历史期间工资主体明确选择', () => {
  function seed() {
    mocks.db.seed(s.personnelPeople, [person({ affiliation: 'external', payrollEnabled: false, projectId: 20, legacyProfileId: 6 })]);
    mocks.db.seed(s.personnelSourceLinks, [{ id: 1, personId: 1, sourceType: 'profile', sourceId: 5 }, { id: 2, personId: 1, sourceType: 'profile', sourceId: 6 }]);
    mocks.db.seed(s.employeeProfiles, [{ id: 5, projectId: 10, laborWorkerId: 3, joinedAt: '2020-01-01', leftAt: '2026-10-31' }, { id: 6, projectId: 20, laborWorkerId: 4, joinedAt: '2026-11-01', leftAt: null }]);
    mocks.db.seed(s.personnelSalaryHistory, [{ id: 1, personId: 1, affiliation: 'company', payrollEnabled: true, salaryBasis: 'monthly', baseSalary: '5000', effectiveFrom: '2020-01-01' }, { id: 2, personId: 1, affiliation: 'external', payrollEnabled: false, salaryBasis: 'monthly', baseSalary: null, effectiveFrom: '2026-11-01' }]);
  }
  it('今日external停薪不阻上月公司工资，不猜当前project pointer', async () => { seed(); expect(await resolvePersonnelPayrollProfile({ personId: 1, period: '2026-10' })).toBe(5); await expect(resolvePersonnelPayrollProfile({ personId: 1, period: '2026-11' })).rejects.toMatchObject({ code: 'BAD_REQUEST' }); });
  it('多历史项目主体必须明确选择，外人profile与无效期间拒绝', async () => {
    seed(); mocks.db.state.employee_profiles[1].joinedAt = '2026-10-01'; await expect(resolvePersonnelPayrollProfile({ personId: 1, period: '2026-10' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' }); expect(await resolvePersonnelPayrollProfile({ personId: 1, period: '2026-10', employeeProfileId: 5 })).toBe(5); expect(await resolvePersonnelPayrollProfile({ personId: 1, period: '2026-10', projectId: 20 })).toBe(6); await expect(resolvePersonnelPayrollProfile({ personId: 1, period: '2026-10', employeeProfileId: 99 })).rejects.toMatchObject({ code: 'FORBIDDEN' }); await expect(resolvePersonnelPayrollProfile({ personId: 1, period: '2010-01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('detail明确投影真实工资profile项目与日期，无敏感账号', async () => { seed(); mocks.db.seed(s.projects, [{ id: 10, name: '旧项目' }, { id: 20, name: '新项目' }]); const detail = await directoryDetail(1); expect(detail.payrollSubjects).toEqual([{ employeeProfileId: 5, projectId: 10, projectName: '旧项目', joinedAt: '2020-01-01', leftAt: '2026-10-31', workerId: 3 }, { employeeProfileId: 6, projectId: 20, projectName: '新项目', joinedAt: '2026-11-01', leftAt: null, workerId: 4 }]); expect(JSON.stringify(detail.payrollSubjects)).not.toMatch(/phone|userId|bank|salary|Encrypted/); });
});

describe('手机号跨人员与历史源重复校验', () => {
  it('无账号外部/不计薪人员仍拒绝另一master手机号，格式规范化防绕过', async () => {
    const fp = buildPersonnelPatch({ ...baseInput, phoneNumber: '13812345678' }).phoneFingerprint;
    mocks.db.seed(s.personnelPeople, [person({ id: 9, phoneFingerprint: fp })]);
    await expect(saveDirectoryPerson({ ...baseInput, affiliation: 'external', phoneNumber: '138 1234-5678' }, 7, mocks.db)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.db.state.personnel_people).toHaveLength(1); expect(mocks.db.writes).toHaveLength(0);
  });
  it.each(['worker', 'user'] as const)('未确认历史%s手机号不能自动新建合并，不写工资/账号', async type => {
    const fp = buildPersonnelPatch({ ...baseInput, phoneNumber: '13812345678' }).phoneFingerprint;
    mocks.db.seed(type === 'worker' ? s.laborWorkers : s.userProfiles, [type === 'worker' ? { id: 8, phoneFingerprint: fp } : { id: 8, userId: 20, phoneFingerprint: fp }]);
    await expect(saveDirectoryPerson({ ...baseInput, phoneNumber: '13812345678' }, 7, mocks.db)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(mocks.db.writes).toHaveLength(0);
  });
  it('已确认本人的全部worker/user源允许重复镜像，同person不产生假冲突', async () => {
    const fp = buildPersonnelPatch({ ...baseInput, phoneNumber: '13812345678' }).phoneFingerprint;
    mocks.db.seed(s.personnelPeople, [person({ phoneFingerprint: fp, legacyWorkerId: 8, userId: 20 })]); mocks.db.seed(s.laborWorkers, [{ id: 8, phoneFingerprint: fp }, { id: 9, phoneFingerprint: fp }]); mocks.db.seed(s.userProfiles, [{ id: 2, userId: 20, phoneFingerprint: fp }]);
    mocks.db.seed(s.personnelSourceLinks, [{ id: 1, personId: 1, sourceType: 'worker', sourceId: 8 }, { id: 2, personId: 1, sourceType: 'worker', sourceId: 9 }, { id: 3, personId: 1, sourceType: 'user', sourceId: 20 }]);
    expect(await saveDirectoryPerson({ ...baseInput, id: 1, version: 1, phoneNumber: '13812345678' }, 7, mocks.db)).toMatchObject({ id: 1, version: 2 });
    expect(mocks.db.state.personnel_people[0].phoneFingerprint).toBe(fp);
  });
});
