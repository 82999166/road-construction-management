import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动业务影像快捷入口", () => {
  it("全局下线悬浮现场拍照入口，不影响业务页面内的影像功能", () => {
    const source = readFileSync(new URL("./MobileEvidenceShortcut.tsx", import.meta.url), "utf8");

    expect(source).toContain("全局悬浮取证入口已按业务要求下线");
    expect(source).toContain("return null");
    expect(source).not.toContain("打开现场拍照与票据识别");
  });
});
