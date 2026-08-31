import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("管理端 PC uTrust 正式写卡", () => {
  it("生成桥接任务后不展示可编辑正式载荷，只允许本机完成写入回读确认", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain('executionMode: "pc_bridge"');
    expect(source).toContain("PC 受控车辆卡写入");
    expect(source).toContain("http://127.0.0.1:47601/api/write-vehicle-card");
    expect(source).toContain("写入并回读确认");
    expect(source).toContain("bridge_write_endpoint_missing");
    expect(source).toContain("当前 Windows 桥接程序未安装正式车辆卡写入接口");
    expect(source).toContain("bridge_write_authorization_rejected");
    expect(source).toContain("bridge_write_card_or_payload_mismatch");
    expect(source).toContain('const REQUIRED_RFID_BRIDGE_VERSION = "utrust-bridge-atomic-v2"');
    expect(source).toContain('fetch("http://127.0.0.1:47601/health"');
    expect(source).toContain("healthResult.bridgeVersion !== REQUIRED_RFID_BRIDGE_VERSION");
    expect(source).toContain("bridge_write_version_mismatch");
    expect(source).toContain("当前 Windows 桥接程序或写卡器版本过旧，已在写卡前停止操作");
    expect(source).toContain("车辆卡 ${result.jobNo || rfidWritePreview.jobNo} 已完成写入、回读校验并启用。");
    expect(source).toContain("window.requestAnimationFrame(() => setRfidWritePreview(null))");
  });
});
