import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const state = vi.hoisted(() => ({ db: null as any, roles: ["ALL"], modules: null as string[] | null, failAudit: false, effects: vi.fn(async () => {}) }));
vi.mock("./db", () => ({ getDb: async () => state.db }));
vi.mock("./access", async original => ({
  ...await original<typeof import("./access")>(),
  assertDepartmentBusinessAccess: async (_ctx: unknown, module: string) => { if (state.modules && !state.modules.includes(module)) throw new TRPCError({ code: "FORBIDDEN", message: "未授权业务模块" }); },
  assertProjectInCurrentScope: async (_ctx: unknown, id: number) => { if (id !== 2) throw new TRPCError({ code: "FORBIDDEN", message: "项目未授权" }); },
  getEffectiveRoleCodes: async () => [...state.roles],
  getDepartmentModuleDataScope: async () => ({ hasAllProjects: false, projectIds: [2], organizationIds: [] }),
  hasUserSpecificOperationPermission: async () => false,
}));
vi.mock("./storage", () => ({ storagePut: async (key: string) => ({ key, url: "https://isolated.invalid/asset" }), storageGetSignedUrl: async () => "https://isolated.invalid/asset" }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: state.effects }));
vi.mock("./services/auditIntegrity", () => ({ appendIntegrityProtectedAudit: async (tx: any, value: any) => { if (state.failAudit) throw new Error("protected audit failed"); await tx.insert((await import("../drizzle/schema")).auditLogs).values(value); } }));
import { contractRouter } from "./routers/contracts";
import { financeRouter, measurementRouter, purchasingRouter } from "./routers/finance";
import { subcontractRouter } from "./routers/subcontract";
import { evidenceRouter } from "./routers/evidence";
import { router } from "./_core/trpc";
const mounted = router({ contract: contractRouter, finance: financeRouter, measurement: measurementRouter, purchasing: purchasingRouter, subcontract: subcontractRouter, evidence: evidenceRouter });
const context = { user: { id: 9, role: "admin", name: "契约兼容隔离验证", openId: "source-compatibility" }, req: {}, res: {} } as TrpcContext;
const caller = () => mounted.createCaller(context);
const normalize = (value: any): any => value instanceof Date ? value.toISOString().slice(0, 23).replace("T", " ") : typeof value === "boolean" ? Number(value) : value && typeof value === "object" ? JSON.stringify(value) : value ?? null;
/** Execute actual Drizzle predicates against isolated in-memory SQL; helpers and routers are not mocked. */
class Database {
  rows: Record<string, any[]> = { projects: [{ id: 2, status: "active" }], evidence_records: [], audit_logs: [], measurement_takeoff_records: [{ id: 7, projectId: 2, status: "draft", createdBy: 9 }], outsource_contracts: [{ id: 5, projectId: 2, status: "draft", createdBy: 9, contractNo: "LEGACY-CONTRACT", contractType: "transport", counterpartyName: "真实往来方", contractAmount: "100", attachmentEvidenceId: 28 }], project_tax_profiles: [{ id: 1, projectId: 2, status: "active", taxEntityId: 1, crossRegionConstruction: true, projectLocation: "长沙", taxMethod: "general" }] };
  locks: Array<{ table: string; ids: number[] }> = [];
  race?: () => void;
  cas = 1;
  rollback() { throw new Error("transaction rollback"); }
  match(table: any, condition?: SQL) {
    const name = getTableName(table), rows = this.rows[name] ?? [];
    if (!condition) return rows;
    const columns = [...new Set([...Object.values(getTableColumns(table)).map((col: any) => col.name), ...rows.flatMap(row => Object.keys(row))])];
    const sql = new DatabaseSync(":memory:");
    sql.exec(`CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(col => `\`${col}\``).join(",")})`);
    const insert = sql.prepare(`INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`);
    rows.forEach((row, index) => insert.run(index, ...columns.map(col => normalize(row[col]))));
    const query = new MySqlDialect().sqlToQuery(condition);
    const found = sql.prepare(`SELECT __index FROM \`${name}\` WHERE ${query.sql}`).all(...query.params.map(normalize)).map((row: any) => rows[row.__index]);
    sql.close(); return found;
  }
  select(projection?: any) { return { from: (table: any) => {
    let condition: SQL | undefined, limit = Infinity, locked = false, sorted = false;
    const chain: any = { where: (value: SQL) => { condition = value; return chain; }, limit: (value: number) => { limit = value; return chain; }, orderBy: () => { sorted = true; return chain; }, for: () => { locked = true; return chain; }, then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      if (locked && getTableName(table) === "evidence_records") { this.race?.(); this.race = undefined; }
      let rows = this.match(table, condition).slice(0, limit); if (sorted) rows = rows.sort((a, b) => a.id - b.id);
      if (locked) this.locks.push({ table: getTableName(table), ids: rows.map(row => row.id) });
      return rows.map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, col]: any) => [key, structuredClone(row[col.name])])) : structuredClone(row));
    }).then(resolve, reject) }; return chain;
  } }; }
  insert(table: any) { return { values: (value: any) => {
    let duplicate: any;
    const action = async () => {
      const name = getTableName(table), rows = this.rows[name] ??= [];
      const keys: Record<string, string[]> = { business_document_number_allocations: ["requestHash"], business_document_number_counters: ["prefix"], business_document_creation_receipts: ["requestHash"], measurement_takeoff_evidences: ["takeoffId", "evidenceId"] };
      const prior = duplicate && keys[name] && rows.find(row => keys[name].every(key => row[key] === value[key]));
      if (prior) { Object.assign(prior, structuredClone(duplicate.set)); return [{ insertId: prior.id }]; }
      const id = Math.max(0, ...rows.map(row => row.id ?? 0)) + 1;
      const defaults = name === "business_document_number_allocations" ? { number: null, prefix: null, sequence: null } : name === "business_document_creation_receipts" ? { resultJson: null } : {};
      rows.push({ id, ...defaults, ...structuredClone(value) }); return [{ insertId: id }];
    };
    const chain: any = { then: (resolve: any, reject: any) => action().then(resolve, reject), onDuplicateKeyUpdate: (options: any) => { duplicate = options; return chain; }, $returningId: async () => [{ id: (await action())[0].insertId }] }; return chain;
  } }; }
  update(table: any) { return { set: (value: any) => ({ where: async (condition: SQL) => { const rows = this.match(table, condition); if (this.cas) rows.forEach(row => Object.assign(row, structuredClone(value))); return [{ affectedRows: this.cas ? rows.length : 0 }]; } }) }; }
  async transaction<T>(callback: (tx: Database) => Promise<T>): Promise<T> { const before = structuredClone(this.rows); try { return await callback(this); } catch (error) { this.rows = before; throw error; } }
}
const oldEvidence = (override: any = {}) => ({ id: 28, projectId: 2, status: "active", uploadedBy: 9, sourceType: "other", sourceId: null, fileKey: "legacy/contracts/28.jpg", ...override });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(28).fill(0)]).toString("base64");
const uploadInput = { projectId: 2, fileName: "现场.jpg", mimeType: "image/jpeg" as const, base64Data: jpeg, description: "真实现场签认照片" };
const contractInput = { id: 5, projectId: 2, contractType: "transport" as const, counterpartyName: "真实往来方", pricingMethod: "trip" as const, contractAmount: 100 };
const invoiceInput = { projectId: 2, invoiceNo: "LEGACY-2026-001", counterpartyName: "真实销方", invoiceType: "electronic" as const, direction: "expense" as const, amount: 100, taxAmount: 6, taxRate: 0.06, issuedAt: "2026-11-24", allocationPurpose: "expense_deduction" as const, allocatedAmount: 100 };
const recordInput = { projectId: 2, direction: "expense" as const, category: "真实费用", amount: 100, occurredAt: "2026-11-24T03:00:00Z", settlementStatus: "unpaid" as const, sourceType: null, sourceId: null, evidenceId: null };
function setup() { const db = new Database(); state.db = db; return db; }
async function uploadFinancial() { const result = await caller().finance.uploadInvoiceEvidence(uploadInput); return result.evidenceId; }
async function uploadPurchase(kind: "document" | "invoice" = "document") { const result = await caller().purchasing.uploadPurchaseDocument({ ...uploadInput, attachmentKind: kind }); return result.id; }
async function uploadSite(sourceId: string | null = "takeoff-7") { const result = await caller().evidence.upload({ ...uploadInput, sourceType: "site_photo", sourceId, capturedAt: "2026-11-24T03:00:00Z" }); return result.id!; }
beforeEach(() => { state.roles = ["ALL"]; state.modules = null; state.failAudit = false; state.effects.mockClear(); });

