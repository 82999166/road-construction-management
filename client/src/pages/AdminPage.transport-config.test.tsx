import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("./AdminPage.tsx", import.meta.url),
  "utf8"
).replace(/\s+/g, " ");
describe("PC运输配置入口收敛", () => {
  it("统一地点路线与RFID仅在场站终端栏挂载，不污染日常运单台账", () => {
    expect(source.match(/<TransportRouteConfigurationEditor /g)).toHaveLength(
      1
    );
    expect(source).toContain('active={transportWorkspaceTab === "terminals"}');
    expect(source).toContain('label="运输场站路线与终端"');
    expect(source).toContain(
      'transportWorkspaceTab === "terminals" ? renderRfidManagement() : null'
    );
    expect(source).toContain(
      "canConfigureSafety={rights?.canConfigureSafety ?? false}"
    );
    expect(source).not.toContain("运输路线一次配置");
    expect(source).not.toContain("一次配置运输路线");
  });
});
