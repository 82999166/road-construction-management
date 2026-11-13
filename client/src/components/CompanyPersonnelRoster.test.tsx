import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./CompanyPersonnelRoster.tsx", import.meta.url),
  "utf8"
);

describe("CompanyPersonnelRoster", () => {
  it("将公司账号、员工档案与实名制人员按类别和状态提供组合筛选", () => {
    expect(source).toContain("公司全员花名册");
    expect(source).toContain("公司账号、员工档案和实名制人员");
    expect(source).toContain("全部人员类型");
    expect(source).toContain("公司管理员");
    expect(source).toContain("机械司机");
    expect(source).toContain("渣土车司机");
    expect(source).toContain("劳务队工人");
    expect(source).toContain("临时工");
    expect(source).toContain("rosterCategory");
    expect(source).toContain("roleSources");
    expect(source).toContain("兼任");
    expect(source).toContain("全部在职状态");
    expect(source).toContain("全部归属项目");
  });

  it("不回显完整手机号、证件号、银行卡和登录账号", () => {
    expect(source).toContain("已登记手机号会完整显示");
    expect(source).not.toContain("phoneEncrypted");
    expect(source).not.toContain("bankAccountEncrypted");
    expect(source).not.toContain("localUsername");
  });

  it("支持从人员详情维护档案并展示完整银行卡信息", () => {
    expect(source).toContain("修改员工资料");
    expect(source).toContain("保存员工档案");
    expect(source).toContain("bankAccountMasked");
    expect(source).toContain("银行卡");
    expect(source).toContain("手机号（新增或修改）");
    expect(source).not.toContain("decryptSecret");
  });

  it("展示入职、确认打卡、截至日应计工资，并提供受控工资草稿和月度自动生成入口", () => {
    expect(source).toContain("截至当日工资费用");
    expect(source).toContain("已确认打卡 / 考勤");
    expect(source).toContain("生成工资草稿");
    expect(source).toContain("启用每月自动生成");
    expect(source).toContain("不自动扣减");
  });
});
