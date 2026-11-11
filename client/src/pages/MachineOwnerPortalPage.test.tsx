import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("机械老板费用门户", () => {
  it("只调用服务端受控的名下机械费用接口，并不暴露录入或审核动作", () => {
    const source = readFileSync(
      new URL("./MachineOwnerPortalPage.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("machinery.ownerExpensePortal");
    expect(source).toContain("名下机械费用清单");
    expect(source).toContain("仅展示后台明确绑定到本账号的机械");
    expect(source).toContain("不可录入、审核、结算或查看其他项目设备");
    expect(source).not.toContain("saveMachine");
    expect(source).not.toContain("transitionCost");
  });

  it("提供每台机械费用汇总和受控明细阅读", () => {
    const source = readFileSync(
      new URL("./MachineOwnerPortalPage.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("最近100条内费用小计");
    expect(source).toContain("油料费用");
    expect(source).toContain("维修 / 加班");
    expect(source).toContain("机械费用明细");
    expect(source).toContain("月结账单");
    expect(source).toContain("付款账单");
    expect(source).toContain("待付款");
  });
});

describe("机械档案老板账号入口", () => {
  it("在机械档案中提供创建并绑定老板账号的明确入口", () => {
    const source = readFileSync(
      new URL("../pages/AdminPage.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("新增机械老板账号");
    expect(source).toContain("请在机械档案中选择并绑定该账号");
    expect(source).toContain("ownerUserId: machineForm.ownerUserId");
  });
});
