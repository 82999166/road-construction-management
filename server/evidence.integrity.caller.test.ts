import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import * as s from "../drizzle/schema";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn(async key => `signed:${key}`), storagePut: vi.fn(async () => ({ key: "evidence/2/new.jpg", url: "stored" })) }));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./services/auditIntegrity", () => ({ appendIntegrityProtectedAudit: vi.fn(async () => ({ auditLogId: 7 })) }));
vi.mock("./access", async original => ({
  ...await original<typeof import("./access")>(),
  assertDepartmentBusinessAccess: vi.fn(), assertProjectInCurrentScope: vi.fn(),
  assertExistingBusinessRecordChangeAccess: vi.fn(), getDepartmentModuleDataScope: vi.fn(),
  getEffectiveRoleCodes: vi.fn(), getRoleOperationPermissionDecision: vi.fn(), getSuperAdminAccess: vi.fn(),
}));
import { getDb } from "./db";
import { assertDepartmentBusinessAccess, assertExistingBusinessRecordChangeAccess, getDepartmentModuleDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision, getSuperAdminAccess } from "./access";
import { storageGetSignedUrl, storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { appendIntegrityProtectedAudit } from "./services/auditIntegrity";
import { evidenceRouter } from "./routers/evidence";
import { router } from "./_core/trpc";
import { EVIDENCE_REFERENCE_REGISTRY, lockActiveEvidenceForBinding, type EvidenceRow, valueReferencesEvidence } from "./services/evidenceIntegrity";

const mounted = router({ evidence: evidenceRouter });
const ctx = { user: { id: 9, role: "admin", openId: "evidence-isolated", name: "附件测试", loginMethod: "manus" }, req: {}, res: {} } as TrpcContext;
const base = { id: 28, projectId: 2, sourceType: "site_photo", sourceId: null, status: "active", uploadedBy: 9, fileKey: "evidence/2/old.jpg", fileName: "原始水印.jpg", mimeType: "image/jpeg", contentSha256: "a".repeat(64), contentBytes: 4, watermarkJson: '{"description":"现场","version":1}', retentionUntil: null, longitude: "120", latitude: "30" } as EvidenceRow;
const upload = { projectId: 2, sourceType: "site_photo" as const, sourceId: "construction-report-3", description: "施工日报现场水印", capturedAt: "2026-11-24T01:00:00.000Z", fileName: "现场.jpg", mimeType: "image/jpeg" as const, base64Data: Buffer.from([255,216,255,217]).toString("base64") };

/** 真实 router caller；表驱动隔离事务保存/回滚，外部存储/模型/通知均不透传。 */
function database(seed: Record<string, Record<string, unknown>[]> = {}) {
  let state: Record<string, Record<string, unknown>[]> = { projects: [{ id: 2, status: "active", organizationId: 1 }], evidence_records: [{ ...base }], ...seed };
  const dialect = new MySqlDialect();
  const locks: string[] = [];
  const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
  let casRows = 1;
  let preTransaction: (() => void) | undefined;
  let tail = Promise.resolve();
  const client = () => ({
    select: vi.fn(() => {
      let name = "", where: SQL | undefined, limit = Infinity;
      const resolve = async () => {
        let rows = state[name] ?? [];
        if (where && ["evidence_records", "projects", "construction_daily_reports"].includes(name)) {
          const query = dialect.sqlToQuery(where);
          if (/`id` = \?/.test(query.sql)) rows = rows.filter(row => row.id === query.params[0]);
          else if (name === "evidence_records" && /`id` in/.test(query.sql)) rows = rows.filter(row => query.params.includes(row.id));
        }
        return rows.slice(0, limit).map(row => ({ ...row }));
      };
      const chain: any = {
        from: (table: any) => { name = getTableName(table); return chain; },
        where: (condition: SQL) => { where = condition; return chain; },
        orderBy: () => chain, limit: (value: number) => { limit = value; return chain; },
        for: async () => { locks.push(name); return resolve(); },
        then: (success: any, failure: any) => resolve().then(success, failure),
      };
      return chain;
    }),
    update: vi.fn((table: any) => ({ set: (values: Record<string, unknown>) => ({ where: async () => {
      const name = getTableName(table); writes.push({ table: name, values });
      if (casRows === 1) state[name] = (state[name] ?? []).map(row => ({ ...row, ...values }));
      return [{ affectedRows: casRows }];
    } }) })),
    insert: vi.fn((table: any) => ({ values: async (values: Record<string, unknown>) => {
      const name = getTableName(table); writes.push({ table: name, values });
      (state[name] ??= []).push({ id: 29, ...values });
      return [{ insertId: 29 }];
    } })),
  });
  const db = {
    ...client(),
    transaction: vi.fn(async (callback: (tx: ReturnType<typeof client>) => Promise<any>) => {
      let unlock!: () => void;
      const previous = tail; tail = new Promise<void>(resolve => { unlock = resolve; });
      await previous;
      preTransaction?.(); preTransaction = undefined;
      const snapshot = structuredClone(state);
      try { return await callback(client()); } catch (error) { state = snapshot; throw error; } finally { unlock(); }
    }),
  };
  return { db, locks, writes, rows: (table: string) => state[table] ?? [], setRows: (table: string, rows: any[]) => { state[table] = rows; }, failCas: () => { casRows = 0; }, beforeTransaction: (fn: () => void) => { preTransaction = fn; } };
}
function setup(seed: Parameters<typeof database>[0] = {}) {
  const model = database(seed); vi.mocked(getDb).mockResolvedValue(model.db as never); return model;
}
const caller = () => mounted.createCaller(ctx).evidence;
const reason = { id: 28, deletionReason: "误上传尚未使用，请保留正确照片" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ALL"]);
  vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [], roleCodes: ["ALL"] });
  vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({ allowed: true, hasDetailedPermissions: true } as never);
  vi.mocked(getSuperAdminAccess).mockResolvedValue({ user: ctx.user!, canAccess: true });
  vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue(undefined as never);
  vi.mocked(appendIntegrityProtectedAudit).mockResolvedValue({ auditLogId: 7 } as never);
  vi.mocked(invokeLLM).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ documentType: "收据", issuer: "", documentNo: "", issueDate: "", amount: "12", currency: "CNY", summary: "", confidence: 0.8, requiresManualReview: false }) } }] } as never);
});

