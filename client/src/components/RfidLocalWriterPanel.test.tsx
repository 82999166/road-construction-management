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

  it("初卡恢复只能调用固定的本地擦除接口，并要求二次确认且明确不修改锁位或写保护", () => {
    expect(source).toContain('"/api/erase-initial-card"');
    expect(source).toContain("确认停用所选车辆卡，并擦除当前 NTAG216 的 NDEF 用户区恢复为空白初卡");
    expect(source).toContain("停用并擦除恢复初卡");
    expect(source).toContain("不会修改制造商区、锁定位、配置页或写保护口令");
  });

  it("已启用车辆卡可选择恢复初卡，但必须先调用服务端停用流程", () => {
    expect(source).toContain("prepareRfidInitialErase");
    expect(source).toContain('["active", "revoked", "suspended"]');
    expect(source).toContain("已启用（将停用）");
  });

  it("业务数据清空且没有车辆卡绑定时，可只在本机桥接中恢复当前实体卡而不写回旧业务数据", () => {
    expect(source).toContain("hasNoBoundCards");
    expect(source).toContain("直接恢复当前未绑定实体卡");
    expect(source).toContain("不会恢复或写入任何旧车辆、司机或运输业务数据");
  });

  it("写卡板块必须明确区分测试卡与正式车辆卡写入，并展示手机触碰验证步骤", () => {
    expect(source).toContain("正式车辆卡写入流程");
    expect(source).toContain("不会写入运输页面链接");
    expect(source).toContain("PC 写入车辆卡");
    expect(source).toContain("系统应打开受控运输刷卡入口");
  });

  it("装土点与卸土点读卡设备必须可登记到具体地点，供手机 NFC 双设备闭环选择", () => {
    expect(source).toContain("装卸点读卡设备");
    expect(source).toContain("saveReaderDevice.mutate");
    expect(source).toContain("LOAD-NFC-01");
    expect(source).toContain("手机 NFC 触碰车辆卡后");
  });
});
