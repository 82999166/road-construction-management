import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./routers/diesel.ts", import.meta.url), "utf8");

describe("移动柴油领用服务端边界", () => {
  it("将柴油登记、项目范围、现场凭证、资产归属和扣油结算权限全部放在服务端校验", () => {
    expect(source).toContain("mobileCreateRefuel");
    expect(source).toContain('getRoleOperationPermissionDecision(ctx, "DIESEL", "create")');
    expect(source).toContain("assertProjectInCurrentScope(ctx, input.projectId)");
    expect(source).toContain('evidence[0].sourceType !== "diesel_receipt"');
    expect(source).toContain("所选车辆或机械必须归属当前项目");
    expect(source).toContain("运输扣油需额外授予柴油扣油结算权限");
  });

  it("只允许移动端新增已记账领用，保留后台对编辑、作废、指导价和预警的职责分离", () => {
    expect(source).toContain('status: "approved"');
    expect(source).toContain("现场端只允许新增已记账领用");
  });

  it("在事务内拦截五分钟内同项目、同资源、同供油方式和相同加油量的重复记录", () => {
    expect(source).toContain("DUPLICATE_REFUEL_WINDOW_MILLISECONDS");
    expect(source).toContain("DUPLICATE_REFUEL_LITERS_TOLERANCE");
    expect(source).toContain("duplicateRefuelRecord");
    expect(source).toContain('code: "CONFLICT"');
    expect(source).toContain("为避免重复入账，本次未保存");
  });
});
