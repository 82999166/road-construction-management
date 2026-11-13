import React, { type HTMLAttributes, type ReactNode } from "react";
import { createRequire } from "node:module";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personnelSaveInput } from "@shared/personnel";

const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");

// Synthetic values only. No server, browser session, or real personnel records.
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  confirm: vi.fn(() => true),
  invalidate: vi.fn(async () => undefined),
  optionRefetch: vi.fn(async () => undefined),
  activeTab: "basic",
  optionsLoading: false,
  optionsMissing: false,
  optionsError: null as { message: string } | null,
  positions: [
    { id: 21, name: "合成岗位", status: "active", category: "driver" },
    { id: 22, name: "合成机械驾驶员", status: "active", category: "operator" },
    {
      id: 23,
      name: "合成公司管理员",
      status: "active",
      category: "management",
    },
  ],
  salaryHistory: [] as {
    effectiveFrom: string;
    affiliation: "company" | "external";
    salaryPayerType?: "company" | "owner";
    salaryPayerName?: string | null;
    payrollEnabled: boolean;
    salaryBasis: "monthly";
    baseSalary: string | null;
  }[],
  print: vi.fn(),
  onError: undefined as
    | ((error: { message: string; data?: { code?: string } }) => void)
    | undefined,
  person: {
    id: 12,
    personNo: "P-SYNTHETIC-12",
    name: "合成测试人员",
    affiliation: "external" as "external" | "company",
    employmentStatus: "active",
    primaryPositionId: null as number | null,
    secondaryPositionIds: [] as number[],
    projectId: null,
    teamId: null,
    userId: null,
    entryDate: "2026-11-13",
    exitDate: null,
    gender: "unspecified",
    birthDate: null,
    address: null,
    emergencyContactName: null,
    emergencyContactPhoneMasked: null,
    remarks: null,
    payrollEnabled: false,
    salaryPayerType: undefined as "company" | "owner" | undefined,
    salaryPayerName: null as string | null,
    phoneMasked: "19900000001" as string | null | undefined,
    identityMasked: "TEST-IDENTITY-001" as string | null | undefined,
    bankMasked: "TEST-BANK-001" as string | null | undefined,
    bankName: "合成开户行",
    salaryBasis: "monthly",
    baseSalary: null as string | null,
    version: 7,
    avatarDocumentId: null,
    positionName: null,
    secondaryPositionNames: [],
    projectName: null,
    teamName: null,
    insuranceStatus: "none",
    historicalDuplicateProfileCount: 0,
  },
}));

vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => ({ data })),
  });
  return {
    trpc: {
      useUtils: () => ({
        personnel: {
          list: { invalidate: mocks.invalidate },
          detail: { invalidate: mocks.invalidate },
          options: { invalidate: mocks.invalidate },
        },
      }),
      personnel: {
        options: {
          useQuery: () => ({
            ...query(
              mocks.optionsMissing
                ? undefined
                : {
                    positions: mocks.positions,
                    projects: [],
                    teams: [],
                    users: [],
                  }
            ),
            isLoading: mocks.optionsLoading,
            error: mocks.optionsError,
            refetch: mocks.optionRefetch,
          }),
        },
        list: { useQuery: () => query([mocks.person]) },
        detail: {
          useQuery: () =>
            query({
              person: mocks.person,
              assignments: [],
              sourceLinks: [],
              salaryHistory: mocks.salaryHistory,
              changes: [],
              attendance: { days: 0, workHours: 0, overtimeHours: 0, rows: [] },
            }),
        },
        save: {
          useMutation: (options: { onError?: typeof mocks.onError }) => {
            mocks.onError = options.onError;
            return { mutate: mocks.mutate, isPending: false };
          },
        },
      },
    },
  };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/dialog", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Block,
    DialogHeader: Block,
    DialogTitle: Block,
    DialogDescription: Block,
  };
});
vi.mock("@/components/ui/tabs", () => {
  const Block = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Tabs: Block,
    TabsList: Block,
    TabsTrigger: Block,
    // Other business sub-components remain out of scope; allow basic and salary detail assertions.
    TabsContent: ({
      value,
      children,
    }: {
      value: string;
      children?: ReactNode;
    }) => (value === mocks.activeTab ? <div>{children}</div> : null),
  };
});
vi.mock("@/components/ProtectedImagePreview", () => ({
  ProtectedImagePreview: () => null,
}));
vi.mock("@/components/PersonnelInsuranceEditor", () => ({
  PersonnelInsuranceEditor: () => null,
}));
vi.mock("@/lib/a4Print", () => ({
  escapePrintHtml: (value: unknown) =>
    String(value ?? "").replaceAll("<", "&lt;"),
  openA4PrintDocument: mocks.print,
}));

