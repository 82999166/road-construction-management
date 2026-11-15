import { describe, expect, it } from "vitest";
import {
  getInitialEraseErrorMessage,
  INITIAL_ERASE_VERSION,
  isVerifiedInitialEraseResult,
} from "./rfidInitialErase";
import {
  inspectRfidBridgeReadiness,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_BRIDGE_VERSION,
  REQUIRED_RFID_WRITER_VERSION,
} from "./rfidBridgeReadiness";

const receipt = {
  success: true,
  initialNdef: true,
  erased: true,
  verified: true,
  writeProtectionChanged: false,
  cardUidFingerprint: "a".repeat(64),
  writerVersion: INITIAL_ERASE_VERSION,
};
const bridge = {
  success: true,
  bridgeVersion: REQUIRED_RFID_BRIDGE_VERSION,
  bridgeBuildId: REQUIRED_RFID_BRIDGE_BUILD_ID,
  requiredWriterVersion: REQUIRED_RFID_WRITER_VERSION,
  initialEraseReady: true,
  initialEraseVersion: INITIAL_ERASE_VERSION,
};

describe("NTAG216 GET_VERSION 兼容修复的前端契约", () => {
  it("仅完整 v2 成功回执可认定恢复成功，v1/未知/缺失版本不能放行", () => {
    expect(INITIAL_ERASE_VERSION).toBe("ntag216-initial-erase-v2");
    expect(isVerifiedInitialEraseResult(receipt)).toBe(true);
    for (const writerVersion of [
      "ntag216-initial-erase-v1",
      "unknown",
      undefined,
    ])
      expect(isVerifiedInitialEraseResult({ ...receipt, writerVersion })).toBe(
        false
      );
  });
  it.each(["erased", "verified", "initialNdef", "success"] as const)(
    "新版仍不能因 %s 为假而误报成功",
    field =>
      expect(isVerifiedInitialEraseResult({ ...receipt, [field]: false })).toBe(
        false
      )
  );
  it("新桥接仍不能混用旧恢复器或缺件，v17/v14整套旧桥接必须升级", () => {
    expect(inspectRfidBridgeReadiness(bridge, true, true).status).toBe("ready");
    for (const initialEraseVersion of [
      "ntag216-initial-erase-v1",
      "unknown",
      undefined,
    ])
      expect(
        inspectRfidBridgeReadiness(
          { ...bridge, initialEraseVersion },
          true,
          true
        ).status
      ).toBe("upgrade_required");
    expect(
      inspectRfidBridgeReadiness(
        { ...bridge, initialEraseReady: false },
        true,
        true
      ).status
    ).toBe("upgrade_required");
    expect(
      inspectRfidBridgeReadiness(
        {
          ...bridge,
          bridgeVersion: "utrust-bridge-installer-v14",
          bridgeBuildId: "utrust-rfid-installer-20261115-erase-v14",
        },
        true,
        true
      ).status
    ).toBe("upgrade_required");
  });
  it("CRC错误明确在写入前停止，不误称真实型号不符", () => {
    const message = getInitialEraseErrorMessage(
      new Error("erase_card_identification_crc_invalid")
    );
    expect(message).toContain("CRC");
    expect(message).toContain("写入前停止");
    expect(message).not.toContain("型号信息不符合");
  });
  it("读卡器状态或长度异常与真实型号不符使用不同提示", () => {
    const reader = getInitialEraseErrorMessage(
      new Error("erase_reader_identification_failed")
    );
    expect(reader).toContain("不能据此认定卡片型号不符");
    expect(reader).toContain("写入前停止");
    const model = getInitialEraseErrorMessage(
      new Error("erase_card_type_not_supported")
    );
    expect(model).toContain("完整型号信息不符合");
    expect(model).toContain("不会仅凭容量声明擦卡");
  });
  it("未知保护区配置继续拒绝且不声称非NTAG216", () => {
    const message = getInitialEraseErrorMessage(
      new Error("erase_card_protection_profile_unknown")
    );
    expect(message).toContain("锁定或配置区");
    expect(message).toContain("不会修改");
    expect(message).not.toContain("型号信息不符合");
  });
});
