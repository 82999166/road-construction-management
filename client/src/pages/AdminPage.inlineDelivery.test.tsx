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
});
