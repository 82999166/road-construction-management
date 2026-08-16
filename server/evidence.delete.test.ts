import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

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

function createDeleteDb(rows: unknown[][]) {
  let index = 0;
  const limitedRows = () => rows[index++] ?? [];
  return {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => limitedRows()) })) })) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  };
}

const baseEvidence = { id: 28, projectId: 2, uploadedBy: 9, fileName: "现场水印.jpg", fileKey: "evidence/2/现场水印.jpg", sourceType: "site_photo" };

describe("现场影像受控删除", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["SITE_MANAGER"]);
    vi.mocked(getDepartmentModuleDataScope).mockResolvedValue({ hasAllProjects: false, projectIds: [2], organizationIds: [], roleCodes: ["SITE_MANAGER"] });
    vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
  });

  it("允许提交人删除未关联业务单据的照片，并保留审计记录", async () => {
    const db = createDeleteDb([[baseEvidence], [], [], [], [], [], [], [], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(evidenceRouter.createCaller(createContext()).delete({ id: 28 })).resolves.toEqual({ success: true });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(expect.anything(), "EVIDENCE");
    expect(assertDepartmentBusinessAccess).not.toHaveBeenCalledWith(expect.anything(), "EVIDENCE", "void");
  });

  it("拒绝删除已被业务单据引用的照片，防止破坏审计凭证", async () => {
    const db = createDeleteDb([[baseEvidence], [{ id: 1 }], [], [], [], [], [], [], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(evidenceRouter.createCaller(createContext()).delete({ id: 28 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("不能删除") });
    expect(db.delete).not.toHaveBeenCalled();
  });
});
