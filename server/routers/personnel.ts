import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { assertSuperAdmin, assertDepartmentBusinessAccess, getDepartmentModuleDataScope, getEffectiveRoleCodes, hasUserSpecificOperationPermission, requireAuthenticatedUser } from "../access";
import { personnelPeople, personnelPositions, projects, machines, transportVehicles } from "../../drizzle/schema";
import { personnelDateSchema, personnelPeriodSchema, personnelSaveInput, personnelListInput, personnelPositionInput, personnelTeamInput, personnelResourceInput, personnelDocumentInput, personnelInsuranceInput } from "../../shared/personnel";
import { directoryDetail, findPersonnel, listDirectoryPeople, personnelOptions, previewPersonnelDocument, previewInsuranceDocument, requirePersonnelDb, saveDirectoryPerson, saveDirectoryPosition, saveDirectoryTeam, uploadPersonnelDocument, savePersonnelInsurance, resolvePersonnelPayrollProfile } from "../services/personnelDirectory";
import { adoptLegacy, listLegacyCandidates, saveResourceBinding } from "../services/personnelLegacyBridge";
import { adminRouter } from "./admin";

const id = z.number().int().positive();
const personnelProcedure = protectedProcedure.use(async ({ ctx, next }) => { const user = await assertSuperAdmin(ctx); return next({ ctx: { ...ctx, user } }); });

