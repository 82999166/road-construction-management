import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPersonnelSave,
  chinaToday,
  friendlyPersonnelError,
  newPersonnelDraft,
  personnelCsv,
  salaryChanged,
  sensitiveClearLabels,
} from "./UnifiedPersonnelDirectory.helpers";
import { personnelSaveInput } from "@shared/personnel";
const source = readFileSync(
  new URL("./UnifiedPersonnelDirectory.tsx", import.meta.url),
  "utf8"
);
describe("统一人员目录安全回归", () => {
  it("无账号、任意归属可建档，外部默认不公司发薪，临时工日薪", () => {
    for (const affiliation of [
      "company",
      "temporary",
      "labor_team",
      "external",
    ] as const) {
      const draft = { ...newPersonnelDraft(affiliation), name: "本地测试人员" };
      const input = buildPersonnelSave(draft);
      expect(input.userId).toBeNull();
      expect(input.phoneNumber).toBeUndefined();
      expect(personnelSaveInput.safeParse(input).success).toBe(true);
    }
    expect(newPersonnelDraft("external").payrollEnabled).toBe(false);
    expect(newPersonnelDraft("temporary").salaryBasis).toBe("daily");
  });
  it("未改可选字段不提交，离职日期、备注及银行卡不被空白覆盖", () => {
    const original = {
      ...newPersonnelDraft(),
      name: "原姓名",
      exitDate: "2026-08-01",
      bankName: "原开户行",
      remarks: "原备注",
      baseSalary: "5000",
    };
    const input = buildPersonnelSave(
      { ...original, name: "新姓名" },
      original,
      { id: 1, version: 7 }
    );
    expect(input).toEqual({
      id: 1,
      version: 7,
      name: "新姓名",
      affiliation: "company",
      employmentStatus: "active",
      primaryPositionId: null,
      payrollEnabled: true,
    });
    expect(input.phoneNumber).toBeUndefined();
    expect(input.identityNo).toBeUndefined();
    expect(input.bankAccount).toBeUndefined();
    expect(input.baseSalary).toBeUndefined();
    expect(input.exitDate).toBeUndefined();
    expect(input.remarks).toBeUndefined();
  });
  it("已回填完整号码未变或仅两端空白不提交，避免无关更新触发号码写入", () => {
    const original = {
      ...newPersonnelDraft("external"),
      name: "合成测试人员",
      phoneNumber: "19900000001",
      identityNo: "TEST-IDENTITY-001",
      bankAccount: "TEST-BANK-001",
    };
    for (const draft of [
      { ...original, name: "更正姓名" },
      {
        ...original,
        phoneNumber: ` ${original.phoneNumber} `,
        identityNo: ` ${original.identityNo} `,
        bankAccount: ` ${original.bankAccount} `,
      },
      { ...original, phoneNumber: " ", identityNo: "", bankAccount: "\t" },
    ]) {
      const input = buildPersonnelSave(draft, original, { id: 1, version: 7 });
      for (const key of ["phoneNumber", "identityNo", "bankAccount"] as const) {
        expect(input).not.toHaveProperty(key);
      }
      expect(input).not.toHaveProperty("clearPhoneNumber");
      expect(input).not.toHaveProperty("clearIdentityNo");
      expect(input).not.toHaveProperty("clearBankAccount");
      expect(personnelSaveInput.safeParse(input).success).toBe(true);
    }
  });
  it.each([
    ["phoneNumber", "clearPhoneNumber", "19900000002"],
    ["identityNo", "clearIdentityNo", "TEST-IDENTITY-002"],
    ["bankAccount", "clearBankAccount", "TEST-BANK-002"],
  ] as const)(
    "仅变更%s提交该字段；清空标记优先且不误清其它字段",
    (key, clear, replacement) => {
      const original = {
        ...newPersonnelDraft("external"),
        name: "合成测试人员",
        phoneNumber: "19900000001",
        identityNo: "TEST-IDENTITY-001",
        bankAccount: "TEST-BANK-001",
      };
      const draft = { ...original, [key]: ` ${replacement} ` };
      const input = buildPersonnelSave(draft, original, { id: 1, version: 7 });
      expect(input[key]).toBe(replacement);
      for (const other of ["phoneNumber", "identityNo", "bankAccount"] as const)
        if (other !== key) expect(input).not.toHaveProperty(other);
      const clearing = buildPersonnelSave(
        { ...draft, [clear]: true },
        original,
        { id: 1, version: 7 }
      );
      expect(clearing[clear]).toBe(true);
      expect(clearing).not.toHaveProperty(key);
      for (const other of [
        "clearPhoneNumber",
        "clearIdentityNo",
        "clearBankAccount",
      ] as const)
        if (other !== clear) expect(clearing).not.toHaveProperty(other);
      expect(personnelSaveInput.safeParse(clearing).success).toBe(true);
    }
  );
  it("明确修改为空才清空普通字段，敏感清空须独立标记", () => {
    const original = {
      ...newPersonnelDraft(),
      name: "人员",
      exitDate: "2026-08-01",
    };
    const draft = {
      ...original,
      exitDate: "",
      clearPhoneNumber: true,
      clearIdentityNo: true,
      clearBankAccount: true,
    };
    const input = buildPersonnelSave(draft, original, { id: 1, version: 2 });
    expect(input.exitDate).toBeNull();
    expect(input.clearPhoneNumber).toBe(true);
    expect(input.phoneNumber).toBeUndefined();
    expect(sensitiveClearLabels(draft)).toBe("手机号、证件号、银行卡");
    expect(source).toContain("window.confirm");
  });
  it("修改薪资提交生效日期且保留金额字符串精度", () => {
    const original = {
      ...newPersonnelDraft(),
      name: "人员",
      baseSalary: "5000",
    };
    const draft = {
      ...original,
      baseSalary: "6000.35",
      salaryEffectiveFrom: "2026-12-01",
    };
    const input = buildPersonnelSave(draft, original, { id: 1, version: 2 });
    expect(salaryChanged(draft, original)).toBe(true);
    expect(input.baseSalary).toBe("6000.35");
    expect(input.salaryEffectiveFrom).toBe("2026-12-01");
  });
  it("从兼任岗位移除主要岗位，未修改关联ID不清空", () => {
    const original = {
      ...newPersonnelDraft(),
      name: "人员",
      primaryPositionId: "10",
      projectId: "2",
      userId: "9",
      secondaryPositionIds: [11],
    };
    const input = buildPersonnelSave(
      { ...original, secondaryPositionIds: [10, 11, 12] },
      original,
      { id: 3, version: 4 }
    );
    expect(input.secondaryPositionIds).toEqual([11, 12]);
    expect(input.userId).toBeUndefined();
    expect(input.projectId).toBeUndefined();
  });
  it("版本冲突提示保留用户输入且不绕过version", () => {
    expect(
      friendlyPersonnelError({ message: "stale", data: { code: "CONFLICT" } })
    ).toContain("您的输入仍保留");
    expect(source).toContain("version: editVersion");
    expect(source).not.toContain("as any");
  });
  it("CSV支持中文BOM、引号换行且阻止公式注入", () => {
    const csv = personnelCsv(
      ["姓名"],
      [["=HYPERLINK(1)"], ["  +SUM(1)"], ['中文"姓名'], ["安全\n换行"]]
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'  +SUM");
    expect(csv).toContain('中文""姓名');
  });
  it("中国业务日期跨UTC午夜正确", () => {
    expect(chinaToday(new Date("2026-11-03T16:10:00Z"))).toBe("2026-11-04");
  });
  it("八Tab、受控预览、实际付款与核定分离，不静默adopt", () => {
    for (const label of [
      "基础资料",
      "岗位归属",
      "薪资",
      "考勤",
      "工资结算",
      "车辆机械",
      "证照保险",
      "收款变更",
    ])
      expect(source).toContain(label);
    expect(source).toContain("trpc.personnel.previewDocument.useQuery");
    expect(source).toContain("ProtectedImagePreview");
    expect(source).toContain("核定实发（非实付）");
    expect(source).toContain("实际付款流水");
    expect(source).toContain("核对后引入");
    expect(source).toContain("openLegacySource");
    expect(source).not.toContain("localUsername");
  });
  it("帮助文案说明完整显示与安全保留，不新增浏览器持久化", () => {
    expect(source).toContain("手机号、证件号、银行卡完整显示并可修改");
    expect(source).toContain("未修改或留空均保留已登记值");
    expect(source).toContain("取消勾选恢复勾选前的输入");
    expect(source).not.toContain("敏感字段不回显");
    expect(source).not.toContain("不回显原值");
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie/
    );
  });
});

