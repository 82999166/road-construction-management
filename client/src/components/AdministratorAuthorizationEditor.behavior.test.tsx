import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthorizationSnapshot,
  AuthorizationRole,
  AuthorizationOrganization,
  AuthorizationProject,
  AuthorizationPermission,
} from "./administratorAuthorizationHelpers";

const mocks = vi.hoisted(() => ({
  authorization: null as AuthorizationSnapshot | null,
  roles: [] as AuthorizationRole[],
  permissions: [] as AuthorizationPermission[],
  organizations: [] as AuthorizationOrganization[],
  projects: [] as AuthorizationProject[],
  failQuery: "",
  loadingQuery: "",
  missingQuery: "",
  baselineError: false,
  roleIds: { 2: [11, 12], 3: [31] } as Record<number, number[]>,
  refetch: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  baselineInputs: vi.fn(),
  mutationError: false,
  gate: null as null | Promise<void>,
  dialogOpenChange: null as null | ((open: boolean) => void),
}));
vi.mock("@/components/ui/dialog", () => ({
  useDialogComposition: () => ({
    justEndedComposing: () => false,
    setComposing: () => {},
    markCompositionEnd: () => {},
  }),
  Dialog: ({ children, onOpenChange }: any) => {
    mocks.dialogOpenChange = onOpenChange;
    return <div data-test="dialog">{children}</div>;
  },
  DialogContent: ({ children, ...props }: any) => (
    <div data-test="content" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children, ...props }: any) => (
    <footer {...props}>{children}</footer>
  ),
}));
vi.mock("@/lib/trpc", () => {
  function query(name: string, data: unknown) {
    return {
      data: mocks.missingQuery === name ? undefined : data,
      isError: mocks.failQuery === name,
      isFetching: mocks.loadingQuery === name,
      refetch: () => mocks.refetch(name, data),
    };
  }
  return {
    trpc: {
      useUtils: () => ({
        admin: { role: { permissionIds: { invalidate: mocks.invalidate } } },
        administratorManagement: { list: { invalidate: mocks.invalidate } },
      }),
      administratorManagement: {
        authorization: {
          useQuery: () => query("authorization", mocks.authorization),
        },
        saveAuthorization: {
          useMutation: () => {
            const [isPending, setPending] = React.useState(false);
            return {
              isPending,
              mutateAsync: async (input: unknown) => {
                mocks.mutate(input);
                setPending(true);
                try {
                  if (mocks.gate) await mocks.gate;
                  if (mocks.mutationError) throw new Error("CONFLICT");
                  return { success: true };
                } finally {
                  setPending(false);
                }
              },
            };
          },
        },
      },
      admin: {
        role: {
          list: { useQuery: () => query("roles", mocks.roles) },
          permissions: {
            useQuery: () => query("permissions", mocks.permissions),
          },
          permissionIds: {
            useQuery: (input: { roleId: number }) => {
              mocks.baselineInputs(input);
              return {
                data: mocks.roleIds[input.roleId] ?? [],
                isError: mocks.baselineError,
                isFetching: false,
              };
            },
          },
        },
        organization: {
          list: { useQuery: () => query("organizations", mocks.organizations) },
        },
        project: {
          listAccessible: { useQuery: () => query("projects", mocks.projects) },
        },
      },
    },
  };
});

import AdministratorAuthorizationEditor, {
  AdministratorAuthorizationEditor as NamedEditor,
} from "./AdministratorAuthorizationEditor";
import {
  buildAuthorizationInput,
  createAuthorizationDraft,
  fromAuthorizationTimeInput,
  toAuthorizationTimeInput,
} from "./administratorAuthorizationHelpers";

let view: TestRenderer.ReactTestRenderer | undefined;
const close = vi.fn();
const saved = vi.fn();
const dirty = vi.fn();
const confirm = vi.fn(() => true);
const childrenText = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(childrenText).join("")
    : typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
const button = (label: string) =>
  view!.root
    .findAllByType("button")
    .find(item => childrenText(item.props.children) === label)!;
const ariaButton = (label: string) =>
  view!.root
    .findAllByType("button")
    .find(item => item.props["aria-label"] === label)!;
const input = (label: string) =>
  view!.root
    .findAllByType("input")
    .find(item => item.props["aria-label"] === label)!;
const select = (label: string) =>
  view!.root
    .findAllByType("select")
    .find(item => item.props["aria-label"] === label)!;
