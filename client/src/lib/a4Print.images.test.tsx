import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openA4PrintDocument } from "./a4Print";
let frame: any;
let win: any;
let doc: any;
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const photo = (decode = vi.fn().mockResolvedValue(undefined)) => ({
  complete: true,
  naturalWidth: 1200,
  naturalHeight: 800,
  decode,
});
beforeEach(() => {
  vi.useFakeTimers();
  doc = {
    open: vi.fn(),
    write: vi.fn(),
    close: vi.fn(),
    images: [],
    body: { dataset: {} },
  };
  win = {
    document: doc,
    addEventListener: vi.fn(),
    focus: vi.fn(),
    print: vi.fn(),
  };
  frame = {
    contentWindow: win,
    style: {},
    isConnected: true,
    setAttribute: vi.fn(),
    remove: vi.fn(() => {
      frame.isConnected = false;
    }),
  };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => frame),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("window", { setTimeout });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const start = (isCurrent = () => true) =>
  openA4PrintDocument({
    title: "施工照片",
    orientation: "portrait",
    marginMm: 12,
    waitForImages: true,
    isCurrent,
    bodyHtml: "<table><tr><td>完整正文</td></tr></table>",
  });
describe("施工A4影像严格就绪", () => {
  it("页边距统一12mm，非零A4预布局，没有自行提前print的脚本", async () => {
    const pending = start();
    const html = doc.write.mock.calls[0][0];
    expect(html).toContain("@page { size:A4 portrait; margin:12mm; }");
    expect(html).not.toContain("<script>");
    expect(frame.style.cssText).toContain("width:794px;height:1123px");
    await vi.advanceTimersByTimeAsync(180);
    await pending;
    expect(win.print).toHaveBeenCalledOnce();
    expect(doc.body.dataset.printReady).toBe("true");
  });
  it("逐张等待全部照片decode，慢照片完成前不送交打印", async () => {
    const slow = deferred();
    doc.images = [photo(), photo(vi.fn(() => slow.promise))];
    const pending = start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(win.print).not.toHaveBeenCalled();
    slow.resolve();
    await vi.advanceTimersByTimeAsync(180);
    await pending;
    expect(doc.images.every((p: any) => p.decode.mock.calls.length === 1)).toBe(
      true
    );
    expect(win.print).toHaveBeenCalledOnce();
  });
  it.each(["网络失败", "签名过期", "损坏图片"])(
    "%s不静默漏图，销毁iframe且不打印",
    async reason => {
      doc.images = [
        photo(),
        photo(vi.fn().mockRejectedValue(new Error(reason))),
      ];
      const pending = start();
      const rejected = expect(pending).rejects.toThrow("第2张现场照片加载失败");
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(win.print).not.toHaveBeenCalled();
      expect(frame.remove).toHaveBeenCalledOnce();
    }
  );
  it("空naturalWidth即使decode成功仍判失败", async () => {
    doc.images = [{ ...photo(), naturalWidth: 0 }];
    const pending = start();
    await expect(pending).rejects.toThrow("现场照片加载失败");
    expect(win.print).not.toHaveBeenCalled();
  });
  it("等待超过60秒明确失败且清理，不会一直卡住", async () => {
    doc.images = [photo(vi.fn(() => deferred().promise))];
    const pending = start();
    const rejected = expect(pending).rejects.toThrow("超过60秒");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(win.print).not.toHaveBeenCalled();
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("图片等待期间切换项目及时取消，迟到decode不能复活打印", async () => {
    const slow = deferred();
    let current = true;
    doc.images = [photo(vi.fn(() => slow.promise))];
    const pending = start(() => current);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    current = false;
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    slow.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(win.print).not.toHaveBeenCalled();
  });
  it("全部图片解码后、最终布局等待期间撤权仍取消", async () => {
    let current = true;
    doc.images = [photo()];
    const pending = start(() => current);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await vi.advanceTimersByTimeAsync(50);
    current = false;
    await vi.advanceTimersByTimeAsync(150);
    await rejected;
    expect(win.print).not.toHaveBeenCalled();
  });
  it("无decode旧浏览器通过load+天然尺寸验真，并清掉监听器", async () => {
    const listeners: Record<string, Function> = {};
    const old = {
      complete: false,
      naturalWidth: 100,
      naturalHeight: 100,
      addEventListener: vi.fn((k, fn) => {
        listeners[k] = fn;
      }),
      removeEventListener: vi.fn(),
    };
    doc.images = [old];
    const pending = start();
    await vi.advanceTimersByTimeAsync(100);
    expect(win.print).not.toHaveBeenCalled();
    old.complete = true;
    listeners.load();
    await vi.advanceTimersByTimeAsync(180);
    await pending;
    expect(old.removeEventListener).toHaveBeenCalledTimes(2);
  });
  it("print抛错不会冒充完成，移除文档", async () => {
    win.print.mockImplementation(() => {
      throw new Error("浏览器打印失败");
    });
    const pending = start();
    const rejected = expect(pending).rejects.toThrow("浏览器打印失败");
    await vi.advanceTimersByTimeAsync(180);
    await rejected;
    expect(frame.remove).toHaveBeenCalledOnce();
  });
  it("成功后afterprint清理，旧模块默认8mm/零宽模式继续兼容", async () => {
    const pending = start();
    await vi.advanceTimersByTimeAsync(180);
    await pending;
    win.addEventListener.mock.calls[0][1]();
    await vi.advanceTimersByTimeAsync(300);
    expect(frame.remove).toHaveBeenCalledOnce();
    openA4PrintDocument({ title: "柴油明细", bodyHtml: "<table></table>" });
    expect(doc.write.mock.calls.at(-1)[0]).toContain("margin:8mm");
    expect(frame.style.cssText).toContain("width:0;height:0");
  });
});
