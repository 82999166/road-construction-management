import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端首次 NFC 发卡授权", () => {
  const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

  it("允许超级管理员或具备运输新增/维护权限的账号签发，避免只读守卫误拦截", () => {
    expect(source).toContain("async function assertCanIssueMobileNfcCards");
    expect(source).toContain('getRoleOperationPermissionDecision(ctx, "TRANSPORT", "create")');
    expect(source).toContain('getRoleOperationPermissionDecision(ctx, "TRANSPORT", "edit")');
    expect(source).toContain('await assertCanIssueMobileNfcCards(ctx, roleCodes)');
  });

  it("明确拒绝只有运输查看权限的账号签发车辆卡", () => {
    expect(source).toContain("当前账号仅有运输查看权限，未获车辆卡签发或维护授权");
  });
});
