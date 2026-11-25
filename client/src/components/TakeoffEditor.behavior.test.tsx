import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TakeoffDetail, TakeoffSaveInput } from "@/lib/takeoffEditorModel";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), printFetch: vi.fn(), print: vi.fn(), upload: vi.fn(), config: { data: { camera: { enabled: true }, location: { required: false } }, isLoading: false, isError: false }, requestClose: vi.fn(), protection: null as any, readPhoto: vi.fn(), coordinates: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/ui/dialog", () => ({
  useDialogComposition: () => ({ isComposing: () => false, justEndedComposing: () => false, setComposing: () => {}, markCompositionEnd: () => {} }),
  Dialog: ({ children, ...props }: any) => <section data-test="dialog" {...props}>{children}</section>,
  DialogContent: ({ children, ...props }: any) => <div data-test="content" {...props}>{children}</div>,
  DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>, DialogFooter: ({ children, ...props }: any) => <footer {...props}>{children}</footer>,
}));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ measurement: { getTakeoffDetail: { fetch: mocks.fetch }, getTakeoffPrint: { fetch: mocks.printFetch } } }), measurement: { uploadTakeoffAttachment: { useMutation: () => ({ mutateAsync: mocks.upload }) }, captureConfig: { useQuery: () => mocks.config } } } }));
vi.mock("@/contexts/MobileFormProtectionContext", () => ({ useMobileFormProtection: (value: any) => { mocks.protection = value; return { requestClose: (close: () => void) => { mocks.requestClose(); close(); } }; } }));
vi.mock("@/components/TakeoffPhotos", async importOriginal => ({ ...(await importOriginal<any>()), readTakeoffPhoto: mocks.readPhoto, takeoffCoordinates: mocks.coordinates }));
vi.mock("@/lib/measurementTakeoffPrint", () => ({ printTakeoffDetail: mocks.print }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
import { TakeoffEditor } from "./TakeoffEditor";
import { TakeoffDetailDialog } from "./TakeoffDetailDialog";
const version = "sha256:" + "a".repeat(64);
function detail(status = "draft", oldPhotos = 1): TakeoffDetail {
  return { project: { id: 7, name: "道路项目" }, submittedByName: "录入人", reviewedByName: null,
    evidences: Array.from({ length: oldPhotos }, (_, i) => ({ evidenceId: i + 1, fileName: `old-${i}.png`, mimeType: "image/png", url: `/api/measurement-takeoff/preview/old-${i}`, capturedAt: null, description: null })),
    record: { id: 12, projectId: 7, takeoffNo: "SF-REAL", measurementClaimId: 3, workItem: "原始工程", workLocation: "K12+300", unit: "m3", quantity: "12.5", unitPrice: "2", declaredAmount: "25", takeoffDate: "2026-11-25", status, submittedBy: 1, reviewedBy: null, reviewedAt: null, reviewNote: null, lockedAt: null, createdAt: "2026-11-25", updatedAt: "2026-11-25", workDescription: "真实内容", measurementBasis: "图纸", measurementRows: [], version } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let view: TestRenderer.ReactTestRenderer | undefined;
const close = vi.fn(); const saved = vi.fn(); const save = vi.fn<(input: TakeoffSaveInput) => Promise<unknown>>();
const text = (v: any): string => Array.isArray(v) ? v.map(text).join("") : typeof v === "string" || typeof v === "number" ? String(v) : v?.props ? text(v.props.children) : "";
const button = (label: string) => view!.root.findAllByType("button").find(n => text(n.props.children) === label)!;
const field = (id: string) => view!.root.findByProps({ id });
const tick = async () => { await act(async () => { await Promise.resolve(); }); };
async function mount(props: Partial<React.ComponentProps<typeof TakeoffEditor>> = {}) { await act(async () => { view = TestRenderer.create(<TakeoffEditor projectId={7} projectName="道路项目" sessionIdentity={1} save={save} onClose={close} onSaved={saved} {...props} />); }); }
async function fill() { for (const [id, value] of [["takeoff-item", "路基填筑"], ["takeoff-position", "K9+200"], ["takeoff-quantity", "10"], ["takeoff-price", "2"]]) await act(async () => field(id).props.onChange({ target: { value } })); }
function choose(files: any[]) { view!.root.findByProps({ "aria-label": "相册照片文件" }).props.onChange({ target: { files, value: "x" } }); }
beforeEach(() => {
  vi.clearAllMocks(); save.mockResolvedValue({ success: true }); mocks.fetch.mockResolvedValue(detail()); mocks.printFetch.mockResolvedValue(detail()); mocks.upload.mockResolvedValue({ success: true, evidenceId: 80, fileName: "new.png", mimeType: "image/png" }); mocks.readPhoto.mockResolvedValue({ mimeType: "image/png", base64Data: "bytes" }); mocks.coordinates.mockResolvedValue(undefined); mocks.print.mockResolvedValue(undefined);
  mocks.config = { data: { camera: { enabled: true }, location: { required: false } }, isLoading: false, isError: false };
  vi.stubGlobal("React", React);
  const values = new Map<string, string>(); vi.stubGlobal("window", { confirm: vi.fn(() => true), localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("挂载共享收方编辑器", () => {
  it("四分区挂载，新增双击只保存一次且pending不能取消/X/Escape/outside", async () => {
    const gate = deferred<unknown>(); save.mockReturnValue(gate.promise); await mount(); await fill();
    const submit = button("保存收方草稿").props.onClick;
    await act(async () => { submit(); submit(); });
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].documentRequestKey).toBeTruthy();
    expect(button("取消").props.disabled).toBe(true); await act(async () => button("取消").props.onClick()); expect(close).not.toHaveBeenCalled();
    const content = view!.root.findByProps({ "data-test": "content" }); expect(content.props.showCloseButton).toBe(false);
    const preventDefault = vi.fn(); content.props.onEscapeKeyDown({ preventDefault }); content.props.onInteractOutside({ preventDefault }); expect(preventDefault).toHaveBeenCalledTimes(2);
    await act(async () => gate.resolve({})); expect(saved).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it("手机pending直接拒绝关闭，不启动草稿退出流程", async () => {
    const gate = deferred<unknown>(); save.mockReturnValue(gate.promise); await mount({ mobile: true }); await fill(); await act(async () => button("保存草稿").props.onClick());
    await act(async () => button("取消").props.onClick()); expect(mocks.requestClose).not.toHaveBeenCalled();
    await act(async () => mocks.protection.discard()); expect(close).not.toHaveBeenCalled(); await act(async () => gate.resolve({}));
  });
  it("编辑fresh读取详情，使用真实强version和原关联", async () => {
    await mount({ id: 12 }); expect(mocks.fetch).toHaveBeenCalledWith({ projectId: 7, id: 12 }, { staleTime: 0 });
    await act(async () => button("保存收方草稿").props.onClick());
    expect(save.mock.calls[0][0]).toMatchObject({ id: 12, expectedVersion: version, measurementClaimId: 3, workDescription: "真实内容", measurementBasis: "图纸" });
    expect(save.mock.calls[0][0]).not.toHaveProperty("documentRequestKey");
  });
  it("后端返回非可编辑或缺版本记录不允许保存", async () => {
    mocks.fetch.mockResolvedValue(detail("locked")); await mount({ id: 12 }); expect(button("保存收方草稿").props.disabled).toBe(true); expect(view!.root.findByProps({ role: "alert" })).toBeTruthy();
    mocks.fetch.mockResolvedValue({ ...detail(), record: { ...detail().record, version: "" } }); await act(async () => button("重新读取").props.onClick()); expect(button("保存收方草稿").props.disabled).toBe(true); expect(save).not.toHaveBeenCalled();
  });
  it("上传双击singleflight，第二张失败仍保留第一张ID和表单，重试保存失败不丢照片", async () => {
    const gate = deferred<any>(); mocks.upload.mockReturnValueOnce(gate.promise).mockRejectedValueOnce(new Error("第二张失败")); await mount(); await fill();
    await act(async () => { choose([{ name: "a.png" }, { name: "b.png" }]); choose([{ name: "duplicate.png" }]); }); expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(button("取消").props.disabled).toBe(true);
    await act(async () => gate.resolve({ success: true, evidenceId: 80, fileName: "a.png", mimeType: "image/png" })); await tick();
    expect(mocks.upload).toHaveBeenCalledTimes(2); expect(field("takeoff-item").props.value).toBe("路基填筑");
    save.mockRejectedValueOnce(new Error("网络失败")); await act(async () => button("保存收方草稿").props.onClick());
    expect(save.mock.calls[0][0].attachmentEvidenceIds).toEqual([80]); const key = save.mock.calls[0][0].documentRequestKey;
    await act(async () => button("保存收方草稿").props.onClick()); expect(save.mock.calls[1][0].attachmentEvidenceIds).toEqual([80]); expect(save.mock.calls[1][0].documentRequestKey).toBe(key);
  });
  it("新建失败后改内容换requestKey", async () => {
    await mount(); await fill(); save.mockRejectedValueOnce(new Error("网络失败")); await act(async () => button("保存收方草稿").props.onClick());
    await act(async () => field("takeoff-description").props.onChange({ target: { value: "改过内容" } })); await act(async () => button("保存收方草稿").props.onClick()); expect(save.mock.calls[1][0].documentRequestKey).not.toBe(save.mock.calls[0][0].documentRequestKey);
  });
  it("原有23张图片完整保留仍可新增，保存只新增IDs", async () => {
    mocks.fetch.mockResolvedValue(detail("draft", 23)); await mount({ id: 12 }); expect(view!.root.findAllByType("img")).toHaveLength(23);
    await act(async () => choose([{ name: "new.png" }])); await tick(); await act(async () => button("保存收方草稿").props.onClick());
    expect(save.mock.calls[0][0].attachmentEvidenceIds).toEqual([80]); expect(save.mock.calls[0][0]).not.toHaveProperty("deleteEvidenceIds");
  });
  it.each(["disabled", "error", "loading"])("现场配置%s时拒绝图片归档", async kind => {
    if (kind === "disabled") mocks.config.data.camera.enabled = false; if (kind === "error") mocks.config.isError = true; if (kind === "loading") mocks.config.isLoading = true;
    await mount(); await act(async () => choose([{ name: "new.png" }])); expect(mocks.upload).not.toHaveBeenCalled(); expect(view!.root.findByProps({ role: "alert" })).toBeTruthy();
  });
  it("要求定位明确获取真定位，拒绝时不上传", async () => {
    mocks.config.data.location.required = true; mocks.coordinates.mockRejectedValue(new Error("定位拒绝")); await mount(); await act(async () => choose([{ name: "new.png" }])); await tick(); expect(mocks.coordinates).toHaveBeenCalledWith(true); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("上传归属当前项目与编辑父单，全部完成ID保存", async () => {
    mocks.coordinates.mockResolvedValue({ longitude: 112, latitude: 28 }); mocks.config.data.location.required = true; mocks.upload.mockResolvedValueOnce({ evidenceId: 81, fileName: "a.png", mimeType: "image/png" }).mockResolvedValueOnce({ evidenceId: 82, fileName: "b.png", mimeType: "image/png" });
    await mount({ id: 12 }); await act(async () => choose([{ name: "a.png" }, { name: "b.png" }])); await tick(); expect(mocks.upload.mock.calls[0][0]).toMatchObject({ projectId: 7, takeoffId: 12, longitude: 112, latitude: 28, mimeType: "image/png" });
    await act(async () => button("保存收方草稿").props.onClick()); expect(save.mock.calls[0][0].attachmentEvidenceIds).toEqual([81, 82]);
  });
  it("关闭未完成详情读取取消迟到，不填旧记录", async () => {
    const gate = deferred<TakeoffDetail>(); mocks.fetch.mockReturnValue(gate.promise); await mount({ id: 12 }); await act(async () => button("取消").props.onClick()); expect(close).toHaveBeenCalledOnce(); await act(async () => gate.resolve(detail())); expect(save).not.toHaveBeenCalled(); expect(view!.root.findAllByProps({ id: "takeoff-item" })).toHaveLength(0);
  });
  it("卸载期间上传返回不创建预览、不完成保存", async () => {
    const gate = deferred<any>(); mocks.upload.mockReturnValue(gate.promise); await mount(); await act(async () => choose([{ name: "new.png" }])); await act(async () => view!.unmount()); view = undefined;
    await act(async () => gate.resolve({ evidenceId: 81, fileName: "new.png", mimeType: "image/png" })); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("换项目期间旧保存返回不清新项目草稿、不关闭新会话、不刷新", async () => {
    const gate = deferred<unknown>(); save.mockReturnValue(gate.promise); await mount(); await fill(); await act(async () => button("保存收方草稿").props.onClick());
    await act(async () => view!.update(<TakeoffEditor projectId={8} projectName="新项目" sessionIdentity={1} save={save} onClose={close} onSaved={saved} />));
    await act(async () => gate.resolve({})); expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled(); expect(field("takeoff-item").props.value).toBe("");
  });
  it("换登录身份期间旧上传不展示", async () => {
    const gate = deferred<any>(); mocks.upload.mockReturnValue(gate.promise); await mount(); await act(async () => choose([{ name: "new.png" }]));
    await act(async () => view!.update(<TakeoffEditor projectId={7} projectName="道路项目" sessionIdentity={2} save={save} onClose={close} onSaved={saved} />));
    await act(async () => gate.resolve({ evidenceId: 81, fileName: "new.png", mimeType: "image/png" })); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("手机保存普通字段完整恢复，旧草稿兼容且不存ID/bytes/url", async () => {
    window.localStorage.setItem("yx-mobile-draft:v1:measurement-takeoff:7:new", JSON.stringify({ version: 1, savedAt: Date.now(), value: { workItem: "旧工程", workLocation: "旧里程", quantity: "3", unitPrice: "2", measurementClaimId: "99", attachmentEvidenceIds: [5], url: "secret" } }));
    await mount({ mobile: true }); expect(field("takeoff-item").props.value).toBe("旧工程"); expect(field("takeoff-position").props.value).toBe("旧里程"); expect(field("takeoff-claim").props.value).toBe("");
    await act(async () => choose([{ name: "new.png" }])); await tick(); await act(async () => button("保存本机草稿").props.onClick());
    const raw = window.localStorage.getItem("yx-mobile-draft:v1:measurement-takeoff:7:new")!; expect(raw).toContain("workPosition"); expect(raw).not.toMatch(/attachmentEvidenceIds|evidenceId|base64|blob:|secret|measurementClaimId/);
  });
});
describe("挂载详情与fresh A4打印", () => {
  async function mountDetail(autoPrint = false) { await act(async () => { view = TestRenderer.create(<TakeoffDetailDialog projectId={7} id={12} sessionIdentity={1} onClose={close} autoPrint={autoPrint} />); }); }
  it("每次打印fresh getTakeoffPrint而非详情缓存，双击singleflight", async () => {
    const gate = deferred<TakeoffDetail>(); mocks.printFetch.mockReturnValueOnce(gate.promise); await mountDetail();
    const click = button("A4 打印").props.onClick; await act(async () => { click(); click(); }); expect(mocks.printFetch).toHaveBeenCalledTimes(1);
    const fresh = detail("approved", 23); await act(async () => gate.resolve(fresh)); expect(mocks.print.mock.calls[0][0]).toBe(fresh);
    await act(async () => button("A4 打印").props.onClick()); expect(mocks.printFetch).toHaveBeenCalledTimes(2);
    expect(mocks.printFetch).toHaveBeenCalledWith({ projectId: 7, id: 12 }, { staleTime: 0 });
  });
  it("关闭时取消迟到打印API，不打开打印", async () => {
    const gate = deferred<TakeoffDetail>(); mocks.printFetch.mockReturnValue(gate.promise); await mountDetail(true); await act(async () => button("关闭").props.onClick()); await act(async () => gate.resolve(detail())); expect(mocks.print).not.toHaveBeenCalled();
  });
  it("打印加载图片期间关闭使isCurrent失效", async () => {
    const gate = deferred<void>(); mocks.print.mockReturnValue(gate.promise); await mountDetail(true); const current = mocks.print.mock.calls[0][1]; expect(current()).toBe(true); await act(async () => button("关闭").props.onClick()); expect(current()).toBe(false); await act(async () => gate.resolve());
  });
  it("fresh打印API失败可重试且不静默省略错误", async () => {
    mocks.printFetch.mockRejectedValueOnce(new Error("坏引用")); await mountDetail(true); expect(view!.root.findByProps({ role: "alert" })).toBeTruthy(); expect(mocks.print).not.toHaveBeenCalled(); await act(async () => button("A4 打印").props.onClick()); expect(mocks.print).toHaveBeenCalledOnce();
  });
  it("详情换项目和卸载隔离迟到响应", async () => {
    const gate = deferred<TakeoffDetail>(); mocks.fetch.mockReturnValueOnce(gate.promise); await mountDetail();
    await act(async () => view!.update(<TakeoffDetailDialog projectId={8} id={13} sessionIdentity={1} onClose={close} />)); await act(async () => gate.resolve(detail())); expect(mocks.fetch.mock.calls[1][0]).toEqual({ projectId: 8, id: 13 });
    await act(async () => view!.unmount()); view = undefined; expect(mocks.print).not.toHaveBeenCalled();
  });
});
