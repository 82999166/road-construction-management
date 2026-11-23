import { protectedProcedure, router } from "../_core/trpc";
import { assertSuperAdmin } from "../access";
import { siteProjectInput, siteDashboardInput, siteTransportDetailsInput, siteSaveConfigurationInput, siteWeatherCredentialInput, siteUploadVideoInput } from "../../shared/siteOperations";
import { getSiteProjects, getSiteDashboard, getSiteTransportDetails } from "../services/siteOperationsDashboard";
import { getSiteConfiguration, saveSiteConfiguration, getSiteWeatherCredential, saveSiteWeatherCredential } from "../services/siteOperationsConfiguration";
import { getSiteWeather } from "../services/siteOperationsWeather";
import { uploadSiteVideo } from "../services/siteOperationsVideo";
const superAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const actor = await assertSuperAdmin(ctx);
  return next({ ctx: { ...ctx, actor } });
});
/** GET procedures only read facts/config; never run scans, persist alerts, or mutate business history. */
export const siteOperationsRouter = router({
  projects: superAdminProcedure.query(() => getSiteProjects()),
  dashboard: superAdminProcedure.input(siteDashboardInput).query(({ input }) => getSiteDashboard(input.projectId, input.businessDate)),
  transportDetails: superAdminProcedure.input(siteTransportDetailsInput).query(({ input }) => getSiteTransportDetails(input.projectId, input.businessDate, input.metric)),
  getConfiguration: superAdminProcedure.input(siteProjectInput).query(({ input }) => getSiteConfiguration(input.projectId)),
  saveConfiguration: superAdminProcedure.input(siteSaveConfigurationInput).mutation(({ ctx, input }) => saveSiteConfiguration(ctx.actor.id, input)),
  getWeather: superAdminProcedure.input(siteProjectInput).query(({ input }) => getSiteWeather(input.projectId)),
  getWeatherCredential: superAdminProcedure.query(() => getSiteWeatherCredential()),
  saveWeatherCredential: superAdminProcedure.input(siteWeatherCredentialInput).mutation(({ ctx, input }) => saveSiteWeatherCredential(ctx.actor.id, input)),
  uploadVideo: superAdminProcedure.input(siteUploadVideoInput).mutation(({ ctx, input }) => uploadSiteVideo(ctx.actor.id, input)),
});
