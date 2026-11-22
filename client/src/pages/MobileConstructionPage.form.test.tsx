import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const runtime = vi.hoisted(() => ({
  workspace: {} as any,
  protection: {} as any,
  auth: {
    user: { id: 20, name: "填报人" },
    isAuthenticated: true,
    loading: false,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
  },
  save: vi.fn(),
  remember: vi.fn(),
  savedDraft: null as any,
  draftWrite: vi.fn(),
  clearDraft: vi.fn(),
  mutationOptions: {} as any,
  smart: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => runtime.auth }));
vi.mock("@/hooks/useManagementPermissions", () => ({
  useManagementPermissions: () => ({ isSuperAdmin: false }),
}));
vi.mock("@/contexts/MobileFormProtectionContext", () => ({
  useMobileSafeNavigate: () => vi.fn(),
  useMobileFormProtection: (options: any) => {
    runtime.protection = options;
    return { requestClose: (next: any) => next() };
  },
}));
vi.mock("@/lib/mobileDraftStorage", async importOriginal => ({
  ...(await importOriginal<any>()),
  readMobileDraft: () => runtime.savedDraft,
  saveMobileDraft: (...args: any[]) => {
    runtime.draftWrite(...args);
    return true;
  },
  clearMobileDraft: runtime.clearDraft,
}));
vi.mock("@/lib/trpc", () => {
  const query = { data: undefined, isLoading: false, refetch: vi.fn() };
  const mutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  return {
    trpc: {
      useUtils: () => ({
        constructionAssistant: { history: { invalidate: vi.fn() } },
        construction: {
          listReports: { invalidate: vi.fn() },
          summary: { invalidate: vi.fn() },
        },
        mobile: { workbench: { invalidate: vi.fn() } },
      }),
      constructionAssistant: {
        remember: { useMutation: () => ({ mutateAsync: runtime.remember }) },
      },
      construction: {
        projectOptions: {
          useQuery: () => ({
            ...query,
            data: [{ id: 10, name: "授权项目", code: "A" }],
          }),
        },
        reportEvidence: { useQuery: () => query },
        resolveCurrentWeather: { useQuery: () => query },
        saveReport: {
          useMutation: (options: any) => {
            runtime.mutationOptions = options;
            return { mutate: runtime.save, isPending: false };
          },
        },
        transitionReport: { useMutation: mutation },
        submitReportForReview: { useMutation: mutation },
        reviewReport: { useMutation: mutation },
      },
      evidence: {
        captureConfig: { useQuery: () => query },
        upload: { useMutation: mutation },
      },
      location: { reverseGeocode: { useMutation: mutation } },
    },
  };
});
vi.mock("@/components/ConstructionWorkspace", () => ({
  default: (props: any) => {
    runtime.workspace = props;
    return <div>日报工作区</div>;
  },
}));
vi.mock("@/components/ConstructionSmartInput", () => ({
  ConstructionSmartInput: (props: any) => {
    runtime.smart(props);
    return <span data-smart-field={props.field} />;
  },
}));
// Work-area behavior is covered by its real component suite; this adapter only exposes the page's controlled wiring.
vi.mock("@/components/ConstructionWorkAreaInput", () => ({
  ConstructionWorkAreaInput: ({ onChange, ...props }: any) => (
    <input {...props} onChange={(event: any) => onChange(event.target.value)} />
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
import MobileConstructionPage, {
  parseConstructionReportDraft,
} from "./MobileConstructionPage";
let view: ReactTestRenderer | undefined;
const report = {
  id: 1,
  projectId: 10,
  createdBy: 20,
  reportDate: "2026-11-10",
  workArea: "历史路基作业面",
  weather: "sunny",
  workContent: "完整旧施工内容",
  constructionPlan: "原施工计划",
  issueNotes: "协调事项",
  issuePriority: null,
  safetyNotes: "旧安全记录必须保留",
  progressPercent: 12,
  status: "draft",
};
async function mount() {
  await act(async () => {
    view = TestRenderer.create(<MobileConstructionPage />);
  });
}
async function create() {
  await act(async () => runtime.workspace.onCreate());
}
async function edit() {
  const actions = runtime.workspace.renderMobileActions(report, {});
  await act(async () => {
    (actions.props.children[0] as any).props.onClick();
  });
}
function button(label: string) {
  return view!.root
    .findAllByType("button")
    .find(n => n.children.some(child => child === label))!;
}
async function click(label: string) {
  await act(async () => button(label).props.onClick());
}
async function input(id: string, value: string) {
  await act(async () =>
    view!.root
      .findAll(n => typeof n.type === "string" && n.props.id === id)[0]
      .props.onChange({ target: { value } })
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
function markup() {
  return JSON.stringify(view!.toJSON());
}
beforeEach(() => {
  vi.clearAllMocks();
  runtime.savedDraft = null;
  runtime.remember.mockResolvedValue({ success: true });
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
});
afterEach(async () => {
  if (view) await act(async () => view!.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});
describe("手机日报表单真实行为", () => {
  it("新建一般和紧急贯通save；空问题保存NULL且不发送safety", async () => {
    await mount();
    await create();
    expect(
      view!.root.findAllByType("input").find(n => n.props.value === "normal")!
        .props.checked
    ).toBe(true);
    expect(runtime.protection.isDirty).toBe(false);
    await input("report-area", "新手输作业面");
    await input("report-content", "当天完整施工内容");
    await input("report-issues", "等待协调");
    await click("保存草稿");
    expect(runtime.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        issuePriority: "normal",
        workArea: "新手输作业面",
        workContent: "当天完整施工内容",
      })
    );
    expect(runtime.save.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "safetyNotes"
    );
    await choose("urgent");
    await click("保存草稿");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBe("urgent");
    await input("report-issues", "  ");
    await click("保存草稿");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBeNull();
  });
  it("历史NULL编辑保持未分级，不默认一般；旧安全只留设备snapshot不发送也不记忆", async () => {
    await mount();
    await edit();
    expect(markup()).toContain("历史未分级");
    expect(
      view!.root
        .findAllByType("input")
        .filter(n => n.props.type === "radio")
        .every(n => !n.props.checked)
    ).toBe(true);
    await click("保存修改");
    const payload = runtime.save.mock.calls.at(-1)?.[0];
    expect(payload.issuePriority).toBeNull();
    expect(payload).not.toHaveProperty("safetyNotes");
    expect(payload.workContent).toBe(report.workContent);
    await click("保存本机草稿");
    const snapshot = runtime.draftWrite.mock.calls.at(-1)?.[1];
    expect(snapshot.safetyNotes).toBe(report.safetyNotes);
    expect(snapshot.issuePriority).toBeNull();
    expect(snapshot.draftVersion).toBe(2);
    expect(
      runtime.remember.mock.calls
        .at(-1)?.[0]
        .entries.some((entry: any) => entry.field === "safetyNotes")
    ).toBe(false);
    await choose("urgent");
    await click("保存修改");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBe("urgent");
  });
  it.each(["normal", "urgent", null])(
    "本机等级草稿恢复%j，并贯通退出保护快照",
    async priority => {
      runtime.savedDraft = {
        value: {
          reportDate: "2026-11-10",
          workArea: "草稿作业面",
          workContent: "恢复完整内容",
          issueNotes: "恢复问题",
          issuePriority: priority,
          draftVersion: 2,
        },
      };
      await mount();
      await create();
      expect(view!.root.findByProps({ id: "report-content" }).props.value).toBe(
        "恢复完整内容"
      );
      if (priority === null) expect(markup()).toContain("历史未分级");
      else
        expect(
          view!.root
            .findAllByType("input")
            .find(n => n.props.type === "radio" && n.props.value === priority)!
            .props.checked
        ).toBe(true);
      await act(async () => runtime.protection.saveDraft());
      expect(runtime.draftWrite.mock.calls.at(-1)?.[1].issuePriority).toBe(
        priority
      );
      expect(runtime.protection.isDirty).toBe(true);
    }
  );
  it("缺少等级旧草稿恢复NULL，校验异常字段而不自动一般", async () => {
    runtime.savedDraft = {
      value: {
        workContent: "老版本草稿完整施工内容",
        issueNotes: "旧问题",
        safetyNotes: "旧安全草稿",
      },
    };
    await mount();
    await create();
    expect(markup()).toContain("历史未分级");
    await click("保存草稿");
    expect(runtime.save.mock.calls.at(-1)?.[0].issuePriority).toBeNull();
    expect(
      parseConstructionReportDraft({
        issuePriority: "danger",
        weather: "unsafe",
        progressPercent: "NaN",
        workArea: 123,
      })
    ).toEqual({ issuePriority: null });
  });
  it("内容后接施工计划、没有安全输入；问题AI/语音与原正文均保留", async () => {
    await mount();
    await create();
    const ids = view!.root
      .findAll(
        n =>
          typeof n.type === "string" &&
          ["report-content", "report-plan", "report-issues"].includes(
            n.props.id
          )
      )
      .map(n => n.props.id);
    expect(ids).toEqual(["report-content", "report-plan", "report-issues"]);
    expect(
      view!.root.findAll(
        n => typeof n.type === "string" && n.props.id === "report-safety"
      )
    ).toHaveLength(0);
    expect(runtime.smart.mock.calls.map(call => call[0].field)).toContain(
      "issueNotes"
    );
    expect(runtime.smart.mock.calls.map(call => call[0].field)).not.toContain(
      "safetyNotes"
    );
    const source = readFileSync(
      new URL("./MobileConstructionPage.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("workContent: report.workContent");
    expect(source).toContain("localDraftPayload");
  });
});
