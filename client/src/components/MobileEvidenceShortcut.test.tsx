import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动业务影像快捷入口", () => {
  it("不再为机械管理显示重复的现场拍照悬浮入口，同时保留其他业务来源", () => {
    const source = readFileSync(new URL("./MobileEvidenceShortcut.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('"/mobile/machinery": "machinery"');
    expect(source).toContain('"/mobile/construction": "construction"');
    expect(source).toContain('"/mobile/transport": "transport"');
    expect(source).toContain('"/mobile/measurement": "measurement"');
  });
});
