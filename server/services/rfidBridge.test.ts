import { describe, expect, it } from "vitest";
import { createRfidBridgeToken, hashRfidBridgeToken, RFID_BRIDGE_TOKEN_TTL_MS } from "./rfidBridge";

describe("本地 uTrust 写卡一次性桥接授权", () => {
  it("生成不可预测令牌并只使用固定摘要参与服务端匹配", () => {
    const first = createRfidBridgeToken();
    const second = createRfidBridgeToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(hashRfidBridgeToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRfidBridgeToken(first)).not.toBe(hashRfidBridgeToken(second));
  });

  it("将桥接任务授权限制在短时窗口内", () => {
    expect(RFID_BRIDGE_TOKEN_TTL_MS).toBe(5 * 60 * 1000);
  });
});
