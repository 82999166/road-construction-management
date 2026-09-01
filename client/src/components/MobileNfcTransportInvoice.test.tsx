import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("手机刷 NFC 卡发票", () => {
  it("页面打开即监听车辆卡，读取后选择路线并保存开票", () => {
    const source = readFileSync(new URL("./MobileNfcTransportInvoice.tsx", import.meta.url), "utf8");
    expect(source).toContain("reader.scan({ signal: controller.signal })");
    expect(source).toContain("请将已启用的车辆卡贴近手机");
    expect(source).toContain("previewMobileNfcInvoice");
    expect(source).toContain("confirmMobileNfcInvoice");
    expect(source).toContain("保存并开具发票");
    expect(source).toContain("该车还未卸土，不能开具新发票");
    expect(source).toContain("speechSynthesis");
    expect(source).toContain("unlockSpeech()");
    expect(source).toContain('getVoices().find(voice => voice.lang.toLowerCase().startsWith("zh"))');
    expect(source).toContain("speech.volume = 1");
    expect(source).toContain("speech.onerror");
    expect(source).toContain("自动播报被手机系统拦截");
    expect(source).toContain("播放成功语音");
    expect(source).toContain("text-3xl font-black");
    expect(source).toContain("已重新读取车辆卡，正在刷新车辆与在途状态");
    expect(source).toContain("utils.transport.previewMobileNfcInvoice.invalidate");
    expect(source).not.toContain("if (!open || initialToken) return");
    expect(source).toContain("本次开票已完成，请贴下一张已启用车辆卡");
    expect(source).toContain("}, 3_000)");
    expect(source).toContain("setToken(\"\")");
    expect(source).toContain("setRoutePresetId(\"\")");
    expect(source).toContain("当前浏览器不支持页面内读卡");
    expect(source).toContain("已启动 Android Chrome 页面内读卡");
    expect(source).toContain("重新启动读卡");
    expect(source).toContain("scanAttempt");
    expect(source).toContain("卸土点中文详细地址尚未完成地图定位校验");
    expect(source).toContain("装卸土点与运输路线配置");
    expect(source).toContain("补录详细地址");
  });
});
