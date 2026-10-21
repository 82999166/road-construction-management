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
    expect(source).toContain("公司管理人员");
    expect(source).toContain("机械操作员");
    expect(source).toContain("施工队工人");
    expect(source).toContain("临时日结人员");
    expect(source).toContain("全部在职状态");
    expect(source).toContain("全部归属项目");
  });

  it("不回显完整手机号、证件号、银行卡和登录账号", () => {
    expect(source).toContain("详情只显示脱敏号码");
    expect(source).not.toContain("phoneEncrypted");
    expect(source).not.toContain("bankAccountEncrypted");
    expect(source).not.toContain("localUsername");
  });

  it("支持从人员详情维护档案并仅展示银行卡脱敏信息", () => {
    expect(source).toContain("修改员工资料");
    expect(source).toContain("保存员工档案");
    expect(source).toContain("bankAccountMasked");
    expect(source).toContain("银行卡（脱敏）");
    expect(source).toContain("手机号（新增或修改）");
    expect(source).not.toContain("decryptSecret");
  });
});
