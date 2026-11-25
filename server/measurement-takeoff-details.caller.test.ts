import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type MySqlTable } from "drizzle-orm/mysql-core";
import * as s from "../drizzle/schema";
import { ProjectPermissionsMockDb } from "./services/projectPermissions.mockDb";
import type { TrpcContext } from "./_core/context";
const state = vi.hoisted(() => ({ db: null as any, root: "", user: null as any, storage: vi.fn(), notify: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => state.db }));
vi.mock("./storage", () => ({ storagePut: state.storage, storageGetSignedUrl: async () => "https://fixture.invalid/image" }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: state.notify }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => state.user } }));
vi.mock("./_core/env", () => ({ ENV: { get selfHostStorageDir() { return state.root; }, cookieSecret: "isolated-takeoff-test" } }));
import { router } from "./_core/trpc";
import { measurementRouter } from "./routers/finance";
import { registerTakeoffAttachmentPreview, takeoffVersion } from "./services/measurementTakeoff";
import { assertEvidenceImageSignature } from "../shared/domain";
const mounted = router({ measurement: measurementRouter });
const fixed = new Date("2026-11-25T08:00:00Z");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKpUAAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(32).fill(0), 0xff, 0xd9]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const baseInput = { projectId: 10, workItem: "路基土方", workLocation: "K12+300", unit: "m3" as const, quantity: 100, unitPrice: 23.5, takeoffDate: "2026-11-25" };
const row = { item: "原始尺寸", location: "断面一", length: 2, width: 3, height: null, count: 0, quantity: 0, calculation: "原始式不执行", remarks: "零值原始观测" };
const uploadInput = { projectId: 10, fileName: "现场.png", mimeType: "image/png" as const, base64Data: png.toString("base64"), description: "现场完整照片" };
/** Extends the required ProjectPermissionsMockDb only for missing Drizzle JSON/upsert/returningId APIs.
 * SQL predicates, joins, transactions and rollback remain the original SQLite implementation.
 * Real schema unique keys are installed. FOR UPDATE is observed, never MySQL concurrency proof. */
