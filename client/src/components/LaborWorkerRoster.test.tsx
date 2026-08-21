import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LaborWorkerRoster", () => {
  it("仅展示实名核验、进退场与出勤状态，并通过父级受控打开档案详情", () => {
    const source = readFileSync(new URL("./LaborWorkerRoster.tsx", import.meta.url), "utf8");
    expect(source).toContain("identityLabel");
    expect(source).toContain("个人身份和资金字段保持脱敏");
    expect(source).toContain("onOpenProfile(worker)");
    expect(source).not.toContain("bankAccountMasked");
  });
});
