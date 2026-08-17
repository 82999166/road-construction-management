import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { runOverdueRiskEscalationForHeartbeatTask } from "./routers/projectRisk";

/** 项目风险整改逾期 Heartbeat：只使用平台认证 task UID 查询规则，任何请求体字段均不参与项目定位。 */
export function registerProjectRiskHeartbeatRoute(app: Express) {
  app.post("/api/scheduled/project-risk-overdue-escalation", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: "scheduled_task_auth_required" });
        return;
      }
      res.status(200).json(await runOverdueRiskEscalationForHeartbeatTask(user.taskUid));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      console.error("[project-risk-overdue] scheduled run failed", message);
      res.status(500).json({ error: "project_risk_overdue_escalation_failed", message, timestamp: new Date().toISOString() });
    }
  });
}
