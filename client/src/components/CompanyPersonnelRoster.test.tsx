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

  it("明确不展示手机号、证件号、银行卡和登录账号", () => {
    expect(source).toContain("不显示手机号、证件号、银行卡或登录账号");
    expect(source).not.toContain("phoneEncrypted");
    expect(source).not.toContain("bankAccountEncrypted");
    expect(source).not.toContain("localUsername");
  });
});
