import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Windows 车辆卡受控深链读取程序", () => {
  const source = readFileSync(new URL("../desktop-bridge/UTrustReadVehicleEntry.cs", import.meta.url), "utf8");
  const wrapper = readFileSync(new URL("../desktop-bridge/run_utrust_read_vehicle_entry.ps1", import.meta.url), "utf8");

  it("只读取 Type 2 NDEF 用户区的首条 URI 记录", () => {
    expect(source).toContain("private const int FirstUserPage = 4");
    expect(source).toContain("ParseVehicleEntryUrl");
    expect(source).toContain("userData[position] != 0x55");
    expect(source).toContain("userData[position] != 0x00");
  });

  it("仅允许受控域名、运输路径和单一 nfc 参数", () => {
    expect(source).toContain('string.Equals(uri.Host, "yx.maomaoyx.com", StringComparison.OrdinalIgnoreCase)');
    expect(source).toContain('string.Equals(uri.AbsolutePath, "/mobile/transport", StringComparison.Ordinal)');
    expect(source).toContain('parts.Length != 1 || !parts[0].StartsWith("nfc=", StringComparison.Ordinal)');
    expect(wrapper).toContain("UTrustReadVehicleEntry.cs");
    expect(wrapper).toContain("[UTrustReadVehicleEntry]::Main()");
  });
});
