import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransportReceiptSpeech } from "./transportReceiptSpeech";

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  volume = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}
function fixture() {
  const chineseVoice = { lang: "zh-CN", name: "中文" } as SpeechSynthesisVoice;
  const engine = {
    cancel: vi.fn(), resume: vi.fn(), speak: vi.fn(),
    getVoices: vi.fn(() => [{ lang: "en-US" }, chineseVoice]),
  };
  const status = vi.fn();
  const controller = createTransportReceiptSpeech(status, () => ({
    synthesizer: engine as unknown as SpeechSynthesis,
    Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
  }));
  return { engine, status, controller, chineseVoice };
}
function lastSpeech(engine: ReturnType<typeof fixture>["engine"]): FakeUtterance {
  return engine.speak.mock.calls.at(-1)![0] as FakeUtterance;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("拍照运输成功语音控制器", () => {
  it("用户点击时同步以静音中文语音解锁，异步完成后使用中文声音自动播报", () => {
    const { controller, engine, status, chineseVoice } = fixture();
    controller.prepareSpeech();
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(lastSpeech(engine)).toMatchObject({ lang: "zh-CN", volume: 0, text: " " });
    controller.speakTransportReceipt("湘AZ9999，今日第1车拍照发票成功", false, "trip-1:load");
    expect(engine.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    const speech = lastSpeech(engine);
    expect(speech).toMatchObject({ lang: "zh-CN", rate: 0.8, volume: 1, voice: chineseVoice });
    speech.onstart?.();
    expect(status).toHaveBeenLastCalledWith("speaking");
    speech.onend?.();
    expect(status).toHaveBeenLastCalledWith("completed");
  });
  it("手工重播在点击调用栈内直接播放，不依赖定时器", () => {
    const { controller, engine } = fixture();
    controller.prepareSpeech();
    controller.speakTransportReceipt("卸土成功", true);
    expect(engine.speak).toHaveBeenCalledTimes(2);
    expect(lastSpeech(engine).text).toBe("卸土成功");
  });
  it("静默丢弃且没有onstart时提供可重试状态，不无限自动重播", () => {
    const { controller, engine, status } = fixture();
    controller.speakTransportReceipt("拍照发票成功");
    vi.advanceTimersByTime(5080);
    expect(status).toHaveBeenLastCalledWith("blocked");
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    controller.prepareSpeech();
    controller.speakTransportReceipt("拍照发票成功", true);
    lastSpeech(engine).onstart?.();
    expect(status).toHaveBeenLastCalledWith("speaking");
  });
  it("无语音API时不抛出异常，只提示不支持", () => {
    const status = vi.fn();
    const controller = createTransportReceiptSpeech(status, () => null);
    expect(() => { controller.prepareSpeech(); controller.speakTransportReceipt("卸土成功"); }).not.toThrow();
    expect(status).toHaveBeenLastCalledWith("unsupported");
  });
  it("浏览器同步抛错与异步语音失败均降级，不阻断业务后续操作", () => {
    const { controller, engine, status } = fixture();
    engine.speak.mockImplementationOnce(() => { throw new Error("blocked"); });
    expect(() => controller.prepareSpeech()).not.toThrow();
    expect(status).toHaveBeenLastCalledWith("blocked");
    controller.speakTransportReceipt("卸土成功");
    vi.advanceTimersByTime(80);
    lastSpeech(engine).onerror?.();
    expect(status).toHaveBeenLastCalledWith("blocked");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("相同服务端成功回执自动只播一次，同车下一趟和卸土仍可播", () => {
    const { controller, engine } = fixture();
    controller.speakTransportReceipt("装土成功", false, "trip-1:load");
    vi.advanceTimersByTime(80);
    controller.speakTransportReceipt("装土成功", false, "trip-1:load");
    vi.advanceTimersByTime(80);
    expect(engine.speak).toHaveBeenCalledTimes(1);
    controller.speakTransportReceipt("卸土成功", false, "trip-1:unload");
    vi.advanceTimersByTime(80);
    controller.speakTransportReceipt("装土成功", false, "trip-2:load");
    vi.advanceTimersByTime(80);
    expect(engine.speak).toHaveBeenCalledTimes(3);
  });
  it("手工重播不被自动成功去重限制", () => {
    const { controller, engine } = fixture();
    controller.speakTransportReceipt("卸土成功", false, "trip-1:unload");
    vi.advanceTimersByTime(80);
    controller.speakTransportReceipt("卸土成功", true, "trip-1:unload");
    expect(engine.speak).toHaveBeenCalledTimes(2);
  });
  it("旧播报取消、结束或超时回调不会覆盖新成功回执", () => {
    const { controller, engine, status } = fixture();
    controller.speakTransportReceipt("旧回执");
    vi.advanceTimersByTime(80);
    const oldError = lastSpeech(engine).onerror;
    controller.speakTransportReceipt("新回执");
    vi.advanceTimersByTime(80);
    lastSpeech(engine).onstart?.();
    oldError?.();
    vi.advanceTimersByTime(5000);
    expect(status).toHaveBeenLastCalledWith("speaking");
  });
  it("已完成后清理不会取消其他组件的NFC语音，卸载会清理自己的延迟任务", () => {
    const { controller, engine } = fixture();
    controller.speakTransportReceipt("卸土成功");
    vi.advanceTimersByTime(80);
    lastSpeech(engine).onend?.();
    engine.cancel.mockClear();
    controller.dispose();
    expect(engine.cancel).not.toHaveBeenCalled();
    controller.speakTransportReceipt("下一回执");
    controller.dispose();
    vi.advanceTimersByTime(10000);
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("语音列表尚未加载时仍使用中文语言默认声音", () => {
    const { controller, engine } = fixture();
    engine.getVoices.mockReturnValue([]);
    controller.speakTransportReceipt("拍照发票成功");
    vi.advanceTimersByTime(80);
    expect(lastSpeech(engine)).toMatchObject({ lang: "zh-CN", voice: null });
  });
  it("空回执不会播报虚假成功，重复预热不会打断正在播的回执", () => {
    const { controller, engine } = fixture();
    controller.speakTransportReceipt(null);
    expect(engine.speak).not.toHaveBeenCalled();
    controller.speakTransportReceipt("卸土成功", true);
    controller.prepareSpeech();
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(engine.cancel).not.toHaveBeenCalled();
  });
});
