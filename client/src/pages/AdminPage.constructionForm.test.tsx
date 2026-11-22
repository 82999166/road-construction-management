import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const runtime = vi.hoisted(() => ({
  workspace: {} as any,
  save: vi.fn(),
  mutationOptions: {} as any,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 20, name: "项目管理员", role: "admin" },
  }),
}));
vi.mock("@/hooks/useManagementPermissions", () => ({
  useManagementPermissions: () => ({ isSuperAdmin: false }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/admin/construction", vi.fn()],
  Link: ({ children }: any) => children,
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: any) => <main>{children}</main>,
}));
vi.mock("@/components/ConstructionWorkspace", () => ({
  default: (props: any) => {
    runtime.workspace = props;
    return <div>施工工作区</div>;
  },
}));
vi.mock("@/components/ConstructionWorkAreaInput", () => ({
  ConstructionWorkAreaInput: ({ onChange, ...props }: any) => (
    <input
      aria-label="施工部位 / 作业面"
      {...props}
      onChange={(event: any) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/ui/dialog", () => {
  const shell = ({ children }: any) => <div>{children}</div>;
  return {
    useDialogComposition: () => null,
    Dialog: ({ open, children }: any) =>
      open ? <section data-dialog>{children}</section> : null,
    DialogContent: shell,
    DialogDescription: shell,
    DialogFooter: shell,
    DialogHeader: shell,
    DialogTitle: shell,
    DialogTrigger: shell,
    DialogClose: shell,
  };
});
vi.mock("@/components/ui/select", () => {
  const shell = ({ children }: any) => <div>{children}</div>;
  return {
    Select: shell,
    SelectContent: shell,
    SelectItem: shell,
    SelectTrigger: shell,
    SelectValue: () => null,
  };
});
vi.mock("@/lib/trpc", () => {
  const query = {
    data: undefined,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  const projects = {
    ...query,
    data: [{ id: 10, name: "授权项目", status: "active" }],
  };
  const capabilities = { ...query, data: { canCreate: true, canEdit: true } };
  const noop = vi.fn();
  const cache = new Map<string, any>();
  function node(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const proxy = new Proxy(noop, {
      get(_target, key) {
        if (key === "then") return undefined;
        if (key === "useUtils") return () => node("utils");
        if (key === "useQuery")
          return () =>
            path === "admin.project.listAccessible"
              ? projects
              : path === "construction.capabilities"
                ? capabilities
                : query;
        if (key === "useMutation")
          return (options: any) => {
            if (path === "construction.saveReport") {
              runtime.mutationOptions = options;
              return {
                mutate: runtime.save,
                mutateAsync: runtime.save,
                isPending: false,
              };
            }
            return { mutate: noop, mutateAsync: noop, isPending: false };
          };
        if (key === "invalidate") return async () => undefined;
        return node(path ? `${path}.${String(key)}` : String(key));
      },
    });
    cache.set(path, proxy);
    return proxy;
  }
  return { trpc: node("") };
});
import AdminPage from "./AdminPage";
let view: ReactTestRenderer | undefined;
const report = {
  id: 1,
  projectId: 10,
  status: "draft",
  reportDate: "2026-11-10",
  weather: "sunny",
  workArea: "已保存作业面",
  workContent: "旧完整施工内容",
  constructionPlan: "原有计划",
  safetyNotes: "旧安全必须保留",
  issueNotes: "历史问题",
  issuePriority: null,
  progressPercent: 8,
};
async function mount() {
  await act(async () => {
    view = TestRenderer.create(<AdminPage scopedSection="construction" />);
  });
}
async function create() {
  await act(async () => runtime.workspace.onCreate());
}
function button(label: string) {
  return view!.root
    .findAllByType("button")
    .find(n => n.children.some(child => child === label))!;
}
async function click(label: string) {
  await act(async () => button(label).props.onClick());
}
async function text(value: string, next: string) {
  await act(async () =>
    view!.root
      .findAllByType("textarea")
      .find(n => n.props.value === value)!
      .props.onChange({ target: { value: next } })
  );
}
async function choose(value: string) {
  await act(async () =>
    view!.root
      .findAllByType("input")
      .find(n => n.props.type === "radio" && n.props.value === value)!
      .props.onChange()
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    location: { search: "", pathname: "/admin/construction" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    confirm: vi.fn(() => true),
    localStorage: { getItem: vi.fn() },
  });
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(async () => {
  if (view) await act(async () => view!.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});
describe("PC日报表单真实行为", () => {
  it("新建一般默认与紧急保存，清空问题发送NULL而非一般；载荷不含安全", async () => {
    await mount();
    await create();
    expect(
      view!.root.findAllByType("input").find(n => n.props.value === "normal")!
        .props.checked
    ).toBe(true);
    await act(async () =>
      view!.root
        .findAllByType("input")
        .find(n => n.props["aria-label"] === "施工部位 / 作业面")!
        .props.onChange({ target: { value: "新作业面" } })
    );
    const areas = view!.root.findAllByType("textarea");
    await act(async () =>
      areas[0].props.onChange({ target: { value: "当天施工完整内容" } })
    );
    await act(async () =>
      areas[2].props.onChange({ target: { value: "当天问题" } })
    );
    await click("保存日报");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBe("normal");
    expect(runtime.save.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "safetyNotes"
    );
    await choose("urgent");
    await click("保存日报");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBe("urgent");
    await text("当天问题", " ");
    await click("保存日报");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBeNull();
    expect(runtime.save.mock.calls.at(-1)?.[0].issueNotes).toBeNull();
  });
  it("旧NULL保持未分级，未选择保存不改等级；施工正文计划仍完整", async () => {
    await mount();
    await act(async () => runtime.workspace.onEdit(report));
    expect(JSON.stringify(view!.toJSON())).toContain("历史未分级");
    await click("保存修改");
    const payload = runtime.save.mock.calls.at(-1)?.[0];
    expect(payload.issuePriority).toBeNull();
    expect(payload.workContent).toBe(report.workContent);
    expect(payload.constructionPlan).toBe(report.constructionPlan);
    expect(payload).not.toHaveProperty("safetyNotes");
    await choose("normal");
    await click("保存修改");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBe("normal");
  });
  it("PC内容计划问题顺序与手机一致，不存在安全录入控件，等级参与退出JSON snapshot", async () => {
    await mount();
    await act(async () => runtime.workspace.onEdit(report));
    expect(
      view!.root.findAllByType("textarea").map(n => n.props.value)
    ).toEqual([report.workContent, report.constructionPlan, report.issueNotes]);
    expect(JSON.stringify(view!.toJSON())).not.toContain("安全记录（可选）");
    const source = readFileSync(
      new URL("./AdminPage.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain(
      "JSON.stringify(constructionReportEditor) !== constructionEditorSnapshot"
    );
    expect(source).toContain("issuePriority: item.issuePriority ?? null");
    expect(source).toContain("safetyNotes: item.safetyNotes ??");
  });
});