const directCases: Array<[string, string]> = [
  ["attendance_records", "evidenceId"], ["machine_cost_records", "evidenceId"], ["diesel_refuel_records", "evidenceId"], ["transport_trips", "evidenceId"],
  ["transport_vehicle_usage_records", "evidenceId"], ["purchase_orders", "evidenceId"], ["purchase_orders", "invoiceEvidenceId"], ["inventory_transactions", "evidenceId"],
  ["measurement_takeoff_evidences", "evidenceId"], ["financial_records", "evidenceId"], ["financial_invoices", "evidenceId"], ["financial_invoice_originals", "evidenceId"],
  ["settlement_payment_records", "evidenceId"], ["outsource_contracts", "attachmentEvidenceId"], ["subcontract_payment_settlements", "invoiceEvidenceId"],
  ["employee_insurance_policies", "evidenceId"], ["personnel_people", "avatarEvidenceId"], ["personnel_documents", "evidenceId"], ["tax_auxiliary_entries", "evidenceId"],
  ["tax_handoff_batches", "receiptEvidenceId"], ["payroll_tax_withholding_entries", "evidenceId"], ["contract_tax_registrations", "contractEvidenceId"],
  ["contract_tax_registrations", "paymentEvidenceId"], ["cross_region_construction_tax_ledgers", "deductionEvidenceId"], ["cross_region_construction_tax_ledgers", "taxPaymentEvidenceId"],
];

