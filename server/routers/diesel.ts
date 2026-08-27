import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, dieselGuidelinePrices, dieselRefuelRecords, evidenceRecords, machineCostRecords, machines, projects, transportVehicles } from "../../drizzle/schema";
import { assertProjectInCurrentScope, getCurrentDataScope, getRoleOperationPermissionDecision, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { chinaBusinessDate } from "../services/chinaBusinessTime";
import { protectedProcedure, router } from "../_core/trpc";

/**
 * 移动柴油工作区只提供已授权项目的真实台账摘要与最近记录。
 * 领用登记、指导价、预警、结算和作废仍分别由既有细分权限与后台受控流程处理，避免移动端菜单扩大操作边界。
 */
const DUPLICATE_REFUEL_WINDOW_MILLISECONDS = 5 * 60 * 1000;
const DUPLICATE_REFUEL_LITERS_TOLERANCE = 0.001;

export const dieselRouter = router({
  mobileOverview: protectedProcedure.input(z.object({ projectId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
    requireAuthenticatedUser(ctx);
    const readAccess = await getRoleOperationPermissionDecision(ctx, "DIESEL", "read");
    if (!readAccess.hasDetailedPermissions || !readAccess.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未被授予柴油台账查看权限" });
    const db = await getDb();
    if (!db) return { projects: [], selectedProjectId: null, summary: null, records: [] };
    const dataScope = await getCurrentDataScope(ctx);
    const allProjects = await db.select({ id: projects.id, name: projects.name, organizationId: projects.organizationId, status: projects.status }).from(projects).where(ne(projects.status, "archived"));
    const authorizedProjects = dataScope.hasAllProjects
      ? allProjects
      : allProjects.filter(project => dataScope.projectIds.includes(project.id) || (project.organizationId !== null && dataScope.organizationIds.includes(project.organizationId)));
    const selectedProjectId = input?.projectId ?? authorizedProjects[0]?.id ?? null;
    if (selectedProjectId && !authorizedProjects.some(project => project.id === selectedProjectId)) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未获授权访问该项目柴油台账" });
    if (!selectedProjectId) return { projects: authorizedProjects.map(project => ({ id: project.id, name: project.name })), selectedProjectId: null, summary: null, records: [] };
    const rows = await db.select().from(dieselRefuelRecords).where(eq(dieselRefuelRecords.projectId, selectedProjectId)).orderBy(desc(dieselRefuelRecords.refueledAt));
    const activeRows = rows.filter(row => row.status !== "void");
    const summary = {
      totalLiters: activeRows.reduce((total, row) => total + Number(row.liters), 0),
      totalAmount: activeRows.reduce((total, row) => total + Number(row.amount), 0),
      projectSupplyLiters: activeRows.filter(row => row.supplyMethod === "project_supply").reduce((total, row) => total + Number(row.liters), 0),
      stationLiters: activeRows.filter(row => row.supplyMethod === "external_station").reduce((total, row) => total + Number(row.liters), 0),
      deductibleAmount: activeRows.filter(row => row.deductFromFreight).reduce((total, row) => total + Number(row.amount), 0),
    };
    const [createAccess, settleAccess, voidAccess, guidelineAccess, alertAccess] = await Promise.all([
      getRoleOperationPermissionDecision(ctx, "DIESEL", "create"),
      getRoleOperationPermissionDecision(ctx, "DIESEL", "settle"),
      getRoleOperationPermissionDecision(ctx, "DIESEL", "void"),
      getRoleOperationPermissionDecision(ctx, "DIESEL", "manage"),
      getRoleOperationPermissionDecision(ctx, "DIESEL", "manage"),
    ]);
    return {
      projects: authorizedProjects.map(project => ({ id: project.id, name: project.name })),
      selectedProjectId,
      capabilities: {
        canCreateRefuel: createAccess.allowed,
        canSettleDeduction: settleAccess.allowed,
        canVoidRefuel: voidAccess.allowed,
        canManageGuidelinePrice: guidelineAccess.allowed,
        canManagePriceAlert: alertAccess.allowed,
      },
      summary,
      records: rows.slice(0, 30).map(row => ({
        id: row.id,
        recordNo: row.recordNo,
        assetType: row.assetType,
        assetId: row.assetType === "vehicle" ? row.vehicleId : row.machineId,
        supplyMethod: row.supplyMethod,
        stationOrSupplierName: row.stationOrSupplierName,
        liters: Number(row.liters),
        amount: Number(row.amount),
        appliedUnitPrice: Number(row.appliedUnitPrice),
        deductFromFreight: row.deductFromFreight,
        refueledAt: row.refueledAt,
        status: row.status,
      })),
    };
  }),

  /**
   * 柴油汇总打印仅查询已授权项目内的真实领用记录。默认不让作废记录混入金额汇总；
   * 管理人员显式筛选“已作废”时才单独打印作废审计明细。
   */
  printSummary: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    assetType: z.enum(["all", "vehicle", "machine"]).default("all"),
    supplyMethod: z.enum(["all", "project_supply", "external_station"]).default("all"),
    status: z.enum(["all", "approved", "settled", "void"]).default("all"),
  })).query(async ({ ctx, input }) => {
    requireAuthenticatedUser(ctx);
    const readAccess = await getRoleOperationPermissionDecision(ctx, "DIESEL", "read");
    if (!readAccess.hasDetailedPermissions || !readAccess.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未被授予柴油台账查看权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { records: [], summary: { recordCount: 0, liters: 0, amount: 0, deductibleAmount: 0, vehicleCount: 0, machineCount: 0 } };
    const start = new Date(`${input.dateFrom}T00:00:00+08:00`);
    const end = new Date(`${input.dateTo}T23:59:59.999+08:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new TRPCError({ code: "BAD_REQUEST", message: "柴油汇总日期范围无效" });
    const predicates = [eq(dieselRefuelRecords.projectId, input.projectId), gte(dieselRefuelRecords.refueledAt, start), lte(dieselRefuelRecords.refueledAt, end)];
    if (input.assetType !== "all") predicates.push(eq(dieselRefuelRecords.assetType, input.assetType));
    if (input.supplyMethod !== "all") predicates.push(eq(dieselRefuelRecords.supplyMethod, input.supplyMethod));
    if (input.status === "all") predicates.push(ne(dieselRefuelRecords.status, "void"));
    else predicates.push(eq(dieselRefuelRecords.status, input.status));
    const [rows, vehicleRows, machineRows] = await Promise.all([
      db.select().from(dieselRefuelRecords).where(and(...predicates)).orderBy(desc(dieselRefuelRecords.refueledAt)),
      db.select({ id: transportVehicles.id, label: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)),
      db.select({ id: machines.id, label: machines.name, code: machines.code }).from(machines).where(eq(machines.projectId, input.projectId)),
    ]);
    const vehicleLabels = new Map(vehicleRows.map(row => [row.id, row.label]));
    const machineLabels = new Map(machineRows.map(row => [row.id, row.code ? `${row.label} · ${row.code}` : row.label]));
    const records = rows.map(row => ({
      id: row.id,
      recordNo: row.recordNo,
      assetType: row.assetType,
      assetLabel: row.assetType === "vehicle" ? vehicleLabels.get(row.vehicleId ?? -1) ?? "车辆已停用/删除" : machineLabels.get(row.machineId ?? -1) ?? "机械已停用/删除",
      supplyMethod: row.supplyMethod,
      stationOrSupplierName: row.stationOrSupplierName,
      liters: Number(row.liters),
      appliedUnitPrice: Number(row.appliedUnitPrice),
      amount: Number(row.amount),
      deductFromFreight: row.deductFromFreight,
      meterReading: row.meterReading === null ? null : Number(row.meterReading),
      receiptNo: row.receiptNo,
      refueledAt: row.refueledAt,
      status: row.status,
    }));
    return {
      records,
      summary: {
        recordCount: records.length,
        liters: records.reduce((sum, row) => sum + row.liters, 0),
        amount: records.reduce((sum, row) => sum + row.amount, 0),
        deductibleAmount: records.filter(row => row.deductFromFreight).reduce((sum, row) => sum + row.amount, 0),
        vehicleCount: new Set(records.filter(row => row.assetType === "vehicle").map(row => row.assetLabel)).size,
        machineCount: new Set(records.filter(row => row.assetType === "machine").map(row => row.assetLabel)).size,
      },
    };
  }),

  /** 为移动端柴油领用登记提供已授权项目内的真实车辆与机械；不能依赖客户端猜测资产编号。 */
  mobileRefuelOptions: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireAuthenticatedUser(ctx);
    const createAccess = await getRoleOperationPermissionDecision(ctx, "DIESEL", "create");
    if (!createAccess.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未被授予柴油领用登记权限" });
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) return { vehicles: [], machines: [] };
    const [vehicleRows, machineRows] = await Promise.all([
      db.select({ id: transportVehicles.id, label: transportVehicles.plateNo }).from(transportVehicles).where(eq(transportVehicles.projectId, input.projectId)),
      db.select({ id: machines.id, label: machines.name, code: machines.code }).from(machines).where(eq(machines.projectId, input.projectId)),
    ]);
    return {
      vehicles: vehicleRows.map(item => ({ id: item.id, label: item.label })),
      machines: machineRows.map(item => ({ id: item.id, label: item.code ? `${item.label} · ${item.code}` : item.label })),
    };
  }),

  /**
   * 移动柴油登记与后台登记共用相同的关键业务约束：项目、资产、影像和指导价均由服务端复核。
   * 现场端只允许新增已记账领用；编辑、作废、指导价与预警设置仍由各自细分权限的受控窗口办理。
   */
  mobileCreateRefuel: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    assetType: z.enum(["vehicle", "machine"]),
    assetId: z.number().int().positive(),
    supplyMethod: z.enum(["project_supply", "external_station"]),
    stationOrSupplierName: z.string().trim().max(160).nullable().optional(),
    liters: z.number().positive().max(100_000),
    actualUnitPrice: z.number().positive().max(10_000).nullable().optional(),
    deductFromFreight: z.boolean().default(false),
    refueledAt: z.string().datetime(),
    meterReading: z.number().min(0).max(10_000_000).nullable().optional(),
    receiptNo: z.string().trim().max(128).nullable().optional(),
    evidenceId: z.number().int().positive(),
    remarks: z.string().trim().max(500).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx);
    const createAccess = await getRoleOperationPermissionDecision(ctx, "DIESEL", "create");
    if (!createAccess.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未被授予柴油领用登记权限" });
    if (input.deductFromFreight) {
      const settleAccess = await getRoleOperationPermissionDecision(ctx, "DIESEL", "settle");
      if (!settleAccess.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "运输扣油需额外授予柴油扣油结算权限" });
      if (input.assetType !== "vehicle") throw new TRPCError({ code: "BAD_REQUEST", message: "运输扣油仅适用于车辆" });
    }
    if (input.supplyMethod === "external_station" && (!input.stationOrSupplierName?.trim() || !input.actualUnitPrice)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "加油站加油必须填写加油站/供应商和实际单价" });
    }
    await assertProjectInCurrentScope(ctx, input.projectId);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接暂不可用" });
    const [project, evidence, asset] = await Promise.all([
      db.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.id, input.projectId)).limit(1),
      db.select({ id: evidenceRecords.id, projectId: evidenceRecords.projectId, sourceType: evidenceRecords.sourceType, status: evidenceRecords.status }).from(evidenceRecords).where(eq(evidenceRecords.id, input.evidenceId)).limit(1),
      input.assetType === "vehicle"
        ? db.select({ id: transportVehicles.id, projectId: transportVehicles.projectId }).from(transportVehicles).where(eq(transportVehicles.id, input.assetId)).limit(1)
        : db.select({ id: machines.id, projectId: machines.projectId }).from(machines).where(eq(machines.id, input.assetId)).limit(1),
    ]);
    if (!project[0] || project[0].status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "柴油记录必须归属有效项目" });
    if (!evidence[0] || evidence[0].projectId !== input.projectId || evidence[0].sourceType !== "diesel_receipt" || evidence[0].status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "柴油领用必须关联当前项目有效的加油表水印凭证" });
    if (!asset[0] || asset[0].projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "所选车辆或机械必须归属当前项目" });
    const refueledAt = new Date(input.refueledAt);
    if (Number.isNaN(refueledAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "加油时间无效" });
    let appliedUnitPrice = input.actualUnitPrice ?? 0;
    if (input.supplyMethod === "project_supply") {
      const dateText = chinaBusinessDate(refueledAt);
      const prices = await db.select().from(dieselGuidelinePrices).where(eq(dieselGuidelinePrices.projectId, input.projectId)).orderBy(desc(dieselGuidelinePrices.effectiveFrom));
      const activePrice = prices.find(price => price.status === "active" && chinaBusinessDate(price.effectiveFrom) <= dateText && (!price.effectiveTo || chinaBusinessDate(price.effectiveTo) >= dateText));
      if (!activePrice) throw new TRPCError({ code: "BAD_REQUEST", message: "项目部供油前请先维护当日有效的柴油指导单价" });
      appliedUnitPrice = Number(activePrice.pricePerLiter);
    }
    const amount = Number((input.liters * appliedUnitPrice).toFixed(2));
    const recordNo = `DS${input.projectId}${Date.now().toString().slice(-8)}`;
    let recordId = 0;
    await db.transaction(async tx => {
      const duplicateWindowStart = new Date(refueledAt.getTime() - DUPLICATE_REFUEL_WINDOW_MILLISECONDS);
      const duplicateWindowEnd = new Date(refueledAt.getTime() + DUPLICATE_REFUEL_WINDOW_MILLISECONDS);
      const nearbyRecords = await tx.select({ id: dieselRefuelRecords.id, recordNo: dieselRefuelRecords.recordNo, liters: dieselRefuelRecords.liters, refueledAt: dieselRefuelRecords.refueledAt, supplyMethod: dieselRefuelRecords.supplyMethod })
        .from(dieselRefuelRecords)
        .where(and(
          eq(dieselRefuelRecords.projectId, input.projectId),
          eq(dieselRefuelRecords.assetType, input.assetType),
          input.assetType === "vehicle" ? eq(dieselRefuelRecords.vehicleId, input.assetId) : eq(dieselRefuelRecords.machineId, input.assetId),
          ne(dieselRefuelRecords.status, "void"),
          gte(dieselRefuelRecords.refueledAt, duplicateWindowStart),
          lte(dieselRefuelRecords.refueledAt, duplicateWindowEnd),
        ));
      const duplicateRefuelRecord = nearbyRecords.find(record => record.supplyMethod === input.supplyMethod && Math.abs(Number(record.liters) - input.liters) <= DUPLICATE_REFUEL_LITERS_TOLERANCE);
      if (duplicateRefuelRecord) {
        throw new TRPCError({ code: "CONFLICT", message: `检测到 ${DUPLICATE_REFUEL_WINDOW_MILLISECONDS / 60_000} 分钟内同一资源相同加油量的记录（${duplicateRefuelRecord.recordNo}），为避免重复入账，本次未保存` });
      }
      const result = await tx.insert(dieselRefuelRecords).values({ projectId: input.projectId, assetType: input.assetType, vehicleId: input.assetType === "vehicle" ? input.assetId : null, machineId: input.assetType === "machine" ? input.assetId : null, transportTripId: null, supplyMethod: input.supplyMethod, stationOrSupplierName: input.stationOrSupplierName?.trim() || null, liters: String(input.liters), actualUnitPrice: input.actualUnitPrice === null || input.actualUnitPrice === undefined ? null : String(input.actualUnitPrice), appliedUnitPrice: String(appliedUnitPrice), amount: String(amount), deductFromFreight: input.assetType === "vehicle" && input.deductFromFreight, refueledAt, meterReading: input.meterReading === null || input.meterReading === undefined ? null : String(input.meterReading), receiptNo: input.receiptNo?.trim() || null, evidenceId: input.evidenceId, remarks: input.remarks?.trim() || null, status: "approved", recordNo, createdBy: user.id, approvedBy: user.id, approvedAt: new Date() });
      recordId = Number((result[0] as { insertId?: number } | undefined)?.insertId ?? 0);
      if (!recordId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "柴油记录保存后无法确认编号" });
      if (input.assetType === "machine") {
        await tx.insert(machineCostRecords).values({ machineId: input.assetId, projectId: input.projectId, costType: "fuel", quantity: String(input.liters), unitPrice: String(appliedUnitPrice), amount: String(amount), dieselRefuelRecordId: recordId, occurredAt: refueledAt, evidenceId: input.evidenceId, status: "approved" });
      }
      await tx.insert(auditLogs).values({ userId: user.id, module: "diesel", action: "mobile_create_refuel", targetType: "diesel_refuel", targetId: String(recordId), summary: `移动柴油领用登记：${input.assetType === "vehicle" ? "车辆" : "机械"} · ${input.liters}L · ¥${amount}${input.deductFromFreight ? " · 运输扣油" : ""}` });
    });
    return { success: true, id: recordId, recordNo, amount, appliedUnitPrice };
  }),
});
