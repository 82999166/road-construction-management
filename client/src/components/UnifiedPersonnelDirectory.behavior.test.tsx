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
  onError: undefined as
    | ((error: { message: string; data?: { code?: string } }) => void)
    | undefined,
  person: {
    id: 12,
    personNo: "P-SYNTHETIC-12",
    name: "合成测试人员",
    affiliation: "external",
    employmentStatus: "active",
    primaryPositionId: null,
    secondaryPositionIds: [],
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
    phoneMasked: "19900000001" as string | null | undefined,
    identityMasked: "TEST-IDENTITY-001" as string | null | undefined,
    bankMasked: "TEST-BANK-001" as string | null | undefined,
    bankName: "合成开户行",
    salaryBasis: "monthly",
    baseSalary: null,
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
          useQuery: () =>
            query({
              positions: [{ id: 21, name: "合成岗位", status: "active" }],
              projects: [],
              teams: [],
              users: [],
            }),
        },
        list: { useQuery: () => query([mocks.person]) },
        detail: {
          useQuery: () =>
            query({
              person: mocks.person,
              assignments: [],
              sourceLinks: [],
              salaryHistory: [],
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
    // This suite exercises the real basic-detail -> edit path, not other business tabs.
    TabsContent: ({
      value,
      children,
    }: {
      value: string;
      children?: ReactNode;
    }) => (value === "basic" ? <div>{children}</div> : null),
  };
});
vi.mock("@/components/ProtectedImagePreview", () => ({
  ProtectedImagePreview: () => null,
}));
vi.mock("@/components/PersonnelInsuranceEditor", () => ({
  PersonnelInsuranceEditor: () => null,
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
      .find(node => node.props["aria-label"] === "主要岗位");
    expect(primary?.props.value).toBe("");
    expect(text(primary!)).toContain("暂不设置");
    const secondary = root()
      .findAllByType("input")
      .find(
        node =>
          node.props.type === "checkbox" &&
          !node.props["aria-label"] &&
          node.parent &&
          text(node.parent).includes("合成岗位")
      );
    expect(secondary?.props.checked).toBe(false);
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
