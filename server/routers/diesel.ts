import { TRPCError } from "@trpc/server";
import { desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { dieselRefuelRecords, projects } from "../../drizzle/schema";
import { getCurrentDataScope, getRoleOperationPermissionDecision, requireAuthenticatedUser } from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

/**
 * 移动柴油工作区只提供已授权项目的真实台账摘要与最近记录。
 * 领用登记、指导价、预警、结算和作废仍分别由既有细分权限与后台受控流程处理，避免移动端菜单扩大操作边界。
 */
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
    return {
      projects: authorizedProjects.map(project => ({ id: project.id, name: project.name })),
      selectedProjectId,
      summary,
      records: rows.slice(0, 30).map(row => ({
        id: row.id,
        recordNo: row.recordNo,
        assetType: row.assetType,
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
});