describe("人员计薪与实际API约束", () => {
  it("切换发薪资格或用工归属也提交工资生效版本", () => {
    const original = {
      ...newPersonnelDraft(),
      name: "人员",
      baseSalary: "5000",
    };
    const disabled = buildPersonnelSave(
      { ...original, payrollEnabled: false, salaryEffectiveFrom: "2026-11-04" },
      original,
      { id: 1, version: 2 }
    );
    expect(disabled.salaryEffectiveFrom).toBe("2026-11-04");
    expect(disabled.baseSalary).toBe("5000");
    const moved = buildPersonnelSave(
      { ...original, affiliation: "labor_team" },
      original,
      { id: 1, version: 2 }
    );
    expect(moved.salaryEffectiveFrom).toBeTruthy();
  });
  it("保留真实保险筛选、历史重复档案导出及原月度自动入口", () => {
    expect(source).toContain("30天内到期");
    expect(source).toContain("historicalDuplicateProfileCount");
    expect(source).toContain("getPayrollGenerationSchedule.useQuery");
    expect(source).toContain("savePayrollGenerationSchedule.useMutation");
    expect(source).toContain("启用每月自动生成");
    expect(source).toContain("linkedPersonId");
    expect(source).toContain("今日即时生效");
    expect(source).not.toContain("effectiveTo: draft.effectiveTo");
  });
});

describe("统一人员详情完整维护入口", () => {
  it("头像与旧保单使用短时授权，不拼接存储链接", () => {
    expect(source).toContain("person.avatarDocumentId");
    expect(source).toContain('setDocumentIntent("portrait")');
    expect(source).toContain(
      "trpc.personnel.previewInsuranceDocument.useQuery"
    );
    expect(source).toContain("查看保单附件");
    expect(source).not.toContain("storageGet");
  });
  it("详情可登记修改保险，考勤付款跳至原业务工作区而不绕审批", () => {
    expect(source).toContain("PersonnelInsuranceEditor");
    expect(source).toContain("登记人员保险");
    expect(source).toContain("修改保险信息");
    expect(source).toContain("/admin/labor?tab=operations");
    const insuranceSource = readFileSync(
      new URL("./PersonnelInsuranceEditor.tsx", import.meta.url),
      "utf8"
    );
    expect(insuranceSource).toContain(
      "trpc.personnel.saveInsurance.useMutation"
    );
    expect(insuranceSource).toMatch(/personId,\s*version/);
    expect(insuranceSource).toMatch(/policyReference\.trim\(\)\s*\?/);
    expect(insuranceSource).not.toContain("evidenceId: null");
  });
});
