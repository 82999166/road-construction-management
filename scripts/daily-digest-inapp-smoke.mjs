import { register } from "tsx/esm/api";

const api = register();

const { getDb } = await import("../server/db.ts");
const { dailyProjectDigestSchedules } = await import("../drizzle/schema.ts");
const { eq } = await import("drizzle-orm");
const { runDailyProjectDigest } = await import("../server/services/dailyProjectDigest.ts");
const db = await getDb();
if (!db) throw new Error("database_unavailable");
const [schedule] = await db.select({ id: dailyProjectDigestSchedules.id }).from(dailyProjectDigestSchedules).where(eq(dailyProjectDigestSchedules.enabled, true)).limit(1);
if (!schedule) throw new Error("no_enabled_daily_digest_schedule");
const result = await runDailyProjectDigest(schedule.id);
console.log(JSON.stringify({ status: result.status, businessDate: result.businessDate, projectCount: result.projectCount, deliveredCount: result.deliveredCount, failedCount: result.failedCount }));
