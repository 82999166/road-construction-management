import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isInlineBroadcastDeliveryExpanded } from "@/lib/adminWorkspaceState";

describe("范围通知卡片内投递明细", () => {
  it("只展开被当前点击的通知卡片", () => {
    expect(isInlineBroadcastDeliveryExpanded(32, 32)).toBe(true);
    expect(isInlineBroadcastDeliveryExpanded(32, 31)).toBe(false);
  });

  it("未选择通知时不展开任何投递明细", () => {
    expect(isInlineBroadcastDeliveryExpanded(undefined, 32)).toBe(false);
  });

  it("仅保留当前范围通知工作区，避免未调用的旧群发逻辑被误恢复", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("const renderBroadcast = () =>");
    expect(source).not.toContain("const renderLegacyBroadcast = () =>");
  });
});
