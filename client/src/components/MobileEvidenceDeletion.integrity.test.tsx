import React from "react";
import { createRequire } from "node:module";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create, act } = createRequire(import.meta.url)("react-test-renderer") as typeof import("react-test-renderer");

type EvidenceFixture = {
  id: number;
  fileName: string;
  sourceType: "site_photo";
  sourceId: string | null;
  sourceAssociationStatus?: "unassigned" | "referenced" | "unverified_marker";
  canDelete?: boolean;
  deletionBlockedReason?: string | null;
  description: string;
  capturedAt: string;
};
type DeletionCallbacks = {
  onSuccess: () => Promise<void>;
  onError: (error: unknown) => void;
  onSettled: () => void;
};

const mock = vi.hoisted(() => ({
  list: {
    data: [] as EvidenceFixture[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  projects: [{ id: 10, name: "已授权项目甲" }],
  mutation: { isPending: false, mutate: vi.fn() },
  deletionCallbacks: undefined as DeletionCallbacks | undefined,
  deleteUseMutation: vi.fn(),
  listUseQuery: vi.fn(),
  unrelatedMutate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  navigate: vi.fn(),
}));

// Only boundary hooks and UI primitives are replaced. EvidenceWorkspace,
// canRequestEvidenceDeletion, error formatting and all deletion handlers stay real.
vi.mock("@/lib/trpc", () => ({
  trpc: {
    evidence: {
      projectOptions: { useQuery: () => ({ data: mock.projects, isLoading: false, refetch: vi.fn() }) },
      captureConfig: { useQuery: () => ({ data: undefined, isError: false }) },
      list: { useQuery: (input: unknown, options: unknown) => {
        mock.listUseQuery(input, options);
        return mock.list;
      } },
      delete: { useMutation: (options: DeletionCallbacks) => {
        mock.deleteUseMutation(options);
        mock.deletionCallbacks = options;
        return mock.mutation;
      } },
      upload: { useMutation: () => ({ isPending: false, mutateAsync: mock.unrelatedMutate }) },
      ocr: { useMutation: () => ({ isPending: false, mutate: mock.unrelatedMutate }) },
    },
    location: {
      reverseGeocode: { useMutation: () => ({ isPending: false, mutate: mock.unrelatedMutate }) },
    },
  },
}));
vi.mock("../_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7, name: "授权取证人员" },
    isAuthenticated: true,
    loading: false,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/mobile/evidence?projectId=10", mock.navigate] }));
vi.mock("sonner", () => ({
  toast: { error: mock.toastError, success: mock.toastSuccess, warning: mock.toastWarning },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ variant: _variant, size: _size, ...props }: any) => <button {...props} />,
}));
vi.mock("@/components/ui/card", () => {
  const Block = (props: any) => <div {...props} />;
  return { Card: Block, CardContent: Block };
});
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }));
vi.mock("@/components/ui/label", () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock("@/components/ui/select", () => {
  const Block = ({ children }: any) => <div>{children}</div>;
  return { Select: Block, SelectContent: Block, SelectItem: Block, SelectTrigger: Block, SelectValue: Block };
});
vi.mock("@/components/ui/alert-dialog", async () => {
  const ReactModule = await import("react");
  const CloseContext = ReactModule.createContext<() => void>(() => {});
  const Block = (props: any) => <div {...props} />;
  return {
    AlertDialog: ({ open, onOpenChange, children }: any) => (
      <CloseContext.Provider value={() => onOpenChange(false)}>
        <Block data-evidence-dialog data-open={open} onClose={() => onOpenChange(false)}>
          {open ? children : null}
        </Block>
      </CloseContext.Provider>
    ),
    AlertDialogCancel: ({ children, ...props }: any) => {
      const close = ReactModule.useContext(CloseContext);
      return <button {...props} onClick={close}>{children}</button>;
    },
    // Do not supply a pending lock in the primitive: repeated calls must be
    // rejected by the real workspace's synchronous useRef guard itself.
    AlertDialogAction: (props: any) => <button {...props} />,
    AlertDialogContent: Block,
    AlertDialogDescription: Block,
    AlertDialogFooter: Block,
    AlertDialogHeader: Block,
    AlertDialogTitle: Block,
  };
});

import { EvidenceWorkspace } from "../pages/MobileEvidencePage";

function evidenceFixture(overrides: Partial<EvidenceFixture> = {}): EvidenceFixture {
  return {
    id: 101,
    fileName: "original-site-photo.jpg",
    sourceType: "site_photo",
    sourceId: null,
    sourceAssociationStatus: "unassigned",
    canDelete: true,
    deletionBlockedReason: null,
    description: "已核验无业务引用的现场影像",
    capturedAt: "2026-11-24T05:00:00.000Z",
    ...overrides,
  };
}

let tree: ReactTestRenderer | undefined;
const root = () => tree!.root;
const text = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");
const button = (label: string) => {
  const found = root().findAllByType("button").find(node => text(node) === label);
  if (!found) throw new Error(`Expected real workspace button: ${label}`);
  return found;
};
const listButtons = () => root().findAllByType("button").filter(node => text(node) === "删除取证记录");
const dialog = () => root().findByProps({ "data-evidence-dialog": true });
const reasonInput = () => root().findAllByType("textarea").find(node =>
  node.props.placeholder === "例如：重复上传，已保留正确影像记录 #123"
)!;
const clickEvent = () => ({ preventDefault: vi.fn() });
const callbacks = () => {
  if (!mock.deletionCallbacks) throw new Error("The real useMutation options were not registered");
  return mock.deletionCallbacks;
};
async function mount() {
  await act(async () => { tree = create(<EvidenceWorkspace />); });
}
async function rerender() {
  await act(async () => { tree!.update(<EvidenceWorkspace />); });
}
async function open(index = 0) {
  await act(async () => { listButtons()[index].props.onClick(); });
}
async function editReason(value: string) {
  await act(async () => { reasonInput().props.onChange({ target: { value } }); });
}
async function submit() {
  await act(async () => { button("确认受控删除").props.onClick(clickEvent()); });
}
function expectOpenWithOriginalReason(reason: string) {
  expect(dialog().props["data-open"]).toBe(true);
  expect(text(dialog())).toContain("original-site-photo.jpg");
  expect(reasonInput().props.value).toBe(reason);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.list.data = [evidenceFixture(), evidenceFixture({ id: 102, fileName: "other-site-photo.jpg" })];
  mock.list.isLoading = false;
  mock.list.isFetching = false;
  mock.list.isError = false;
  mock.list.error = null;
  mock.list.refetch.mockReset().mockResolvedValue({ data: mock.list.data });
  mock.mutation.isPending = false;
  mock.deletionCallbacks = undefined;
});
afterEach(async () => {
  if (tree) await act(async () => { tree!.unmount(); });
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("真实 EvidenceWorkspace：同步受控删除锁", () => {
  it("授权项目、真实 canDelete 和 unassigned 允许打开；注册真实 mutation 回调", async () => {
    await mount();
    expect(mock.listUseQuery).toHaveBeenCalledWith({ projectId: 10, limit: 50 }, { enabled: true, retry: false });
    expect(listButtons()[0].props.disabled).toBe(false);
    await open();
    expectOpenWithOriginalReason("");
    expect(button("确认受控删除").props.disabled).toBe(true);
    expect(mock.deleteUseMutation).toHaveBeenCalledWith({
      onSuccess: expect.any(Function), onError: expect.any(Function), onSettled: expect.any(Function),
    });
    expect(mock.mutation.mutate).not.toHaveBeenCalled();
  });

  it("isPending 恒 false、同帧两次调用原点击 handler，只发送一次 mutate", async () => {
    await mount(); await open(); await editReason("  重复上传，保留正确影像 #202  ");
    const handler = button("确认受控删除").props.onClick;
    const first = clickEvent(); const second = clickEvent();
    await act(async () => {
      handler(first);
      handler(second); // No await, timer, render, pending transition or mock lock.
    });
    expect(mock.mutation.isPending).toBe(false);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mock.mutation.mutate).toHaveBeenCalledWith({ id: 101, deletionReason: "重复上传，保留正确影像 #202" });
    expectOpenWithOriginalReason("  重复上传，保留正确影像 #202  ");
    expect(mock.list.refetch).not.toHaveBeenCalled();
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.unrelatedMutate).not.toHaveBeenCalled();
  });

  it("同帧 submit 后关闭/取消/列表另开被 ref 阻止，原对话框和原因不被清空", async () => {
    await mount(); await open(); await editReason("重复归档已核对原始记录");
    const confirm = button("确认受控删除").props.onClick;
    const close = dialog().props.onClose;
    const cancel = button("取消").props.onClick;
    const switchRecord = listButtons()[1].props.onClick;
    await act(async () => {
      confirm(clickEvent());
      close();
      cancel();
      switchRecord();
      confirm(clickEvent());
    });
    expect(mock.mutation.isPending).toBe(false);
    expectOpenWithOriginalReason("重复归档已核对原始记录");
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mock.mutation.mutate).toHaveBeenCalledWith({ id: 101, deletionReason: "重复归档已核对原始记录" });
    expect(mock.list.refetch).not.toHaveBeenCalled();
    // Repeat across a later render, still without isPending becoming true.
    await rerender();
    await act(async () => { dialog().props.onClose(); listButtons()[1].props.onClick(); });
    expectOpenWithOriginalReason("重复归档已核对原始记录");
  });

  it("异步 isPending=true 时同样不能取消、关闭、切换或重复提交", async () => {
    await mount(); await open(); await editReason("重复归档已核对原始记录"); await submit();
    mock.mutation.isPending = true;
    await rerender();
    expect(button("取消").props.disabled).toBe(true);
    expect(button("正在受控删除…").props.disabled).toBe(true);
    expect(listButtons()[1].props.disabled).toBe(true);
    await act(async () => {
      button("取消").props.onClick();
      dialog().props.onClose();
      listButtons()[1].props.onClick();
      button("正在受控删除…").props.onClick(clickEvent());
    });
    expectOpenWithOriginalReason("重复归档已核对原始记录");
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mock.list.refetch).not.toHaveBeenCalled();
  });

  it("CONFLICT onError 保留原原因、未 settled 不可重试；onSettled 后可重试且仍防同帧重复", async () => {
    const reason = "  重复上传已保留正确影像 #202  ";
    await mount(); await open(); await editReason(reason); await submit();
    const error = Object.assign(new Error("该影像已有业务或历史引用，请刷新后核验"), { data: { code: "CONFLICT" } });
    await act(async () => { callbacks().onError(error); });
    expect(mock.toastError).toHaveBeenCalledWith("该影像已有业务或历史引用，请刷新后核验");
    expectOpenWithOriginalReason(reason);
    await submit();
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(1);
    await act(async () => { callbacks().onSettled(); });
    expectOpenWithOriginalReason(reason);
    expect(button("确认受控删除").props.disabled).toBe(false);
    const retry = button("确认受控删除").props.onClick;
    await act(async () => { retry(clickEvent()); retry(clickEvent()); });
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(2);
    expect(mock.mutation.mutate.mock.calls).toEqual([
      [{ id: 101, deletionReason: reason.trim() }],
      [{ id: 101, deletionReason: reason.trim() }],
    ]);
    expect(mock.mutation.isPending).toBe(false);
    expectOpenWithOriginalReason(reason);
    expect(mock.list.refetch).not.toHaveBeenCalled();
    expect(mock.toastSuccess).not.toHaveBeenCalled();
  });

  it("只有 onSuccess 关闭并清原因、refetch 一次；refetch 完成后提示成功，settled 允许新操作", async () => {
    let finishRefetch!: () => void;
    mock.list.refetch.mockImplementation(() => new Promise<void>(resolve => { finishRefetch = resolve; }));
    await mount(); await open(); await editReason("重复上传已保留正确影像"); await submit();
    expectOpenWithOriginalReason("重复上传已保留正确影像");
    expect(mock.list.refetch).not.toHaveBeenCalled();
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    let success!: Promise<void>;
    await act(async () => { success = callbacks().onSuccess(); });
    expect(dialog().props["data-open"]).toBe(false);
    expect(mock.list.refetch).toHaveBeenCalledTimes(1);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    await act(async () => { finishRefetch(); await success; callbacks().onSettled(); });
    expect(mock.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mock.toastSuccess).toHaveBeenCalledWith("现场影像已删除，操作已记录审计");
    await open(1);
    expect(dialog().props["data-open"]).toBe(true);
    expect(text(dialog())).toContain("other-site-photo.jpg");
    expect(reasonInput().props.value).toBe("");
    expect(button("确认受控删除").props.disabled).toBe(true);
    await editReason("其他重复影像已核对"); await submit();
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(2);
    expect(mock.mutation.mutate).toHaveBeenLastCalledWith({ id: 102, deletionReason: "其他重复影像已核对" });
    expect(mock.list.refetch).toHaveBeenCalledTimes(1);
  });

  it("未提交时允许取消，关闭后重新打开不残留旧原因", async () => {
    await mount(); await open(); await editReason("还未提交的删除原因");
    await act(async () => { button("取消").props.onClick(); });
    expect(dialog().props["data-open"]).toBe(false);
    await open();
    expectOpenWithOriginalReason("");
    expect(mock.mutation.mutate).not.toHaveBeenCalled();
    expect(mock.list.refetch).not.toHaveBeenCalled();
  });
});

