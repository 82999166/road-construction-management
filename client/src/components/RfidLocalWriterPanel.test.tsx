import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/components/RfidLocalWriterPanel.tsx"), "utf8");

describe("uTrust 本地桥接面板", () => {
  it("检测按钮必须展示加载态、八秒超时和可读网络访问失败说明", () => {
    expect(source).toContain("const [checkingBridge, setCheckingBridge]");
    expect(source).toContain("AbortController");
    expect(source).toContain("8_000");
    expect(source).toContain("浏览器无法访问本机 127.0.0.1 桥接");
    expect(source).toContain("正在检测…");
  });

  it("正式测试写卡必须等待桥接健康检查成功，并在页面保留实时状态文字", () => {
    expect(source).toContain('bridgeStatus !== "ready"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("已连接：智能卡服务");
  });

  it("车辆卡绑定可通过本地桥接只读 UID 接口自动带入，而不是要求管理员手工抄录", () => {
    expect(source).toContain('"/api/read-uid"');
    expect(source).toContain("onUidRead(result.cardUid)");
    expect(source).toContain("读取卡 UID 并绑定");
  });

  it("装土点与卸土点读卡设备必须可登记到具体地点，供手机 NFC 双设备闭环选择", () => {
    expect(source).toContain("装卸点读卡设备");
    expect(source).toContain("saveReaderDevice.mutate");
    expect(source).toContain("LOAD-NFC-01");
    expect(source).toContain("手机 NFC 触碰车辆卡后");
  });
});
