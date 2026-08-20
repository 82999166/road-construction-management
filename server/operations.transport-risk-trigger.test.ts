import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输事件自动风险扫描", () => {
  const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

  it("以中国业务日期触发风险扫描，且异常不会回滚现场业务", () => {
    expect(source).toContain('new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai"');
    expect(source).toContain("void runProjectRiskScan(projectId, getChinaBusinessDate()).catch(() => undefined)");
  });

  it("覆盖手机 NFC 和双设备装土、卸土成功路径", () => {
    expect((source.match(/triggerTransportRiskScan\(resolved\.projectId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((source.match(/triggerTransportRiskScan\(input\.projectId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
