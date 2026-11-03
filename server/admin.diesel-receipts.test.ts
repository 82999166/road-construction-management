import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { dieselRefuelRecords, evidenceRecords, transportVehicles, users } from "../drizzle/schema";
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => ({ ...await importOriginal<typeof import("./access")>(), assertSuperAdmin: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageGetSignedUrl: vi.fn() }));
import { getDb } from "./db";
import { assertSuperAdmin } from "./access";
import { storageGetSignedUrl } from "./storage";
import { adminRouter } from "./routers/admin";

const ctx = {
  user: { id: 7, openId: "diesel-admin-test", email: null, name: "查看管理员", loginMethod: "local", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: {}, res: {},
} as TrpcContext;
const baseRecord = { id: 41, recordNo: "DS-41", projectId: 8, assetType: "vehicle", vehicleId: 1, machineId: null, transportTripId: null, supplyMethod: "external_station", stationOrSupplierName: "真实加油站", liters: "10.000", appliedUnitPrice: "7.00", actualUnitPrice: "7.00", amount: "70.00", refueledAt: new Date("2026-11-03T23:00:00Z"), status: "approved", receiptNo: "小票号", evidenceId: 91, createdBy: 2 };
const baseEvidence = { id: 91, projectId: 8, sourceType: "diesel_receipt", status: "active", fileName: "加油表.png", mimeType: "image/png", fileKey: "private/diesel/91.png" };

/** 内存桩故意不执行where：确保实体ID、项目、来源和状态亦被输出层复核；无真实DB连接。 */
function mockDb(records: unknown[], evidence: unknown[]) {
  const data = new Map<unknown, unknown[]>([[dieselRefuelRecords, records], [evidenceRecords, evidence], [transportVehicles, [{ id: 1, name: "粤A12345", plateNo: "粤A12345" }]], [users, [{ id: 2, name: "真实登记人" }]]]);
  const db = {
    select: vi.fn(() => ({ from: vi.fn((table: unknown) => {
      const result = {
        where: vi.fn(() => result), orderBy: vi.fn(() => result), limit: vi.fn(() => result),
        then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(data.get(table) ?? []).then(resolve, reject),
      };
      return result;
    }) })),
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
  vi.mocked(getDb).mockResolvedValue(db as never);
  return db;
}

describe("复用admin.diesel.listRefuelRecords的安全票据投影", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(ctx.user!);
    vi.mocked(storageGetSignedUrl).mockResolvedValue("/controlled-preview/91");
  });
  it("仅当前筛选项目真实ID的柴油凭证可预览，不下发对象键或伪造正式发票", async () => {
    const db = mockDb([baseRecord, { ...baseRecord, id: 42, projectId: 9 }], [baseEvidence]);
    const result = await adminRouter.createCaller(ctx).diesel.listRefuelRecords({ projectId: 8, dateFrom: "2026-11-04", dateTo: "2026-11-04" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 41, hasReceipt: true, formalInvoice: null, invoiceLinkage: "no_linkage", refuelerName: "真实登记人", receiptEvidence: { id: 91, fileName: "加油表.png", mimeType: "image/png", url: "/controlled-preview/91" } });
    expect(Object.keys(result[0].receiptEvidence!).sort()).toEqual(["id", "fileName", "mimeType", "url"].sort());
    expect(JSON.stringify(result)).not.toContain("private/diesel/91.png");
    expect(storageGetSignedUrl).toHaveBeenCalledWith("private/diesel/91.png");
    expect(db.insert).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled(); expect(db.delete).not.toHaveBeenCalled();
  });
  it.each([{ id: 92 }, { projectId: 9 }, { sourceType: "financial_invoice" }, { status: "deleted" }])("拒绝不匹配ID/跨项目/非柴油/已删除的影像：%s", override => {
    mockDb([baseRecord], [{ ...baseEvidence, ...override }]);
    return adminRouter.createCaller(ctx).diesel.listRefuelRecords({ projectId: 8 }).then(result => {
      expect(result[0].receiptEvidence).toBeNull();
      expect(result[0].hasReceipt).toBe(true); // 真实小票号仍存在，不等于影像可预览。
      expect(result[0].formalInvoice).toBeNull();
      expect(storageGetSignedUrl).not.toHaveBeenCalled();
    });
  });
  it("无真实小票号或有效影像时hasReceipt=false，不用孤立evidenceId填充", async () => {
    mockDb([{ ...baseRecord, receiptNo: "  " }], []);
    const result = await adminRouter.createCaller(ctx).diesel.listRefuelRecords({ projectId: 8 });
    expect(result[0]).toMatchObject({ hasReceipt: false, receiptEvidence: null, formalInvoice: null, invoiceLinkage: "no_linkage" });
  });
  it("复用后台超级管理员守卫，拒绝授权失败且不查询票据/存储", async () => {
    const db = mockDb([baseRecord], [baseEvidence]);
    vi.mocked(assertSuperAdmin).mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    await expect(adminRouter.createCaller(ctx).diesel.listRefuelRecords({ projectId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled(); expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
  it("复用日期区间校验，不接受倒序日期", async () => {
    await expect(adminRouter.createCaller(ctx).diesel.listRefuelRecords({ projectId: 8, dateFrom: "2026-11-04", dateTo: "2026-11-03" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
});
