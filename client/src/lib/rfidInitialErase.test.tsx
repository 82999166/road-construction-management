import { describe, expect, it } from "vitest";
import {
  inspectRfidBridgeReadiness,
  REQUIRED_RFID_BRIDGE_VERSION,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_WRITER_VERSION,
} from "./rfidBridgeReadiness";
import {
  getInitialEraseErrorMessage,
  isVerifiedInitialEraseResult,
  INITIAL_ERASE_VERSION,
} from "./rfidInitialErase";
const ready = {
  success: true,
  bridgeVersion: REQUIRED_RFID_BRIDGE_VERSION,
  bridgeBuildId: REQUIRED_RFID_BRIDGE_BUILD_ID,
  requiredWriterVersion: REQUIRED_RFID_WRITER_VERSION,
  initialEraseReady: true,
  initialEraseVersion: INITIAL_ERASE_VERSION,
};
const result = {
  success: true,
  erased: true,
  verified: true,
  initialNdef: true,
  writeProtectionChanged: false,
  cardUidFingerprint: "a".repeat(64),
  writerVersion: INITIAL_ERASE_VERSION,
};
describe("初卡恢复能力与结果真实验证", () => {
  it("有完整恢复能力时才允许恢复；普通写卡版本检测保持独立", () => {
    expect(inspectRfidBridgeReadiness(ready, true, true).status).toBe("ready");
    const old = { ...ready, initialEraseReady: undefined };
    expect(inspectRfidBridgeReadiness(old, true, true).status).toBe(
      "upgrade_required"
    );
    expect(inspectRfidBridgeReadiness(old, true).status).toBe("ready");
  });
  it.each([false, "true", undefined, null])(
    "缺失或非布尔恢复能力%j不得放行",
    value => {
      expect(
        inspectRfidBridgeReadiness(
          { ...ready, initialEraseReady: value },
          true,
          true
        ).status
      ).toBe("upgrade_required");
    }
  );
  it("恢复底层版本必须精确匹配", () => {
    expect(
      inspectRfidBridgeReadiness(
        { ...ready, initialEraseVersion: "unknown" },
        true,
        true
      ).status
    ).toBe("upgrade_required");
  });
  it("只有完整明确回读结果才能确认成功", () => {
    expect(isVerifiedInitialEraseResult(result)).toBe(true);
    for (const key of ["success", "erased", "verified", "initialNdef"])
      for (const value of [false, "true", undefined])
        expect(isVerifiedInitialEraseResult({ ...result, [key]: value })).toBe(
          false
        );
    expect(
      isVerifiedInitialEraseResult({ ...result, writeProtectionChanged: true })
    ).toBe(false);
    expect(
      isVerifiedInitialEraseResult({ ...result, writerVersion: "old" })
    ).toBe(false);
    expect(
      isVerifiedInitialEraseResult({ ...result, cardUidFingerprint: "invalid" })
    ).toBe(false);
  });
  it("实际File参数报错转换为安装步骤，不回显本机路径", () => {
    const message = getInitialEraseErrorMessage(
      new Error(
        "The argument 'D:\\manus\\run_utrust_erase_initial.ps1' to the -File parameter does not exist."
      )
    );
    expect(message).toContain("本机缺少恢复初卡脚本");
    expect(message).toContain("Install-Yuexin-RFID-Bridge.cmd");
    expect(message).not.toContain("D:\\");
    expect(message).toContain("仅刷新网页不能");
  });
  it.each([
    "erase_script_missing",
    "reader_script_missing",
    "erase_card_uid_mismatch",
    "erase_card_write_protected",
    "erase_card_verify_failed",
    "erase_unknown_in_progress",
  ])("%s返回中文可操作提示", code => {
    const message = getInitialEraseErrorMessage(new Error(code));
    expect(message).toMatch(/[\u4e00-\u9fff]/);
    expect(message).not.toContain(code);
  });
});
