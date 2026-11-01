import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("司机与机械老板专属门户数据范围", () => {
  it("手机号司机账单仅从当前账号绑定车辆读取，不接受客户端传入的车辆编号", () => {
    const service = readFileSync(new URL("./services/officialAccountDriverBinding.ts", import.meta.url), "utf8");
    const router = readFileSync(new URL("./routers/officialAccount.ts", import.meta.url), "utf8");
    expect(service).toContain("getLocalDriverPortalSummary(userId: number)");
    expect(service).toContain("eq(transportVehicles.driverUserId, userId)");
    expect(service).toContain("eq(transportTrips.vehicleId, vehicle.id)");
    expect(service).toContain("eq(dieselRefuelRecords.vehicleId, vehicle.id)");
    expect(router).toContain("localDriverPortalSummary: protectedProcedure");
    expect(router).toContain('user.loginMethod !== "local_driver"');
  });

  it("机械老板门户仅读取机械档案 ownerUserId 显式绑定的设备与费用", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("ownerExpensePortal: protectedProcedure");
    expect(source).toContain("eq(machines.ownerUserId, user.id)");
    expect(source).toContain("ownerUserId: z.number().int().positive().nullable().optional()");
    expect(source).toContain("司机手机号账号只能查看本人操作机械");
    expect(source).toContain("请选择启用中的机械老板账号");
  });

  it("本地司机账号被运输管理服务端拒绝，不能仅依赖前端隐藏入口", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const mobileSource = readFileSync(new URL("./routers/mobile.ts", import.meta.url), "utf8");
    expect(source).toContain('user.loginMethod === "local_driver"');
    expect(source).toContain("不提供运输管理功能");
    expect(mobileSource).toContain("司机手机号账号仅允许进入绑定车辆账单");
    expect(mobileSource).toContain('menu.code !== "WORKBENCH"');
  });
});
