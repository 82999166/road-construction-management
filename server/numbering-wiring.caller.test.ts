import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as s from "../drizzle/schema";
import { BusinessDocumentCreationMockDb } from "./services/businessDocumentCreation.mockDb";
import { isBusinessDocumentNumber } from "../shared/businessDocumentNumber";
const mocks = vi.hoisted(() => ({ db: null as any, denied: false, roleDenied: false, notify: vi.fn(), sms: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => mocks.db }));
vi.mock("./access", async original => ({ ...(await original<any>()), assertDepartmentBusinessAccess: async () => { if (mocks.roleDenied) throw new Error("模块角色已收回"); }, assertProjectInCurrentScope: async () => { if (mocks.denied) throw new Error("权限已收回"); }, assertSuperAdmin: async (ctx: any) => ctx.user, getEffectiveRoleCodes: async () => ["ALL"], hasUserSpecificOperationPermission: async () => true, getRoleOperationPermissionDecision: async () => ({ allowed: true, hasDetailedPermissions: true }) }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: mocks.notify }));
vi.mock("./services/smsNotifier", () => ({ notifyAliyunSmsSafely: mocks.sms, formatChinaSmsTime: () => "fixture" }));
vi.mock("./services/officialAccountDriverBinding", () => ({ sendOfficialAccountDriverNotification: mocks.notify }));
vi.mock("./services/transportRisk", () => ({ triggerTransportRiskScan: mocks.notify }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "fixture-only-secret" } }));
vi.mock("./services/refuelCompletionNotifier", () => ({ notifyRefuelCompletedSafely: mocks.notify }));
vi.mock("./services/secretVault", () => ({ encryptSecret: (v: any) => v, decryptSecret: (v: any) => v, fingerprintSecret: (v: any) => v, revealBusinessSecret: (v: any) => v }));
vi.mock("./services/personnelHistorySecurity", () => ({ protectPersonnelHistory: (v: any) => v, revealPersonnelHistory: (v: any) => v }));
vi.mock("./services/auditIntegrity", () => ({ appendIntegrityProtectedAudit: async (tx: any, input: any) => tx.insert(s.auditLogs).values(input) }));
import { contractRouter } from "./routers/contracts";
import { broadcastRouter } from "./routers/broadcast";
import { purchasingRouter, measurementRouter, financeRouter } from "./routers/finance";
import { machineryRouter, transportRouter } from "./routers/operations";
import { adminRouter } from "./routers/admin";
import { dieselRouter } from "./routers/diesel";
import { subcontractRouter } from "./routers/subcontract";
import { laborRouter } from "./routers/labor";
import { constructionRouter } from "./routers/construction";
import { settlementPaymentRouter } from "./routers/settlementPayments";
import { saveDirectoryPerson } from "./services/personnelDirectory";
import { generatePayrollDraftForEmployeeProfile } from "./services/payrollGeneration";
import { runBusinessDocumentCreation, newBusinessDocumentNumber } from "./services/businessDocumentCreation";
const ctx: any = { user: { id: 9, role: "user", openId: "synthetic-numbering", name: "测试", loginMethod: "manus" }, req: { headers: {} }, res: {} };
let db: BusinessDocumentCreationMockDb;
function number(table: any, field: string, module: string) { const rows = db.rows(table); expect(rows).toHaveLength(1); expect(isBusinessDocumentNumber(rows[0][field])).toBe(true); expect(rows[0][field]).toMatch(new RegExp(`^${module}\\d{14}0009\\d{4}$`)); return rows[0][field]; }
beforeEach(() => { vi.clearAllMocks(); mocks.denied = false; mocks.roleDenied = false; db = new BusinessDocumentCreationMockDb(); mocks.db = db; db.seed(s.projects, { id: 3, code: "P3", name: "合成项目", nodeType: "project", status: "active" }); mocks.notify.mockResolvedValue(undefined); mocks.sms.mockResolvedValue(undefined); });
afterEach(() => { db.close(); vi.useRealTimers(); });
describe("完整业务服务caller接线（真实生成器/SQL/unique，离线fixture）", () => {
  it("合同新建、并发重试一次业务和通知、编辑保留历史号", async () => {
    const input = { projectId: 3, contractType: "transport" as const, counterpartyName: "合成运输队", pricingMethod: "trip" as const, contractAmount: 1000, documentRequestKey: "contract-1" };
    const caller = contractRouter.createCaller(ctx); const [a,b] = await Promise.all([caller.save(input), caller.save(input)]); expect(a).toEqual(b); const no = number(s.outsourceContracts, "contractNo", "CT"); expect(mocks.notify).toHaveBeenCalledTimes(1);
    await caller.save({ ...input, id: a.contractId, contractAmount: 2000, documentRequestKey: "contract-edit" }); expect(db.rows(s.outsourceContracts)[0].contractNo).toBe(no);
  });
  it("业务/审计/提交/编号失败整体回滚且不通知，再试不留半业务", async () => {
    const input = { projectId: 3, contractType: "other" as const, counterpartyName: "合成合同", pricingMethod: "day" as const, contractAmount: 10 };
    db.failInsertTable = "audit_logs"; await expect(contractRouter.createCaller(ctx).save(input)).rejects.toThrow("injected"); expect(db.rows(s.outsourceContracts)).toEqual([]); expect(db.rows(s.businessDocumentNumberCounters)).toEqual([]); expect(mocks.notify).not.toHaveBeenCalled();
    db.failInsertTable = undefined; db.failCommit = true; await expect(contractRouter.createCaller(ctx).save(input)).rejects.toThrow("commit"); expect(db.rows(s.outsourceContracts)).toEqual([]); expect(db.rows(s.businessDocumentCreationReceipts)).toEqual([]); db.failCommit = false; await contractRouter.createCaller(ctx).save(input); number(s.outsourceContracts, "contractNo", "CT");
  });
  it("重试内容冲突、权限收回和未登录不借用回执", async () => {
    const input = { projectId: 3, contractType: "other" as const, counterpartyName: "合成合同", pricingMethod: "day" as const, contractAmount: 10, documentRequestKey: "stable" };
    await contractRouter.createCaller(ctx).save(input); await expect(contractRouter.createCaller(ctx).save({ ...input, contractAmount: 11 })).rejects.toThrow("不同内容"); mocks.denied = true; await expect(contractRouter.createCaller(ctx).save(input)).rejects.toThrow("权限已收回"); await expect(contractRouter.createCaller({ ...ctx, user: null }).save(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("稳定回执锁等待期间收回模块角色也拒绝，不能只依赖早期scope校验", async () => {
    const input = { projectId: 3, contractType: "other" as const, counterpartyName: "合成合同", pricingMethod: "day" as const, contractAmount: 10, documentRequestKey: "revoke-lock" };
    await contractRouter.createCaller(ctx).save(input); db.beforeSelect = table => { if (table === "projects") mocks.roleDenied = true; }; await expect(contractRouter.createCaller(ctx).save(input)).rejects.toThrow("模块角色已收回"); expect(db.rows(s.outsourceContracts)).toHaveLength(1);
  });
  it("采购申请PR始终服务端正式编号，用户外部号仅保留参考，订单PO保留批准申请引用", async () => {
    db.seed(s.purchaseCategories, { id: 2, code: "PART", name: "配件", status: "active" });
    await purchasingRouter.createCaller(ctx).saveRequest({ projectId: 3, categoryId: 2, amount: 100, description: "合成采购" }); number(s.purchaseRequests, "requestNo", "PR");
    await purchasingRouter.createCaller(ctx).saveRequest({ projectId: 3, categoryId: 2, amount: 50, description: "外部采购", requestNo: "EXTERNAL-PR" }); expect(db.rows(s.purchaseRequests)[1].requestNo).toMatch(/^PR\d{14}0009\d{4}$/); expect(db.rows(s.purchaseRequests)[1].description).toContain("EXTERNAL-PR"); expect(new Set(db.rows(s.purchaseRequests).map(row => row.requestNo)).size).toBe(2);
    await db.update(s.purchaseRequests).set({ status: "approved" }).where((await import("drizzle-orm")).eq(s.purchaseRequests.id, 1));
    await purchasingRouter.createCaller(ctx).createOrder({ projectId: 3, requestId: 1, amount: 100, orderedAt: "2026-11-24T08:00:00Z" }); number(s.purchaseOrders, "orderNo", "PO"); expect(db.rows(s.purchaseOrders)[0].requestId).toBe(1);
  });
  it("计量CL和取量TO实际创建路径", async () => {
    await measurementRouter.createCaller(ctx).saveClaim({ projectId: 3, period: "2026-11", declaredAmount: 100 }); number(s.measurementClaims, "claimNo", "CL");
    await measurementRouter.createCaller(ctx).saveTakeoff({ projectId: 3, takeoffDate: "2026-11-24", workLocation: "合成区段", workItem: "合成土方", unit: "m3", quantity: 10, unitPrice: 2 }); number(s.measurementTakeoffRecords, "takeoffNo", "TO");
  });
  it("人工财务FR及冲销RV保持来源链和金额，不改原单", async () => {
    const caller = financeRouter.createCaller(ctx); await caller.saveRecord({ projectId: 3, direction: "expense", category: "合成费用", amount: 10, occurredAt: "2026-11-24T08:00:00Z", settlementStatus: "paid" }); const no = number(s.financialRecords, "recordNo", "FR");
    await caller.reverseRecord({ projectId: 3, id: 1, reversedAt: "2026-11-24T09:00:00Z", reason: "合成冲销依据" }); const rows = db.rows(s.financialRecords); expect(rows).toHaveLength(2); expect(rows[0].recordNo).toBe(no); expect(rows[1]).toMatchObject({ sourceType: "financial_reversal", sourceId: "1", amount: "10", direction: "income" }); expect(rows[1].recordNo).toMatch(/^RV\d{14}0009\d{4}$/);
  });
  it("手机柴油DS和机械镜像MC金额/来源一体", async () => {
    db.seed(s.machines, { id: 13, code: "M13", name: "合成机械", ownership: "owned", projectId: 3 }); db.seed(s.evidenceRecords, { id: 6, projectId: 3, sourceType: "diesel_receipt", fileKey: "fixture", fileName: "fixture.jpg", mimeType: "image/jpeg", status: "active", uploadedBy: 9 }); db.seed(s.dieselGuidelinePrices, { projectId: 3, pricePerLiter: "8", effectiveFrom: new Date("2026-11-01"), status: "active", createdBy: 9 });
    const input = { projectId: 3, assetType: "machine" as const, assetId: 13, documentRequestKey: "diesel-stable", supplyMethod: "project_supply" as const, liters: 10, refueledAt: "2026-11-24T08:00:00Z", evidenceId: 6 };
    const caller = dieselRouter.createCaller(ctx); const a = await caller.mobileCreateRefuel(input); const b = await caller.mobileCreateRefuel(input); expect(a).toEqual(b); number(s.dieselRefuelRecords, "recordNo", "DS"); number(s.machineCostRecords, "documentNo", "MC"); expect(db.rows(s.machineCostRecords)[0]).toMatchObject({ dieselRefuelRecordId: 1, amount: "80" }); expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
  it("机械费用MC防重重放先于分号，来源柴油DS带明确costId桥接", async () => {
    db.seed(s.machines, { id: 13, projectId: 3, code: "M13", name: "合成机械", ownership: "owned" }); db.seed(s.dieselGuidelinePrices, { projectId: 3, pricePerLiter: "8", effectiveFrom: new Date("2026-11-01"), status: "active", createdBy: 9 });
    const input = { machineId: 13, projectId: 3, costType: "fuel" as const, costName: "柴油", quantity: 10, unitPrice: 8, occurredAt: "2026-11-24T08:00:00Z", requestId: "b428d876-dab1-455e-900c-393471b95a12" };
    const caller = machineryRouter.createCaller(ctx); await caller.saveCost(input); const no = number(s.machineCostRecords, "documentNo", "MC"); number(s.dieselRefuelRecords, "recordNo", "DS"); expect(db.rows(s.dieselRefuelRecords)[0].machineCostSourceId).toBe(1); await caller.saveCost(input); expect(db.rows(s.machineCostRecords)[0].documentNo).toBe(no); expect(db.rows(s.businessDocumentNumberAllocations)).toHaveLength(2);
  });
  it("机械日作业MD及工资PY临工DW真实创建并保留修改号", async () => {
    db.seed(s.machines, { id: 13, projectId: 3, code: "M13", name: "合成机械", ownership: "owned" }); await machineryRouter.createCaller(ctx).saveDailyOperation({ projectId: 3, machineId: 13, occurredOn: "2026-11-24", shiftCount: 0, shiftRate: 0, workHours: 0, outputAmount: 0, driverWageAmount: 0, overtimeHours: 2, overtimeHourlyRate: 10 }); number(s.machineDailyOperations, "documentNo", "MD");
    db.seed(s.laborWorkers, [{ id: 1, projectId: 3, realName: "合成员工", workerCategory: "company_admin", entryDate: new Date("2026-11-01") }, { id: 2, projectId: 3, realName: "合成临工", workerCategory: "temporary_daily", entryDate: new Date("2026-11-01") }]);
    await laborRouter.createCaller(ctx).payroll.save({ projectId: 3, workerId: 1, period: "2026-11", payableAmount: 100 }); number(s.payrollStatements, "documentNo", "PY");
    await laborRouter.createCaller(ctx).dailyWage.save({ projectId: 3, workerId: 2, settlementDate: "2026-11-24", payableAmount: 20 }); number(s.temporaryDailyWageSettlements, "documentNo", "DW");
  });
  it("施工日报CR与人事PN实际服务新建持久号", async () => {
    await constructionRouter.createCaller(ctx).saveReport({ projectId: 3, reportDate: "2026-11-24", workContent: "合成施工记录", workArea: "合成工区", weather: "sunny", progressPercent: 10 }); number(s.constructionDailyReports, "documentNo", "CR");
    await saveDirectoryPerson({ name: "合成外部人员", affiliation: "external", primaryPositionId: null, projectId: 3, employmentStatus: "active", payrollEnabled: false }, 9, db as any); number(s.personnelPeople, "personNo", "PN");
  });
  it("分包SP及应付SS保留原包件快照", async () => {
    db.seed(s.subcontractTeams, { id: 1, projectId: 3, teamName: "合成施工队", status: "active", createdBy: 9 }); await subcontractRouter.createCaller(ctx).savePackage({ projectId: 3, subcontractTeamId: 1, workItem: "合成工程", unit: "m3", quantity: 10, upstreamUnitPrice: 10, subcontractUnitPrice: 8 }); const no = number(s.subcontractPackages, "packageNo", "SP"); await db.update(s.subcontractPackages).set({ status: "confirmed" }).where((await import("drizzle-orm")).eq(s.subcontractPackages.id, 1)); await subcontractRouter.createCaller(ctx).createPaymentSettlement({ projectId: 3, packageId: 1, payeeName: "合成施工队" }); number(s.subcontractPaymentSettlements, "settlementNo", "SS"); expect(db.rows(s.subcontractPaymentSettlements)[0].packageNoSnapshot).toBe(no);
  });
  it("真正定时工资SYS、手动actor9，预览/已有期不分号", async () => {
    db.seed(s.laborWorkers, { id: 1, projectId: 3, realName: "合成员工", workerCategory: "company_admin", entryDate: new Date("2026-11-01") }); db.seed(s.employeeProfiles, { id: 1, projectId: 3, laborWorkerId: 1, employeeType: "management", employmentStatus: "active", joinedAt: new Date("2026-11-01"), salaryBasis: "daily", baseSalary: "100" }); db.seed(s.attendanceRecords, { workerId: 1, projectId: 3, attendanceDate: new Date("2026-11-02"), workHours: "8", overtimeHours: "0", status: "confirmed" });
    expect(await generatePayrollDraftForEmployeeProfile({ employeeProfileId: 1, period: "2026-11", actorUserId: 9, source: "schedule" })).toMatchObject({ status: "created" }); expect(db.rows(s.payrollStatements)[0].documentNo).toMatch(/^PY\d{14}SYS\d{4}$/); expect(await generatePayrollDraftForEmployeeProfile({ employeeProfileId: 1, period: "2026-11", actorUserId: 9, source: "manual" })).toMatchObject({ status: "skipped" }); expect(db.rows(s.businessDocumentNumberAllocations)).toHaveLength(1);
  });
  it("统一付款PM及财务FR同事务，资金来源ID不改", async () => {
    db.seed(s.payrollStatements, { id: 1, workerId: 1, projectId: 3, period: "2026-11", payableAmount: "100", actualAmount: "100", status: "approved" }); db.seed(s.laborWorkers, { id: 1, projectId: 3, realName: "合成员工" }); db.seed(s.evidenceRecords, { id: 6, projectId: 3, sourceType: "settlement_payment_proof", sourceId: "payroll:1", fileKey: "fixture", fileName: "fixture.jpg", mimeType: "image/jpeg", status: "active", uploadedBy: 9 });
    await settlementPaymentRouter.createCaller(ctx).record({ projectId: 3, settlementType: "payroll", settlementId: 1, amount: 100, paymentDate: "2026-11-24", paymentMethod: "bank_transfer", payeeName: "合成员工", evidenceId: 6 }); number(s.settlementPaymentRecords, "documentNo", "PM"); number(s.financialRecords, "recordNo", "FR"); expect(db.rows(s.financialRecords)[0]).toMatchObject({ sourceType: "settlement_payment", sourceId: "1", amount: "100" });
  });
  it("库存IV及导入PO/IV统一内部正式编号，外部参考保留且稳定键重试不多入库", async () => {
    db.seed(s.purchaseCategories, { id: 2, code: "MATERIAL", name: "合成材料", status: "active" }); db.seed(s.evidenceRecords, { id: 6, projectId: 3, sourceType: "purchase", sourceId: "small_direct_document", fileKey: "fixture", fileName: "fixture.jpg", mimeType: "image/jpeg", status: "active", uploadedBy: 9 }); const caller = purchasingRouter.createCaller(ctx); await caller.saveInventoryTransaction({ projectId: 3, transactionType: "inbound", evidenceId: 6, exceptionReason: "合成历史无订单库存核准", itemName: "合成沙石", unit: "t", quantity: 2, unitCost: 10, occurredAt: "2026-11-24T08:00:00Z" }); number(s.inventoryTransactions, "transactionNo", "IV");
    const input = { projectId: 3, documentRequestKey: "import-1", orders: [{ orderNo: "EXT-PO-1", categoryName: "合成材料", itemDescription: "合成水泥", amount: 10, orderedAt: "2026-11-24T08:00:00Z", purchaserName: "合成采购者" }], inventoryTransactions: [{ transactionNo: "EXT-IV-1", transactionType: "inbound" as const, itemName: "合成水泥", unit: "包", quantity: 1, unitCost: 10, occurredAt: "2026-11-24T08:00:00Z" }] };
    await db.delete(s.inventoryTransactions).where((await import("drizzle-orm")).eq(s.inventoryTransactions.id, 1)); await caller.importSpreadsheet(input); await caller.importSpreadsheet(input); number(s.purchaseOrders, "orderNo", "PO"); expect(db.rows(s.purchaseOrders)[0].ocrSummary).toContain("原Excel单号：EXT-PO-1"); number(s.inventoryTransactions, "transactionNo", "IV"); expect(db.rows(s.inventoryTransactions)[0].remarks).toContain("原Excel流水号：EXT-IV-1");
  });
  it("会计日结DC和税务交接TX真实落库，并关联纳税主体", async () => {
    db.seed(s.taxEntityProfiles, { id: 1, entityName: "合成纳税主体", taxpayerIdentifier: "FIXTURE123", createdBy: 9 }); db.seed(s.projectTaxProfiles, { projectId: 3, taxEntityId: 1, projectLocation: "合成地区", createdBy: 9 });
    await financeRouter.createCaller(ctx).createTaxHandoffBatch({ projectId: 3, period: "2026-11", handoffType: "combined" }); number(s.taxHandoffBatches, "batchNo", "TX");
    await financeRouter.createCaller(ctx).closeDailyAccount({ projectId: 3, closingDate: "2026-11-24" }); number(s.dailyAccountingClosures, "closingNo", "DC");
  });
  it("机械月度MM及对外付款MS共用真实月结依据", async () => {
    db.seed(s.machines, { id: 13, projectId: 3, code: "M13", name: "合成租赁机械", ownership: "leased" }); db.seed(s.machineLeaseRules, { machineId: 13, projectId: 3, billingType: "monthly", rate: "3000", effectiveFrom: new Date("2026-11-01") });
    const caller = machineryRouter.createCaller(ctx); await caller.saveMonthlyStatement({ projectId: 3, machineId: 13, period: "2026-11", machineWorkDays: 30, machineOvertimeHours: 0, driverMonthlyWage: 0, driverWorkDays: 0, driverOvertimeHours: 0 }); const no = number(s.machineMonthlyStatements, "documentNo", "MM"); await db.update(s.machineMonthlyStatements).set({ status: "approved" }).where((await import("drizzle-orm")).eq(s.machineMonthlyStatements.id, 1));
    await caller.createPaymentSettlement({ projectId: 3, monthlyStatementId: 1, payeeName: "合成出租方", payeeAccount: "fixture-bank", manualDeductionAmount: 0, invoiceStatus: "missing", paymentMethod: "bank_transfer" }); number(s.machinePaymentSettlements, "settlementNo", "MS"); expect(db.rows(s.machineMonthlyStatements)[0].documentNo).toBe(no);
  });
  it("管理员员工预支PA和维修AM真正新建带号且旧记录不被换号", async () => {
    db.seed(s.employeeProfiles, { id: 1, projectId: 3, employeeType: "management", employmentStatus: "active", salaryBasis: "daily", baseSalary: "100" }); await adminRouter.createCaller(ctx).employee.saveAdvance({ employeeProfileId: 1, advanceDate: "2026-11-24", amount: 20 }); number(s.employeePayrollAdvances, "documentNo", "PA");
    db.seed(s.machines, { id: 13, projectId: 3, code: "M13", name: "合成机械", ownership: "owned" }); await adminRouter.createCaller(ctx).assetMaintenance.save({ projectId: 3, assetType: "machine", assetId: 13, costCategory: "repair", amount: 10, occurredAt: "2026-11-24T08:00:00Z", status: "draft" }); number(s.assetMaintenanceRecords, "documentNo", "AM");
  });
  it("PC管理员柴油DS自动与机械成本MC同事务", async () => {
    db.seed(s.machines, { id: 13, projectId: 3, code: "M13", name: "合成机械", ownership: "owned" }); db.seed(s.dieselGuidelinePrices, { projectId: 3, pricePerLiter: "8", effectiveFrom: new Date("2026-11-01"), status: "active", createdBy: 9 }); db.seed(s.evidenceRecords, { id: 6, projectId: 3, sourceType: "diesel_receipt", fileKey: "fixture", fileName: "fixture.jpg", mimeType: "image/jpeg", status: "active", uploadedBy: 9 }); await adminRouter.createCaller(ctx).diesel.saveRefuelRecord({ projectId: 3, assetType: "machine", machineId: 13, evidenceId: 6, supplyMethod: "project_supply", liters: 10, refueledAt: "2026-11-24T08:00:00Z", status: "approved" }); number(s.dieselRefuelRecords, "recordNo", "DS"); number(s.machineCostRecords, "documentNo", "MC");
  });
  it("运输人工TR始终内部正式编号，外部参考保留，TS非按趟结算", async () => {
    db.seed(s.transportVehicles, { id: 1, projectId: 3, plateNo: "合成A12345", ownership: "trip_settlement", boxLengthMeters: "5", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1" }); db.seed(s.freightRateRules, { id: 1, projectId: 3, settlementUnit: "trip", basePricePerUnit: "100", effectiveFrom: new Date("2026-11-01"), status: "active" });
    const caller = transportRouter.createCaller(ctx); await caller.saveTrip({ projectId: 3, vehicleId: 1, freightRuleId: 1, startAt: "2026-11-24T08:00:00Z", endAt: "2026-11-24T09:00:00Z" }); number(s.transportTrips, "tripNo", "TR"); await caller.saveTrip({ projectId: 3, vehicleId: 1, freightRuleId: 1, tripNo: "EXT-TR-1", startAt: "2026-11-24T10:00:00Z", endAt: "2026-11-24T11:00:00Z" }); expect(db.rows(s.transportTrips)[1].tripNo).toMatch(/^TR\d{14}0009\d{4}$/); expect(db.rows(s.transportTrips)[1].routeSnapshot.externalTripNo).toBe("EXT-TR-1"); expect(new Set(db.rows(s.transportTrips).map(row => row.tripNo)).size).toBe(2);
    await caller.createNonTripVehicleSettlement({ projectId: 3, vehicleId: 1, periodStart: "2026-11-24", periodEnd: "2026-11-24", payeeName: "合成司机", paymentMethod: "cash", settlementKind: "adjustment", basisDescription: "合成签证已核准费用", adjustmentAmount: 100 }); number(s.transportVehicleSettlements, "settlementNo", "TS");
  });
  it("无稳定请求键的相同人工流水允许合法另笔，不能payload永久去重", async () => {
    const input = { projectId: 3, direction: "expense" as const, category: "合成费用", amount: 10, occurredAt: "2026-11-24T08:00:00Z", settlementStatus: "unpaid" as const };
    await financeRouter.createCaller(ctx).saveRecord(input); await financeRouter.createCaller(ctx).saveRecord(input); expect(db.rows(s.financialRecords)).toHaveLength(2); expect(new Set(db.rows(s.financialRecords).map(row => row.recordNo)).size).toBe(2); expect(db.rows(s.businessDocumentCreationReceipts)).toHaveLength(0);
  });
  it("群发BC草稿服务新建持久单号且没有实际群发", async () => {
    await broadcastRouter.createCaller(ctx).saveDraft({ title: "合成草稿标题", content: "合成草稿内容", channels: ["system"], audienceType: "project", projectId: 3 }); number(s.officialAccountBroadcasts, "broadcastNo", "BC");
  });
  it("RJ手机首次和PC写卡新建调用真实生成器，仍保留内部卡随机UUID身份", async () => {
    db.seed(s.transportVehicles, { id: 1, projectId: 3, plateNo: "合成A12345", ownership: "trip_settlement", driverName: "合成司机", driverPhoneEncrypted: "13800000000", boxLengthMeters: "5", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1", status: "active" }); const caller = transportRouter.createCaller(ctx);
    await caller.prepareMobileNfcInitialIssue({ projectId: 3, vehicleId: 1, documentRequestKey: "write-mobile" }); const no = number(s.rfidCardWriteJobs, "jobNo", "RJ"); expect(db.rows(s.transportVehicleRfidCards)).toHaveLength(1);
    await db.update(s.rfidCardWriteJobs).set({ status: "succeeded" }).where((await import("drizzle-orm")).eq(s.rfidCardWriteJobs.id, 1)); await db.update(s.transportVehicleRfidCards).set({ status: "active", lastWrittenAt: new Date("2026-11-24T08:00:00Z") }).where((await import("drizzle-orm")).eq(s.transportVehicleRfidCards.id, 1)); await caller.prepareRfidCardWrite({ projectId: 3, cardId: 1, action: "rewrite", executionMode: "manual_confirmation", documentRequestKey: "write-pc" }); expect(db.rows(s.rfidCardWriteJobs)).toHaveLength(2); expect(db.rows(s.rfidCardWriteJobs)[0].jobNo).toBe(no); expect(db.rows(s.rfidCardWriteJobs)[1].jobNo).toMatch(/^RJ\d{14}0009\d{4}$/);
  });
  it("自动读卡TR业务/编号/刷卡事件/审计同事务，内部event幂等键不换号", async () => {
    db.seed(s.transportVehicles, { id: 1, projectId: 3, plateNo: "合成A12345", ownership: "trip_settlement", boxLengthMeters: "5", boxWidthMeters: "2", boxHeightMeters: "1", loadFactor: "1", status: "active" }); db.seed(s.freightRateRules, { id: 1, projectId: 3, settlementUnit: "trip", basePricePerUnit: "100", effectiveFrom: new Date("2026-11-01"), status: "active" }); db.seed(s.transportSites, [{ id: 1, projectId: 3, siteType: "load", name: "合成装土", createdBy: 9 }, { id: 2, projectId: 3, siteType: "unload", name: "合成卸土", createdBy: 9 }]); db.seed(s.transportReaderDevices, { projectId: 3, siteId: 1, deviceCode: "READER-1", displayName: "合成读卡器", createdBy: 9 }); db.seed(s.transportRoutePresets, { projectId: 3, loadSiteId: 1, unloadSiteId: 2, freightRuleId: 1, presetDistanceKm: "1", isDefault: true, createdBy: 9 }); db.seed(s.transportVehicleRfidCards, { projectId: 3, vehicleId: 1, cardUidFingerprint: "a".repeat(64), cardUidMasked: "fixture-card", createdBy: 9 });
    const input = { projectId: 3, readerDeviceCode: "READER-1", cardFingerprint: "a".repeat(64), idempotencyKey: "fixture-event-1", occurredAt: "2026-11-24T08:00:00Z" }; await transportRouter.createCaller(ctx).scanNfcReader(input); const no = number(s.transportTrips, "tripNo", "TR"); expect(db.rows(s.transportCardEvents)).toHaveLength(1); expect(db.rows(s.transportCardEvents)[0].idempotencyKey).toBe(input.idempotencyKey); await transportRouter.createCaller(ctx).scanNfcReader(input); expect(db.rows(s.transportTrips)[0].tripNo).toBe(no); expect(db.rows(s.transportCardEvents)).toHaveLength(1);
  });
  it.each(["PR","PO","IV","CL","TO","TR","TS","DS","MC","MD","MM","MS","PY","DW","PA","PM","FR","RV","SP","SS","CT","DC","TX","AM","CR","RJ","BC","PN"] as const)("版块%s事务编号失败不留创建事实", async module => {
    const input = { projectId: 3, documentRequestKey: `rollback-${module}` }; await expect(runBusinessDocumentCreation(db as any, { actorId: 9, scope: `test:${module}`, projectId: 3, input, revalidate: async () => undefined }, async tx => { await newBusinessDocumentNumber(tx, module, { kind: "user", userId: 9 }, 3, input); throw Error("business failure"); })).rejects.toThrow("business failure"); expect(db.rows(s.businessDocumentNumberAllocations)).toEqual([]); expect(db.rows(s.businessDocumentNumberCounters)).toEqual([]); expect(db.rows(s.businessDocumentCreationReceipts)).toEqual([]);
  });
});