describe("真实 EvidenceWorkspace：授权、来源与台账 guard 负例", () => {
  const forbiddenRows: Array<[string, Partial<EvidenceFixture>]> = [
    ["unassigned 但无 canDelete 授权", { canDelete: false }],
    ["unassigned 但 canDelete 缺失", { canDelete: undefined }],
    ["当前或历史引用，即使 canDelete=true", { sourceAssociationStatus: "referenced" }],
    ["来源标记未核验，即使 canDelete=true", { sourceAssociationStatus: "unverified_marker", sourceId: "free-marker-1" }],
    ["来源状态缺失，即使 canDelete=true", { sourceAssociationStatus: undefined }],
    ["有真实阻断原因，即使 unassigned/canDelete=true", { deletionBlockedReason: "审计保留期未届满" }],
  ];
  it.each(forbiddenRows)("%s：disabled 和真实列表 handler 都拒绝打开", async (_label, overrides) => {
    mock.list.data = [evidenceFixture(overrides)];
    await mount();
    expect(listButtons()[0].props.disabled).toBe(true);
    // Invoke the actual handler even though the UI is disabled: the guard must
    // enforce the rule, not merely depend on native button suppression.
    await open();
    expect(dialog().props["data-open"]).toBe(false);
    expect(mock.mutation.mutate).not.toHaveBeenCalled();
    expect(mock.list.refetch).not.toHaveBeenCalled();
  });

  it.each(["isFetching", "isError"] as const)("台账 %s：旧允许删除数据不能打开", async flag => {
    mock.list[flag] = true;
    await mount();
    expect(listButtons()[0].props.disabled).toBe(true);
    await open();
    expect(dialog().props["data-open"]).toBe(false);
    expect(mock.mutation.mutate).not.toHaveBeenCalled();
  });

  const guardChanges: Array<[string, () => void]> = [
    ["撤回 canDelete", () => { mock.list.data[0].canDelete = false; }],
    ["新增当前/历史引用", () => { mock.list.data[0].sourceAssociationStatus = "referenced"; }],
    ["来源退回待核验", () => { mock.list.data[0].sourceAssociationStatus = "unverified_marker"; }],
    ["来源状态缺失", () => { mock.list.data[0].sourceAssociationStatus = undefined; }],
    ["新增审计阻断原因", () => { mock.list.data[0].deletionBlockedReason = "保留期尚未届满"; }],
    ["候选记录不在当前台账", () => { mock.list.data = mock.list.data.filter(row => row.id !== 101); }],
    ["刷新进行中", () => { mock.list.isFetching = true; }],
    ["台账查询失败", () => { mock.list.isError = true; mock.list.error = new Error("台账加载失败"); }],
  ];
  it.each(guardChanges)("打开后%s：重新核验真实候选，拒绝提交而保留原因", async (_label, change) => {
    await mount(); await open(); await editReason("已填写但尚未提交的原因");
    change(); await rerender();
    expectOpenWithOriginalReason("已填写但尚未提交的原因");
    expect(button("确认受控删除").props.disabled).toBe(true);
    expect(text(dialog())).toContain("当前记录已不可删除");
    if (mock.list.data[0]?.deletionBlockedReason) {
      expect(text(dialog())).toContain(mock.list.data[0].deletionBlockedReason);
    }
    await submit();
    expect(mock.mutation.mutate).not.toHaveBeenCalled();
    expect(mock.list.refetch).not.toHaveBeenCalled();
  });
});