class TakeoffDb extends ProjectPermissionsMockDb {
  beforeWrite?: (table: string) => void;
  constructor() {
    super();
    const sqlite = (this as any).sqlite;
    sqlite.function("regexp", (pattern: string, value: unknown) => new RegExp(pattern, "i").test(String(value ?? "")) ? 1 : 0);
    for (const table of [s.businessDocumentNumberAllocations, s.businessDocumentNumberCounters, s.businessDocumentCreationReceipts, s.measurementTakeoffEvidences]) {
      const cfg = getTableConfig(table); const name = getTableName(table);
      for (const col of cfg.columns) if (col.primary && col.name !== "id" || col.isUnique) sqlite.exec(`CREATE UNIQUE INDEX fixture_${name}_${col.name} ON \`${name}\` (\`${col.name}\`)`);
      for (const index of cfg.indexes) if (index.config.unique) sqlite.exec(`CREATE UNIQUE INDEX fixture_${name}_${index.config.name} ON \`${name}\` (${index.config.columns.map((c: any) => `\`${c.name}\``).join(",")})`);
    }
    (this as any).insert = (table: MySqlTable) => ({ values: (input: any) => {
      const execute = (ignore = false) => { let id = 0; for (const value of Array.isArray(input) ? input : [input]) id ||= this.writeFixture(table, value, ignore); return [{ insertId: id }]; };
      return { then: (ok: any, fail: any) => Promise.resolve().then(() => execute()).then(ok, fail), $returningId: async () => [{ id: execute()[0].insertId }], onDuplicateKeyUpdate: async () => execute(true) };
    } });
    const update = this.update.bind(this);
    (this as any).update = (table: MySqlTable) => ({ set: (values: any) => ({ where: (condition: any) => {
      this.beforeWrite?.(getTableName(table));
      const columns = getTableColumns(table);
      return update(table).set(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, columns[key]?.dataType === "json" && value !== null ? JSON.stringify(value) : value]))).where(condition);
    } }) });
    const select = this.select.bind(this);
    (this as any).select = (projection?: any) => ({ from: (table: MySqlTable) => {
      const builder = select(projection).from(table); const then = builder.then.bind(builder);
      builder.then = (ok: any, fail: any) => then((values: any[]) => values.map(value => this.json(value, projection ?? getTableColumns(table)))).then(ok, fail);
      return builder;
    } });
  }
  rollback(): never { throw Error("fixture rollback"); }
  private json(value: any, columns: any) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item !== null && columns[key]?.dataType === "json" && typeof item === "string" ? JSON.parse(item) : item])); }
  rows(table: MySqlTable) { return super.rows(table).map(value => this.json(value, getTableColumns(table))); }
  seed(table: MySqlTable, input: any) { for (const value of Array.isArray(input) ? input : [input]) this.writeFixture(table, value); }
  private writeFixture(table: MySqlTable, input: any, ignore = false) {
    const name = getTableName(table); if (name === this.failInsertTable) throw Error(`injected insert failure: ${name}`);
    const columns = getTableColumns(table);
    const defaults = Object.fromEntries(Object.entries(columns).map(([key, col]: any) => [key, ["createdAt", "updatedAt", "lastSignedIn"].includes(key) ? fixed : ["string", "number", "boolean"].includes(typeof col.default) ? col.default : null]));
    const value: any = { ...defaults, ...input }; if (value.id == null) delete value.id;
    const fields = Object.keys(value).filter(key => value[key] !== undefined);
    const normalize = (v: any) => v instanceof Date ? v.toISOString() : typeof v === "boolean" ? Number(v) : v && typeof v === "object" ? JSON.stringify(v) : v ?? null;
    const result = (this as any).sqlite.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO \`${name}\` (${fields.map(key => `\`${key}\``).join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...fields.map(key => normalize(value[key])));
    return Number(result.lastInsertRowid);
  }
}
let db: TakeoffDb;
const ctx = (id = 7, role: "user" | "admin" = "user"): TrpcContext => ({ user: { id, role, openId: `isolated-${id}`, loginMethod: "manus", name: "收方录入人" } as any, req: { headers: {} } as any, res: {} as any });
const caller = (context = ctx()) => mounted.createCaller(context).measurement;
function seedRole(code = "PROJECT_MANAGER", userId = 7, projectId = 10, roleId = userId) {
  if (!db.rows(s.systemRoles).some(r => r.id === roleId)) db.seed(s.systemRoles, { id: roleId, code, name: code, status: "active" });
  db.seed(s.userRoleAssignments, { userId, roleId, projectId, organizationId: null, status: "active" });
}
function permission(actions = ["read", "create", "edit", "print", "submit"], roleId = 7) {
  for (const action of actions) { const id = db.rows(s.systemPermissions).length + 1; db.seed(s.systemPermissions, { id, code: `measurement:${action}:${roleId}`, module: "measurement", action, name: action }); db.seed(s.rolePermissions, { roleId, permissionId: id }); }
}
function oldRecord(overrides: any = {}) { db.seed(s.measurementTakeoffRecords, { id: 50, projectId: 10, takeoffNo: "LEGACY-TO", workItem: "历史土方", workLocation: "历史区段", unit: "m3", quantity: "100", unitPrice: "23.5", declaredAmount: "2350", takeoffDate: fixed, submittedBy: 7, status: "draft", ...overrides }); }
function evidence(id = 20, overrides: any = {}) { db.seed(s.evidenceRecords, { id, projectId: 10, sourceType: "site_photo", sourceId: "takeoff-50", fileKey: `evidence/10/old-${id}.png`, fileName: `旧照片${id}.png`, mimeType: "image/png", status: "active", uploadedBy: 7, contentSha256: hash(png), contentBytes: png.length, capturedAt: fixed, watermarkJson: JSON.stringify({ description: "旧说明", ocr: "不返回的OCR", phone: "13800000000" }), ...overrides }); }
async function storeOld(id = 20, bytes = png) { const item = db.rows(s.evidenceRecords).find(e => e.id === id); const target = path.join(state.root, item.fileKey); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); }
async function preview(url: string, user = ctx().user) {
  let handler: any; registerTakeoffAttachmentPreview({ get: (_route: string, fn: any) => { handler = fn; } } as any);
  state.user = user; const result: any = { status: 200, headers: {}, body: null };
  const res: any = { set: (key: string, value: string) => { result.headers[key] = value; return res; }, status: (code: number) => { result.status = code; return res; }, send: (body: any) => { result.body = body; return res; } };
  await handler({ params: { token: url.split("/").pop() }, headers: {} }, res); return result;
}
beforeEach(async () => {
  vi.clearAllMocks(); db = new TakeoffDb(); state.db = db; state.root = await fs.mkdtemp(path.join(os.tmpdir(), "takeoff-isolated-"));
  db.seed(s.projects, [{ id: 10, code: "P10", name: "隔离收方项目", status: "active", nodeType: "项目" }, { id: 11, code: "P11", name: "另一个项目", status: "active", nodeType: "项目" }]);
  seedRole(); permission(); db.seed(s.departmentBusinessScopes, { projectId: 10, module: "MEASUREMENT", status: "active", configuredBy: 1 });
  db.seed(s.users, [{ id: 7, name: "真实录入姓名", openId: "fixture7" }, { id: 8, name: "真实复核姓名", openId: "fixture8" }]);
  state.storage.mockImplementation(async (key: string, bytes: Buffer) => { const target = path.join(state.root, key); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); return { key, url: "never-return-storage-url" }; });
});
afterEach(async () => { db.close(); await fs.rm(state.root || "nonexistent-fixture", { force: true, recursive: true }); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("收方详情真实caller / SQLite谓词 / 真实保护helpers", () => {
  it("新建详情保存真实TO编号、JSON明细、复算金额及真实审计链，同请求回执只一次", async () => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput);
    const input = { ...baseInput, documentRequestKey: "real-retry", workDescription: "完整详细说明", measurementBasis: "测量依据", measurementRows: [row], attachmentEvidenceIds: [uploaded.evidenceId] };
    const [a, b] = await Promise.all([caller().saveTakeoff(input), caller().saveTakeoff(input)]); expect(a).toEqual(b);
    const record = db.rows(s.measurementTakeoffRecords)[0]; expect(record.takeoffNo).toMatch(/^TO\d{14}0007\d{4}$/); expect(record.quantity).toBe("100"); expect(record.declaredAmount).toBe("2350"); expect(record.measurementRows).toEqual([row]);
    expect(db.rows(s.businessDocumentNumberAllocations)).toHaveLength(1); expect(db.rows(s.businessDocumentCreationReceipts)).toHaveLength(1); expect(db.rows(s.measurementTakeoffEvidences)).toHaveLength(1);
    expect(db.rows(s.evidenceRecords)[0].sourceId).toBe(`takeoff-${a.takeoffId}`);
    expect(db.rows(s.auditLogIntegrityEvents)).toHaveLength(3); const events = db.rows(s.auditLogIntegrityEvents); expect(events[1].previousHash).toBe(events[0].entryHash); expect(events[2].previousHash).toBe(events[1].entryHash); expect(db.rows(s.auditLogChainState)[0].lastHash).toBe(events[2].entryHash);
    const detail = await caller().getTakeoffDetail({ projectId: 10, id: a.takeoffId }); expect(detail.record.version).toBe(a.version); expect(detail.submittedByName).toBe("真实录入姓名"); expect(detail.evidences).toHaveLength(1);
    expect(state.notify).not.toHaveBeenCalled();
  });
  it("省略新字段保留、显式空串空数组清空，附件空数组只新增语义且不删原图/旧号", async () => {
    oldRecord({ workDescription: "原详细", measurementBasis: "原依据", measurementRows: [row] }); evidence(); db.seed(s.measurementTakeoffEvidences, { takeoffId: 50, evidenceId: 20, linkedBy: 7 });
    const old = await caller().getTakeoffDetail({ projectId: 10, id: 50 });
    await caller().saveTakeoff({ ...baseInput, id: 50, expectedVersion: old.record.version, attachmentEvidenceIds: [] });
    expect(db.rows(s.measurementTakeoffRecords)[0]).toMatchObject({ takeoffNo: "LEGACY-TO", workDescription: "原详细", measurementBasis: "原依据", measurementRows: [row] });
    const updated = await caller().getTakeoffDetail({ projectId: 10, id: 50 });
    await caller().saveTakeoff({ ...baseInput, id: 50, expectedVersion: updated.record.version, workDescription: "", measurementBasis: "", measurementRows: [] });
    expect(db.rows(s.measurementTakeoffRecords)[0]).toMatchObject({ workDescription: "", measurementBasis: "", measurementRows: [] }); expect(db.rows(s.measurementTakeoffEvidences)).toHaveLength(1); expect(db.rows(s.evidenceRecords)[0].status).toBe("active"); expect(db.rows(s.businessDocumentNumberAllocations)).toHaveLength(0);
    const retain = db.rows(s.auditLogs).filter(a => a.action === "retain_evidence_binding_pointers"); expect(retain).toHaveLength(2); expect(retain[1].beforeJson).toContain("old-20.png"); expect(retain[1].afterJson).toContain('"evidenceId":20');
  });
  it("同秒hash+真实审计id强版本变化、旧version冲突；无version仍保留真实状态CAS", async () => {
    oldRecord(); const first = await caller().getTakeoffDetail({ projectId: 10, id: 50 });
    const saved = await caller().saveTakeoff({ ...baseInput, id: 50, expectedVersion: first.record.version }); expect(saved.version).not.toBe(first.record.version); expect(db.rows(s.measurementTakeoffRecords)[0].updatedAt).toEqual(fixed);
    const before = db.snapshot(); await expect(caller().saveTakeoff({ ...baseInput, id: 50, expectedVersion: first.record.version })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.snapshot()).toEqual(before);
    db.zeroUpdateTable = "measurement_takeoff_records"; await expect(caller().saveTakeoff({ ...baseInput, id: 50 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.snapshot()).toEqual(before);
  });
  it("附件新增和存储指针/内容变化都进入版本，稳定canonical不依赖对象字段顺序", async () => {
    oldRecord(); evidence(); const record = db.rows(s.measurementTakeoffRecords)[0], image = db.rows(s.evidenceRecords)[0];
    expect(takeoffVersion(record, 0, [image])).not.toBe(takeoffVersion(record, 1, [image])); expect(takeoffVersion(record, 0, [])).not.toBe(takeoffVersion(record, 0, [image])); expect(takeoffVersion(record, 0, [image])).not.toBe(takeoffVersion(record, 0, [{ ...image, fileKey: "changed.png" }]));
    expect(takeoffVersion(record, 0, [image])).toBe(takeoffVersion(Object.fromEntries(Object.entries(record).reverse()) as any, 0, [image]));
  });
  it.each(["submitted", "reviewing", "approved", "locked", "void"])("状态%s保存与上传不能改原数据", async status => {
    oldRecord({ status }); const before = db.snapshot(); await expect(caller().saveTakeoff({ ...baseInput, id: 50 })).rejects.toMatchObject({ code: "CONFLICT" }); await expect(caller().uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.snapshot()).toEqual(before); expect(state.storage).not.toHaveBeenCalled();
  });
  it("退回可重新维护但不自动改工程量或正式号", async () => { oldRecord({ status: "rejected" }); await caller().saveTakeoff({ ...baseInput, id: 50, measurementRows: [{ ...row, quantity: 900 }] }); expect(db.rows(s.measurementTakeoffRecords)[0]).toMatchObject({ status: "draft", quantity: "100", takeoffNo: "LEGACY-TO" }); });
  it.each(["audit_logs", "audit_log_integrity_events", "measurement_takeoff_evidences", "business_document_number_counters"])("真实%s失败编号、业务、图片sourceCAS、审计全部回滚", async table => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput); const before = db.snapshot(); db.failInsertTable = table;
    await expect(caller().saveTakeoff({ ...baseInput, documentRequestKey: "failed-retry", attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toThrow("injected"); expect(db.snapshot()).toEqual(before);
  });
  it("来源CAS零写回滚业务与真实编号，不会接管已变来源图片", async () => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput); const before = db.snapshot(); db.zeroUpdateTable = "evidence_records";
    await expect(caller().saveTakeoff({ ...baseInput, attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.snapshot()).toEqual(before);
  });
  it("共同项目锁后实际MEASUREMENT scope收回再次拒绝", async () => {
    let changed = false; db.beforeSelect = table => { if (table === "projects" && db.locks.includes("projects:update") && !changed) { changed = true; (db as any).sqlite.exec("UPDATE department_business_scopes SET status='disabled' WHERE projectId=10"); } };
    await expect(caller().saveTakeoff(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows(s.measurementTakeoffRecords)).toHaveLength(0); expect(db.rows(s.businessDocumentNumberAllocations)).toHaveLength(0);
  });
  it("证据锁后父单变审核状态再次拒绝；项目→证据→父单锁序可观察", async () => {
    oldRecord(); evidence(); let changed = false;
    db.beforeSelect = table => { if (table === "evidence_records" && db.locks.includes("evidence_records:update") && !changed) { changed = true; (db as any).sqlite.exec("UPDATE measurement_takeoff_records SET status='approved' WHERE id=50"); } };
    await expect(caller().saveTakeoff({ ...baseInput, id: 50 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.locks.indexOf("projects:update")).toBeLessThan(db.locks.indexOf("evidence_records:update")); expect(db.locks.indexOf("evidence_records:update")).toBeLessThan(db.locks.indexOf("measurement_takeoff_records:update")); expect(db.rows(s.auditLogs)).toHaveLength(0);
  });
  it("新字段和行限额、有限非负尺寸、不eval、无效强version都由真实RPC验证", async () => {
    for (const patch of [{ workDescription: "x".repeat(10001) }, { measurementBasis: "x".repeat(2001) }, { measurementRows: Array(101).fill(row) }, { measurementRows: [{ ...row, length: -1 }] }, { measurementRows: [{ ...row, quantity: Number.POSITIVE_INFINITY }] }, { expectedVersion: "2026-11-25" }, { attachmentEvidenceIds: Array(21).fill(20) }]) await expect(caller().saveTakeoff({ ...baseInput, ...patch } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller().saveTakeoff({ ...baseInput, measurementRows: [{ ...row, calculation: "throw new Error('must never execute')" }] }); expect(db.rows(s.measurementTakeoffRecords)[0].declaredAmount).toBe("2350");
  });
});

describe("本人专属pending、真实岗位范围/采集配置与图片限制", () => {
  it("仅MEASUREMENT授权可以上传，不要求EVIDENCE模块；真实地理坐标和归档时刻落库", async () => {
    db.seed(s.systemSettings, { settingKey: "EVIDENCE_LOCATION_REQUIRED", valueJson: "true", status: "published", isSensitive: false });
    await expect(caller().uploadTakeoffAttachment(uploadInput)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state.storage).not.toHaveBeenCalled();
    const result = await caller().uploadTakeoffAttachment({ ...uploadInput, longitude: 116.4, latitude: 39.9, capturedAt: fixed.toISOString() }); const image = db.rows(s.evidenceRecords)[0];
    expect(result).toEqual({ success: true, evidenceId: image.id, fileName: "现场.png", mimeType: "image/png" }); expect(image).toMatchObject({ longitude: "116.4", latitude: "39.9", contentBytes: png.length, contentSha256: hash(png), uploadedBy: 7 }); expect(JSON.parse(image.watermarkJson)).toMatchObject({ takeoffAttachment: true, pendingTakeoffId: null, capturedAtMeaning: "本次归档记录时刻（非EXIF核验）" });
  });
  it.each(["EVIDENCE_CAMERA_PROVIDER", "EVIDENCE_LOCATION_REQUIRED"])("发布采集配置%s在存储返回后锁内重新核验", async key => {
    const original = state.storage.getMockImplementation()!; state.storage.mockImplementation(async (...args: any[]) => { const result = await original(...args); db.seed(s.systemSettings, { settingKey: key, valueJson: key.includes("CAMERA") ? "disabled" : "true", status: "published", isSensitive: false }); return result; });
    await expect(caller().uploadTakeoffAttachment(uploadInput)).rejects.toMatchObject({ code: key.includes("CAMERA") ? "FORBIDDEN" : "BAD_REQUEST" }); expect(db.rows(s.evidenceRecords)).toHaveLength(0); expect(db.rows(s.auditLogs)).toHaveLength(0);
  });
  it("真实required配置忽略草稿和敏感项，已停用camera不入存储", async () => {
    db.seed(s.systemSettings, [{ settingKey: "EVIDENCE_LOCATION_REQUIRED", valueJson: "true", status: "draft", isSensitive: false }, { settingKey: "EVIDENCE_CAMERA_PROVIDER", valueJson: "disabled", status: "published", isSensitive: false }]);
    expect(await caller().captureConfig()).toMatchObject({ camera: { enabled: false }, location: { required: false } }); await expect(caller().uploadTakeoffAttachment(uploadInput)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state.storage).not.toHaveBeenCalled();
  });
  it.each(["suspended", "completed", "archived"])("停用或归档项目%s不允许新建/上传", async status => {
    await db.update(s.projects).set({ status }).where(eq(s.projects.id, 10)); await expect(caller(ctx(1, "admin")).saveTakeoff(baseInput)).rejects.toMatchObject({ code: "BAD_REQUEST" }); await expect(caller(ctx(1, "admin")).uploadTakeoffAttachment(uploadInput)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state.storage).not.toHaveBeenCalled();
  });
  it.each(["SITE_MANAGER", "MEASUREMENT_MANAGER", "FINANCE_MANAGER"])("岗位%s不能借新附件上传维护权限", async code => {
    db.seed(s.systemRoles, { id: 22, code, status: "active" }); seedRole(code, 22, 10, 22); permission(["read", "create", "edit", "print"], 22);
    await expect(caller(ctx(22)).uploadTakeoffAttachment(uploadInput)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(state.storage).not.toHaveBeenCalled();
  });
  it.each(["create", "edit", "submit"])("收方上传仅%s详细授权按新建或编辑判定，不把upload误推提交", async action => {
    seedRole("PROJECT_MANAGER", 22, 10, 22); permission(["read", action], 22); oldRecord({ submittedBy: 22 });
    const actor = caller(ctx(22));
    if (action === "create") await expect(actor.uploadTakeoffAttachment(uploadInput)).resolves.toMatchObject({ success: true });
    else await expect(actor.uploadTakeoffAttachment(uploadInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    if (action === "edit") await expect(actor.uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 })).resolves.toMatchObject({ success: true });
    else await expect(actor.uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.storage).toHaveBeenCalledTimes(action === "submit" ? 0 : 1);
  });
  it.each(["create", "edit", "submit"])("收方保存仅%s授权与照片维护一致，既有记录仍须强版本及真实edit授权", async action => {
    seedRole("PROJECT_MANAGER", 22, 10, 22); permission(["read", action], 22); oldRecord({ submittedBy: 22 });
    const actor = caller(ctx(22));
    if (action === "create") await expect(actor.saveTakeoff(baseInput)).resolves.toMatchObject({ success: true });
    else await expect(actor.saveTakeoff(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const old = await actor.getTakeoffDetail({ projectId: 10, id: 50 });
    const patch = { ...baseInput, id: 50, expectedVersion: old.record.version, workDescription: "仅获编辑的维护原单" };
    if (action === "edit") await expect(actor.saveTakeoff(patch)).resolves.toMatchObject({ success: true, takeoffId: 50 });
    else await expect(actor.saveTakeoff(patch)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.rows(s.measurementTakeoffRecords).find(r => r.id === 50).takeoffNo).toBe("LEGACY-TO");
  });
  it("跨项目、未登录、已有记录无显式edit授权均拒绝", async () => {
    oldRecord(); await expect(caller().uploadTakeoffAttachment({ ...uploadInput, projectId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(caller({ ...ctx(), user: null }).saveTakeoff(baseInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    (db as any).sqlite.exec("DELETE FROM role_permissions"); await expect(caller().saveTakeoff({ ...baseInput, id: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(caller().uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("8MB含边界JPEG/PNG真magic接受，超8MB/伪magic/编码和地理伪值在storage前拒绝", async () => {
    const max = Buffer.alloc(8 * 1024 * 1024); jpeg.copy(max); await caller().uploadTakeoffAttachment({ ...uploadInput, mimeType: "image/jpeg", base64Data: max.toString("base64") });
    for (const patch of [{ base64Data: Buffer.concat([max, Buffer.from([0])]).toString("base64"), mimeType: "image/jpeg" }, { base64Data: Buffer.from("<script>bad</script>").toString("base64") }, { base64Data: jpeg.toString("base64") }, { base64Data: "!!!!" }, { longitude: 181, latitude: 91 }, { longitude: 1, latitude: Number.NaN }]) await expect(caller().uploadTakeoffAttachment({ ...uploadInput, ...patch } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(state.storage).toHaveBeenCalledTimes(1);
  });
  it("迟到上传父单变审核状态不入库、不绑定，完成存储文件不物删", async () => {
    oldRecord(); const original = state.storage.getMockImplementation()!; state.storage.mockImplementation(async (...args: any[]) => { const result = await original(...args); await db.update(s.measurementTakeoffRecords).set({ status: "approved" }).where(eq(s.measurementTakeoffRecords.id, 50)); return result; });
    await expect(caller().uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows(s.evidenceRecords)).toHaveLength(0); expect(db.rows(s.measurementTakeoffRecords)[0].status).toBe("approved");
  });
  it.each([{ uploadedBy: 8 }, { sourceId: "takeoff-pending-8-12345678-1234-1234-1234-123456789abc" }, { watermarkJson: '{}' }, { watermarkJson: '{"takeoffAttachment":true,"pendingTakeoffId":50}' }, { sourceId: "takeoff-51" }, { sourceType: "financial_invoice" }, { contentBytes: 0 }, { contentSha256: null }])("实际上传产物被修改%j不能绑定且原证据保留", async patch => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput); await db.update(s.evidenceRecords).set(patch).where(eq(s.evidenceRecords.id, uploaded.evidenceId)); const before = db.snapshot();
    await expect(caller().saveTakeoff({ ...baseInput, attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.snapshot()).toEqual(before);
  });
  it.each([s.financialRecords, s.financialInvoices, s.outsourceContracts])("真实财税/合同历史引用%s不能被pending元数据洗白", async table => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput); db.seed(table, { id: 80, projectId: 10, [table === s.outsourceContracts ? "attachmentEvidenceId" : "evidenceId"]: uploaded.evidenceId }); const before = db.snapshot(); await expect(caller().saveTakeoff({ ...baseInput, attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.snapshot()).toEqual(before);
  });
});

describe("详情/打印所有实际引用和受控预览完整字节授权", () => {
  it("详情和每次打印都读全部linked及旧未linked takeoff-id，旧null字段/文件名明确表示未记录", async () => {
    const historicalCaption = "历史说明".repeat(200) + "不可截断的历史尾文";
    oldRecord({ reviewedBy: 8 }); evidence(20, { sourceId: null, fileName: null, watermarkJson: JSON.stringify({ description: historicalCaption }) }); evidence(21); db.seed(s.measurementTakeoffEvidences, { takeoffId: 50, evidenceId: 20, linkedBy: 7 });
    const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); expect(detail.evidences.map(e => e.evidenceId)).toEqual([20, 21]); expect(detail.evidences[0].fileName).toBe("历史照片（文件名未记录）"); expect(detail.record).toMatchObject({ workDescription: null, measurementBasis: null, measurementRows: null }); expect(detail.reviewedByName).toBe("真实复核姓名");
    evidence(22); const printed = await caller().getTakeoffPrint({ projectId: 10, id: 50 }); expect(printed.evidences.map(e => e.evidenceId)).toEqual([20, 21, 22]); expect(printed.record.version).not.toBe(detail.record.version);
    expect(detail.evidences[0].description).toBe(historicalCaption); expect(printed.evidences[0].description).toBe(historicalCaption);
    const json = JSON.stringify(printed); for (const forbidden of ["fileKey", "contentSha256", "watermarkJson", "不返回的OCR", "13800000000", "evidence/10", "fixture.invalid"]) expect(json).not.toContain(forbidden); expect(printed.evidences.every(e => /^\/api\/measurement-takeoff\/preview\/[a-f0-9]{32}$/.test(e.url))).toBe(true);
  });
  it.each([{ missing: true }, { status: "deleted" }, { projectId: 11 }, { sourceId: "takeoff-51" }, { sourceType: "financial_invoice" }, { mimeType: "text/html" }, { contentBytes: -1 }])("坏linked引用%j不静默跳过详情或打印", async patch => {
    oldRecord(); if (!patch.missing) { const { missing: _missing, ...values } = patch as any; evidence(20, values); } db.seed(s.measurementTakeoffEvidences, { takeoffId: 50, evidenceId: 20, linkedBy: 7 });
    for (const method of ["getTakeoffDetail", "getTakeoffPrint"] as const) await expect(caller()[method]({ projectId: 10, id: 50 })).rejects.toMatchObject({ code: patch.missing ? "CONFLICT" : "FORBIDDEN" });
  });
  it("旧未linked坏takeoff-id和实际财务专用引用也拒绝，不因未linked遗漏", async () => {
    oldRecord(); evidence(20, { status: "deleted" }); await expect(caller().getTakeoffPrint({ projectId: 10, id: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" }); await db.update(s.evidenceRecords).set({ status: "active" }).where(eq(s.evidenceRecords.id, 20)); db.seed(s.financialRecords, { id: 90, evidenceId: 20, projectId: 10 }); await expect(caller().getTakeoffDetail({ projectId: 10, id: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("受控HTTP handler实际完整发送本地PNG字节且不跳转，token绑定用户和登录", async () => {
    oldRecord(); evidence(); await storeOld(); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); const result = await preview(detail.evidences[0].url);
    expect(result.status).toBe(200); expect(result.body).toEqual(png); expect(result.headers).toMatchObject({ "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Disposition": "inline", "Referrer-Policy": "no-referrer" }); expect(result.headers.Location).toBeUndefined();
    expect((await preview(detail.evidences[0].url, ctx(8).user)).status).toBe(403); expect((await preview(detail.evidences[0].url, null)).status).toBe(403); expect((await preview("/api/measurement-takeoff/preview/forged")).status).toBe(410);
  });
  it.each(["scope", "role", "source", "project"])("token签发后%s撤销或改变实际预览再次重验", async kind => {
    oldRecord(); evidence(); await storeOld(); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 });
    if (kind === "scope") await db.update(s.departmentBusinessScopes).set({ status: "disabled" }).where(eq(s.departmentBusinessScopes.projectId, 10));
    if (kind === "role") await db.update(s.userRoleAssignments).set({ status: "revoked" }).where(eq(s.userRoleAssignments.userId, 7));
    if (kind === "source") await db.update(s.evidenceRecords).set({ sourceId: "takeoff-51" }).where(eq(s.evidenceRecords.id, 20));
    if (kind === "project") await db.update(s.measurementTakeoffRecords).set({ projectId: 11 }).where(eq(s.measurementTakeoffRecords.id, 50));
    const result = await preview(detail.evidences[0].url); expect([403, 404]).toContain(result.status); expect(Buffer.isBuffer(result.body)).toBe(false);
  });
  it("print-only令牌每次重验print授权，不以read权限替代", async () => {
    oldRecord(); evidence(); await storeOld(); const detail = await caller().getTakeoffPrint({ projectId: 10, id: 50 }); const printPermission = db.rows(s.systemPermissions).find(p => p.action === "print"); await db.delete(s.rolePermissions).where(eq(s.rolePermissions.permissionId, printPermission.id));
    expect((await preview(detail.evidences[0].url)).status).toBe(403); await expect(caller().getTakeoffPrint({ projectId: 10, id: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect((await caller().getTakeoffDetail({ projectId: 10, id: 50 })).evidences).toHaveLength(1);
  });
  it.each(["magic", "digest", "length", "oversize", "path"])("真实存储%s失效不发送图片字节", async kind => {
    oldRecord(); evidence(); let bytes = png;
    if (kind === "magic") { bytes = Buffer.alloc(png.length, 65); await db.update(s.evidenceRecords).set({ contentSha256: hash(bytes) }).where(eq(s.evidenceRecords.id, 20)); }
    if (kind === "digest") bytes = Buffer.concat([png.subarray(0, png.length - 1), Buffer.from([0])]);
    if (kind === "length") bytes = Buffer.concat([png, Buffer.from([0])]);
    if (kind === "oversize") bytes = Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]);
    if (kind === "path") await db.update(s.evidenceRecords).set({ fileKey: "../escape.png" }).where(eq(s.evidenceRecords.id, 20)); else await storeOld(20, bytes);
    const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); const result = await preview(detail.evidences[0].url); expect(result.status).toBe(404); expect(Buffer.isBuffer(result.body)).toBe(false);
  });
  it("远端完整流校验后才发送；流读取期间项目scope撤销实际再拒绝", async () => {
    oldRecord(); evidence(); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); const savedRoot = state.root; state.root = "";
    vi.stubGlobal("fetch", vi.fn(async () => { await db.update(s.departmentBusinessScopes).set({ status: "disabled" }).where(eq(s.departmentBusinessScopes.projectId, 10)); return new Response(png); }));
    try { const result = await preview(detail.evidences[0].url); expect(result.status).toBe(403); expect(Buffer.isBuffer(result.body)).toBe(false); } finally { state.root = savedRoot; }
  });
  it("完整远端JPEG字节返回且过期token不再读storage", async () => {
    oldRecord(); evidence(20, { mimeType: "image/jpeg", contentBytes: jpeg.length, contentSha256: hash(jpeg) }); assertEvidenceImageSignature(jpeg, "image/jpeg"); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); const savedRoot = state.root; state.root = ""; const fetchMock = vi.fn(async () => new Response(jpeg)); vi.stubGlobal("fetch", fetchMock);
    try { const result = await preview(detail.evidences[0].url); expect(result.status).toBe(200); expect(result.body).toEqual(jpeg); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60 * 1000); expect((await preview(detail.evidences[0].url)).status).toBe(410); expect(fetchMock).toHaveBeenCalledTimes(1); } finally { state.root = savedRoot; }
  });
});

describe("补充真实条件写与历史保留边界", () => {
  it.each([-1, 1.5, 8 * 1024 * 1024 + 1])("待绑定图片contentBytes=%s不接受伪完整性元数据", async contentBytes => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput); await db.update(s.evidenceRecords).set({ contentBytes }).where(eq(s.evidenceRecords.id, uploaded.evidenceId)); const before = db.snapshot();
    await expect(caller().saveTakeoff({ ...baseInput, attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.snapshot()).toEqual(before);
  });
  it("真实source谓词遇到待绑定来源被改写会零更新，整笔编号和业务回滚", async () => {
    const uploaded = await caller().uploadTakeoffAttachment(uploadInput); const before = db.snapshot(); let changed = false;
    db.beforeWrite = table => { if (table === "evidence_records" && !changed) { changed = true; (db as any).sqlite.exec(`UPDATE evidence_records SET sourceId='takeoff-999' WHERE id=${uploaded.evidenceId}`); } };
    await expect(caller().saveTakeoff({ ...baseInput, attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toMatchObject({ code: "CONFLICT" }); expect(changed).toBe(true); expect(db.snapshot()).toEqual(before);
  });
  it.each(["deleted", "missing"])("保存省略附件仍retain历史%s原ID，不新增绑定授权或静默删除", async kind => {
    oldRecord(); if (kind !== "missing") evidence(20, { status: "deleted" }); db.seed(s.measurementTakeoffEvidences, { takeoffId: 50, evidenceId: 20, linkedBy: 7 });
    await caller().saveTakeoff({ ...baseInput, id: 50, workDescription: "只维护收方正文" }); expect(db.rows(s.measurementTakeoffEvidences)).toHaveLength(1); expect(db.rows(s.measurementTakeoffEvidences)[0].evidenceId).toBe(20);
    const retain = db.rows(s.auditLogs).find(a => a.action === "retain_evidence_binding_pointers"); expect(retain.beforeJson).toContain('"evidenceId":20'); expect(retain.afterJson).toContain('"evidenceId":20'); if (kind !== "missing") expect(retain.afterJson).toContain("old-20.png");
    await expect(caller().getTakeoffPrint({ projectId: 10, id: 50 })).rejects.toMatchObject({ code: kind === "missing" ? "CONFLICT" : "FORBIDDEN" });
  });
  it("证据锁等待后撤销实际岗位，维护写入与审计全部拒绝", async () => {
    oldRecord(); evidence(); let changed = false;
    db.beforeSelect = table => { if (table === "evidence_records" && db.locks.includes("evidence_records:update") && !changed) { changed = true; (db as any).sqlite.exec("UPDATE user_role_assignments SET status='revoked' WHERE userId=7"); } };
    await expect(caller().saveTakeoff({ ...baseInput, id: 50 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(changed).toBe(true); expect(db.rows(s.auditLogs)).toHaveLength(0); expect(db.rows(s.measurementTakeoffRecords)[0].workItem).toBe("历史土方");
  });
  it("同用户其他表单的pendingTakeoffId仍不可接管；绑定正确表单后原图保留", async () => {
    oldRecord(); const uploaded = await caller().uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 }); const before = db.snapshot(); await expect(caller().saveTakeoff({ ...baseInput, attachmentEvidenceIds: [uploaded.evidenceId] })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.snapshot()).toEqual(before);
    await caller().saveTakeoff({ ...baseInput, id: 50, attachmentEvidenceIds: [uploaded.evidenceId] }); expect(db.rows(s.evidenceRecords)[0].sourceId).toBe("takeoff-50"); expect((await caller().getTakeoffDetail({ projectId: 10, id: 50 })).evidences[0].evidenceId).toBe(uploaded.evidenceId);
  });
  it("真实申报项目与状态锁校验不能通过收方跨域关联", async () => {
    db.seed(s.measurementClaims, [{ id: 30, projectId: 11, status: "draft" }, { id: 31, projectId: 10, status: "void" }]);
    await expect(caller().saveTakeoff({ ...baseInput, measurementClaimId: 30 })).rejects.toMatchObject({ code: "NOT_FOUND" }); await expect(caller().saveTakeoff({ ...baseInput, measurementClaimId: 31 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows(s.businessDocumentNumberAllocations)).toHaveLength(0); expect(db.rows(s.measurementTakeoffRecords)).toHaveLength(0);
  });
  it("旧linked-null原照片不会被新附件绑定替换；新来源可真实预览", async () => {
    oldRecord(); evidence(20, { sourceId: null }); db.seed(s.measurementTakeoffEvidences, { takeoffId: 50, evidenceId: 20, linkedBy: 7 }); await storeOld(); const uploaded = await caller().uploadTakeoffAttachment({ ...uploadInput, takeoffId: 50 });
    await caller().saveTakeoff({ ...baseInput, id: 50, attachmentEvidenceIds: [uploaded.evidenceId] }); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); expect(detail.evidences.map(e => e.evidenceId)).toEqual([20, uploaded.evidenceId]); expect(db.rows(s.evidenceRecords).find(e => e.id === 20).sourceId).toBeNull(); expect((await preview(detail.evidences[1].url)).body).toEqual(png);
  });
  it("token签发后本地账号初始密码未更改不能读取照片", async () => {
    oldRecord(); evidence(); await storeOld(); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); const result = await preview(detail.evidences[0].url, { ...ctx().user, loginMethod: "local_manager", localPasswordChangeRequired: true } as any); expect(result.status).toBe(403); expect(Buffer.isBuffer(result.body)).toBe(false);
  });
  it("远端超限流即使不声明content-length也中止，不发送已读前缀", async () => {
    oldRecord(); evidence(20, { contentBytes: null, contentSha256: null }); const detail = await caller().getTakeoffDetail({ projectId: 10, id: 50 }); const savedRoot = state.root; state.root = "";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(png); controller.enqueue(new Uint8Array(8 * 1024 * 1024)); controller.close(); } }))));
    try { const result = await preview(detail.evidences[0].url); expect(result.status).toBe(404); expect(Buffer.isBuffer(result.body)).toBe(false); } finally { state.root = savedRoot; }
  });
  it("版本hash覆盖展示caption/时间/MIME与图片字节长度变化", async () => {
    oldRecord(); evidence(); const record = db.rows(s.measurementTakeoffRecords)[0], image = db.rows(s.evidenceRecords)[0], original = takeoffVersion(record, 0, [image]);
    for (const patch of [{ watermarkJson: JSON.stringify({ description: "caption已改" }) }, { capturedAt: new Date(fixed.getTime() + 1) }, { mimeType: "image/jpeg" }, { contentBytes: png.length + 1 }]) expect(takeoffVersion(record, 0, [{ ...image, ...patch }])).not.toBe(original);
  });
});
