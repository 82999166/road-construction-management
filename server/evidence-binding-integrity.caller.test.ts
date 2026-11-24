import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mock = vi.hoisted(() => ({ db: null as any, roles: ["ALL"], failAudit: false, denied: false }));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
vi.mock("./access", async original => ({ ...await original<typeof import("./access")>(), assertDepartmentBusinessAccess: async (_ctx: unknown, module: string) => { if (mock.denied && module !== "EVIDENCE") throw new Error("专用模块无权"); }, assertProjectInCurrentScope: async () => {}, getEffectiveRoleCodes: async () => mock.roles, hasUserSpecificOperationPermission: async () => false, assertExistingBusinessRecordChangeAccess: async () => ({ id: 9 }), getSuperAdminAccess: async () => ({ canAccess: true }) }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: vi.fn(async () => {}) }));
vi.mock("./services/officialAccountDriverBinding", () => ({ sendOfficialAccountDriverNotification: vi.fn(async () => {}) }));
vi.mock("./services/transportRisk", () => ({ triggerTransportRiskScan: vi.fn(async () => {}) }));
vi.mock("./services/auditIntegrity", () => ({ appendIntegrityProtectedAudit: async (tx: any, value: any) => { if (mock.failAudit) throw new Error("protected audit failed"); await tx.insert((await import("../drizzle/schema")).auditLogs).values(value); } }));
import { contractRouter } from "./routers/contracts";
import { purchasingRouter, financeRouter } from "./routers/finance";
import { transportRouter } from "./routers/operations";
import { router } from "./_core/trpc";
import { evidencePointerIds } from "./services/evidenceBinding";
const mounted = router({ contract: contractRouter, purchasing: purchasingRouter, finance: financeRouter, transport: transportRouter });
const ctx = { user: { id: 9, role: "admin", name: "附件绑定隔离测试", openId: "binding-caller" }, req: {}, res: {} } as TrpcContext;
const normalize = (value: any): any => value instanceof Date ? value.toISOString().slice(0, 23).replace("T", " ") : typeof value === "boolean" ? Number(value) : value && typeof value === "object" ? JSON.stringify(value) : value ?? null;
class Fixture {
  rows: Record<string, any[]> = { projects: [{ id: 2, status: "active" }], evidence_records: [], purchase_orders: [{ id: 4, projectId: 2, createdBy: 9, status: "confirmed", evidenceId: 28, invoiceEvidenceId: 30 }], outsource_contracts: [{ id: 5, projectId: 2, status: "draft", attachmentEvidenceId: 28 }] };
  locks: Array<{ table: string; ids: number[] }> = [];
  transactions = 0;
  cas = 1;
  race?: () => void;
  match(table: any, condition?: SQL) {
    const name = getTableName(table), rows = this.rows[name] ?? [];
    if (!condition) return rows;
    const columns = [...new Set([...Object.values(getTableColumns(table)).map((col: any) => col.name), ...rows.flatMap(row => Object.keys(row))])];
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(col => `\`${col}\``).join(",")})`);
    const insert = sqlite.prepare(`INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`);
    rows.forEach((row, index) => insert.run(index, ...columns.map(col => normalize(row[col]))));
    const query = new MySqlDialect().sqlToQuery(condition);
    const found = sqlite.prepare(`SELECT __index FROM \`${name}\` WHERE ${query.sql}`).all(...query.params.map(normalize)).map((row: any) => rows[row.__index]);
    sqlite.close(); return found;
  }
  select(projection?: any) { return { from: (table: any) => {
    let condition: SQL | undefined, limit = Infinity, locked = false, sorted = false;
    const chain: any = { where: (value: SQL) => { condition = value; return chain; }, limit: (value: number) => { limit = value; return chain; }, orderBy: () => { sorted = true; return chain; }, for: () => { locked = true; return chain; }, then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      if (locked && getTableName(table) === "evidence_records") { this.race?.(); this.race = undefined; }
      let rows = this.match(table, condition).slice(0, limit); if (sorted) rows = rows.sort((a, b) => a.id - b.id);
      if (locked) this.locks.push({ table: getTableName(table), ids: rows.map(row => row.id) });
      return rows.map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, col]: any) => [key, row[col.name]])) : structuredClone(row));
    }).then(resolve, reject) }; return chain;
  } }; }
  insert(table: any) { return { values: (value: any) => {
    const action = async () => { const rows = this.rows[getTableName(table)] ??= []; const id = Math.max(0, ...rows.map(row => row.id ?? 0)) + 1; rows.push({ id, ...(getTableName(table) === "business_document_creation_receipts" ? { resultJson: null } : {}), ...structuredClone(value) }); return [{ insertId: id }]; };
    const chain: any = { then: (resolve: any, reject: any) => action().then(resolve, reject), onDuplicateKeyUpdate: () => chain, $returningId: async () => [{ id: (await action())[0].insertId }] }; return chain;
  } }; }
  update(table: any) { return { set: (value: any) => ({ where: async (condition: SQL) => { const rows = this.match(table, condition); if (this.cas) rows.forEach(row => Object.assign(row, structuredClone(value))); return [{ affectedRows: this.cas ? rows.length : 0 }]; } }) }; }
  async transaction<T>(callback: (tx: Fixture) => Promise<T>): Promise<T> { this.transactions++; const before = structuredClone(this.rows); try { return await callback(this); } catch (error) { this.rows = before; throw error; } }
}
const evidence = (id: number, override: any = {}) => ({ id, projectId: 2, status: "active", sourceType: "purchase", sourceId: "small_direct_document", fileKey: `purchase-documents/2/${id}.jpg`, watermarkJson: '{"attachmentKind":"document"}', ...override });
const bind = { projectId: 2, orderId: 4, evidenceId: 29, attachmentKind: "document" as const, reason: "保留原单据并补充清晰照片" };
const contract = { id: 5, projectId: 2, contractType: "transport" as const, counterpartyName: "真实合同方", pricingMethod: "trip" as const, contractAmount: 20, attachmentEvidenceId: 29 };
const caller = () => mounted.createCaller(ctx);
function setup(override: any = {}) { const fixture = new Fixture(); fixture.rows.evidence_records = [evidence(28, { status: "deleted" }), evidence(29, override), evidence(30, { sourceId: "small_direct_invoice" })]; mock.db = fixture; return fixture; }
beforeEach(() => { mock.roles = ["ALL"]; mock.failAudit = false; mock.denied = false; });
describe("真实mounted caller的附件绑定完整性", () => {
  it.each([{ status: "deleted" }, { projectId: 3 }, { sourceType: "personnel_private" }, { sourceId: "small_direct_invoice" }])("采购拒绝已删、跨项目、专用类型或不符来源 %j", async override => { const fixture = setup(override); await expect(caller().purchasing.bindOrderEvidence(bind)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fixture.rows.purchase_orders[0].evidenceId).toBe(28); expect(fixture.rows.audit_logs ?? []).toHaveLength(0); });
  it("采购替换同tx先升序锁旧新及另一个附件，再锁父单，保存当前和已删历史指针", async () => {
    const fixture = setup(); await expect(caller().purchasing.bindOrderEvidence(bind)).resolves.toEqual({ success: true });
    expect(fixture.transactions).toBe(1); const locks = fixture.locks.filter(lock => lock.table !== "projects");
    expect(locks[0]).toEqual({ table: "evidence_records", ids: [28, 29, 30] }); expect(locks[1].table).toBe("purchase_orders");
    expect(fixture.rows.purchase_orders[0]).toMatchObject({ evidenceId: 29, invoiceEvidenceId: 30 });
    const audit = fixture.rows.audit_logs.find(row => row.action === "retain_evidence_binding_pointers"); expect(audit.userId).toBe(9); expect(audit.beforeJson).toContain('"evidenceId":28'); expect(audit.beforeJson).toContain("28.jpg"); expect(audit.afterJson).toContain('"evidenceId":29'); expect(audit.afterJson).toContain('"evidenceId":30');
  });
  it("采购CAS零更新无成功无审计", async () => { const fixture = setup(); fixture.cas = 0; await expect(caller().purchasing.bindOrderEvidence(bind)).rejects.toMatchObject({ code: "CONFLICT" }); expect(fixture.rows.purchase_orders[0].evidenceId).toBe(28); });
  it("受保护审计失败回滚业务指针，不删旧对象", async () => { const fixture = setup(); mock.failAudit = true; await expect(caller().purchasing.bindOrderEvidence(bind)).rejects.toThrow("protected audit failed"); expect(fixture.rows.purchase_orders[0].evidenceId).toBe(28); expect(fixture.rows.evidence_records[0].fileKey).toContain("28.jpg"); });
  it("parent附件在hint与业务锁间改变时拒绝覆盖", async () => { const fixture = setup(); fixture.race = () => { fixture.rows.purchase_orders[0].evidenceId = 31; }; await expect(caller().purchasing.bindOrderEvidence(bind)).rejects.toMatchObject({ code: "CONFLICT" }); });
  it.each([{ status: "deleted" }, { projectId: 3 }, { sourceType: "attendance" }, { sourceId: "contract-6" }])("合同专用绑定拒绝 %j", async override => { const fixture = setup({ sourceType: "other", sourceId: "contract-5", ...override }); await expect(caller().contract.save(contract)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fixture.rows.outsource_contracts[0].attachmentEvidenceId).toBe(28); });
  it("合同拒绝人工伪造other+contract来源，新不同ID不覆盖旧指针或正式号", async () => { const fixture = setup({ sourceType: "other", sourceId: "contract-5" }); fixture.rows.outsource_contracts[0].contractNo = "OLD-SAVED-NO"; await expect(caller().contract.save(contract)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fixture.transactions).toBe(1); expect(fixture.rows.outsource_contracts[0]).toMatchObject({ attachmentEvidenceId: 28, contractNo: "OLD-SAVED-NO" }); expect(fixture.rows.evidence_records[0].fileKey).toContain("28.jpg"); expect(fixture.rows.audit_logs ?? []).toHaveLength(0); });
  it("仅EVIDENCE不能代替合同/财税模块授权", async () => { setup({ sourceType: "other", sourceId: "contract-5" }); mock.denied = true; await expect(caller().contract.save(contract)).rejects.toThrow("专用模块无权"); await expect(caller().finance.transitionTaxAuxiliaryEntry({ id: 1, projectId: 2, targetStatus: "handed_off" })).rejects.toThrow("专用模块无权"); });
  it("税务回执不接受通用site_photo，旧辅助事项指针不覆盖", async () => { const fixture = setup({ sourceType: "site_photo", sourceId: "construction-report-1" }); fixture.rows.tax_auxiliary_entries = [{ id: 1, projectId: 2, status: "handed_off", evidenceId: 28 }]; await expect(caller().finance.transitionTaxAuxiliaryEntry({ id: 1, projectId: 2, targetStatus: "receipt_recorded", evidenceId: 29 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(fixture.rows.tax_auxiliary_entries[0].evidenceId).toBe(28); });
  it("JSON形式路线快照与数组中的历史证据ID都可提取", () => { expect(evidencePointerIds({ routeSnapshot: '{"platePhotoEvidenceId":28,"unloadPhotoEvidenceId":29}', snapshotJson: '{"evidenceIds":[30,31]}' })).toEqual([28, 29, 30, 31]); });
  function unloadSetup(override: any = {}) {
    const fixture = setup({ sourceType: "transport", sourceId: "transport-unload-pending-7-123", ...override });
    fixture.rows.evidence_records.push(evidence(31, { status: "deleted", sourceType: "transport" }));
    fixture.rows.transport_trips = [{ id: 7, projectId: 2, vehicleId: 3, tripNo: "TR-OLD-SAVED", status: "submitted", loadConfirmedAt: new Date("2026-11-24T01:00:00Z"), unloadConfirmedAt: null, unloadSiteId: 10, invoiceMode: "plate_photo", evidenceId: 28, routeSnapshot: { routePresetId: 9, platePhotoEvidenceId: 28, unloadPhotoEvidenceId: 31 } }];
    fixture.rows.transport_vehicles = [{ id: 3, projectId: 2, status: "active", plateNo: "湘A12345" }];
    fixture.rows.transport_route_presets = [{ id: 9, projectId: 2, minimumTransitEnabled: false, unloadGeofenceEnabled: false }];
    fixture.rows.transport_sites = [{ id: 10, projectId: 2, siteType: "unload", status: "active", name: "真实卸土点", minimumTransitEnabled: false, unloadGeofenceEnabled: false }];
    return fixture;
  }
  const unload = { tripId: 7, projectId: 2, unloadEvidenceId: 29, idempotencyKey: "binding-unload-001", occurredAt: "2026-11-24T02:00:00Z" };
  it.each([{ status: "deleted" }, { projectId: 3 }, { sourceType: "attendance" }, { sourceId: "transport-unload-pending-8-123" }])("真实卸土caller拒绝 %j 且不生成事件", async override => {
    const fixture = unloadSetup(override); await expect(caller().transport.confirmPlatePhotoUnload(unload)).rejects.toMatchObject({ code: override.sourceId ? "CONFLICT" : "BAD_REQUEST" });
    expect(fixture.rows.transport_card_events ?? []).toHaveLength(0); expect(fixture.rows.transport_trips[0].routeSnapshot.unloadPhotoEvidenceId).toBe(31);
  });
  it("真实卸土保存同tx路线旧指针，升序证据锁先于真父单锁", async () => {
    const fixture = unloadSetup(); await expect(caller().transport.confirmPlatePhotoUnload(unload)).resolves.toMatchObject({ success: true, duplicate: false });
    expect(fixture.transactions).toBe(1); const locks = fixture.locks.filter(item => ["evidence_records", "transport_trips"].includes(item.table)); expect(locks[0]).toEqual({ table: "evidence_records", ids: [28, 29, 31] }); expect(locks[1].table).toBe("transport_trips");
    expect(fixture.rows.transport_trips[0].routeSnapshot).toMatchObject({ platePhotoEvidenceId: 28, unloadPhotoEvidenceId: 29 });
    const audit = fixture.rows.audit_logs.find(row => row.action === "retain_evidence_binding_pointers"); expect(audit.beforeJson).toContain('"evidenceId":31'); expect(audit.beforeJson).toContain("31.jpg");
  });
  it("卸土审计失败回滚真父单、event和sourceId回写", async () => {
    const fixture = unloadSetup(); mock.failAudit = true; await expect(caller().transport.confirmPlatePhotoUnload(unload)).rejects.toThrow("protected audit failed");
    expect(fixture.rows.transport_card_events ?? []).toHaveLength(0); expect(fixture.rows.transport_trips[0].unloadConfirmedAt).toBeNull(); expect(fixture.rows.transport_trips[0].routeSnapshot.unloadPhotoEvidenceId).toBe(31); expect(fixture.rows.evidence_records.find(row => row.id === 29).sourceId).toBe("transport-unload-pending-7-123");
  });
});
