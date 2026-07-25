import { describe, expect, it } from "vitest";
import { maskSensitiveValue } from "./access";

describe("敏感字段脱敏规则", () => {
  it("仅保留身份证和银行卡的末尾字符，且短值不回传明文", () => {
    expect(maskSensitiveValue("110101199001011234")).toBe("**************1234");
    expect(maskSensitiveValue("6222021234567890")).toBe("************7890");
    expect(maskSensitiveValue("1234")).toBe("****");
  });

  it("对空值保持空值，避免以虚假掩码误导业务人员", () => {
    expect(maskSensitiveValue(null)).toBeNull();
    expect(maskSensitiveValue(undefined)).toBeNull();
    expect(maskSensitiveValue("")).toBeNull();
  });
});