const text = () => JSON.stringify(view!.toJSON());
async function mount() {
  await act(async () => {
    view = TestRenderer.create(
      <AdministratorAuthorizationEditor
        userId={42}
        name="测试管理员"
        onClose={close}
        onSaved={saved}
        onDirtyChange={dirty}
      />
    );
  });
}
async function click(label: string) {
  await act(async () => {
    button(label).props.onClick();
  });
}
async function ariaClick(label: string) {
  await act(async () => {
    ariaButton(label).props.onClick();
  });
}
async function changeInput(label: string, value: string | boolean) {
  await act(async () => {
    input(label).props.onChange({
      target: typeof value === "boolean" ? { checked: value } : { value },
    });
  });
}
async function changeSelect(label: string, value: string) {
  await act(async () => {
    select(label).props.onChange({ target: { value } });
  });
}
async function rerender() {
  await act(async () => {
    view!.update(
      <AdministratorAuthorizationEditor
        userId={42}
        name="测试管理员"
        onClose={close}
        onSaved={saved}
        onDirtyChange={dirty}
      />
    );
  });
}
const fixedFrom = new Date("2020-01-01T02:03:04.123Z");
const fixedTo = new Date("2099-01-01T02:03:04.789Z");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { confirm });
  vi.clearAllMocks();
  confirm.mockReturnValue(true);
  mocks.failQuery = "";
  mocks.loadingQuery = "";
  mocks.missingQuery = "";
  mocks.mutationError = false;
  mocks.gate = null;
  mocks.baselineError = false;
  mocks.roles = [
    {
      id: 1,
      code: "SUPER_ADMIN",
      name: "超级管理员",
      category: "system",
      status: "active",
      isSystem: true,
    },
    {
      id: 2,
      code: "CONSTRUCTION_MANAGER",
      name: "施工管理员",
      category: "business",
      status: "active",
      isSystem: true,
    },
    {
      id: 3,
      code: "LABOR_MANAGER",
      name: "劳资管理员",
      category: "business",
      status: "active",
      isSystem: true,
    },
    {
      id: 4,
      code: "DRIVER",
      name: "司机",
      category: "business",
      status: "active",
      isSystem: true,
    },
    {
      id: 5,
      code: "OLD",
      name: "停用岗位",
      category: "business",
      status: "disabled",
      isSystem: false,
    },
  ];
  mocks.permissions = [
    { id: 11, name: "施工日报查看", module: "construction", action: "read" },
    { id: 12, name: "施工日报新增", module: "construction", action: "create" },
    { id: 21, name: "财务支付", module: "finance", action: "settle" },
    { id: 31, name: "劳务工资查看", module: "labor", action: "read" },
    { id: 99, name: "系统权限治理", module: "admin", action: "manage" },
  ];
  mocks.organizations = [
    { id: 7, name: "工程部门", type: "department", status: "active" },
    { id: 8, name: "总公司", type: "company", status: "active" },
    { id: 9, name: "停用部门", type: "project_department", status: "disabled" },
  ];
  mocks.projects = [
    { id: 17, name: "道路一标", status: "active" },
    { id: 18, name: "归档项目", status: "archived" },
  ];
  mocks.authorization = {
    assignments: [
      {
        id: 81,
        roleId: 2,
        organizationId: 7,
        projectId: null,
        validFrom: fixedFrom,
        validTo: fixedTo,
      },
    ],
    permissionIds: [],
    revision: "original-revision-do-not-replace",
  };
  mocks.roleIds = { 2: [11, 12], 3: [31] };
  mocks.refetch.mockImplementation(async (name, data) => ({
    data: name === "authorization" ? mocks.authorization : data,
    error: null,
  }));
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (view)
    await act(async () => {
      view!.unmount();
    });
  view = undefined;
  vi.unstubAllGlobals();
});

