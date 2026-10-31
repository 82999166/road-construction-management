import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { runScheduledPayrollDraftGenerationForHeartbeatTask } from "./services/payrollGeneration";

/** 平台 Heartbeat 专用入口：任务只由认证 task UID 定位，绝不读取请求体的工资期间或项目参数。 */
export function registerPayrollGenerationHeartbeatRoute(app: Express) {
  app.post("/api/scheduled/monthly-payroll-draft-generation", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: "scheduled_task_auth_required" });
        return;
      }
      res.status(200).json(await runScheduledPayrollDraftGenerationForHeartbeatTask(user.taskUid));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      console.error("[monthly-payroll-draft-generation] scheduled run failed", message);
      res.status(500).json({ error: "monthly_payroll_draft_generation_failed", message, timestamp: new Date().toISOString() });
    }
  });
}