describe("真实旧上传输入→真实业务caller，非猜测marker fixture", () => {
  it("移动计量原takeoff-7拍照输入成功关联，sourceId不被改写", async () => {
    const db = setup(); state.roles = ["PROJECT_MANAGER"];
    const id = await uploadSite(); expect(db.rows.evidence_records[0]).toMatchObject({ sourceType: "site_photo", sourceId: "takeoff-7", uploadedBy: 9 });
    await expect(caller().measurement.linkTakeoffEvidence({ projectId: 2, takeoffId: 7, evidenceId: id })).resolves.toEqual({ success: true });
    expect(db.rows.measurement_takeoff_evidences).toHaveLength(1);
    expect(db.rows.evidence_records[0].sourceId).toBe("takeoff-7");
    const locks = db.locks.filter(lock => ["evidence_records", "measurement_takeoff_records"].includes(lock.table)); expect(locks[0].table).toBe("evidence_records"); expect(locks[1].table).toBe("measurement_takeoff_records");
  });
  it("原计量提交角色可复用本项目未分配site_photo，不需要虚构pending", async () => {
    const db = setup(); const id = await uploadSite(null); db.rows.evidence_records[0].uploadedBy = 10; state.roles = ["CONSTRUCTION_MANAGER"];
    await expect(caller().measurement.linkTakeoffEvidence({ projectId: 2, takeoffId: 7, evidenceId: id })).resolves.toEqual({ success: true });
  });
  it.each([{ sourceId: "takeoff-8" }, { sourceId: "measurement-takeoff-pending-7-123" }, { sourceId: "construction-report-5" }, { sourceType: "other" }, { projectId: 3 }, { status: "deleted" }])("计量拒绝错源跨项目deleted且无额外业务写入 %j", async override => {
    const db = setup(); const id = await uploadSite(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows);
    await expect(caller().measurement.linkTakeoffEvidence({ projectId: 2, takeoffId: 7, evidenceId: id })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before);
  });
  it.each(["locked", "void"])("计量终态%s仍拒绝补证", async status => { const db = setup(); const id = await uploadSite(); db.rows.measurement_takeoff_records[0].status = status; const before = structuredClone(db.rows); await expect(caller().measurement.linkTakeoffEvidence({ projectId: 2, takeoffId: 7, evidenceId: id })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows).toEqual(before); });
  it("证据锁等待后的计量角色撤销被重验，无关联写入", async () => { const db = setup(); const id = await uploadSite(); db.race = () => { state.roles = ["ACCOUNTANT"]; }; const before = structuredClone(db.rows); await expect(caller().measurement.linkTakeoffEvidence({ projectId: 2, takeoffId: 7, evidenceId: id })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows).toEqual(before); });

  it.each(["active", "deleted"])("合同原UI无附件字段的合法编辑保留%s原指针及旧正式号", async status => {
    const db = setup(); db.rows.evidence_records = [oldEvidence({ status })]; await expect(caller().contract.save(contractInput)).resolves.toMatchObject({ success: true });
    expect(db.rows.outsource_contracts[0]).toMatchObject({ attachmentEvidenceId: 28, contractNo: "LEGACY-CONTRACT" }); const audit = db.rows.audit_logs.find(row => row.action === "retain_evidence_binding_pointers"); expect(audit.beforeJson).toContain("28.jpg"); expect(audit.afterJson).toContain('"evidenceId":28');
  });
  it("合同已存同指针不要求原UI无法生成的marker", async () => { const db = setup(); db.rows.evidence_records = [oldEvidence()]; await expect(caller().contract.save({ ...contractInput, attachmentEvidenceId: 28 })).resolves.toMatchObject({ success: true }); });
  it.each([{ sourceType: "other", sourceId: null }, { sourceType: "other", sourceId: "contract-pending-123" }, { sourceType: "contract", sourceId: "contract-5" }])("没有专用上传契约的新合同附件不凭空自动授权 %j", async override => { const db = setup(); db.rows.evidence_records = [oldEvidence(), oldEvidence({ id: 29, ...override })]; const before = structuredClone(db.rows); await expect(caller().contract.save({ ...contractInput, attachmentEvidenceId: 29 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it.each([{ status: "deleted" }, { projectId: 3 }, { sourceType: "site_photo" }])("合同显式重绑旧ID仍校验active/project/type %j", async override => { const db = setup(); db.rows.evidence_records = [oldEvidence(override)]; const before = structuredClone(db.rows); await expect(caller().contract.save({ ...contractInput, attachmentEvidenceId: 28 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it("合同税务使用锁后真实合同旧空marker附件，不借generic新附件", async () => { const db = setup(); db.rows.evidence_records = [oldEvidence()]; await expect(caller().finance.saveContractTaxRegistration({ projectId: 2, contractId: 5, taxItem: "真实专业税目", paymentEvidenceId: null })).resolves.toEqual({ success: true }); expect(db.rows.contract_tax_registrations[0]).toMatchObject({ contractEvidenceId: 28, contractNoSnapshot: "LEGACY-CONTRACT" }); });
  it("合同附件hint至锁后改变时拒绝税务快照且无额外写入", async () => { const db = setup(); db.rows.evidence_records = [oldEvidence()]; db.race = () => { db.rows.outsource_contracts[0].attachmentEvidenceId = 29; }; const before = structuredClone(db.rows); await expect(caller().finance.saveContractTaxRegistration({ projectId: 2, contractId: 5 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows).toEqual(before); });

  const inventory = { projectId: 2, transactionType: "inbound" as const, itemName: "碎石", unit: "t", quantity: 2, unitCost: 30, occurredAt: "2026-11-24T03:00:00Z", exceptionReason: "审批负责人确认现场无订单入库事实" };
  it("移动库存原uploadPurchaseDocument→small_direct_document→入库成功并正式编号", async () => { const db = setup(); const id = await uploadPurchase(); await expect(caller().purchasing.saveInventoryTransaction({ ...inventory, evidenceId: id })).resolves.toMatchObject({ success: true }); expect(db.rows.inventory_transactions[0]).toMatchObject({ evidenceId: id, amount: "60" }); expect(db.rows.inventory_transactions[0].transactionNo).toMatch(/^IV\d{22}$/); });
  it.each([{ sourceId: "purchase-order-4" }, { sourceId: "small_direct_invoice" }, { watermarkJson: '{"attachmentKind":"invoice"}' }, { projectId: 3 }, { status: "deleted" }, { sourceType: "financial_invoice" }])("库存拒绝猜测来源/发票混绑/错项目/deleted %j", async override => { const db = setup(); const id = await uploadPurchase(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows); await expect(caller().purchasing.saveInventoryTransaction({ ...inventory, evidenceId: id })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it("采购旧上传document/invoice实际输入可原订单补绑并保留旧指针", async () => { const db = setup(); db.rows.purchase_orders = [{ id: 4, projectId: 2, createdBy: 9, evidenceId: 28, invoiceEvidenceId: null }]; db.rows.evidence_records = [oldEvidence({ sourceType: "purchase", status: "deleted" })]; const id = await uploadPurchase(); await expect(caller().purchasing.bindOrderEvidence({ projectId: 2, orderId: 4, evidenceId: id, attachmentKind: "document", reason: "补充采购原始清晰凭证" })).resolves.toEqual({ success: true }); const invoice = await uploadPurchase("invoice"); await expect(caller().purchasing.bindOrderEvidence({ projectId: 2, orderId: 4, evidenceId: invoice, attachmentKind: "invoice", reason: "补充采购发票原始凭证" })).resolves.toEqual({ success: true }); expect(db.rows.purchase_orders[0]).toMatchObject({ evidenceId: id, invoiceEvidenceId: invoice }); });

  it("真实财务专用旧upload输入→发票原件和项目分摊成功", async () => { const db = setup(); state.roles = ["ACCOUNTANT"]; const evidenceId = await uploadFinancial(); expect(db.rows.evidence_records[0]).toMatchObject({ sourceType: "financial_invoice", sourceId: "invoice_original_upload" }); await expect(caller().finance.saveInvoice({ ...invoiceInput, evidenceId })).resolves.toEqual({ success: true }); expect(db.rows.financial_invoices[0]).toMatchObject({ evidenceId, allocatedAmount: "100" }); expect(db.rows.financial_invoice_originals[0]).toMatchObject({ evidenceId, totalAmount: "100" }); });
  it.each([{ sourceId: "financial-invoice-pending-1" }, { projectId: 3 }, { status: "deleted" }, { sourceType: "site_photo" }])("财务专用原件拒绝错来源/跨项目/deleted，不写原件分摊 %j", async override => { const db = setup(); const evidenceId = await uploadFinancial(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows); await expect(caller().finance.saveInvoice({ ...invoiceInput, evidenceId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it("财务专用原件分摊容量和封账守卫仍保留", async () => { const db = setup(); const evidenceId = await uploadFinancial(); await caller().finance.saveInvoice({ ...invoiceInput, evidenceId }); const before = structuredClone(db.rows); await expect(caller().finance.saveInvoice({ ...invoiceInput, evidenceId, allocatedAmount: 1 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows).toEqual(before); });
  it("旧移动财务无附件出纳输入保持合法，正式No和资金守卫保留", async () => { const db = setup(); state.roles = ["CASHIER"]; await expect(caller().finance.saveRecord(recordInput)).resolves.toEqual({ success: true }); expect(db.rows.financial_records[0].recordNo).toMatch(/^FR\d{22}$/); expect(db.rows.financial_records[0]).toMatchObject({ evidenceId: null, sourceType: null, amount: "100" }); });
  it("专用财务原件可由原财务登记角色复用，EVIDENCE不能替代FINANCE", async () => { const db = setup(); const evidenceId = await uploadFinancial(); state.roles = ["CASHIER"]; await expect(caller().finance.saveRecord({ ...recordInput, evidenceId })).resolves.toEqual({ success: true }); expect(db.rows.financial_records[0].evidenceId).toBe(evidenceId); state.modules = ["EVIDENCE"]; const before = structuredClone(db.rows); await expect(caller().finance.saveRecord(recordInput)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(caller().contract.save(contractInput)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows).toEqual(before); });

  const receiptCases = [
    { table: "tax_auxiliary_entries", field: "evidenceId", status: "handed_off", call: (id: number | null) => caller().finance.transitionTaxAuxiliaryEntry({ id: 1, projectId: 2, targetStatus: "receipt_recorded", documentReference: "外部真实回执", evidenceId: id }) },
    { table: "tax_handoff_batches", field: "receiptEvidenceId", status: "handed_off", call: (id: number | null) => caller().finance.transitionTaxHandoffBatch({ id: 1, projectId: 2, targetStatus: "receipt_recorded", receiptReference: "外部真实回执", receiptEvidenceId: id }) },
    { table: "payroll_tax_withholding_entries", field: "evidenceId", status: "handed_off", call: (id: number | null) => caller().finance.transitionPayrollTaxWithholdingEntry({ id: 1, projectId: 2, targetStatus: "receipt_recorded", externalReference: "外部真实回执", evidenceId: id }) },
    { table: "contract_tax_registrations", field: "paymentEvidenceId", status: "handed_off", call: (id: number | null) => caller().finance.transitionContractTaxRegistration({ id: 1, projectId: 2, targetStatus: "receipt_recorded", paymentReference: "外部真实回执", paymentEvidenceId: id }) },
    { table: "cross_region_construction_tax_ledgers", field: "taxPaymentEvidenceId", status: "ready_for_handoff", call: (id: number | null) => caller().finance.transitionCrossRegionConstructionTaxLedger({ id: 1, projectId: 2, targetStatus: "receipt_recorded", taxPaymentReference: "外部真实回执", taxPaymentEvidenceId: id }) },
  ];
  for (const entry of receiptCases) {
    it(`${entry.table} 原UI只传真实reference与null附件可成功`, async () => { const db = setup(); db.rows[entry.table] = [{ id: 1, projectId: 2, status: entry.status, [entry.field]: null }]; await expect(entry.call(null)).resolves.toEqual({ success: true }); expect(db.rows[entry.table][0].status).toBe("receipt_recorded"); });
    it(`${entry.table} 专用旧upload原件成功绑定且before/after留存`, async () => { const db = setup(); db.rows.evidence_records = [oldEvidence({ status: "deleted" })]; db.rows[entry.table] = [{ id: 1, projectId: 2, status: entry.status, [entry.field]: 28 }]; const id = await uploadFinancial(); await expect(entry.call(id)).resolves.toEqual({ success: true }); expect(db.rows[entry.table][0][entry.field]).toBe(id); const audit = db.rows.audit_logs.find(row => row.action === "retain_evidence_binding_pointers"); expect(audit.beforeJson).toContain('"evidenceId":28'); expect(audit.afterJson).toContain(`"evidenceId":${id}`); });
    it.each([{ sourceType: "other" }, { sourceId: "other-financial-upload" }, { projectId: 3 }, { status: "deleted" }])(`${entry.table} 拒绝错源/跨项目/deleted无额外业务写入 %j`, async override => { const db = setup(); db.rows[entry.table] = [{ id: 1, projectId: 2, status: entry.status, [entry.field]: null }]; const id = await uploadFinancial(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows); await expect(entry.call(id)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  }
  it("财税CAS零更新及protected审计失败仍回滚", async () => { const db = setup(); db.rows.tax_auxiliary_entries = [{ id: 1, projectId: 2, status: "handed_off", evidenceId: null }]; const id = await uploadFinancial(); const before = structuredClone(db.rows); db.cas = 0; await expect(receiptCases[0].call(id)).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows).toEqual(before); db.cas = 1; state.failAudit = true; await expect(receiptCases[0].call(id)).rejects.toThrow("protected audit failed"); expect(db.rows).toEqual(before); });
  it("分包真实专用发票上传→已复核包件应付成功，金额无额外支付写入", async () => { const db = setup(); const invoiceEvidenceId = await uploadFinancial(); db.rows.subcontract_packages = [{ id: 4, projectId: 2, subcontractTeamId: 3, status: "confirmed", marginAmount: "20", subcontractAmount: "100", packageNo: "SP-OLD", workItem: "真实工程量", quantity: "2", unit: "m3" }]; db.rows.subcontract_teams = [{ id: 3, projectId: 2 }]; state.roles = ["ACCOUNTANT"]; await expect(caller().subcontract.createPaymentSettlement({ projectId: 2, packageId: 4, payeeName: "施工队", invoiceStatus: "verified", invoiceNo: "真实票号", invoiceEvidenceId })).resolves.toMatchObject({ success: true, netPayableAmount: 100 }); expect(db.rows.subcontract_payment_settlements[0]).toMatchObject({ invoiceEvidenceId, status: "draft", netPayableAmount: "100" }); expect(db.rows.financial_records ?? []).toHaveLength(0); });
  it.each([{ sourceType: "other" }, { sourceId: "generic-invoice" }, { projectId: 3 }, { status: "deleted" }])("分包拒绝错源/跨项目/deleted无应付单新增 %j", async override => { const db = setup(); const invoiceEvidenceId = await uploadFinancial(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows); await expect(caller().subcontract.createPaymentSettlement({ projectId: 2, packageId: 4, payeeName: "施工队", invoiceEvidenceId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
});

describe("逐真实保存入口补充兼容闭环", () => {
  const inventory = { projectId: 2, transactionType: "inbound" as const, itemName: "碎石", unit: "t", quantity: 2, unitCost: 30, occurredAt: "2026-11-24T03:00:00Z", exceptionReason: "审批负责人确认真实无订单入库" };
  async function uploadLegacyPurchase() { const result = await caller().evidence.upload({ ...uploadInput, sourceType: "purchase", sourceId: null, capturedAt: "2026-11-24T03:00:00Z" }); return result.id!; }
  const smallOrder = { projectId: 2, categoryId: 1, itemDescription: "真实小额物资", amount: 100, hasInvoice: false, orderedAt: "2026-11-24T03:00:00Z" };
  it("原通用影像purchase+null实际上传可作为库存验收，不接受任意marker", async () => { const db = setup(); const evidenceId = await uploadLegacyPurchase(); await expect(caller().purchasing.saveInventoryTransaction({ ...inventory, evidenceId })).resolves.toMatchObject({ success: true }); expect(db.rows.inventory_transactions[0].evidenceId).toBe(evidenceId); });
  it("原通用purchase+null上传→本订单作者补绑成功", async () => { const db = setup(); db.rows.purchase_orders = [{ id: 4, projectId: 2, createdBy: 9, evidenceId: null, invoiceEvidenceId: null }]; const evidenceId = await uploadLegacyPurchase(); state.roles = ["PURCHASER"]; await expect(caller().purchasing.bindOrderEvidence({ projectId: 2, orderId: 4, evidenceId, attachmentKind: "document", reason: "上传原验收单据并补绑" })).resolves.toEqual({ success: true }); });
  it.each([false, true])("旧通用或专用采购上传→直采订单success（legacy=%s）", async legacy => { const db = setup(); db.rows.purchase_categories = [{ id: 1, status: "active" }]; const evidenceId = legacy ? await uploadLegacyPurchase() : await uploadPurchase(); const invoiceEvidenceId = await uploadPurchase("invoice"); await expect(caller().purchasing.createSmallDirectOrder({ ...smallOrder, evidenceId, hasInvoice: true, invoiceEvidenceId })).resolves.toMatchObject({ success: true, amount: 100 }); expect(db.rows.purchase_orders[0]).toMatchObject({ evidenceId, invoiceEvidenceId, status: "draft" }); expect(db.rows.purchase_orders[0].orderNo).toMatch(/^PO\d{22}$/); });
  it.each([{ sourceId: "purchase-order-99" }, { sourceId: "small_direct_invoice" }, { sourceType: "other" }, { status: "deleted" }, { projectId: 3 }])("直采来源精确拒绝无额外写入 %j", async override => { const db = setup(); db.rows.purchase_categories = [{ id: 1, status: "active" }]; const evidenceId = await uploadPurchase(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows); await expect(caller().purchasing.createSmallDirectOrder({ ...smallOrder, evidenceId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it("采购证据锁等待后原订单作者/角色重新核验，不能沿用旧审批权限", async () => { const db = setup(); db.rows.purchase_orders = [{ id: 4, projectId: 2, createdBy: 10, evidenceId: null, invoiceEvidenceId: null }]; const evidenceId = await uploadPurchase(); db.race = () => { state.roles = ["FINANCE_MANAGER"]; state.modules = ["EVIDENCE"]; }; const before = structuredClone(db.rows); await expect(caller().purchasing.bindOrderEvidence({ projectId: 2, orderId: 4, evidenceId, attachmentKind: "document", reason: "试图沿用已撤销采购权限" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows).toEqual(before); });
  it("库存无订单例外仍须锁后审批角色，旧角色不能沿用", async () => { const db = setup(); const evidenceId = await uploadPurchase(); db.race = () => { state.roles = ["WAREHOUSE_MANAGER"]; }; const before = structuredClone(db.rows); await expect(caller().purchasing.saveInventoryTransaction({ ...inventory, evidenceId })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows).toEqual(before); });

  const payroll = { projectId: 2, workerId: 3, period: "2026-11", incomeType: "resident_wage_salary" as const, cumulativeExemptIncome: 0, employmentMonths: 1, cumulativeSocialInsuranceDeduction: 0, cumulativeSpecialAdditionalDeduction: 0, cumulativeOtherDeduction: 0, cumulativeTaxWithheldBefore: 0 };
  function payrollFacts(db: Database) { db.rows.labor_workers = [{ id: 3, projectId: 2, realName: "真实工资人员" }]; db.rows.payroll_statements = [{ id: 1, workerId: 3, projectId: 2, period: "2026-11", payableAmount: "10000", status: "approved" }]; }
  const saveCases = [
    { table: "tax_auxiliary_entries", field: "evidenceId", prepare: (_db: Database) => {}, call: (id: number | null) => caller().finance.saveTaxAuxiliaryEntry({ projectId: 2, period: "2026-11", entryType: "subcontract_deduction", subject: "真实税务辅助资料", amount: 100, documentReference: "外部原始凭证", evidenceId: id }) },
    { table: "payroll_tax_withholding_entries", field: "evidenceId", prepare: payrollFacts, call: (id: number | null) => caller().finance.savePayrollTaxWithholdingEntry({ ...payroll, evidenceId: id }) },
    { table: "contract_tax_registrations", field: "paymentEvidenceId", prepare: (db: Database) => { db.rows.evidence_records.push(oldEvidence()); }, call: (id: number | null) => caller().finance.saveContractTaxRegistration({ projectId: 2, contractId: 5, paymentReference: "真实回执参考", paymentEvidenceId: id }) },
    { table: "cross_region_construction_tax_ledgers", field: "taxPaymentEvidenceId", prepare: (_db: Database) => {}, call: (id: number | null) => caller().finance.saveCrossRegionConstructionTaxLedger({ projectId: 2, period: "2026-11", projectRegistrationReference: "真实登记引用", taxPaymentReference: "真实完税引用", taxPaymentEvidenceId: id }) },
  ];
  for (const entry of saveCases) {
    it(`${entry.table} 原UI的null附件保存成功，不造专用上传器`, async () => { const db = setup(); entry.prepare(db); await expect(entry.call(null)).resolves.toMatchObject({ success: true }); expect(db.rows[entry.table][0][entry.field]).toBeNull(); });
    it(`${entry.table} 真实FINANCE旧上传产物保存成功`, async () => { const db = setup(); entry.prepare(db); const evidenceId = await uploadFinancial(); await expect(entry.call(evidenceId)).resolves.toMatchObject({ success: true }); expect(db.rows[entry.table][0][entry.field]).toBe(evidenceId); });
    it.each([{ sourceId: "fake-tax-pending-123" }, { sourceType: "other" }, { projectId: 3 }, { status: "deleted" }])(`${entry.table} 保存拒绝错源/跨项目/deleted无额外写入 %j`, async override => { const db = setup(); entry.prepare(db); const evidenceId = await uploadFinancial(); Object.assign(db.rows.evidence_records.find(row => row.id === evidenceId), override); const before = structuredClone(db.rows); await expect(entry.call(evidenceId)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  }
  it("跨地区两个专用附件都按真实source校验，扣除原件错误则整笔不写", async () => { const db = setup(); const evidenceId = await uploadFinancial(); db.rows.evidence_records[0].sourceId = "wrong"; const before = structuredClone(db.rows); await expect(caller().finance.saveCrossRegionConstructionTaxLedger({ projectId: 2, period: "2026-11", deductionEvidenceId: evidenceId, taxPaymentEvidenceId: null })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it("薪税仍用真实已审工资事实生成snapshot，不接受客户端sourcegross", async () => { const db = setup(); payrollFacts(db); await caller().finance.savePayrollTaxWithholdingEntry({ ...payroll, evidenceId: null }); expect(db.rows.payroll_tax_withholding_entries[0]).toMatchObject({ sourceGrossIncome: "10000", sourceDocumentCount: 1, calculatedCurrentWithholding: "150" }); expect(JSON.parse(db.rows.payroll_tax_withholding_entries[0].calculationSnapshotJson).formulaVersion).toBe("resident-wage-cumulative-withholding-v1"); });
  it("原财税生成移交输入保留历史指针、不可变snapshot及正式No", async () => { const db = setup(); db.rows.tax_entity_profiles = [{ id: 1, status: "active", entityName: "真实纳税主体", taxpayerIdentifier: "REAL-TAX-ID", taxMethod: "general" }]; db.rows.evidence_records = [oldEvidence({ status: "deleted" })]; const result = await caller().finance.createTaxHandoffBatch({ projectId: 2, period: "2026-11", handoffType: "combined", notes: null }); expect(result.success).toBe(true); expect(db.rows.tax_handoff_batches[0].batchNo).toMatch(/^TX\d{22}$/); const snapshot = db.rows.tax_handoff_batches[0].snapshotJson; expect(JSON.parse(snapshot).evidencePointers).toContainEqual({ evidenceId: 28 }); db.rows.outsource_contracts[0].attachmentEvidenceId = 29; expect(db.rows.tax_handoff_batches[0].snapshotJson).toBe(snapshot); });
  it("合同原UI无附件字段的新建仍成功，不能将保守拒绝冒充可用", async () => { const db = setup(); await expect(caller().contract.save({ ...contractInput, id: undefined })).resolves.toMatchObject({ success: true }); expect(db.rows.outsource_contracts[1]).toMatchObject({ attachmentEvidenceId: null, status: "draft" }); expect(db.rows.outsource_contracts[1].contractNo).toMatch(/^CT\d{22}$/); });
  it("会计不能借兼容校准创建paid流水，封账继续阻止合法来源登记", async () => { const db = setup(); state.roles = ["ACCOUNTANT"]; const evidenceId = await uploadFinancial(); const before = structuredClone(db.rows); await expect(caller().finance.saveRecord({ ...recordInput, settlementStatus: "paid", evidenceId })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows).toEqual(before); db.rows.daily_accounting_closures = [{ id: 1, projectId: 2, closingDate: new Date("2026-11-24T00:00:00Z"), status: "closed", closingNo: "REAL-CLOSED" }]; const closed = structuredClone(db.rows); await expect(caller().finance.saveRecord({ ...recordInput, evidenceId })).rejects.toMatchObject({ code: "CONFLICT" }); await expect(caller().finance.saveInvoice({ ...invoiceInput, evidenceId })).rejects.toMatchObject({ code: "CONFLICT" }); expect(db.rows).toEqual(closed); });
  it("分包证据锁等待后再核验原会计岗位，无新增应付", async () => { const db = setup(); const invoiceEvidenceId = await uploadFinancial(); db.race = () => { state.roles = ["CASHIER"]; }; const before = structuredClone(db.rows); await expect(caller().subcontract.createPaymentSettlement({ projectId: 2, packageId: 4, payeeName: "施工队", invoiceEvidenceId })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(db.rows).toEqual(before); });
});

describe("所属合同快照与人工流水拒绝闭环", () => {
  it.each([{ projectId: 3 }, { status: "deleted" }, { sourceType: "site_photo" }])("合同税务只接受真合同当前归档附件且active/project/type严格拒绝 %j", async override => { const db = setup(); db.rows.evidence_records = [oldEvidence(override)]; const before = structuredClone(db.rows); await expect(caller().finance.saveContractTaxRegistration({ projectId: 2, contractId: 5, paymentEvidenceId: null })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it.each([{ sourceId: "invoice-pending-123" }, { sourceType: "purchase" }, { projectId: 3 }, { status: "deleted" }])("人工流水附件保持真实专用来源而非泛化借用 %j", async override => { const db = setup(); const evidenceId = await uploadFinancial(); Object.assign(db.rows.evidence_records[0], override); const before = structuredClone(db.rows); await expect(caller().finance.saveRecord({ ...recordInput, evidenceId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
  it("人工流水不能以财务原件附件授权伪造业务sourceId", async () => { const db = setup(); const evidenceId = await uploadFinancial(); const before = structuredClone(db.rows); await expect(caller().finance.saveRecord({ ...recordInput, evidenceId, sourceType: "measurement_payment", sourceId: "7" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(db.rows).toEqual(before); });
});

describe("旧税务transition null的保留而非清空契约", () => {
  const cases = [
    { table: "tax_auxiliary_entries", field: "evidenceId", status: "handed_off", call: () => caller().finance.transitionTaxAuxiliaryEntry({ id: 1, projectId: 2, targetStatus: "receipt_recorded", documentReference: "真实外部回执", evidenceId: null }) },
    { table: "tax_handoff_batches", field: "receiptEvidenceId", status: "handed_off", call: () => caller().finance.transitionTaxHandoffBatch({ id: 1, projectId: 2, targetStatus: "receipt_recorded", receiptReference: "真实外部回执", receiptEvidenceId: null }) },
    { table: "payroll_tax_withholding_entries", field: "evidenceId", status: "handed_off", call: () => caller().finance.transitionPayrollTaxWithholdingEntry({ id: 1, projectId: 2, targetStatus: "receipt_recorded", externalReference: "真实外部回执", evidenceId: null }) },
    { table: "contract_tax_registrations", field: "paymentEvidenceId", status: "handed_off", call: () => caller().finance.transitionContractTaxRegistration({ id: 1, projectId: 2, targetStatus: "receipt_recorded", paymentReference: "真实外部回执", paymentEvidenceId: null }) },
    { table: "cross_region_construction_tax_ledgers", field: "taxPaymentEvidenceId", status: "ready_for_handoff", call: () => caller().finance.transitionCrossRegionConstructionTaxLedger({ id: 1, projectId: 2, targetStatus: "receipt_recorded", taxPaymentReference: "真实外部回执", taxPaymentEvidenceId: null }) },
  ];
  for (const entry of cases) it(`${entry.table} null不重绑deleted历史附件也不丢失before/after`, async () => { const db = setup(); db.rows.evidence_records = [oldEvidence({ status: "deleted" })]; db.rows[entry.table] = [{ id: 1, projectId: 2, status: entry.status, [entry.field]: 28 }]; await expect(entry.call()).resolves.toEqual({ success: true }); expect(db.rows[entry.table][0][entry.field]).toBe(28); const audit = db.rows.audit_logs.find(row => row.action === "retain_evidence_binding_pointers"); expect(audit.beforeJson).toContain('"evidenceId":28'); expect(audit.afterJson).toContain('"evidenceId":28'); expect(audit.afterJson).toContain("28.jpg"); });
});
