import { describe, it, expect } from "vitest";
import { protectPersonnelHistory, revealPersonnelHistory } from "./personnelHistorySecurity";

describe("人员变更历史：完整授权显示与加密保存独立", () => {
  it("手机号证件银行卡紧急电话前后值不以原值落入新日志，授权回读完整", () => {
    const changes = {
      phoneMasked: { before: "13800001111", after: "13900002222" },
      identityMasked: { before: null, after: "430101199001011234" },
      bankMasked: { before: "6222000011112222333", after: null },
      emergencyContactPhoneMasked: { before: "13600003333", after: "13700004444" },
      name: { before: "合成人员", after: "合成施工人员" },
      salarySetting: { before: null, after: { salaryPayerType: "owner" } },
    };
    const stored = protectPersonnelHistory(changes);
    expect(JSON.stringify(stored)).not.toContain("13800001111");
    expect(JSON.stringify(stored)).not.toContain("430101199001011234");
    expect(JSON.stringify(stored)).not.toContain("6222000011112222333");
    expect(stored.phoneMasked.after).toMatch(/^v1\./);
    expect(stored.identityMasked.before).toBeNull();
    expect(stored.bankMasked.after).toBeNull();
    expect(revealPersonnelHistory(stored)).toEqual(changes);
    expect(changes.phoneMasked.before).toBe("13800001111");
  });
  it("不推测旧掩码隐藏数字，完整旧历史和空值如实展示，坏密文不外泄", () => {
    const old = { phoneMasked: { before: "138***1111", after: "13900002222" }, name: { before: null, after: "原名" } };
    expect(revealPersonnelHistory(old)).toEqual(old);
    expect(revealPersonnelHistory(null)).toEqual({});
    expect(revealPersonnelHistory({ bankMasked: { before: "v1.invalid", after: null } }).bankMasked.before).toBeNull();
  });
});
