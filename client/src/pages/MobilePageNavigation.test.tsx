import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("移动业务页个人中心导航", () => {
  it("机械、运输和影像取证页面均将“我的”带回移动个人中心", async () => {
    const pages = ["MobileMachineryPage.tsx", "MobileTransportPage.tsx", "MobileEvidencePage.tsx"];
    const sources = await Promise.all(pages.map(page => readFile(new URL(`./${page}`, import.meta.url), "utf8")));
    for (const source of sources) {
      expect(source).toContain('navigate("/mobile/profile")');
      expect(source).not.toContain('navigate("/")');
    }
  });
});
