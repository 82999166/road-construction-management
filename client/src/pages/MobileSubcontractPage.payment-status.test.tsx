import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "client/src/pages/MobileSubcontractPage.tsx"), "utf8");

describe("MobileSubcontractPage payment visibility", () => {
  it("shows settlement status but masks settlement and payment authority on mobile", () => {
    expect(page).toContain("分包应付付款状态（手机只读）");
    expect(page).toContain("手机端只查看状态，不提供审核、付款或导出操作");
    expect(page).toContain("canSettle: false");
    expect(page).toContain("canPay: false");
  });

  it("projects unknown package, team and payment statuses to Chinese-safe labels", () => {
    expect(page).toContain(')[status] ?? "待处理"');
    expect(page).toContain("paymentSettlementStatus(item.status)");
    expect(page).toContain("teamStatus(team.status)");
    expect(page).not.toContain(")[item.status] || item.status");
  });

  it("does not expose raw server errors when saving or changing subcontract records", () => {
    expect(page).toContain("施工队台账保存失败，请检查填写内容后重试");
    expect(page).toContain("分包批次草稿保存失败，请检查填写内容后重试");
    expect(page).toContain("分包批次状态更新失败，请刷新后重试");
    expect(page).not.toContain("toast.error(error.message)");
  });
});
