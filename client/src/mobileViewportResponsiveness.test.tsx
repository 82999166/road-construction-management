import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("移动端主流手机宽度自适应", () => {
  it("声明移动视口和安全区，并针对微信错误宽视口的触摸设备全宽显示", () => {
    const html = source("index.html");
    const css = source("src/index.css");

    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("interactive-widget=resizes-content");
    expect(css).toContain("(pointer: coarse) and (max-width: 1024px)");
    expect(css).toContain(".mobile-viewport-shell");
    expect(css).toContain(".mobile-bottom-navigation");
    expect(css).toContain("max-width: none");
  });

  it("所有使用手机宽度壳层的业务页均带统一自适应标记", () => {
    const pages = [
      "MobileAttendancePage.tsx", "MobileConstructionPage.tsx", "MobileDieselPage.tsx", "MobileEvidencePage.tsx",
      "MobileFinancePage.tsx", "MobileLaborPage.tsx", "MobileMachineryPage.tsx", "MobileMeasurementPage.tsx",
      "MobileMessagesPage.tsx", "MobileProfilePage.tsx", "MobilePurchasingPage.tsx", "MobileSubcontractPage.tsx",
      "MobileTransportPage.tsx", "MobileWorkbench.tsx",
    ];
    for (const page of pages) {
      expect(source(`src/pages/${page}`), page).toContain("mobile-viewport-shell");
    }
  });

  it("全局固定底部导航不再继承桌面居中预览宽度", () => {
    const navigation = source("src/components/MobileBottomNavigation.tsx");

    expect(navigation).toContain("mobile-bottom-navigation fixed right-0 bottom-0 left-0");
    expect(navigation).toContain("w-full max-w-none");
    expect(navigation).not.toContain("left-1/2");
  });

  it("粗体与放大版面通过根显示偏好令牌生效，不使用破坏触控定位的缩放变换", () => {
    const css = source("src/index.css");

    expect(css).toContain('html[data-text-weight="bold"]');
    expect(css).toContain('html[data-layout-scale="large"]');
    expect(css).toContain("--ui-control-min-height");
    expect(css).toContain("font-size: 112.5%");
    expect(css).not.toContain("html[data-layout-scale=\"large\"] {\n  zoom:");
  });

  it("Portal 弹窗不依赖业务页面壳层，并在手机端将录入网格安全收为单列", () => {
    const css = source("src/index.css");

    expect(css).toContain('[data-slot="dialog-content"]');
    expect(css).toContain('[data-slot="alert-dialog-content"]');
    expect(css).toContain('[data-slot="select-trigger"]');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).not.toContain('.mobile-viewport-shell [data-slot="dialog-content"]');
  });
});