export const personnelRouter = router({
  options: personnelProcedure.query(() => personnelOptions()),
  list: personnelProcedure.input(personnelListInput).query(({ input }) => listDirectoryPeople(input)),
  detail: personnelProcedure.input(z.object({ personId: id, period: personnelPeriodSchema.optional() })).query(({ input }) => directoryDetail(input.personId, input.period)),
  save: personnelProcedure.input(personnelSaveInput).mutation(({ ctx, input }) => saveDirectoryPerson(input, ctx.user.id)),
  savePosition: personnelProcedure.input(personnelPositionInput).mutation(({ input }) => saveDirectoryPosition(input)),
  saveTeam: personnelProcedure.input(personnelTeamInput).mutation(({ input }) => saveDirectoryTeam(input)),
  listLegacyCandidates: personnelProcedure.input(z.object({ search: z.string().trim().max(100).optional() }).optional()).query(async ({ input }) => listLegacyCandidates(await requirePersonnelDb(), { hasAllProjects: true, search: input?.search })),
  adoptLegacy: personnelProcedure.input(z.object({ sourceType: z.enum(["user", "profile", "worker"]), sourceId: id })).mutation(async ({ ctx, input }) => {
    const db = await requirePersonnelDb(); return db.transaction(tx => adoptLegacy(tx, { ...input, actorUserId: ctx.user.id }));
  }),
  saveResourceBinding: personnelProcedure.input(personnelResourceInput).mutation(async ({ ctx, input }) => {
    const db = await requirePersonnelDb(); const table = input.assetType === "vehicle" ? transportVehicles : machines;
    const [asset] = await db.select({ projectId: table.projectId }).from(table).where(eq(table.id, input.assetId)).limit(1);
    if (!asset?.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "资源须归属于真实项目后才能关联人员" });
    const person = await findPersonnel(db, input.personId);
    if (person.projectId !== asset.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "人员须归属资源同一项目，不能关联跨项目或全局未分配人员" });
    return db.transaction(tx => saveResourceBinding(tx, { ...input, actorUserId: ctx.user.id, projectId: asset.projectId! }));
  }),
  uploadDocument: personnelProcedure.input(personnelDocumentInput).mutation(({ ctx, input }) => uploadPersonnelDocument(input, ctx.user.id)),
  previewDocument: personnelProcedure.input(z.object({ personId: id, documentId: id })).query(({ ctx, input }) => previewPersonnelDocument(input.personId, input.documentId, ctx.user.id)),
  previewInsuranceDocument: personnelProcedure.input(z.object({ personId: id, policyId: id })).query(({ ctx, input }) => previewInsuranceDocument(input.personId, input.policyId, ctx.user.id)),
  saveInsurance: personnelProcedure.input(personnelInsuranceInput).mutation(({ ctx, input }) => savePersonnelInsurance(input, ctx.user.id)),
  saveAdvance: personnelProcedure.input(z.object({ personId: id, employeeProfileId: id.optional(), advanceDate: personnelDateSchema, amount: z.number().finite().positive().max(999999999999), remarks: z.string().trim().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const employeeProfileId = await resolvePersonnelPayrollProfile({ personId: input.personId, period: input.advanceDate.slice(0, 7), advanceDate: input.advanceDate, employeeProfileId: input.employeeProfileId });
    // 原预支接口还会在事务内按具体日期校验真实任职和公司发薪资格。
    return adminRouter.createCaller(ctx).employee.saveAdvance({ employeeProfileId, advanceDate: input.advanceDate, amount: input.amount, remarks: input.remarks, status: "draft" });
  }),
  generatePayrollDraft: personnelProcedure.input(z.object({ personId: id, period: personnelPeriodSchema, employeeProfileId: id.optional(), projectId: id.optional() })).mutation(async ({ ctx, input }) => {
    const employeeProfileId = await resolvePersonnelPayrollProfile(input);
    return adminRouter.createCaller(ctx).employee.generatePayrollDraft({ employeeProfileId, period: input.period });
  }),
  /** 唯一非人事入口：沿用原模块read+岗位+模块项目范围，只投影资源选人的最小身份。 */
  selectOptions: protectedProcedure.input(z.object({ projectId: id, role: z.enum(["driver", "operator"]) })).query(async ({ ctx, input }) => {
    const user = requireAuthenticatedUser(ctx); const module = input.role === "driver" ? "TRANSPORT" : "MACHINERY";
    if (user.loginMethod === "local_driver") throw new TRPCError({ code: "FORBIDDEN", message: "司机个人门户不能查询项目人员选项" });
    await assertDepartmentBusinessAccess(ctx, module, "read");
    const roles = await getEffectiveRoleCodes(ctx); const allowed = input.role === "driver" ? ["TRANSPORT_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"] : ["MACHINERY_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"];
    if (!roles.includes("ALL") && !roles.some(role => allowed.includes(role)) && !await hasUserSpecificOperationPermission(ctx, module, "read")) throw new TRPCError({ code: "FORBIDDEN", message: "当前岗位无权选择项目资源人员" });
    const db = await requirePersonnelDb(); const scope = await getDepartmentModuleDataScope(ctx, module);
    const [project] = await db.select({ id: projects.id, organizationId: projects.organizationId }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
    if (!scope.hasAllProjects && !scope.projectIds.includes(project.id) && !(project.organizationId && scope.organizationIds.includes(project.organizationId))) throw new TRPCError({ code: "FORBIDDEN", message: "当前模块未授权该项目" });
    const [people, positions] = await Promise.all([db.select({ id: personnelPeople.id, personNo: personnelPeople.personNo, name: personnelPeople.name, primaryPositionId: personnelPeople.primaryPositionId, secondaryPositionIds: personnelPeople.secondaryPositionIds, affiliation: personnelPeople.affiliation, projectId: personnelPeople.projectId, userId: personnelPeople.userId }).from(personnelPeople).where(and(eq(personnelPeople.projectId, input.projectId), eq(personnelPeople.employmentStatus, "active"))), db.select({ id: personnelPositions.id, name: personnelPositions.name, category: personnelPositions.category, status: personnelPositions.status }).from(personnelPositions)]);
    const categories = input.role === "driver" ? ["driver"] : ["operator", "driver"];
    return people.filter(p => [p.primaryPositionId, ...p.secondaryPositionIds].some(id => positions.some(position => position.id === id && position.status === "active" && categories.includes(position.category)))).map(p => ({ id: p.id, personNo: p.personNo, name: p.name, positionName: positions.find(x => x.id === p.primaryPositionId)?.name ?? null, affiliation: p.affiliation, projectId: p.projectId, userId: p.userId }));
  }),
});
