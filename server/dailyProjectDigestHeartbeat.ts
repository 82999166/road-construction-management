import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { runDailyProjectDigestForHeartbeatTask } from "./services/dailyProjectDigest";

/** 平台 Heartbeat 专用入口：不信任请求体，只从已认证任务 UID 获取调度配置。 */
export function registerDailyProjectDigestHeartbeatRoute(app: Express) {
  app.post("/api/scheduled/daily-project-digest", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: "scheduled_task_auth_required" });
        return;
      }
      const result = await runDailyProjectDigestForHeartbeatTask(user.taskUid);
      res.status(200).json(result);
    } catch (error) {
      console.error("[daily-project-digest] scheduled run failed", error instanceof Error ? error.message : "unknown_error");
      res.status(500).json({ error: "daily_project_digest_failed" });
    }
  });
}
