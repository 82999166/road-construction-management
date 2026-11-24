import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ProjectPermissionsMockDb } from "./services/projectPermissions.mockDb";
import { auditLogChainState, auditLogIntegrityEvents, auditLogs, attendanceRecords, evidenceRecords, inventoryTransactions, projects } from "../drizzle/schema";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storageGet: vi.fn(), storageGetSignedUrl: vi.fn(), storagePut: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertDepartmentBusinessAccess: vi.fn(), assertProjectInCurrentScope: vi.fn(), getDepartmentModuleDataScope: vi.fn(), getEffectiveRoleCodes: vi.fn(), getRoleOperationPermissionDecision: vi.fn() };
});
import { assertDepartmentBusinessAccess, assertProjectInCurrentScope, getDepartmentModuleDataScope, getEffectiveRoleCodes } from "./access";
import { getDb } from "./db";
import { evidenceRouter } from "./routers/evidence";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;
function createContext(userId = 9): TrpcContext {
  const user: AuthenticatedUser = { id: userId, openId: `evidence-delete-${userId}`, email: "evidence@example.com", name: "取证人员", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

/** 真实 Drizzle WHERE 在一次性内存 schema 上执行；真实审计链也在同一事务，非查询次数桩。 */
class EvidenceDeleteDb extends ProjectPermissionsMockDb {
  constructor() {
    super();
    (this as any).sqlite.function("regexp", (pattern: string, value: unknown) => new RegExp(pattern, "i").test(String(value ?? "")) ? 1 : 0);
  }
  insert(table: any): any {
    return { values: (input: any) => ({
      $returningId: async () => [{ id: Number((await super.insert(table).values(input))[0].insertId) }],
      then: (ok: any, fail: any) => super.insert(table).values(input).then(ok, fail),
    }) };
  }
}
const stores: EvidenceDeleteDb[] = [];
const baseEvidence = { id: 28, projectId: 2, uploadedBy: 9, fileName: "现场水印.jpg", fileKey: "evidence/2/现场水印.jpg", sourceType: "site_photo", sourceId: null, status: "active", contentSha256: "a".repeat(64), contentBytes: 1024 };
function createDeleteDb() {
  const db = new EvidenceDeleteDb(); stores.push(db);
  db.seed(projects, { id: 2, status: "active" });
  db.seed(evidenceRecords, baseEvidence);
  db.seed(auditLogChainState, { id: 1, lastSequence: 0, lastHash: "9".repeat(64) });
  vi.spyOn(db, "delete"); vi.spyOn(db, "update"); vi.spyOn(db, "insert"); vi.spyOn(db, "transaction");
  return db;
}
afterEach(() => stores.splice(0).forEach(db => db.close()));
describe("现场影像受控删除", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["SITE_MANAGER"]);
    vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [], roleCodes: ["SITE_MANAGER"] });
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
  });
  it("允许提交人删除未关联业务单据的照片，并保留审计记录", async () => {
    const db = createDeleteDb(); vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(evidenceRouter.createCaller(createContext()).delete({ id: 28, deletionReason: "重复上传，保留正确影像" })).resolves.toEqual({ success: true });
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.locks.slice(0, 2)).toEqual(["projects:update", "evidence_records:update"]);
    expect(db.rows(evidenceRecords)[0]).toMatchObject({ ...baseEvidence, status: "deleted", deletedBy: 9 });
    expect(db.rows(auditLogs)[0]).toMatchObject({ action: "soft_delete", targetId: "28", beforeJson: expect.stringContaining(baseEvidence.fileKey) });
    expect(db.rows(auditLogIntegrityEvents)).toHaveLength(1);
    expect(db.rows(auditLogChainState)[0].lastSequence).toBe(1);
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(expect.anything(), "EVIDENCE");
    expect(assertDepartmentBusinessAccess).not.toHaveBeenCalledWith(expect.anything(), "EVIDENCE", "void");
  });
  it("拒绝删除已被业务单据引用的照片，防止破坏审计凭证", async () => {
    const db = createDeleteDb(); db.seed(attendanceRecords, { id: 1, projectId: 2, evidenceId: 28, status: "void" });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(evidenceRouter.createCaller(createContext()).delete({ id: 28, deletionReason: "关联业务单据的影像不可删除" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("不能删除") });
    expect(db.delete).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
    expect(db.rows(evidenceRecords)[0]).toMatchObject(baseEvidence); expect(db.rows(auditLogs)).toEqual([]);
  });
  it("拒绝删除已关联库存收发流水的入库凭证", async () => {
    const db = createDeleteDb(); db.seed(inventoryTransactions, { id: 1, projectId: 2, evidenceId: 28 });
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(evidenceRouter.createCaller(createContext()).delete({ id: 28, deletionReason: "库存流水关联凭证不可删除" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("库存") });
    expect(db.delete).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
    expect(db.rows(evidenceRecords)[0]).toMatchObject(baseEvidence); expect(db.rows(auditLogs)).toEqual([]);
  });
});
