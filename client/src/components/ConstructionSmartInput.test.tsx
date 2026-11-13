import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConstructionAssistantStatus } from "@/lib/constructionSmartInput";
import type { ConstructionSpeechRecognition } from "@/hooks/useConstructionVoiceInput";

const rpc = vi.hoisted(() => ({
  status: vi.fn(),
  history: vi.fn(),
  forget: vi.fn(),
  assist: vi.fn(),
  transcribe: vi.fn(),
  statusHook: vi.fn(),
  historyHook: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    constructionAssistant: {
      status: { useQuery: rpc.statusHook },
      history: { useQuery: rpc.historyHook },
      forget: { useMutation: () => ({ mutateAsync: rpc.forget }) },
      assist: { useMutation: () => ({ mutateAsync: rpc.assist }) },
      transcribe: { useMutation: () => ({ mutateAsync: rpc.transcribe }) },
    },
  },
}));
import {
  ConstructionSmartInput,
  type ConstructionSmartInputProps,
} from "./ConstructionSmartInput";

const status: ConstructionAssistantStatus = {
  aiReady: true,
  cloudVoiceReady: true,
  aiDailyLimit: 10,
  aiUsed: 2,
  voiceDailyLimit: 5,
  voiceUsed: 1,
  message: "施工助手可用",
  historyEnabled: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeSpeech implements ConstructionSpeechRecognition {
  static instances: FakeSpeech[] = [];
  lang = "";
  continuous = true;
  interimResults = true;
  onresult: ConstructionSpeechRecognition["onresult"] = null;
  onerror: ConstructionSpeechRecognition["onerror"] = null;
  onend: ConstructionSpeechRecognition["onend"] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeSpeech.instances.push(this);
  }
}
class FakeMedia {
  static instances: FakeMedia[] = [];
  static isTypeSupported = (mime: string) => mime.startsWith("audio/webm");
  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
    FakeMedia.instances.push(this);
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  });
}
class FakeReader {
  readyState = 0;
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL() {
    this.readyState = 2;
    this.result = "data:audio/webm;base64,YXVkaW8=";
    queueMicrotask(() => this.onload?.());
  }
  abort() {
    this.readyState = 2;
    this.onabort?.();
  }
}
let view: ReactTestRenderer | undefined;
let props: ConstructionSmartInputProps;
let confirm: ReturnType<typeof vi.fn>;
let trackStop: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
async function mount(overrides: Partial<ConstructionSmartInputProps> = {}) {
  props = {
    projectId: 10,
    userId: 20,
    field: "workContent",
    value: "人工原文",
    onChange: vi.fn(),
    maxLength: 8000,
    active: true,
    ...overrides,
  };
  await act(async () => {
    view = TestRenderer.create(<ConstructionSmartInput {...props} />);
  });
}
async function update(overrides: Partial<ConstructionSmartInputProps>) {
  props = { ...props, ...overrides };
  await act(async () => {
    view!.update(<ConstructionSmartInput {...props} />);
  });
}
function text() {
  const paragraphs = view!.root
    .findAllByType("p")
    .map(node => node.children.join(""))
    .join("\n");
  return `${JSON.stringify(view!.toJSON())}\n${paragraphs}`;
}
function button(label: string) {
  return view!.root
    .findAllByType("button")
    .find(node => node.children.join("") === label)!;
}
async function click(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  expect(target.props.disabled, `${label} disabled`).not.toBe(true);
  await act(async () => {
    target.props.onClick();
  });
}
async function input(label: string, value: string) {
  await act(async () => {
    view!.root
      .findAll(
        node =>
          typeof node.type === "string" && node.props["aria-label"] === label
      )[0]
      .props.onChange({ target: { value } });
  });
}
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
async function openHistory() {
  await click("最近内容");
}
async function previewHistory(id = 1) {
  await act(async () => {
    view!.root
      .findAllByType("button")
      .find(node => node.props["aria-label"] === `预览最近内容 ${id}`)!
      .props.onClick();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  confirm = vi.fn(() => true);
  trackStop = vi.fn();
  getUserMedia = vi
    .fn()
    .mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  vi.stubGlobal("window", { SpeechRecognition: FakeSpeech, confirm });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeMedia);
  vi.stubGlobal("FileReader", FakeReader);
  FakeSpeech.instances = [];
  FakeMedia.instances = [];
  rpc.statusHook.mockReturnValue({ refetch: rpc.status });
  rpc.historyHook.mockReturnValue({ refetch: rpc.history });
  rpc.status.mockResolvedValue({ data: status });
  rpc.history.mockResolvedValue({
    data: {
      items: [
        { id: 1, content: "历史施工内容", usedAt: "2026-11-10T00:00:00Z" },
      ],
    },
  });
  rpc.forget.mockResolvedValue({ success: true });
  rpc.assist.mockResolvedValue({
    text: "整理候选",
    warnings: ["请核对桩号"],
    provider: "configured-ai",
  });
  rpc.transcribe.mockResolvedValue({ text: "云端候选" });
});
afterEach(async () => {
  if (view)
    await act(async () => {
      view!.unmount();
    });
  view = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("施工智能录入真实组件", () => {
  it("inactive 不读接口；面板不取代主输入，容器具备移动宽度保护", async () => {
    await mount({ active: false });
    expect(rpc.status).not.toHaveBeenCalled();
    expect(view!.toJSON()).toBeNull();
    await update({ active: true });
    expect(rpc.status).toHaveBeenCalledTimes(1);
    expect(text()).toContain("w-full min-w-0 max-w-full");
    expect(view!.root.findAllByType("textarea")).toHaveLength(0);
    expect(rpc.statusHook.mock.calls.at(-1)?.[0]).toEqual({ projectId: 10 });
  });
  it("状态失败不是零额度，可重试读取；未配置时不允许假生成", async () => {
    rpc.status.mockRejectedValueOnce(new Error("fetch failed"));
    await mount();
    await click("?");
    await click("AI整理");
    expect(text()).toContain("额度未知");
    expect(text()).not.toContain("今日 0/");
    expect(button("生成候选").props.disabled).toBe(true);
    await click("重试状态");
    expect(text()).toContain("今日 2/10");
    rpc.status.mockResolvedValue({ data: { ...status, aiReady: false } });
    await click("刷新状态");
    expect(text()).toContain("AI尚未配置");
    expect(button("生成候选").props.disabled).toBe(true);
    expect(rpc.assist).not.toHaveBeenCalled();
  });
  it("最多5条历史，显示日期，点击仅预览并可修改后追加，不记忆或提交", async () => {
    rpc.history.mockResolvedValue({
      data: {
        items: Array.from({ length: 8 }, (_, i) => ({
          id: i + 1,
          content: `历史${i + 1}`,
          usedAt: "2026-11-10",
        })),
      },
    });
    await mount();
    await openHistory();
    expect(view!.root.findAllByType("time")).toHaveLength(5);
    expect(text()).not.toContain("历史6");
    expect(text()).toContain("2026");
    await previewHistory();
    expect(props.onChange).not.toHaveBeenCalled();
    await input("录入候选文字", "人工修改候选");
    await click("追加");
    expect(props.onChange).toHaveBeenCalledWith("人工原文\n人工修改候选");
  });
  it("历史替换需显式按钮，追加使用最新人工原文且不截断超长事实", async () => {
    await mount({ maxLength: 8 });
    await openHistory();
    await previewHistory();
    await update({ value: "最新人工原文" });
    await click("追加");
    expect(props.onChange).not.toHaveBeenCalled();
    expect(text()).toContain("超过 8 字");
    await input("录入候选文字", "短文");
    await click("替换");
    expect(props.onChange).toHaveBeenCalledWith("短文");
  });
  it("300ms关键词联想，旧请求结果不覆盖新关键词", async () => {
    await mount();
    await openHistory();
    const old = deferred<{
      data: { items: { id: number; content: string; usedAt: string }[] };
    }>();
    rpc.history.mockReturnValueOnce(old.promise);
    await input("最近内容关键词", "路基");
    await advance(299);
    expect(rpc.history).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(rpc.history).toHaveBeenCalledTimes(2);
    await input("最近内容关键词", "安全");
    await advance(300);
    expect(rpc.historyHook.mock.calls.at(-1)?.[0]).toEqual({
      projectId: 10,
      field: "workContent",
      keyword: "安全",
    });
    await act(async () =>
      old.resolve({
        data: {
          items: [{ id: 99, content: "迟到历史", usedAt: "2026-11-10" }],
        },
      })
    );
    expect(text()).not.toContain("迟到历史");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("历史删除/项目清空都确认并刷新，拒绝确认不请求", async () => {
    await mount();
    await openHistory();
    confirm.mockReturnValueOnce(false);
    const deleteItem = () =>
      view!.root
        .findAllByType("button")
        .find(node => node.props["aria-label"] === "删除最近内容 1")!;
    await act(async () => deleteItem().props.onClick());
    expect(rpc.forget).not.toHaveBeenCalled();
    await act(async () => deleteItem().props.onClick());
    expect(rpc.forget).toHaveBeenCalledWith({ projectId: 10, id: 1 });
    expect(rpc.history).toHaveBeenCalledTimes(2);
    await click("清空本项目最近内容");
    expect(confirm.mock.calls.at(-1)?.[0]).toContain("所有字段");
    expect(rpc.forget).toHaveBeenLastCalledWith({
      projectId: 10,
      id: undefined,
    });
    expect(rpc.history).toHaveBeenCalledTimes(3);
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("历史失败展示错误而非空成功", async () => {
    rpc.history.mockRejectedValue(new Error("network error"));
    await mount();
    await openHistory();
    expect(text()).toContain("最近内容读取失败");
    expect(text()).not.toContain("暂无匹配内容");
    rpc.history.mockResolvedValue({ data: { items: [] } });
    await click("刷新最近内容");
    expect(text()).toContain("暂无匹配内容");
  });
  it("AI调用真实参数，对比原文和候选、人工修改后采用，不自行保存", async () => {
    await mount();
    await click("AI整理");
    await input("AI整理方式", "revise");
    expect(button("生成候选").props.disabled).toBe(true);
    await input("AI修改要求", " 保留桩号 ");
    await click("生成候选");
    expect(rpc.assist).toHaveBeenCalledWith({
      projectId: 10,
      field: "workContent",
      content: "人工原文",
      mode: "revise",
      instruction: "保留桩号",
    });
    expect(text()).toContain("原文（生成时）");
    expect(text()).toContain("请核对桩号");
    expect(props.onChange).not.toHaveBeenCalled();
    await input("AI候选文字", "已核对的新文");
    await click("采用候选");
    expect(props.onChange).toHaveBeenCalledWith("已核对的新文");
  });
  it("AI失败原文不变；整理和分条模式均可选", async () => {
    rpc.assist.mockRejectedValue(new Error("upstream failed"));
    await mount();
    await click("AI整理");
    await input("AI整理方式", "organize");
    await click("生成候选");
    expect(rpc.assist).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "organize" })
    );
    expect(text()).toContain("AI整理失败，原文未改变");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("AI生成期间或之后改原文，旧候选不能采用，改回原值仍须重新生成", async () => {
    const pending = deferred<{
      text: string;
      warnings: string[];
      provider: string;
    }>();
    rpc.assist.mockReturnValueOnce(pending.promise);
    await mount();
    await click("AI整理");
    await click("生成候选");
    await update({ value: "人工新内容" });
    await act(async () =>
      pending.resolve({ text: "旧候选", warnings: [], provider: "AI" })
    );
    expect(text()).toContain("原文已变化，请重新生成");
    expect(button("采用候选").props.disabled).toBe(true);
    await update({ value: "人工原文" });
    expect(button("采用候选").props.disabled).toBe(true);
    expect(props.onChange).not.toHaveBeenCalled();
    await click("重新生成");
    expect(button("采用候选").props.disabled).toBe(false);
  });
  it.each([
    { projectId: 11 },
    { userId: 21 },
    { field: "safetyNotes" as const },
    { active: false },
  ])("scope变更%j丢弃AI迟到结果", async change => {
    const pending = deferred<{
      text: string;
      warnings: string[];
      provider: string;
    }>();
    rpc.assist.mockReturnValueOnce(pending.promise);
    await mount();
    await click("AI整理");
    await click("生成候选");
    await update(change);
    await act(async () =>
      pending.resolve({ text: "迟到AI", warnings: [], provider: "AI" })
    );
    expect(text()).not.toContain("迟到AI");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("AI取消和网络超时都丢弃迟到结果", async () => {
    const pending = deferred<{
      text: string;
      warnings: string[];
      provider: string;
    }>();
    rpc.assist.mockReturnValueOnce(pending.promise);
    await mount();
    await click("AI整理");
    await click("生成候选");
    await advance(30_000);
    expect(text()).toContain("AI整理网络超时");
    await act(async () =>
      pending.resolve({ text: "超时迟到", warnings: [], provider: "AI" })
    );
    expect(text()).not.toContain("超时迟到");
    const next = deferred<{
      text: string;
      warnings: string[];
      provider: string;
    }>();
    rpc.assist.mockReturnValueOnce(next.promise);
    await click("生成候选");
    await click("取消AI整理");
    await act(async () =>
      next.resolve({ text: "取消迟到", warnings: [], provider: "AI" })
    );
    expect(text()).not.toContain("取消迟到");
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe("真实语音钩子在组件中的行为", () => {
  it("浏览器优先zh-CN非continuous，识别结束仅候选，人工修改后追加", async () => {
    await mount();
    await click("语音录入");
    await click("开始浏览器识别");
    const speech = FakeSpeech.instances[0];
    expect(speech.lang).toBe("zh-CN");
    expect(speech.continuous).toBe(false);
    expect(text()).toContain("正在听");
    await act(async () =>
      speech.onresult?.({ results: [[{ transcript: "现场识别文字" }]] })
    );
    expect(props.onChange).not.toHaveBeenCalled();
    await click("结束");
    expect(speech.stop).toHaveBeenCalled();
    await act(async () => speech.onend?.());
    expect(text()).toContain("浏览器识别候选");
    expect(rpc.transcribe).not.toHaveBeenCalled();
    await input("录入候选文字", "已核对语音");
    await click("追加");
    expect(props.onChange).toHaveBeenCalledWith("人工原文\n已核对语音");
  });
  it("浏览器失败不自动调用云服务，取消和field变更丢弃旧识别回调", async () => {
    await mount();
    await click("语音录入");
    await click("开始浏览器识别");
    await act(async () =>
      FakeSpeech.instances[0].onerror?.({ error: "network" })
    );
    expect(text()).toContain("不会自动使用云服务");
    expect(getUserMedia).not.toHaveBeenCalled();
    await click("开始浏览器识别");
    const speech = FakeSpeech.instances[1];
    const late = speech.onresult;
    const lateEnd = speech.onend;
    await update({ field: "issueNotes" });
    expect(speech.abort).toHaveBeenCalled();
    await act(async () => {
      late?.({ results: [[{ transcript: "旧字段语音" }]] });
      lateEnd?.();
    });
    expect(text()).not.toContain("旧字段语音");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("浏览器最多60秒，结束等待超时后可重试；取消清空计时器", async () => {
    await mount();
    await click("语音录入");
    await click("开始浏览器识别");
    await advance(60_000);
    expect(FakeSpeech.instances[0].stop).toHaveBeenCalled();
    await advance(5_000);
    expect(text()).toContain("识别等待超时");
    await click("开始浏览器识别");
    await click("取消语音");
    expect(FakeSpeech.instances[1].abort).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("不支持浏览器且无云配置时真实指导手机输入法，不伪成功、不显示录音启动按钮", async () => {
    vi.stubGlobal("window", { confirm });
    rpc.status.mockResolvedValue({
      data: { ...status, cloudVoiceReady: false },
    });
    await mount();
    await click("语音录入");
    expect(text()).toContain("使用手机输入法麦克风");
    expect(button("开始浏览器识别")).toBeUndefined();
    expect(button("同意并开始云录音")).toBeUndefined();
    expect(rpc.transcribe).not.toHaveBeenCalled();
  });
  it("云录音必须显式同意，停止tracks、规范mime，转写后只预览", async () => {
    vi.stubGlobal("window", { confirm });
    await mount();
    await click("语音录入");
    expect(text()).toContain("转写服务处理");
    expect(getUserMedia).not.toHaveBeenCalled();
    await click("同意并开始云录音");
    const media = FakeMedia.instances[0];
    await act(async () =>
      media.ondataavailable?.({ data: new Blob(["audio"]) })
    );
    await click("结束");
    expect(trackStop).toHaveBeenCalled();
    expect(rpc.transcribe).toHaveBeenCalledWith({
      projectId: 10,
      audioBase64: "YXVkaW8=",
      mimeType: "audio/webm",
    });
    expect(text()).toContain("云端转写候选");
    expect(props.onChange).not.toHaveBeenCalled();
    await click("替换");
    expect(props.onChange).toHaveBeenCalledWith("云端候选");
  });
  it("麦克风拒绝友好说明，不上传、不改原文", async () => {
    getUserMedia.mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" })
    );
    await mount();
    await click("语音录入");
    await click("同意并开始云录音");
    expect(text()).toContain("麦克风权限被拒绝");
    expect(rpc.transcribe).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("权限请求取消后迟到stream也stop；用户改变scope、unmount立即stop", async () => {
    const pending = deferred<{
      getTracks: () => { stop: ReturnType<typeof vi.fn> }[];
    }>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    await mount();
    await click("语音录入");
    await click("同意并开始云录音");
    await click("取消语音");
    await act(async () =>
      pending.resolve({ getTracks: () => [{ stop: trackStop }] })
    );
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(FakeMedia.instances).toHaveLength(0);
    await click("同意并开始云录音");
    const media = FakeMedia.instances[0];
    await update({ userId: 21 });
    expect(media.stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledTimes(2);
    await click("语音录入");
    await click("同意并开始云录音");
    await act(async () => view!.unmount());
    view = undefined;
    expect(trackStop).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(rpc.transcribe).not.toHaveBeenCalled();
  });
  it("云录音60秒自动stop，超过2MB拒绝上传而非假成功", async () => {
    await mount();
    await click("语音录入");
    await click("同意并开始云录音");
    const first = FakeMedia.instances[0];
    await act(async () =>
      first.ondataavailable?.({ data: new Blob(["audio"]) })
    );
    await advance(60_000);
    expect(first.stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
    expect(rpc.transcribe).toHaveBeenCalledTimes(1);
    await click("取消候选");
    await click("同意并开始云录音");
    const second = FakeMedia.instances[1];
    await act(async () =>
      second.ondataavailable?.({
        data: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]),
      })
    );
    expect(second.stop).toHaveBeenCalled();
    expect(text()).toContain("超过 2MB");
    expect(rpc.transcribe).toHaveBeenCalledTimes(1);
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("云服务失败、网络超时和取消丢弃结果，不覆盖人工输入", async () => {
    rpc.transcribe.mockRejectedValueOnce(new Error("network failed"));
    await mount();
    await click("语音录入");
    async function record() {
      await click("同意并开始云录音");
      await act(async () =>
        FakeMedia.instances
          .at(-1)
          ?.ondataavailable?.({ data: new Blob(["audio"]) })
      );
      await click("结束");
    }
    await record();
    expect(text()).toContain("云端转写失败");
    const pending = deferred<{ text: string }>();
    rpc.transcribe.mockReturnValueOnce(pending.promise);
    await record();
    await advance(30_000);
    expect(text()).toContain("云端转写网络超时");
    await act(async () => pending.resolve({ text: "迟到云文本" }));
    expect(text()).not.toContain("迟到云文本");
    const next = deferred<{ text: string }>();
    rpc.transcribe.mockReturnValueOnce(next.promise);
    await record();
    await click("取消语音");
    await act(async () => next.resolve({ text: "取消云文本" }));
    expect(text()).not.toContain("取消云文本");
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe("主字段实时联想与取消边界", () => {
  it("初次非空值不自动展开，主输入变动300ms联想末行短关键词且不自动写字段", async () => {
    await mount({ value: "初始载入的历史正文" });
    expect(rpc.history).not.toHaveBeenCalled();
    expect(text()).not.toContain("最近内容面板");
    await update({ value: "此前工作\n最新路基工作" });
    expect(text()).toContain("最近内容面板");
    expect(rpc.history).not.toHaveBeenCalled();
    await advance(299);
    expect(rpc.history).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.history).toHaveBeenCalledTimes(1);
    expect(rpc.historyHook.mock.calls.at(-1)?.[0]).toEqual({
      projectId: 10,
      field: "workContent",
      keyword: "最新路基工作",
    });
    expect(props.onChange).not.toHaveBeenCalled();
    await update({ value: "施".repeat(8000) });
    await advance(300);
    expect(rpc.historyHook.mock.calls.at(-1)?.[0].keyword).toHaveLength(100);
  });
  it("关闭实时联想后主输入不展开；手动关键词不因能力状态刷新而丢失", async () => {
    await mount();
    await act(async () =>
      view!.root
        .findAllByType("input")
        .find(node => node.props["aria-label"] === "输入时联想最近内容")!
        .props.onChange({ target: { checked: false } })
    );
    await update({ value: "人工新文" });
    await advance(300);
    expect(rpc.history).not.toHaveBeenCalled();
    await openHistory();
    await input("最近内容关键词", "手动路基查询");
    await advance(300);
    await click("?");
    await click("刷新状态");
    const keyword = view!.root
      .findAllByType("input")
      .find(node => node.props["aria-label"] === "最近内容关键词")!;
    expect(keyword.props.value).toBe("手动路基查询");
    await update({ value: "更多人工新文" });
    expect(keyword.props.value).toBe("手动路基查询");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("建议只有两行，全文仍完整进入可编辑候选", async () => {
    const full = "长文".repeat(4000);
    rpc.history.mockResolvedValue({
      data: { items: [{ id: 1, content: full, usedAt: "2026-11-10" }] },
    });
    await mount();
    await openHistory();
    const suggestion = view!.root
      .findAllByType("button")
      .find(node => node.props["aria-label"] === "预览最近内容 1")!;
    expect(suggestion.props.className).toContain("line-clamp-2");
    await previewHistory();
    const candidate = view!.root
      .findAllByType("textarea")
      .find(node => node.props["aria-label"] === "录入候选文字")!;
    expect(candidate.props.value).toBe(full);
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("浏览器cancel后旧回调不能复活候选，下一次正常识别可继续", async () => {
    await mount();
    await click("语音录入");
    await click("开始浏览器识别");
    const first = FakeSpeech.instances[0];
    const lateResult = first.onresult;
    const lateEnd = first.onend;
    await click("取消语音");
    expect(first.abort).toHaveBeenCalled();
    expect(first.onresult).toBeNull();
    expect(first.onend).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      lateResult?.({ results: [[{ transcript: "取消后旧识别" }]] });
      lateEnd?.();
    });
    expect(text()).not.toContain("取消后旧识别");
    await click("开始浏览器识别");
    const next = FakeSpeech.instances[1];
    await act(async () => {
      next.onresult?.({ results: [[{ transcript: "新的识别" }]] });
      next.onend?.();
    });
    expect(text()).toContain("新的识别");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("pending麦克风权限超时释放迟到tracks；云格式不支持就不做录音按钮", async () => {
    const pending = deferred<{
      getTracks: () => { stop: ReturnType<typeof vi.fn> }[];
    }>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    await mount();
    await click("语音录入");
    await click("同意并开始云录音");
    await advance(30_000);
    expect(text()).toContain("麦克风权限等待超时");
    await act(async () =>
      pending.resolve({ getTracks: () => [{ stop: trackStop }] })
    );
    expect(trackStop).toHaveBeenCalled();
    expect(FakeMedia.instances).toHaveLength(0);
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported = () => false;
      }
    );
    await update({ field: "workArea" });
    await click("语音录入");
    expect(button("同意并开始云录音")).toBeUndefined();
    expect(text()).toContain("当前浏览器不支持云录音");
    expect(rpc.transcribe).not.toHaveBeenCalled();
  });
  it("webkit识别同样可用；云额度用尽不能请求麦克风", async () => {
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeSpeech, confirm });
    rpc.status.mockResolvedValue({ data: { ...status, voiceUsed: 5 } });
    await mount();
    await click("语音录入");
    expect(button("开始浏览器识别")).toBeDefined();
    expect(button("同意并开始云录音").props.disabled).toBe(true);
    expect(text()).toContain("今日云语音限额已用完");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("本人缓存键独立，切换用户不复用另一用户的查询键", async () => {
    await mount();
    const optionsA = rpc.statusHook.mock.calls.at(-1)?.[1];
    await update({ userId: 21 });
    const optionsB = rpc.statusHook.mock.calls.at(-1)?.[1];
    const key = [
      ["constructionAssistant", "status"],
      { input: { projectId: 10 } },
    ];
    expect(optionsA.queryKeyHashFn(key)).not.toBe(optionsB.queryKeyHashFn(key));
    expect(rpc.status).toHaveBeenCalledTimes(2);
  });
});

describe("所有远端结果按当前作用域隔离", () => {
  it("旧用户状态和旧字段历史请求迟到，不复活旧数据或旧额度", async () => {
    const oldStatus = deferred<{ data: ConstructionAssistantStatus }>();
    rpc.status.mockReturnValueOnce(oldStatus.promise);
    await mount();
    await update({ userId: 21 });
    await click("?");
    await act(async () =>
      oldStatus.resolve({
        data: { ...status, aiUsed: 9, message: "旧用户状态" },
      })
    );
    expect(text()).not.toContain("旧用户状态");
    const oldHistory = deferred<{
      data: { items: { id: number; content: string; usedAt: string }[] };
    }>();
    rpc.history.mockReturnValueOnce(oldHistory.promise);
    await openHistory();
    await update({ field: "safetyNotes" });
    await act(async () =>
      oldHistory.resolve({
        data: {
          items: [{ id: 90, content: "旧字段历史", usedAt: "2026-11-10" }],
        },
      })
    );
    expect(text()).not.toContain("旧字段历史");
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("云转写已发送后切项目，迟到结果仍不影响新字段或显示候选", async () => {
    const pending = deferred<{ text: string }>();
    rpc.transcribe.mockReturnValueOnce(pending.promise);
    await mount();
    await click("语音录入");
    await click("同意并开始云录音");
    await act(async () =>
      FakeMedia.instances[0].ondataavailable?.({ data: new Blob(["audio"]) })
    );
    await click("结束");
    expect(trackStop).toHaveBeenCalled();
    await update({ projectId: 11 });
    await act(async () => pending.resolve({ text: "旧项目转写结果" }));
    expect(text()).not.toContain("旧项目转写结果");
    expect(props.onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
