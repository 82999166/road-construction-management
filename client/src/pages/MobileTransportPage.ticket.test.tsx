import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端运输刷卡票据", () => {
  it("提供装土卸土票据入口、保存后刷卡指引与自动计费通知文案", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("刷卡票据");
    expect(source).toContain("运输刷卡票据");
    expect(source).toContain("新建装土票据");
    expect(source).toContain("开始装土刷卡");
    expect(source).toContain("开始卸土刷卡");
    expect(source).toContain("装土票据确认成功");
    expect(source).toContain("卸土票据确认成功，已自动核算运费并通知司机和主管");
    expect(source).toContain("recordLoadEvent.mutate");
    expect(source).toContain("recordUnloadEvent.mutate");
    expect(source).toContain("openTripDialog(true)");
    expect(source).toContain("装土票据 → 卸土票据");
  });
});
