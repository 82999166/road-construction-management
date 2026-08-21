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

describe("应用级路由性能", () => {
  it("移动业务页面按路由懒加载，并由统一加载边界承接加载状态", async () => {
    const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
    expect(source).toContain('const MobileTransportPage = lazy(() => import("./pages/MobileTransportPage"))');
    expect(source).toContain('const MobileFinancePage = lazy(() => import("./pages/MobileFinancePage"))');
    expect(source).toContain("<Suspense fallback=");
    expect(source).not.toContain('import MobileTransportPage from "./pages/MobileTransportPage"');
  });
});
