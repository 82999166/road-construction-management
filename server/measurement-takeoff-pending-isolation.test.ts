import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ProjectPermissionsMockDb } from "./services/projectPermissions.mockDb";
import { auditLogs, evidenceRecords, projects } from "../drizzle/schema";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn(), storagePut: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertDepartmentBusinessAccess: vi.fn(), assertProjectInCurrentScope: vi.fn(), getDepartmentModuleDataScope: vi.fn(), getEffectiveRoleCodes: vi.fn(), getRoleOperationPermissionDecision: vi.fn() };
});
import { getDb } from "./db";
import { getDepartmentModuleDataScope, getEffectiveRoleCodes, getRoleOperationPermissionDecision } from "./access";
import { storageGetSignedUrl, storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { evidenceRouter } from "./routers/evidence";
import { evidenceDeleteBlockedReason, isGeneralEvidenceVisible, type EvidenceRow } from "./services/evidenceIntegrity";

class PendingIsolationDb extends ProjectPermissionsMockDb {
  constructor() {
    super();
    (this as any).sqlite.function("regexp", (pattern: string, value: unknown) => new RegExp(pattern, "i").test(String(value ?? "")) ? 1 : 0);
  }
}
const stores: PendingIsolationDb[] = [];
const base = { id: 28, projectId: 2, uploadedBy: 9, sourceType: "site_photo", sourceId: "takeoff-pending-9-unique", status: "active", mimeType: "image/jpeg", fileName: "收方现场.jpg", fileKey: "evidence/2/takeoff.jpg", contentSha256: "a".repeat(64), contentBytes: 1024 };
function context(): TrpcContext {
  return { user: { id: 9, openId: "pending-isolation-9", name: "只有影像岗位", role: "user", email: null, loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function setup(sourceId: string | null = base.sourceId) {
  const db = new PendingIsolationDb(); stores.push(db);
  db.seed(projects, { id: 2, status: "active" });
  db.seed(evidenceRecords, { ...base, sourceId });
  vi.mocked(getDb).mockResolvedValue(db as never);
  return db;
}
afterEach(() => stores.splice(0).forEach(db => db.close()));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["SITE_MANAGER"]);
  vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [], roleCodes: ["SITE_MANAGER"] });
  vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({ allowed: true } as never);
  vi.mocked(storageGetSignedUrl).mockResolvedValue("https://controlled.invalid/short-lived-photo");
});

describe("收方专属待关联影像不能被通用影像岗位接管", () => {
  it.each(["takeoff-pending-9-unique", "takeoff-pending", "TAKEOFF-PENDING-9-unique"])("保守隔离来源 %s 且来源标记仍阻挡删除", sourceId => {
    const row = { ...base, sourceId } as EvidenceRow;
    expect(isGeneralEvidenceVisible(row, [])).toBe(false);
    expect(evidenceDeleteBlockedReason(row, [])).toContain("不能删除");
  });
  it.each([null, "takeoff-28", "construction-report-28"])("不破坏既有非敏感现场影像来源 %s", sourceId => {
    const row = { ...base, sourceId } as EvidenceRow;
    expect(isGeneralEvidenceVisible(row, [])).toBe(true);
    if (sourceId) expect(evidenceDeleteBlockedReason(row, [])).toContain("不能删除");
  });
  it("真实list不会为待关联照片签发URL或返回归档元数据", async () => {
    setup();
    const rows = await evidenceRouter.createCaller(context()).list({ projectId: 2 });
    expect(rows).toEqual([]);
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
  it.each([null, "takeoff-28"])("真实list继续读取旧现场影像 %s", async sourceId => {
    setup(sourceId);
    const rows = await evidenceRouter.createCaller(context()).list({ projectId: 2 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 28, sourceId, url: "https://controlled.invalid/short-lived-photo" });
  });
  it("待关联照片的通用OCR在签名或模型调用之前拒绝", async () => {
    const db = setup();
    await expect(evidenceRouter.createCaller(context()).ocr({ id: 28 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
    expect(invokeLLM).not.toHaveBeenCalled();
    expect(db.rows(evidenceRecords)[0]).toMatchObject(base);
    expect(db.rows(auditLogs)).toEqual([]);
  });
  it("本人也不能用通用delete删除收方专属待关联照片", async () => {
    const db = setup();
    await expect(evidenceRouter.createCaller(context()).delete({ id: 28, deletionReason: "收方待提交影像不可在此删除" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.locks.slice(0, 2)).toEqual(["projects:update", "evidence_records:update"]);
    expect(db.rows(evidenceRecords)[0]).toMatchObject(base);
    expect(db.rows(auditLogs)).toEqual([]);
  });
  it.each(["takeoff-pending-9-forged", "takeoff-pending"])("通用upload不接受伪造专用pending %s", async sourceId => {
    const db = setup();
    await expect(evidenceRouter.createCaller(context()).upload({ projectId: 2, sourceType: "site_photo", sourceId, description: "普通入口不能伪造收方产物", capturedAt: "2026-11-25T00:00:00.000Z", fileName: "现场.jpg", mimeType: "image/jpeg", base64Data: "/9j/2Q==" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("收方专用") });
    expect(storagePut).not.toHaveBeenCalled();
    expect(db.rows(evidenceRecords)).toHaveLength(1);
    expect(db.rows(auditLogs)).toEqual([]);
  });
});
