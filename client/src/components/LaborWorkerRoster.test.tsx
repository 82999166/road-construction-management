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

  it("可选地提供父级控制的新建施工队工人入口，不在台账组件内采集敏感资料", () => {
    const source = readFileSync(new URL("./LaborWorkerRoster.tsx", import.meta.url), "utf8");
    expect(source).toContain("onCreateWorker?: () => void");
    expect(source).toContain("onCreateWorker ? <Button");
    expect(source).toContain("onClick={onCreateWorker}");
    expect(source).toContain("新建施工队工人");
    expect(source).not.toContain("identityNo");
    expect(source).not.toContain("bankAccount");
  });
});