describe("管理员授权编辑器真实组件行为", () => {
  it("具名和默认导出相同；初始及tab切换不误报脏数据，父级回传卸载归零", async () => {
    expect(NamedEditor).toBe(AdministratorAuthorizationEditor);
    await mount();
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(button("保存授权").props.disabled).toBe(true);
    await click("菜单及操作");
    expect(dirty).toHaveBeenLastCalledWith(false);
    await changeInput("施工日报新增 · 新增", true);
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => {
      view!.unmount();
    });
    view = undefined;
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it.each([
    "authorization",
    "roles",
    "permissions",
    "organizations",
    "projects",
  ])("%s 加载错误，即使已有输入也禁止保存", async name => {
    mocks.failQuery = name;
    await mount();
    if (name !== "authorization")
      await changeSelect("数据范围 1", "project:17");
    expect(text()).toContain("禁止保存以免覆盖已有授权");
    expect(button("保存授权").props.disabled).toBe(true);
    await click("保存授权");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("目录缺失、空目录或加载中禁止保存", async () => {
    await mount();
    await changeSelect("数据范围 1", "project:17");
    mocks.missingQuery = "permissions";
    await rerender();
    expect(button("保存授权").props.disabled).toBe(true);
    mocks.missingQuery = "";
    mocks.permissions = [];
    await rerender();
    expect(text()).toContain("可用授权目录缺失");
    mocks.permissions = [
      { id: 11, name: "施工日报查看", module: "construction", action: "read" },
    ];
    mocks.loadingQuery = "projects";
    await rerender();
    expect(button("保存授权").props.disabled).toBe(true);
  });

  it("保存保留原assignment id、毫秒时间与revision，删除不改成新授予", async () => {
    await mount();
    await click("菜单及操作");
    await changeInput("财务支付 · 结算 / 付款", true);
    expect(button("保存授权").props.disabled).toBe(false);
    await click("保存授权");
    expect(mocks.mutate).toHaveBeenCalledWith({
      userId: 42,
      revision: "original-revision-do-not-replace",
      assignments: [
        {
          id: 81,
          roleId: 2,
          organizationId: 7,
          projectId: null,
          validFrom: fixedFrom.toISOString(),
          validTo: fixedTo.toISOString(),
        },
      ],
      permissionIds: [21],
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("角色隐藏超管司机、允许劳资管理，权限基于真实名称和动作，不呈现系统治理", async () => {
    await mount();
    const options = select("岗位 1")
      .findAllByType("option")
      .map(item => childrenText(item.props.children));
    expect(options).toContain("劳资管理员");
    expect(options).not.toContain("超级管理员");
    expect(options).not.toContain("司机");
    expect(options).not.toContain("停用岗位");
    const scopes = select("数据范围 1")
      .findAllByType("option")
      .map(item => childrenText(item.props.children));
    expect(scopes).not.toContain("总公司");
    expect(scopes).not.toContain("归档项目");
    await click("菜单及操作");
    expect(input("劳务工资查看 · 查询")).toBeTruthy();
    expect(text()).not.toContain("系统权限治理");
    expect(
      view!.root
        .findAllByType("input")
        .filter(item => item.props.type === "checkbox")
    ).toHaveLength(4);
  });

  it("空专属配置继承角色基线不全禁，勾选后仅模块覆盖，取消最后项须确认", async () => {
    await mount();
    await click("菜单及操作");
    expect(input("施工日报查看 · 查询").props.checked).toBe(false);
    expect(text()).toContain("岗位继承允许");
    expect(text()).toContain("沿用岗位权限（不是全部禁用）");
    expect(mocks.baselineInputs).toHaveBeenCalledWith({ roleId: 2 });
    await changeInput("施工日报新增 · 新增", true);
    expect(text()).toContain("专属配置 1 项");
    expect(text()).toContain("专属未选");
    confirm.mockReturnValue(false);
    await changeInput("施工日报新增 · 新增", false);
    expect(input("施工日报新增 · 新增").props.checked).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("将继承该模块岗位权限")
    );
    confirm.mockReturnValue(true);
    await changeInput("施工日报新增 · 新增", false);
    expect(input("施工日报新增 · 新增").props.checked).toBe(false);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("清空模块和全部专属配置取消时不改变权限；确认后回归岗位", async () => {
    mocks.authorization!.permissionIds = [11, 12, 21];
    await mount();
    await click("菜单及操作");
    confirm.mockReturnValue(false);
    await ariaClick("清空施工日报专属权限");
    expect(input("施工日报新增 · 新增").props.checked).toBe(true);
    await click("清空全部专属，回归岗位");
    expect(input("财务支付 · 结算 / 付款").props.checked).toBe(true);
    confirm.mockReturnValue(true);
    await ariaClick("清空施工日报专属权限");
    expect(input("施工日报新增 · 新增").props.checked).toBe(false);
    expect(input("财务支付 · 结算 / 付款").props.checked).toBe(true);
    await click("清空全部专属，回归岗位");
    expect(input("财务支付 · 结算 / 付款").props.checked).toBe(false);
    expect(text()).toContain("沿用岗位权限（不是全部禁用）");
  });

  it("撤销部分记录只从提交省略，清空全部及最后一项取消都保留，空授予保存二次确认", async () => {
    mocks.authorization!.assignments.push({
      id: 82,
      roleId: 3,
      organizationId: null,
      projectId: 17,
      validFrom: null,
      validTo: null,
    });
    await mount();
    await ariaClick("撤销岗位授予 1");
    expect(select("岗位 1").props.value).toBe(3);
    confirm.mockReturnValue(false);
    await ariaClick("撤销岗位授予 1");
    expect(select("岗位 1").props.value).toBe(3);
    await click("清空全部岗位");
    expect(select("岗位 1").props.value).toBe(3);
    await click("保存授权");
    expect(mocks.mutate.mock.calls[0][0].assignments).toEqual([
      {
        id: 82,
        roleId: 3,
        organizationId: null,
        projectId: 17,
        validFrom: null,
        validTo: null,
      },
    ]);
  });

  it("清空所有岗位后明确无范围，保存仍确认，拒绝确认不调用服务器", async () => {
    await mount();
    await click("清空全部岗位");
    expect(text()).toContain("不代表全公司 / 全项目访问权限");
    confirm.mockReturnValue(false);
    await click("保存授权");
    expect(mocks.mutate).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click("保存授权");
    expect(mocks.mutate.mock.calls[0][0].assignments).toEqual([]);
  });

  it("新增多个部门/项目岗位与北京时间有效期，缺范围和倒序时间禁保存", async () => {
    await mount();
    await click("新增岗位授予");
    await changeSelect("岗位 2", "3");
    expect(button("保存授权").props.disabled).toBe(true);
    await changeSelect("数据范围 2", "project:17");
    await changeInput("生效时间 2", "2027-05-01T08:00:01");
    await changeInput("结束时间 2", "2027-04-01T08:00:01");
    expect(button("保存授权").props.disabled).toBe(true);
    expect(text()).toContain("结束时间必须晚于开始时间");
    await changeInput("结束时间 2", "2027-06-01T08:00:02");
    await click("新增岗位授予");
    await changeSelect("岗位 3", "2");
    await changeSelect("数据范围 3", "organization:7");
    expect(button("保存授权").props.disabled).toBe(false);
    await click("保存授权");
    const result = mocks.mutate.mock.calls[0][0];
    expect(result.assignments[1]).toEqual({
      roleId: 3,
      organizationId: null,
      projectId: 17,
      validFrom: "2027-05-01T00:00:01.000Z",
      validTo: "2027-06-01T00:00:02.000Z",
    });
    expect(result.assignments[2]).toEqual({
      roleId: 2,
      organizationId: 7,
      projectId: null,
      validFrom: null,
      validTo: null,
    });
    expect(result.assignments[0].id).toBe(81);
  });

  it("失效岗位/范围/不存在权限中文回显而不默默清空，修正或明确移除前禁保存", async () => {
    mocks.authorization!.assignments[0].roleId = 5;
    mocks.authorization!.assignments[0].organizationId = 9;
    mocks.authorization!.permissionIds = [12345];
    await mount();
    expect(select("岗位 1").props.value).toBe(5);
    expect(select("数据范围 1").props.value).toBe("organization:9");
    expect(text()).toContain("已停用 / 不可用");
    await changeSelect("岗位 1", "2");
    await changeSelect("数据范围 1", "project:17");
    expect(button("保存授权").props.disabled).toBe(true);
    await click("菜单及操作");
    expect(text()).toContain("原值未清空");
    confirm.mockReturnValue(false);
    await ariaClick("移除不可用权限 1");
    expect(text()).toContain("既有权限 1");
    confirm.mockReturnValue(true);
    await ariaClick("移除不可用权限 1");
    expect(button("保存授权").props.disabled).toBe(false);
  });

  it("已到期授予原样保留但不误算当前岗位继承", async () => {
    mocks.authorization!.assignments[0].validTo = new Date(
      "2021-01-01T00:00:00Z"
    );
    await mount();
    expect(text()).toContain("已到期（保留记录）");
    await click("菜单及操作");
    expect(text()).not.toContain("岗位继承允许");
    await changeInput("财务支付 · 结算 / 付款", true);
    await click("保存授权");
    expect(mocks.mutate.mock.calls[0][0].assignments[0]).toMatchObject({
      id: 81,
      validTo: "2021-01-01T00:00:00.000Z",
    });
  });

  it("岗位基线加载失败时禁止保存", async () => {
    mocks.baselineError = true;
    await mount();
    await changeSelect("数据范围 1", "project:17");
    expect(text()).toContain("岗位权限读取失败");
    expect(button("保存授权").props.disabled).toBe(true);
  });

  it("取消/ESC关闭拒绝确认不退出且保留输入", async () => {
    await mount();
    await changeSelect("数据范围 1", "project:17");
    confirm.mockReturnValue(false);
    await click("取消");
    expect(close).not.toHaveBeenCalled();
    expect(select("数据范围 1").props.value).toBe("project:17");
    await act(async () => {
      mocks.dialogOpenChange!(false);
    });
    expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click("取消");
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("冲突/保存失败保留草稿和旧revision，回读取消保留，成功回读才换成新版本", async () => {
    mocks.mutationError = true;
    await mount();
    await changeSelect("数据范围 1", "project:17");
    await click("保存授权");
    expect(text()).toContain("您的输入和读取版本已保留");
    expect(select("数据范围 1").props.value).toBe("project:17");
    expect(close).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    confirm.mockReturnValue(false);
    await click("重新读取服务器授权");
    expect(mocks.refetch).not.toHaveBeenCalled();
    await click("保存授权");
    expect(mocks.mutate.mock.calls[1][0].revision).toBe(
      "original-revision-do-not-replace"
    );
    confirm.mockReturnValue(true);
    mocks.authorization = {
      ...mocks.authorization!,
      revision: "new-server-revision",
    };
    await click("重新读取服务器授权");
    expect(select("数据范围 1").props.value).toBe("organization:7");
    expect(button("保存授权").props.disabled).toBe(true);
    mocks.mutationError = false;
    await changeSelect("数据范围 1", "project:17");
    await click("保存授权");
    expect(mocks.mutate.mock.calls[2][0].revision).toBe("new-server-revision");
  });

  it("回读目录失败不会替换未保存输入", async () => {
    await mount();
    await changeSelect("数据范围 1", "project:17");
    mocks.refetch.mockImplementation(async (name, data) => ({
      data,
      error: name === "roles" ? new Error("FAILED") : null,
    }));
    await click("重新读取服务器授权");
    expect(text()).toContain("原有输入仍保留");
    expect(select("数据范围 1").props.value).toBe("project:17");
  });

  it("pending禁保存/关闭/编辑和重复提交，完成失败后可继续操作", async () => {
    let release!: () => void;
    mocks.gate = new Promise<void>(resolve => {
      release = resolve;
    });
    mocks.mutationError = true;
    await mount();
    await changeSelect("数据范围 1", "project:17");
    const staleSaveClick = button("保存授权").props.onClick;
    await act(async () => {
      staleSaveClick();
      staleSaveClick();
    });
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(button("保存中…").props.disabled).toBe(true);
    expect(button("取消").props.disabled).toBe(true);
    await click("取消");
    await act(async () => {
      mocks.dialogOpenChange!(false);
    });
    expect(close).not.toHaveBeenCalled();
    await changeSelect("数据范围 1", "organization:7");
    expect(select("数据范围 1").props.value).toBe("project:17");
    await act(async () => {
      release();
    });
    expect(button("取消").props.disabled).toBe(false);
    expect(text()).toContain("授权保存失败");
  });
});

describe("授权独立helper时间和保留规则", () => {
  it("北京时间转换固定UTC且拒绝非法日期；未编辑时间精度不丢失", () => {
    expect(toAuthorizationTimeInput("2026-01-01T00:00:00Z")).toBe(
      "2026-01-01T08:00:00"
    );
    expect(fromAuthorizationTimeInput("2026-01-01T08:00:01")).toBe(
      "2026-01-01T00:00:01.000Z"
    );
    expect(fromAuthorizationTimeInput("2026-02-30T08:00:00")).toBe(
      "2026-02-30T08:00:00"
    );
    const draft = createAuthorizationDraft(mocks.authorization!);
    const payload = buildAuthorizationInput(42, "opaque", draft);
    expect(payload.assignments[0].validFrom).toBe("2020-01-01T02:03:04.123Z");
    expect(payload.assignments[0].id).toBe(81);
    expect(payload.revision).toBe("opaque");
  });
});
