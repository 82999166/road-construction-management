import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输地点管理权限", () => {
  it("允许运输负责人或被显式授予创建/编辑权限的项目管理员，并由服务端二次校验", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("async function canManageTransportSites");
    expect(source).toContain('getRoleOperationPermissionDecision(ctx, "TRANSPORT", "create")');
    expect(source).toContain('getRoleOperationPermissionDecision(ctx, "TRANSPORT", "edit")');
    expect(source).toContain("siteManagementAccess:");
    expect(source).toContain("当前账号未被授予运输地点新增或编辑权限");
  });
});