import UnifiedPersonnelDirectory from "./UnifiedPersonnelDirectory";

let tree: ReactTestRenderer | undefined;
const root = () => {
  if (!tree) throw new Error("Personnel directory must be rendered first");
  return tree.root;
};
const text = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");
const input = (label: string) => {
  const control = root()
    .findAllByType("input")
    .find(node => node.props["aria-label"] === label);
  if (!control) throw new Error(`Missing input: ${label}`);
  return control;
};
const click = async (label: string) => {
  const control = root()
    .findAllByType("button")
    .find(node => text(node).trim() === label);
  if (!control) throw new Error(`Missing button: ${label}`);
  await act(async () => control.props.onClick());
};
const change = async (label: string, value: string | boolean) => {
  const control = input(label);
  expect(control.props.disabled).not.toBe(true);
  await act(async () =>
    control.props.onChange({
      target: typeof value === "boolean" ? { checked: value } : { value },
    })
  );
};
const submit = async () => {
  await act(async () =>
    root().findByType("form").props.onSubmit({ preventDefault: vi.fn() })
  );
};
const select = (label: string) =>
  root()
    .findAllByType("select")
    .find(node => node.props["aria-label"] === label)!;
const choose = async (label: string, value: string) => {
  const control = select(label);
  if (!control) throw new Error(`Missing select: ${label}`);
  await act(async () => control.props.onChange({ target: { value } }));
};
const openEdit = async () => {
  await act(async () => {
    tree = create(<UnifiedPersonnelDirectory />);
  });
  await click("详情");
  await click("修改资料");
};
const fields = [
  [
    "phoneNumber",
    "clearPhoneNumber",
    "手机号（新增或替换）",
    "明确清空手机号",
    "19900000001",
    "19900000002",
    "tel",
  ],
  [
    "identityNo",
    "clearIdentityNo",
    "证件号（新增或替换）",
    "明确清空证件号",
    "TEST-IDENTITY-001",
    "TEST-IDENTITY-002",
    "text",
  ],
  [
    "bankAccount",
    "clearBankAccount",
    "银行卡（新增或替换）",
    "明确清空银行卡",
    "TEST-BANK-001",
    "TEST-BANK-002",
    "text",
  ],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockReturnValue(true);
  mocks.activeTab = "basic";
  mocks.optionsLoading = false;
  mocks.optionsMissing = false;
  mocks.optionsError = null;
  mocks.positions = [
    { id: 21, name: "合成岗位", status: "active", category: "driver" },
    { id: 22, name: "合成机械驾驶员", status: "active", category: "operator" },
    {
      id: 23,
      name: "合成公司管理员",
      status: "active",
      category: "management",
    },
  ];
  mocks.salaryHistory = [];
  mocks.person.affiliation = "external";
  mocks.person.primaryPositionId = null;
  mocks.person.secondaryPositionIds = [];
  mocks.person.salaryPayerType = undefined;
  mocks.person.salaryPayerName = null;
  mocks.person.payrollEnabled = false;
  mocks.person.baseSalary = null;
  mocks.person.phoneMasked = "19900000001";
  mocks.person.identityMasked = "TEST-IDENTITY-001";
  mocks.person.bankMasked = "TEST-BANK-001";
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { confirm: mocks.confirm });
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("人员授权编辑的真实组件行为", () => {
  it("编辑页完整回填三字段，不以password隐藏；无修改保存不重复提交号码", async () => {
    await openEdit();
    for (const [, , label, clearLabel, original, , type] of fields) {
      expect(input(label).props.value).toBe(original);
      expect(input(label).props.type).toBe(type);
      expect(input(label).props.disabled).toBe(false);
      expect(input(label).props.autoComplete).toBe("off");
      expect(input(clearLabel).props.checked).toBe(false);
    }
    expect(text(root())).toContain("未修改或留空均保留已登记值");
    expect(text(root())).toContain("取消勾选恢复勾选前的输入");
    expect(text(root())).not.toContain("不回显");
    await submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: 12,
      version: 7,
      name: "合成测试人员",
      affiliation: "external",
      employmentStatus: "active",
      primaryPositionId: null,
      payrollEnabled: false,
      salaryPayerType: "owner",
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("null和缺省号码安全回填为空字符串；主岗可不设置、兼任可不选", async () => {
    mocks.person.phoneMasked = null;
    mocks.person.identityMasked = undefined;
    mocks.person.bankMasked = null;
    await openEdit();
    for (const [, , label] of fields) expect(input(label).props.value).toBe("");
    const primary = root()
      .findAllByType("select")
      .find(node => node.props["aria-label"] === "人员类型 / 主要岗位");
    expect(primary?.props.value).toBe("");
    expect(text(primary!)).toContain("暂不设置");
    const secondary = root()
      .findAllByType("button")
      .find(node => node.props["aria-label"] === "选择兼任岗位")!;
    expect(secondary.props["aria-expanded"]).toBe(false);
    await act(async () => secondary.props.onClick());
    expect(input("搜索兼任岗位")).toBeDefined();
    expect(
      root()
        .findAllByProps({ role: "option" })
        .every(node => !node.props["aria-selected"])
    ).toBe(true);
    await submit();
    const saved = mocks.mutate.mock.calls[0][0];
    expect(saved.primaryPositionId).toBeNull();
    expect(saved).not.toHaveProperty("secondaryPositionIds");
    expect(personnelSaveInput.safeParse(saved).success).toBe(true);
  });

  it.each(fields)(
    "修改%s后勾选并取消清空恢复输入，其他字段也不会误清",
    async (key, clear, label, clearLabel, original, replacement) => {
      await openEdit();
      await change(label, replacement);
      await change(clearLabel, true);
      expect(input(label).props.value).toBe("");
      expect(input(label).props.disabled).toBe(true);
      const other = fields.find(field => field[0] !== key)!;
      await change(other[2], other[5]);
      await change(clearLabel, false);
      expect(input(label).props.value).toBe(replacement);
      expect(input(label).props.disabled).toBe(false);
      await submit();
      const saved = mocks.mutate.mock.calls[0][0];
      expect(saved[key]).toBe(replacement);
      expect(saved[other[0]]).toBe(other[5]);
      expect(saved).not.toHaveProperty(clear);
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(personnelSaveInput.safeParse(saved).success).toBe(true);
      expect(original).not.toBe(replacement);
    }
  );

  it.each(fields)(
    "清空%s需要确认，只提交该清空标记而不提交其它号码",
    async (key, clear, label, clearLabel, original) => {
      await openEdit();
      await change(clearLabel, true);
      mocks.confirm.mockReturnValueOnce(false);
      await submit();
      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(input(clearLabel).props.checked).toBe(true);
      await change(clearLabel, false);
      expect(input(label).props.value).toBe(original);
      await change(clearLabel, true);
      await submit();
      const saved = mocks.mutate.mock.calls[0][0];
      expect(saved[clear]).toBe(true);
      for (const [otherKey, otherClear] of fields) {
        expect(saved).not.toHaveProperty(otherKey);
        if (otherKey !== key) expect(saved).not.toHaveProperty(otherClear);
      }
      expect(saved.version).toBe(7);
      expect(personnelSaveInput.safeParse(saved).success).toBe(true);
    }
  );

  it("手动擦空或仅空格保留旧号码，不隐式变成清空", async () => {
    await openEdit();
    for (const [, , label] of fields) await change(label, "  ");
    await submit();
    const saved = mocks.mutate.mock.calls[0][0];
    for (const [key, clear] of fields) {
      expect(saved).not.toHaveProperty(key);
      expect(saved).not.toHaveProperty(clear);
    }
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("服务端版本冲突保留替换输入和原version，不自动覆盖或重新提交", async () => {
    await openEdit();
    await change(fields[0][2], fields[0][5]);
    await submit();
    await act(async () =>
      mocks.onError?.({ message: "档案版本冲突", data: { code: "CONFLICT" } })
    );
    expect(input(fields[0][2]).props.value).toBe(fields[0][5]);
    expect(text(root())).toContain("您的输入仍保留");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0].version).toBe(7);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("人员分类与工资发放方 UI 契约", () => {
  const openCreate = async () => {
    await act(async () => {
      tree = create(<UnifiedPersonnelDirectory />);
    });
    await click("新增人员");
    await change("姓名", "合成新人员");
  };
  const toggleSecondary = async () => {
    const trigger = root()
      .findAllByType("button")
      .find(node => node.props["aria-label"] === "选择兼任岗位")!;
    await act(async () => trigger.props.onClick());
  };

  it("新增所有归属必须选择真实主分类，分组列出且不自动生成管理员", async () => {
    await openCreate();
    await choose("工资发放方", "owner");
    const primary = select("人员类型 / 主要岗位");
    expect(primary.props.required).toBe(true);
    expect(
      primary.findAllByType("optgroup").map(node => node.props.label)
    ).toEqual(["管理", "司机", "机械操作"]);
    expect(
      primary.findAllByType("option").find(node => node.props.value === "")
        ?.props.disabled
    ).toBe(true);
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(text(root())).toContain("所有新增人员必须分类");
    await choose("人员类型 / 主要岗位", "21");
    await submit();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      primaryPositionId: 21,
      salaryPayerType: "owner",
      payrollEnabled: false,
      userId: null,
    });
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty("role");
    expect(text(root())).toContain("不会根据空岗位把司机变成管理员");
  });

  it("兼任可打开、搜索、多选、显示已选和取消，主岗变化自动排除重叠", async () => {
    await openCreate();
    await choose("人员类型 / 主要岗位", "21");
    await toggleSecondary();
    expect(root().findAllByProps({ role: "option" }).map(text)).not.toContain(
      "合成岗位选择"
    );
    await change("搜索兼任岗位", "机械");
    const options = root().findAllByProps({ role: "option" });
    expect(options).toHaveLength(1);
    await act(async () => options[0].props.onClick());
    expect(
      root().findAllByProps({ role: "option" })[0].props["aria-selected"]
    ).toBe(true);
    expect(text(root())).toContain("已选 1 项 · 合成机械驾驶员");
    await change("搜索兼任岗位", "管理员");
    await act(async () =>
      root().findAllByProps({ role: "option" })[0].props.onClick()
    );
    expect(text(root())).toContain("已选 2 项");
    await choose("人员类型 / 主要岗位", "22");
    expect(text(root())).toContain("已选 1 项 · 合成公司管理员");
    const remove = root()
      .findAllByType("button")
      .find(node => node.props["aria-label"] === "移除兼任合成公司管理员")!;
    await act(async () => remove.props.onClick());
    expect(text(root())).toContain("选择兼任岗位（可不选）");
    await choose("工资发放方", "owner");
    await submit();
    expect(mocks.mutate.mock.calls[0][0].secondaryPositionIds).toEqual([]);
  });

  it("真实空字典不伪造选项，明确提示维护与重试并阻止新增保存", async () => {
    mocks.positions = [];
    await openCreate();
    expect(select("人员类型 / 主要岗位").findAllByType("option")).toHaveLength(
      1
    );
    expect(text(root())).toContain("岗位字典真实为空");
    expect(
      root()
        .findAllByType("button")
        .find(node => text(node) === "保存人员档案")?.props.disabled
    ).toBe(true);
    await click("重试岗位字典");
    expect(mocks.optionRefetch).toHaveBeenCalledTimes(1);
    expect(
      root()
        .findAllByType("button")
        .some(node => text(node) === "岗位维护")
    ).toBe(true);
    await choose("工资发放方", "owner");
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each(["loading", "missing", "error"])(
    "字典%s时明确等待或错误、维护重试入口，不渲染假岗位表单",
    async state => {
      mocks.optionsLoading = state === "loading";
      mocks.optionsMissing = true;
      mocks.optionsError =
        state === "error" ? { message: "合成读取失败" } : null;
      await act(async () => {
        tree = create(<UnifiedPersonnelDirectory />);
      });
      await click("新增人员");
      expect(root().findAllByType("form")).toHaveLength(0);
      expect(text(root())).toContain(
        state === "loading" ? "正在读取真实岗位字典" : "岗位字典尚未加载"
      );
      await click("重试岗位字典");
      expect(mocks.optionRefetch).toHaveBeenCalled();
      expect(
        root()
          .findAllByType("button")
          .some(node => text(node) === "岗位维护")
      ).toBe(true);
    }
  );

  it("手机号仅在基础资料出现一次，证件银行卡继续text完整回填", async () => {
    await openEdit();
    const phones = root()
      .findAllByType("input")
      .filter(node => node.props["aria-label"] === "手机号（新增或替换）");
    expect(phones).toHaveLength(1);
    let section = phones[0].parent;
    while (section && section.type !== "section") section = section.parent;
    expect(section && text(section.findByType("h3"))).toBe("基础资料");
    expect(input("证件号（新增或替换）").props.type).toBe("text");
    expect(input("银行卡（新增或替换）").props.type).toBe("text");
  });

  it("选择owner强制不公司计薪且不渲染基础工资，提交名称/生效日不改账号和资产", async () => {
    mocks.person.affiliation = "company";
    mocks.person.salaryPayerType = "company";
    mocks.person.payrollEnabled = true;
    mocks.person.baseSalary = "5000";
    await openEdit();
    expect(input("基础工资 / 单价（元）").props.value).toBe("5000");
    await choose("工资发放方", "owner");
    expect(
      root()
        .findAllByType("input")
        .some(node => node.props["aria-label"] === "基础工资 / 单价（元）")
    ).toBe(false);
    expect(
      root()
        .findAllByType("input")
        .some(node => node.props["aria-label"] === "启用公司计薪")
    ).toBe(false);
    expect(input("老板 / 车队名称").props.maxLength).toBe(128);
    await change("老板 / 车队名称", "合成车队");
    await change("工资生效日期", "2026-12-01");
    await submit();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      id: 12,
      version: 7,
      salaryPayerType: "owner",
      salaryPayerName: "合成车队",
      payrollEnabled: false,
      baseSalary: null,
      salaryEffectiveFrom: "2026-12-01",
    });
    for (const key of ["userId", "assetId", "role", "permissions"])
      expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty(key);
    expect(text(root())).toContain("不生成公司工资表");
  });

  it("公司计薪关闭仍是公司发放，外部人员也可显式选择公司发放且不自动计薪", async () => {
    await openEdit();
    await choose("工资发放方", "company");
    expect(input("启用公司计薪").props.checked).toBe(false);
    expect(input("启用公司计薪").props.disabled).not.toBe(true);
    await change("启用公司计薪", true);
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(text(root())).toContain("请填写公司计薪人员");
    await change("基础工资 / 单价（元）", "3500.25");
    await submit();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      salaryPayerType: "company",
      payrollEnabled: true,
      baseSalary: "3500.25",
    });
  });

  it("分类与发薪筛选作用于同一列表，A4和标准CSV使用当前筛选和发薪方列", async () => {
    mocks.person.primaryPositionId = 21;
    mocks.person.salaryPayerType = "owner";
    mocks.person.salaryPayerName = "合成车队";
    await act(async () => {
      tree = create(<UnifiedPersonnelDirectory />);
    });
    await choose("筛选人员分类", "22");
    expect(
      root()
        .findAllByType("button")
        .some(node => text(node) === "详情")
    ).toBe(false);
    await choose("筛选人员分类", "21");
    await choose("筛选工资发放方", "company");
    expect(
      root()
        .findAllByType("button")
        .some(node => text(node) === "详情")
    ).toBe(false);
    await choose("筛选工资发放方", "owner");
    expect(
      root()
        .findAllByType("button")
        .some(node => text(node) === "详情")
    ).toBe(true);
    await click("A4打印");
    expect(mocks.print.mock.calls[0][0].bodyHtml).toContain("工资发放方");
    expect(mocks.print.mock.calls[0][0].bodyHtml).toContain(
      "人员类型 / 主要岗位"
    );
    expect(mocks.print.mock.calls[0][0].bodyHtml).toContain("合成车队");
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:synthetic");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    await click("CSV");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await blob.text();
    expect(csv).toContain('"工资发放方","老板 / 车队名称","公司计薪启用"');
    expect(csv).toContain('"车队或机械老板自行发放","合成车队","否"');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("历史薪资按历史发薪方显示，旧公司disabled不误认owner，旧外部默认owner", async () => {
    mocks.activeTab = "salary";
    mocks.person.affiliation = "company";
    mocks.person.salaryPayerType = "owner";
    mocks.salaryHistory = [
      {
        effectiveFrom: "2026-09-01",
        affiliation: "company",
        payrollEnabled: false,
        salaryBasis: "monthly",
        baseSalary: "5000",
      },
      {
        effectiveFrom: "2026-10-01",
        affiliation: "external",
        payrollEnabled: false,
        salaryBasis: "monthly",
        baseSalary: null,
      },
      {
        effectiveFrom: "2026-11-01",
        affiliation: "company",
        salaryPayerType: "owner",
        salaryPayerName: "历史合成老板",
        payrollEnabled: false,
        salaryBasis: "monthly",
        baseSalary: null,
      },
    ];
    await act(async () => {
      tree = create(<UnifiedPersonnelDirectory />);
    });
    await click("详情");
    const ledger = root()
      .findAllByType("table")
      .find(node => text(node).includes("原工资发放方"))!;
    const rows = ledger.findAllByType("tbody")[0].findAllByType("tr").map(text);
    expect(rows[0]).toContain("公司发放");
    expect(rows[0]).not.toContain("老板自行");
    expect(rows[1]).toContain("车队或机械老板自行发放");
    expect(rows[2]).toContain("历史合成老板");
    expect(text(root())).toContain("不生成公司工资表");
  });

  it("未保存取消会确认且拒绝时保留草稿，dirty回调可供父级导航保护接入", async () => {
    const onDirtyChange = vi.fn();
    await act(async () => {
      tree = create(
        <UnifiedPersonnelDirectory onDirtyChange={onDirtyChange} />
      );
    });
    await click("新增人员");
    await change("姓名", "合成未保存");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    mocks.confirm.mockReturnValueOnce(false);
    await click("取消");
    expect(input("姓名").props.value).toBe("合成未保存");
    await click("取消");
    expect(root().findAllByType("form")).toHaveLength(0);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("编辑未保存关闭详情或取消不会静默丢弃，version保持不变", async () => {
    await openEdit();
    await change("姓名", "合成编辑草稿");
    mocks.confirm.mockReturnValueOnce(false);
    await click("关闭详情");
    expect(input("姓名").props.value).toBe("合成编辑草稿");
    mocks.confirm.mockReturnValueOnce(false);
    await click("取消");
    expect(input("姓名").props.value).toBe("合成编辑草稿");
    await submit();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      id: 12,
      version: 7,
      name: "合成编辑草稿",
    });
  });
});

describe("人员草稿与旧档案边界回归", () => {
  it("旧公司已启用计薪但未维护工资金额时可仅修改基础资料，不强制新工资版本", async () => {
    mocks.person.affiliation = "company";
    mocks.person.payrollEnabled = true;
    mocks.person.baseSalary = null;
    await openEdit();
    expect(input("基础工资 / 单价（元）").props.required).toBe(false);
    await change("姓名", "合成更正姓名");
    await submit();
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      version: 7,
      name: "合成更正姓名",
      salaryPayerType: "company",
      payrollEnabled: true,
    });
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty(
      "salaryEffectiveFrom"
    );
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty("baseSalary");
  });

  it("发薪方变化必须有生效日期，owner不自动改账号", async () => {
    await openEdit();
    await choose("工资发放方", "company");
    await change("工资生效日期", "");
    await submit();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(text(root())).toContain("修改薪资必须选择生效日期");
  });

  it("草稿绑定beforeunload及站内链接离开保护，拒绝导航保留输入，取消后清理监听", async () => {
    const windowListeners = new Map<
      string,
      (event: { preventDefault: () => void; returnValue?: string }) => void
    >();
    const documentListeners = new Map<
      string,
      (event: {
        target: object;
        defaultPrevented: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void
    >();
    const addWindow = vi.fn((name: string, listener) =>
      windowListeners.set(name, listener)
    );
    const removeWindow = vi.fn((name: string) => windowListeners.delete(name));
    const addDocument = vi.fn((name: string, listener) =>
      documentListeners.set(name, listener)
    );
    const removeDocument = vi.fn((name: string) =>
      documentListeners.delete(name)
    );
    class SyntheticLink {
      closest() {
        return this;
      }
      getAttribute() {
        return "/admin/dashboard";
      }
    }
    vi.stubGlobal("window", {
      confirm: mocks.confirm,
      addEventListener: addWindow,
      removeEventListener: removeWindow,
    });
    vi.stubGlobal("document", {
      addEventListener: addDocument,
      removeEventListener: removeDocument,
    });
    vi.stubGlobal("Element", SyntheticLink);
    await act(async () => {
      tree = create(<UnifiedPersonnelDirectory />);
    });
    await click("新增人员");
    await change("姓名", "合成离开保护草稿");
    expect(addWindow).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    );
    const unload = {
      preventDefault: vi.fn(),
      returnValue: undefined as string | undefined,
    };
    windowListeners.get("beforeunload")!(unload);
    expect(unload.preventDefault).toHaveBeenCalled();
    expect(unload.returnValue).toBe("");
    const navigation = {
      target: new SyntheticLink(),
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    mocks.confirm.mockReturnValueOnce(false);
    documentListeners.get("click")!(navigation);
    expect(navigation.preventDefault).toHaveBeenCalled();
    expect(navigation.stopPropagation).toHaveBeenCalled();
    expect(input("姓名").props.value).toBe("合成离开保护草稿");
    await click("取消");
    expect(removeWindow).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    );
    expect(removeDocument).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true
    );
  });
});
