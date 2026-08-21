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
});