describe("真实 EvidenceWorkspace：删除原因输入边界", () => {
  it.each(["", "     ", "删", "重复上传", "  abcd  "])("trim 后不足 5 字 %j：按钮和真实 handler 都拒绝提交", async reason => {
    await mount(); await open(); await editReason(reason);
    expect(reasonInput().props.maxLength).toBe(500);
    expect(button("确认受控删除").props.disabled).toBe(true);
    await submit();
    expectOpenWithOriginalReason(reason);
    expect(mock.mutation.mutate).not.toHaveBeenCalled();
    expect(mock.list.refetch).not.toHaveBeenCalled();
  });

  it.each([
    ["恰好 5 字", "  重复上传了  ", "重复上传了"],
    ["500 字原生输入上限", "核".repeat(500), "核".repeat(500)],
  ])("%s：真实 handler 发送 trim 后原因", async (_label, value, expected) => {
    await mount(); await open(); await editReason(value);
    expect(reasonInput().props.maxLength).toBe(500);
    expect(button("确认受控删除").props.disabled).toBe(false);
    await submit();
    expect(mock.mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mock.mutation.mutate).toHaveBeenCalledWith({ id: 101, deletionReason: expected });
    expectOpenWithOriginalReason(value);
    expect(mock.list.refetch).not.toHaveBeenCalled();
  });
});
