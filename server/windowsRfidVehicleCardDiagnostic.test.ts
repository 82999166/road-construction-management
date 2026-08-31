import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Windows 车辆卡只读诊断", () => {
  const source = readFileSync(new URL("../desktop-bridge/UTrustVehicleCardDiagnostic.cs", import.meta.url), "utf8");
  const wrapper = readFileSync(new URL("../desktop-bridge/run_utrust_vehicle_card_diagnostic.ps1", import.meta.url), "utf8");

  it("通过 uTrust PC/SC 读取 UID、CC 与 Type 2 用户区而不发送写入指令", () => {
    expect(source).toContain("0xFF, 0xCA, 0x00, 0x00, 0x00");
    expect(source).toContain("0xFF, 0xB0, 0x00, (byte)page, 0x04");
    expect(source).toContain("writeOperation\\\":false");
    expect(source).not.toContain("0xFF, 0xD6");
  });

  it("只输出结构与 UID 指纹，不输出 NDEF 深链或 RC3 原文", () => {
    expect(source).toContain("uidFingerprint");
    expect(source).toContain("ndefStructure");
    expect(source).not.toContain("nfcEntryUrl");
    expect(wrapper).toContain("UTrustVehicleCardDiagnostic.cs");
  });
});
