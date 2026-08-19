import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSupervisorReviewAutoApprove } from "./services/supervisorReview";

function createSettingsDb(valueJson?: string) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => valueJson === undefined ? [] : [{ valueJson }],
        }),
      }),
    }),
  };
}

describe("统一上级主管审核开关", () => {
  it("缺省保持人工审核，只有已发布 true 值才开启自动通过", async () => {
    await expect(isSupervisorReviewAutoApprove(createSettingsDb() as never)).resolves.toBe(false);
    await expect(isSupervisorReviewAutoApprove(createSettingsDb("false") as never)).resolves.toBe(false);
    await expect(isSupervisorReviewAutoApprove(createSettingsDb("true") as never)).resolves.toBe(true);
  });

  it("施工日报和采购提交节点均通过统一守卫处理上级主管审核", () => {
    const construction = readFileSync(new URL("./routers/construction.ts", import.meta.url), "utf8");
    const finance = readFileSync(new URL("./routers/finance.ts", import.meta.url), "utf8");
    expect(construction).toContain("isSupervisorReviewAutoApprove(db)");
    expect(construction).toContain("auto_approve_daily_report_by_supervisor_setting");
    expect(finance).toContain("auto_approve_purchase_request_by_supervisor_setting");
    expect(finance).toContain("auto_approve_small_direct_order_by_supervisor_setting");
  });
});