describe("证据引用保护：真实caller", () => {
  it.each(directCases)("当前/作废历史 %s.%s 不得删除", async (table, column) => {
    const model = setup({ [table]: [{ id: 1, status: "void", [column]: 28 }] });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: table.match(/^(financial|settlement_payment|outsource|subcontract_payment|employee|personnel|tax|payroll|contract_tax|cross_region)/) ? "FORBIDDEN" : "BAD_REQUEST" });
    expect(model.rows("evidence_records")[0].status).toBe("active");
    expect(appendIntegrityProtectedAudit).not.toHaveBeenCalled();
  });
  it.each([
    ["transport_trips", "routeSnapshot", { unloadPhotoEvidenceId: 28 }],
    ["transport_trips", "routeSnapshot", { photos: [{ id: 3 }, { id: 28 }] }],
    ["audit_logs", "beforeJson", JSON.stringify({ old: { invoiceEvidenceId: 28 }, amount: 9 })],
    ["audit_logs", "beforeJson", '{"attachmentEvidenceId":28,broken'],
    ["audit_logs", "beforeJson", '{"attachmentEvidenceIds":[12,28],broken'],
    ["audit_logs", "summary", "原影像 #28 已改为新影像 #29"],
    ["financial_records", "remarks", "历史原指针 https://storage.example/evidence/2/old.jpg"],
    ["daily_accounting_closure_events", "snapshotJson", { proof: { id: 28 } }],
    ["vehicle_changes", "changes", { original: { attachmentEvidenceId: 28 } }],
  ])("JSON/历史/自由文本 %s.%s 保护原指针", async (table, column, value) => {
    const model = setup({ [table]: [{ id: 1, module: "operations", action: "bind", targetType: "trip", [column]: value }] });
    await expect(caller().delete(reason)).rejects.toBeDefined();
    expect(model.rows("evidence_records")[0].status).toBe("active");
  });
  it.each(["construction-report-3", "construction-report-003", "some historical free source", "transport-unload-pending-3-123"])("来源 %s 未明确核验仍保留和可预览，不宣称未引用", async sourceId => {
    setup({ evidence_records: [{ ...base, sourceId }] });
    const list = await caller().list({ projectId: 2 });
    expect(list[0]).toMatchObject({ id: 28, canDelete: false, deletionBlockedReason: expect.stringContaining("来源标记") });
    expect(list[0].url).toContain("signed:");
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("误上传软删除保留全部原字段，并锁项目、证据、引用和同事务审计", async () => {
    const model = setup({ audit_logs: [{ module: "evidence", action: "upload", targetType: "evidence", targetId: "28", afterJson: JSON.stringify({ fileKey: base.fileKey }) }] });
    await expect(caller().delete(reason)).resolves.toEqual({ success: true });
    expect(model.rows("evidence_records")[0]).toMatchObject({ ...base, status: "deleted", deletionReason: reason.deletionReason, deletedBy: 9 });
    expect(model.locks.slice(0, 2)).toEqual(["projects", "evidence_records"]);
    expect(appendIntegrityProtectedAudit).toHaveBeenCalledWith(expect.objectContaining({ select: expect.any(Function) }), expect.objectContaining({ action: "soft_delete", beforeJson: expect.stringContaining(base.fileKey) }));
  });
  it("CAS 零更新不返回成功或写审计", async () => {
    const model = setup(); model.failCas();
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(appendIntegrityProtectedAudit).not.toHaveBeenCalled();
    expect(model.rows("evidence_records")[0].status).toBe("active");
  });
  it("审计失败必须回滚软删除", async () => {
    const model = setup(); vi.mocked(appendIntegrityProtectedAudit).mockRejectedValueOnce(new Error("audit failed"));
    await expect(caller().delete(reason)).rejects.toThrow("audit failed");
    expect(model.rows("evidence_records")[0].status).toBe("active");
    expect(model.rows("evidence_records")[0].fileKey).toBe(base.fileKey);
  });
  it("审计替换以 targetId 保留旧证据，即使无beforeJson也不可删除", async () => {
    const model = setup({ audit_logs: [{ module: "evidence", action: "replace_attachment", targetType: "evidence", targetId: "28", summary: "原始证据已替换" }] });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(model.rows("evidence_records")[0].status).toBe("active");
  });
  it("free sourceType/sourceId 以数字证据号保存旧引用仍保护", async () => {
    const model = setup({ financial_records: [{ id: 1, sourceType: "evidence", sourceId: "28" }] });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(model.rows("evidence_records")[0].status).toBe("active");
  });
  it("锁前 active、锁后 deleted 的状态变化不能重复删除", async () => {
    const model = setup(); model.beforeTransaction(() => model.setRows("evidence_records", [{ ...base, status: "deleted" }]));
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(appendIntegrityProtectedAudit).not.toHaveBeenCalled();
  });
  it("删除他人误上传仍需 EVIDENCE void 权限", async () => {
    setup({ evidence_records: [{ ...base, uploadedBy: 7 }] });
    vi.mocked(assertDepartmentBusinessAccess).mockImplementation(async (_ctx, module, action) => { if (module === "EVIDENCE" && action === "void") throw new Error("no void"); return undefined as never; });
    await expect(caller().delete(reason)).rejects.toThrow("no void");
  });
  it("仅其它模块项目授权不能利用 EVIDENCE 读取、识别或删除", async () => {
    setup(); vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [], organizationIds: [], roleCodes: ["ALL"] });
    await expect(caller().list({ projectId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
});

describe("通用与专用来源边界", () => {
  it.each(["settlement_payment_proof", "financial_invoice", "personnel_avatar", "payroll_proof", "unknown"])("专用来源 %s 不签名、OCR或删除", async sourceType => {
    setup({ evidence_records: [{ ...base, sourceType }] });
    await expect(caller().list({ projectId: 2 })).resolves.toEqual([]);
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled(); expect(invokeLLM).not.toHaveBeenCalled();
  });
  it.each(["financial_records", "settlement_payment_records", "personnel_documents", "employee_insurance_policies", "payroll_tax_withholding_entries"])("other 被 %s 复用不能以 EVIDENCE 权限外露", async table => {
    setup({ evidence_records: [{ ...base, sourceType: "other" }], [table]: [{ id: 1, evidenceId: 28 }] });
    await expect(caller().list({ projectId: 2, sourceType: "other" })).resolves.toEqual([]);
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
  it("旧安全现场照片有业务引用仍保留一般预览，但不显示删除", async () => {
    setup({ transport_trips: [{ id: 4, routeSnapshot: JSON.stringify({ unloadPhotoEvidenceId: 28 }) }] });
    const list = await caller().list({ projectId: 2 });
    expect(list[0]).toMatchObject({ id: 28, canDelete: false }); expect(list[0].url).toBe(`signed:${base.fileKey}`);
  });
  it("无来源的other误上传仍可软删除；来源不明确的other不外露", async () => {
    setup({ evidence_records: [{ ...base, sourceType: "other" }] });
    await expect(caller().delete(reason)).resolves.toEqual({ success: true });
    setup({ evidence_records: [{ ...base, sourceType: "other", sourceId: "legacy-unknown" }] });
    await expect(caller().list({ projectId: 2 })).resolves.toEqual([]);
  });
  it("通用OCR active 校验、人工复核、同事务审计保持", async () => {
    const model = setup(); const result = await caller().ocr({ id: 28 });
    expect(result.ocrResult.requiresManualReview).toBe(true);
    expect(model.rows("evidence_records")[0].ocrResultJson).toContain('"requiresManualReview":true');
    expect(appendIntegrityProtectedAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ocr" }));
    setup({ evidence_records: [{ ...base, status: "deleted" }] });
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("OCR 审计失败回滚识别写入，不篡改水印", async () => {
    const model = setup(); vi.mocked(appendIntegrityProtectedAudit).mockRejectedValueOnce(new Error("audit fail"));
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(model.rows("evidence_records")[0].ocrResultJson).toBeUndefined();
    expect(model.rows("evidence_records")[0].watermarkJson).toBe(base.watermarkJson);
  });
  it("OCR 服务返回前被并发删掉时拒绝写回", async () => {
    const model = setup();
    const originalResult = await vi.mocked(invokeLLM)();
    vi.mocked(invokeLLM).mockImplementationOnce(async () => { model.setRows("evidence_records", [{ ...base, status: "deleted" }]); return originalResult; });
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(model.writes).toEqual([]);
  });
  it("专用目录的other不能在尚未绑定前被通用接口签名", async () => {
    setup({ evidence_records: [{ ...base, sourceType: "other", fileKey: "personnel-private/legacy.encrypted" }] });
    await expect(caller().list({ projectId: 2 })).resolves.toEqual([]);
    await expect(caller().ocr({ id: 28 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().delete(reason)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
});

describe("日报父单和上传结构", () => {
  it.each(["construction-report-0", "construction-report-03", "construction-report-3-extra", "construction-report-9007199254740993"])("拒绝来源ID %s", async sourceId => {
    setup(); await expect(caller().upload({ ...upload, sourceId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(storagePut).not.toHaveBeenCalled();
  });
  it.each([undefined, { id: 3, projectId: 4, status: "draft", createdBy: 9 }, { id: 3, projectId: 2, status: "submitted", createdBy: 9 }, { id: 3, projectId: 2, status: "approved", createdBy: 9 }, { id: 3, projectId: 2, status: "locked", createdBy: 9 }])("拒绝不存在、跨项目或终态父单 %j", async report => {
    setup({ construction_daily_reports: report ? [report] : [] });
    await expect(caller().upload(upload)).rejects.toBeDefined(); expect(storagePut).not.toHaveBeenCalled();
  });
  it.each(["draft", "rejected"])("%s 父单存在才允许水印上传，锁内再校验与记录真实关联", async status => {
    const model = setup({ construction_daily_reports: [{ id: 3, projectId: 2, status, createdBy: 9 }] });
    await expect(caller().upload(upload)).resolves.toMatchObject({ success: true, id: 29 });
    expect(model.rows("evidence_records")[1]).toMatchObject({ sourceType: "site_photo", sourceId: "construction-report-3", contentSha256: expect.any(String), watermarkJson: expect.stringContaining('"validatedConstructionReportId":3') });
    expect(model.locks).toContain("construction_daily_reports");
  });
  it("不能通过已有EVIDENCE权限向无施工权限日报追加照片", async () => {
    setup({ construction_daily_reports: [{ id: 3, projectId: 2, status: "draft", createdBy: 9 }] });
    vi.mocked(assertDepartmentBusinessAccess).mockImplementation(async (_ctx, module) => { if (module === "CONSTRUCTION") throw new Error("no construction"); return undefined as never; });
    await expect(caller().upload(upload)).rejects.toThrow("no construction"); expect(storagePut).not.toHaveBeenCalled();
  });
  it("施工fallback不得以自由sourceId上传；他人日报要求既有记录修改权", async () => {
    setup({ construction_daily_reports: [{ id: 3, projectId: 2, status: "draft", createdBy: 7 }] });
    vi.mocked(assertDepartmentBusinessAccess).mockImplementation(async (_ctx, module) => { if (module === "EVIDENCE") throw new Error("no evidence"); return undefined as never; });
    await expect(caller().upload({ ...upload, sourceId: "free-id" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.mocked(assertExistingBusinessRecordChangeAccess).mockRejectedValueOnce(new Error("no edit other"));
    await expect(caller().upload(upload)).rejects.toThrow("no edit other");
  });
  it("合法普通上传不被pending regex误拒绝，只是来源标记不能认定实际关联", async () => {
    const model = setup(); await expect(caller().upload({ ...upload, sourceType: "transport", sourceId: "transport-unload-pending-3-1700000000" })).resolves.toMatchObject({ success: true });
    expect(model.rows("evidence_records")[1].watermarkJson).toContain('"validatedConstructionReportId":null');
  });
  it("锁内父单变已提交，数据库不得归档新增证据", async () => {
    const model = setup({ construction_daily_reports: [{ id: 3, projectId: 2, status: "draft", createdBy: 9 }] });
    model.beforeTransaction(() => model.setRows("construction_daily_reports", [{ id: 3, projectId: 2, status: "submitted", createdBy: 9 }]));
    await expect(caller().upload(upload)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(model.rows("evidence_records")).toHaveLength(1);
  });
});

describe("统一bind helper与并发删除", () => {
  it.each(["deleted", "wrong-project", "wrong-source"])("阻断 %s 证据新绑定", async kind => {
    const row = { ...base, ...(kind === "deleted" ? { status: "deleted" } : kind === "wrong-project" ? { projectId: 4 } : { sourceType: "other" }) };
    const model = setup({ evidence_records: [row] });
    await expect(model.db.transaction(tx => lockActiveEvidenceForBinding(tx, { projectId: 2, evidenceIds: [28], allowedSourceTypes: ["site_photo"] }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("并发先绑后删：同项目证据共同锁，删看见新增引用", async () => {
    const model = setup();
    const bind = model.db.transaction(async tx => { await lockActiveEvidenceForBinding(tx, { projectId: 2, evidenceIds: [28] }); await tx.insert(s.inventoryTransactions).values({ evidenceId: 28 }); });
    const deletion = caller().delete(reason);
    await bind; await expect(deletion).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(model.rows("evidence_records")[0].status).toBe("active");
  });
  it("并发先删后绑：deleted 不得被后来绑定", async () => {
    const model = setup();
    let auditStarted!: () => void, releaseAudit!: () => void;
    const started = new Promise<void>(resolve => { auditStarted = resolve; });
    const gate = new Promise<void>(resolve => { releaseAudit = resolve; });
    vi.mocked(appendIntegrityProtectedAudit).mockImplementationOnce(async () => { auditStarted(); await gate; return { auditLogId: 7 } as never; });
    const deletion = caller().delete(reason); await started;
    const binding = model.db.transaction(tx => lockActiveEvidenceForBinding(tx, { projectId: 2, evidenceIds: [28] }));
    releaseAudit(); await deletion;
    await expect(binding).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(model.rows("inventory_transactions")).toEqual([]);
  });
  it("历史原指针精确识别，不把金额和业务ID误当引用", () => {
    expect(valueReferencesEvidence({ amount: 28, sourceId: 28, id: 28 }, base)).toBe(false);
    expect(valueReferencesEvidence({ attachmentEvidenceIds: [1, 28] }, base)).toBe(true);
    expect(valueReferencesEvidence({ before: { photo: { id: 28 } } }, base)).toBe(true);
    expect(valueReferencesEvidence("影像 #280", base)).toBe(false);
    expect(valueReferencesEvidence("https://example/" + encodeURIComponent(base.fileKey), base)).toBe(true);
  });
  it("注册表由schema覆盖所有直指针，包括二级附件", () => {
    for (const [table, column] of directCases) expect(EVIDENCE_REFERENCE_REGISTRY.find(entry => entry.name === table)?.direct.map(([name]) => name)).toContain(column);
  });
});
