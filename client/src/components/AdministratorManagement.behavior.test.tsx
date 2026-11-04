import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  queryError: null as any,
  loading: false,
  fetching: false,
  refetch: vi.fn(),
  invalidate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  resetPassword: vi.fn(),
  ownPassword: vi.fn(),
  mutationReset: vi.fn(),
  editorMounts: [] as number[],
  editorUnmounts: [] as number[],
}));

vi.mock("@/components/ui/dialog", () => ({
  useDialogComposition: () => ({
    isComposing: () => false,
    justEndedComposing: () => false,
    setComposing: () => {},
    markCompositionEnd: () => {},
  }),
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? (
      <div data-testid="dialog" data-close={() => onOpenChange(false)}>
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    onEscapeKeyDown,
    onInteractOutside,
    ...props
  }: any) => (
    <div
      data-testid="dialog-content"
      data-escape={onEscapeKeyDown}
      data-outside={onInteractOutside}
      className={props.className}
    >
      {children}
    </div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock("@/components/AdministratorAuthorizationEditor", () => ({
  default: ({ userId, name, onClose, onSaved }: any) => {
    const [mountedFor] = React.useState(userId);
    React.useEffect(() => {
      mocks.editorMounts.push(userId);
      return () => {
        mocks.editorUnmounts.push(userId);
      };
    }, []);
    return (
      <div
        data-testid="authorization"
        data-user-id={userId}
        data-mounted-for={mountedFor}
      >
        <p>{name}</p>
        <button onClick={onClose}>关闭权限编辑</button>
        <button onClick={onSaved}>保存权限模拟</button>
      </div>
    );
  },
}));

vi.mock("@/lib/trpc", () => {
  function mutation(call: ReturnType<typeof vi.fn>) {
    const [isPending, setPending] = React.useState(false);
    return {
      isPending,
      reset: mocks.mutationReset,
      mutateAsync: async (input: any) => {
        setPending(true);
        try {
          return await call(input);
        } finally {
          setPending(false);
        }
      },
    };
  }
  return {
    trpc: {
      useUtils: () => ({
        administratorManagement: { list: { invalidate: mocks.invalidate } },
      }),
      administratorManagement: {
        list: {
          useQuery: () => ({
            data: mocks.rows,
            isLoading: mocks.loading,
            isFetching: mocks.fetching,
            isError: !!mocks.queryError,
            error: mocks.queryError,
            refetch: mocks.refetch,
          }),
        },
        create: { useMutation: () => mutation(mocks.create) },
        update: { useMutation: () => mutation(mocks.update) },
        resetPassword: { useMutation: () => mutation(mocks.resetPassword) },
      },
      auth: {
        changeLocalPassword: { useMutation: () => mutation(mocks.ownPassword) },
      },
    },
  };
});

import AdministratorManagement from "./AdministratorManagement";
import { FinancePagination } from "./FinanceWorkspaceNavigation";

function account(
  id: number,
  name = `管理人员${id}`,
  extras: Record<string, unknown> = {}
) {
  return {
    id,
    name,
    role: "user",
    localUsername: `1380000${String(id).padStart(4, "0")}`,
    localAccountStatus: "active",
    localLoginMode: "pc",
    lastSignedIn: null,
    createdAt: new Date("2026-01-01"),
    ...extras,
  };
}

let view: TestRenderer.ReactTestRenderer | undefined;
function text(node: ReactTestInstance): string {
  return node.children
    .map(child => (typeof child === "string" ? child : text(child)))
    .join("");
}
function button(label: string) {
  const result = view!.root
    .findAllByType("button")
    .find(node => text(node) === label || node.props["aria-label"] === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
function field(id: string) {
  return view!.root.findAll(
    node =>
      (node.type === "input" || node.type === "select") && node.props.id === id
  )[0];
}
async function change(id: string, value: string) {
  await act(async () => field(id).props.onChange({ target: { value } }));
}
async function click(label: string) {
  await act(async () => button(label).props.onClick());
}
async function submit() {
  await act(async () => {
    await view!.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
}
async function mount(
  props: Partial<React.ComponentProps<typeof AdministratorManagement>> = {}
) {
  await act(async () => {
    view = TestRenderer.create(
      <AdministratorManagement
        currentUserId={1}
        canChangeOwnPassword
        {...props}
      />
    );
  });
}
async function rerender(
  props: Partial<React.ComponentProps<typeof AdministratorManagement>> = {}
) {
  await act(async () =>
    view!.update(
      <AdministratorManagement
        currentUserId={1}
        canChangeOwnPassword
        {...props}
      />
    )
  );
}
async function fillCreate() {
  await change("administrator-username", "+86 138-0013-8000");
  await change("administrator-displayName", " 张管理 ");
  await change("administrator-password", "Abcd1234!");
  await change("administrator-confirmation", "Abcd1234!");
}
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.rows = [
    account(1, "超级管理", { role: "admin" }),
    account(2, "张管理"),
    account(3, "李管理", {
      localAccountStatus: "disabled",
      localLoginMode: "mobile",
    }),
  ];
  mocks.queryError = null;
  mocks.loading = false;
  mocks.fetching = false;
  mocks.create.mockResolvedValue({ success: true, userId: 99 });
  mocks.update.mockResolvedValue({ success: true });
  mocks.resetPassword.mockResolvedValue({ success: true });
  mocks.ownPassword.mockResolvedValue({ success: true });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({});
  mocks.editorMounts = [];
  mocks.editorUnmounts = [];
});
afterEach(async () => {
  if (view) await act(async () => view!.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

describe("PC 管理员管理真实 React 行为", () => {
  it("表格仅普通管理员有编辑授权和重置，超管只读，本人密码单独修改，不包含司机", async () => {
    mocks.rows.push(account(4, "司机账号", { loginMethod: "local_driver" }));
    await mount();
    expect(text(view!.root)).toContain("PC 管理员管理");
    expect(text(view!.root)).toContain("超级管理员 · 只读");
    expect(text(view!.root.findByType("tbody"))).not.toContain("司机账号");
    expect(
      view!.root
        .findAllByType("button")
        .some(node => node.props["aria-label"] === "重置超级管理密码")
    ).toBe(false);
    expect(
      view!.root
        .findAllByType("button")
        .filter(node => text(node) === "重置密码")
    ).toHaveLength(2);
    expect(text(view!.root)).toContain("原普通管理入口");
    expect(text(view!.root)).toContain("服务端二次校验");
    expect(text(view!.root)).toContain("仅显示已授权菜单");
  });

  it("默认创建PC普通管理员，手机号姓名密码校验和确认不通过时不提交", async () => {
    await mount();
    await click("新增管理员");
    expect(field("administrator-login-mode").props.value).toBe("pc");
    await submit();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(text(view!.root)).toContain("有效的中国大陆手机号");
    expect(text(view!.root)).toContain("姓名需为 2–128");
    expect(text(view!.root)).toContain("密码需为 8–128");
    await fillCreate();
    await change("administrator-password", "1234567");
    await change("administrator-confirmation", "1234567");
    await submit();
    expect(mocks.create).not.toHaveBeenCalled();
    await change("administrator-password", "Abcd1234!");
    await change("administrator-confirmation", "Mismatch123");
    await submit();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(text(view!.root)).toContain("两次输入的密码不一致");
  });

  it("成功创建只提交白名单字段并清除密码，下一步分配权限不冒称已授权", async () => {
    await mount();
    await click("新增管理员");
    await fillCreate();
    await submit();
    expect(mocks.create).toHaveBeenCalledWith({
      username: "13800138000",
      displayName: "张管理",
      initialPassword: "Abcd1234!",
      status: "active",
      loginMode: "pc",
    });
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("role");
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("confirmation");
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.mutationReset).toHaveBeenCalledTimes(1);
    expect(view!.root.findAllByType("form")).toHaveLength(0);
    expect(text(view!.root)).toContain("创建账号不代表已授权");
    await click("下一步：分配权限");
    expect(
      view!.root.findByProps({ "data-testid": "authorization" }).props[
        "data-user-id"
      ]
    ).toBe(99);
    await click("关闭权限编辑");
    await click("新增管理员");
    expect(field("administrator-password").props.value).toBe("");
    expect(field("administrator-confirmation").props.value).toBe("");
  });

  it("未保存取消需要确认；继续编辑保留密码，放弃清空，Esc和遮罩同样保护", async () => {
    await mount();
    await click("新增管理员");
    await fillCreate();
    await click("取消");
    expect(text(view!.root)).toContain("存在未保存的修改");
    await click("继续编辑");
    expect(field("administrator-password").props.value).toBe("Abcd1234!");
    const preventDefault = vi.fn();
    await act(async () =>
      view!.root
        .findByProps({ "data-testid": "dialog-content" })
        .props["data-escape"]({ preventDefault })
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(text(view!.root)).toContain("存在未保存的修改");
    await click("继续编辑");
    await act(async () =>
      view!.root
        .findByProps({ "data-testid": "dialog-content" })
        .props["data-outside"]({ preventDefault })
    );
    await click("放弃修改并退出");
    expect(view!.root.findAllByType("form")).toHaveLength(0);
    await click("新增管理员");
    expect(field("administrator-password").props.value).toBe("");
    expect(field("administrator-confirmation").props.value).toBe("");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("pending同步防重复提交及关闭，包括Esc、遮罩和取消，完成后清除", async () => {
    const job = deferred();
    mocks.create.mockImplementation(() => job.promise);
    await mount();
    await click("新增管理员");
    await fillCreate();
    const handler = view!.root.findByType("form").props.onSubmit;
    const cancel = button("取消").props.onClick;
    let submitted!: Promise<void>;
    await act(async () => {
      submitted = handler({ preventDefault() {} });
      void handler({ preventDefault() {} });
      cancel();
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(button("取消").props.disabled).toBe(true);
    expect(button("正在提交…").props.disabled).toBe(true);
    const preventDefault = vi.fn();
    await act(async () => {
      const content = view!.root.findByProps({
        "data-testid": "dialog-content",
      });
      content.props["data-escape"]({ preventDefault });
      content.props["data-outside"]({ preventDefault });
      view!.root.findByProps({ "data-testid": "dialog" }).props["data-close"]();
    });
    expect(view!.root.findAllByType("form")).toHaveLength(1);
    expect(text(view!.root)).not.toContain("存在未保存的修改");
    await act(async () => {
      job.resolve({ success: true, userId: 99 });
      await submitted;
    });
    expect(view!.root.findAllByType("form")).toHaveLength(0);
  });

  it("mutation冲突有友好可操作错误，失败保留草稿，修正后可重试", async () => {
    mocks.create.mockRejectedValueOnce({
      data: { code: "CONFLICT" },
      message: "SQL/private failure",
    });
    await mount();
    await click("新增管理员");
    await fillCreate();
    await submit();
    expect(text(view!.root)).toContain("该手机号已被使用");
    expect(text(view!.root)).not.toContain("SQL/private failure");
    expect(field("administrator-password").props.value).toBe("Abcd1234!");
    expect(button("创建账号").props.disabled).toBe(false);
    await change("administrator-username", "13800138001");
    await submit();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].username).toBe("13800138001");
  });

  it("编辑仅改账号字段不带密码和权限，可以停用或选择双端", async () => {
    await mount();
    await click("编辑张管理");
    expect(field("administrator-displayName").props.value).toBe("张管理");
    expect(
      view!.root
        .findAllByType("input")
        .filter(node => node.props.type === "password")
    ).toHaveLength(0);
    await change("administrator-displayName", " 张新名 ");
    await change("administrator-account-status", "disabled");
    await change("administrator-login-mode", "both");
    await submit();
    expect(mocks.update).toHaveBeenCalledWith({
      userId: 2,
      username: "13800000002",
      displayName: "张新名",
      status: "disabled",
      loginMode: "both",
    });
    expect(text(view!.root)).toContain("岗位和操作权限未改变");
  });

  it("重置明确不读取旧密码，只发送目标id和确认后的新密码，完成后新窗口为空", async () => {
    await mount();
    await click("重置张管理密码");
    expect(text(view!.root)).toContain("不读取、不显示旧密码");
    expect(
      view!.root.findAll(
        node =>
          node.type === "input" &&
          node.props.id === "administrator-currentPassword"
      )
    ).toHaveLength(0);
    await change("administrator-password", "newAbcd123!");
    await change("administrator-confirmation", "badConfirm!");
    await submit();
    expect(mocks.resetPassword).not.toHaveBeenCalled();
    await change("administrator-confirmation", "newAbcd123!");
    await submit();
    expect(mocks.resetPassword).toHaveBeenCalledWith({
      userId: 2,
      newPassword: "newAbcd123!",
    });
    await click("重置李管理密码");
    expect(field("administrator-password").props.value).toBe("");
    expect(field("administrator-confirmation").props.value).toBe("");
  });

  it("本人改密精确使用既有auth接口，要求当前密码，新密码成功全部清空", async () => {
    await mount();
    await click("修改我的密码");
    await change("administrator-password", "ownAbcd123!");
    await change("administrator-confirmation", "ownAbcd123!");
    await submit();
    expect(mocks.ownPassword).not.toHaveBeenCalled();
    expect(text(view!.root)).toContain("请输入当前密码");
    await change("administrator-currentPassword", "myOldPass");
    mocks.ownPassword.mockRejectedValueOnce({
      data: { code: "UNAUTHORIZED" },
      message: "当前密码错误",
    });
    await submit();
    expect(text(view!.root)).toContain("当前密码不正确或登录已失效");
    expect(field("administrator-password").props.value).toBe("ownAbcd123!");
    await change("administrator-currentPassword", "correctOldPass");
    await submit();
    expect(mocks.ownPassword).toHaveBeenCalledWith({
      currentPassword: "correctOldPass",
      newPassword: "ownAbcd123!",
    });
    expect(mocks.resetPassword).not.toHaveBeenCalled();
    expect(text(view!.root)).not.toContain("全部旧会话");
    await click("修改我的密码");
    for (const id of [
      "administrator-currentPassword",
      "administrator-password",
      "administrator-confirmation",
    ])
      expect(field(id).props.value).toBe("");
  });

  it("不支持本地改密的当前登录显示第三方说明，不提供本人改密按钮", async () => {
    await mount({ canChangeOwnPassword: false });
    expect(text(view!.root)).toContain("第三方登录密码请到对应登录服务修改");
    expect(
      view!.root
        .findAllByType("button")
        .some(node => text(node) === "修改我的密码")
    ).toBe(false);
  });

  it("授权编辑器按userId key重新挂载，不把上一个用户草稿传到另一个用户", async () => {
    await mount();
    await click("配置张管理权限");
    expect(mocks.editorMounts).toEqual([2]);
    await click("关闭权限编辑");
    await click("配置李管理权限");
    const editor = view!.root.findByProps({ "data-testid": "authorization" });
    expect(editor.props["data-user-id"]).toBe(3);
    expect(editor.props["data-mounted-for"]).toBe(3);
    expect(mocks.editorMounts).toEqual([2, 3]);
    expect(mocks.editorUnmounts).toEqual([2]);
    await click("保存权限模拟");
    expect(
      view!.root.findAllByProps({ "data-testid": "authorization" })
    ).toHaveLength(0);
    expect(text(view!.root)).toContain("实际访问以服务端权限校验为准");
  });

  it("列表分页只限制表格，搜索姓名手机号和状态筛选切回第一页，编辑窗口完整", async () => {
    mocks.rows = Array.from({ length: 25 }, (_, index) =>
      account(index + 1, `人员${index + 1}`)
    );
    await mount();
    let paging = view!.root.findByType(FinancePagination);
    expect(paging.props.total).toBe(25);
    expect(
      view!.root.findAllByType("tbody")[0].findAllByType("tr")
    ).toHaveLength(20);
    await act(async () => paging.props.onPageChange(2));
    expect(
      view!.root.findAllByType("tbody")[0].findAllByType("tr")
    ).toHaveLength(5);
    await click("编辑人员25");
    expect(field("administrator-displayName").props.value).toBe("人员25");
    await click("取消");
    await change("administrator-search", "13800000025");
    paging = view!.root.findByType(FinancePagination);
    expect(paging.props.page).toBe(1);
    expect(paging.props.total).toBe(1);
    await change("administrator-status-filter", "disabled");
    expect(text(view!.root)).toContain("没有匹配的管理员");
    await click("清除筛选");
    expect(view!.root.findByType(FinancePagination).props.total).toBe(25);
    await change("administrator-search", "人员25");
    expect(view!.root.findByType(FinancePagination).props.total).toBe(1);
  });

  it("查询loading/error/空态区别清晰，错误不冒充无数据，重试可操作", async () => {
    mocks.loading = true;
    await mount();
    expect(text(view!.root)).toContain("正在加载管理员账号");
    mocks.loading = false;
    mocks.queryError = {
      data: { code: "INTERNAL_SERVER_ERROR" },
      message: "private database",
    };
    await rerender();
    expect(text(view!.root)).toContain("管理员列表加载失败");
    expect(text(view!.root)).not.toContain("暂无管理员账号");
    expect(text(view!.root)).not.toContain("张管理");
    expect(button("新增管理员").props.disabled).toBe(true);
    await click("重试加载");
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    mocks.queryError = null;
    mocks.rows = [];
    await rerender();
    expect(text(view!.root)).toContain("暂无管理员账号");
    expect(button("新增管理员").props.disabled).toBe(false);
  });

  it("父级脏状态从开窗到pending保持保护、窗口关闭及卸载回传false", async () => {
    const dirty = vi.fn();
    await mount({ onDirtyChange: dirty });
    expect(dirty).toHaveBeenLastCalledWith(false);
    await click("新增管理员");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await click("取消");
    expect(dirty).toHaveBeenLastCalledWith(false);
    await click("配置张管理权限");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => view!.unmount());
    view = undefined;
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
});
