import { afterEach, describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { auditLogIntegrityEvents, auditLogs, evidenceRecords, projects } from "../drizzle/schema";
import { BusinessDocumentCreationMockDb } from "./services/businessDocumentCreation.mockDb";
import { lockBusinessEvidenceBindings } from "./services/evidenceBinding";
let db: BusinessDocumentCreationMockDb;
afterEach(() => db?.close());
function setup() {
  db = new BusinessDocumentCreationMockDb();
  db.seed(projects, { id: 2, code: "RET-P2", name: "真实保留指针专项", nodeType: "project", status: "active" });
  db.seed(evidenceRecords, [
    { id: 41, projectId: 2, sourceType: "purchase", sourceId: "small_direct_document", fileKey: "evidence/2/old-deleted.jpg", uploadedBy: 9, status: "deleted" },
    { id: 42, projectId: 2, sourceType: "purchase", sourceId: "small_direct_document", fileKey: "evidence/2/new-active.jpg", uploadedBy: 9, status: "active" },
  ]);
  return db;
}
const base = { projectId: 2, actorId: 9, module: "construction", targetType: "construction_daily_report", targetId: "7" };
const oldPointers = [{ evidenceId: 41 }];
const audit = () => db.rows(auditLogs).find(row => row.action === "retain_evidence_binding_pointers")!;
describe("外部原附件快照显式保留与替换区分（真实SQL和受保护审计）", () => {
  it("施工照片未改变时before和after均保留已删历史ID/fileKey，不复活对象", async () => {
    setup();
    await db.transaction(async tx => (await lockBusinessEvidenceBindings(tx, { ...base, bindings: [], oldPointers, retainedPointers: oldPointers })).retain());
    expect(JSON.parse(audit().beforeJson)).toEqual({ evidencePointers: [{ evidenceId: 41, fileKey: "evidence/2/old-deleted.jpg" }] });
    expect(JSON.parse(audit().afterJson)).toEqual(JSON.parse(audit().beforeJson));
    expect(db.rows(evidenceRecords)[0].status).toBe("deleted");
    expect(db.rows(auditLogIntegrityEvents)).toHaveLength(1);
  });
  it("人员/采购实际替换时旧ID只在before，新ID只在after，不能无脑加入所有旧指针", async () => {
    setup();
    await db.transaction(async tx => (await lockBusinessEvidenceBindings(tx, { ...base, oldPointers, bindings: [{ field: "evidenceId", id: 42, allowedSourceTypes: ["purchase"], sourceId: "small_direct_document" }] })).retain());
    expect(JSON.parse(audit().beforeJson).evidencePointers.map((row: any) => row.evidenceId)).toEqual([41]);
    expect(JSON.parse(audit().afterJson).evidencePointers).toEqual([{ evidenceId: 42, fileKey: "evidence/2/new-active.jpg" }]);
  });
  it("明确清空字段不保留到after，旧引用仍在before受保护", async () => {
    setup();
    await db.transaction(async tx => (await lockBusinessEvidenceBindings(tx, { ...base, oldPointers, bindings: [{ field: "evidenceId", id: null, allowedSourceTypes: ["purchase"] }] })).retain());
    expect(JSON.parse(audit().beforeJson).evidencePointers).toHaveLength(1);
    expect(JSON.parse(audit().afterJson).evidencePointers).toEqual([]);
  });
  it("不能以retainedPointers偷偷引入不是原业务快照的新ID", async () => {
    setup(); const before = db.snapshot();
    await expect(db.transaction(tx => lockBusinessEvidenceBindings(tx, { ...base, bindings: [], oldPointers, retainedPointers: [{ evidenceId: 42 }] }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.snapshot()).toEqual(before);
  });
  it("只保留明确指定的外部关联，完整before与升序锁覆盖其余历史ID", async () => {
    setup();
    await db.transaction(async tx => (await lockBusinessEvidenceBindings(tx, { ...base, bindings: [], oldPointers: [{ evidenceId: 42 }, { evidenceId: 41 }], retainedPointers: [{ evidenceId: 41 }] })).retain());
    expect(JSON.parse(audit().beforeJson).evidencePointers.map((row: any) => row.evidenceId)).toEqual([41, 42]);
    expect(JSON.parse(audit().afterJson).evidencePointers.map((row: any) => row.evidenceId)).toEqual([41]);
    expect(db.locks.slice(0, 2)).toEqual(["projects:update", "evidence_records:update"]);
  });
  it("真实审计链插入失败时主审计和指针保留一起事务回滚", async () => {
    setup(); const before = db.snapshot(); db.failInsertTable = getTableName(auditLogIntegrityEvents);
    await expect(db.transaction(async tx => (await lockBusinessEvidenceBindings(tx, { ...base, bindings: [], oldPointers, retainedPointers: oldPointers })).retain())).rejects.toThrow("injected insert failure");
    expect(db.snapshot()).toEqual(before);
  });
});
