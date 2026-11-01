import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientRoot = resolve(import.meta.dirname, "..");
const source = (relativePath: string) => readFileSync(resolve(clientRoot, relativePath), "utf8");

describe("高频移动录入的本机草稿与退出确认", () => {
  it("统一守卫支持继续填写、放弃填写、本机草稿和浏览器离开提醒", () => {
    const guard = source("src/contexts/MobileFormProtectionContext.tsx");
    const app = source("src/App.tsx");
    const navigation = source("src/components/MobileBottomNavigation.tsx");

    expect(guard).toContain("保存本机草稿并退出");
    expect(guard).toContain("放弃填写");
    expect(guard).toContain("继续填写");
    expect(guard).toContain("beforeunload");
    expect(guard).toContain("useMobileSafeNavigate");
    expect(app).toContain("MobileFormProtectionProvider");
    expect(navigation).toContain("useMobileSafeNavigate");
  });

  it("九类高频现场表单均有本机草稿、退出确认和安全导航入口", () => {
    const pages = [
      "MobileConstructionPage.tsx", "MobileMachineryPage.tsx", "MobileDieselPage.tsx",
      "MobilePurchasingPage.tsx", "MobileTransportPage.tsx", "MobileLaborPage.tsx",
      "MobileFinancePage.tsx", "MobileMeasurementPage.tsx", "MobileSubcontractPage.tsx",
    ];

    for (const page of pages) {
      const content = source(`src/pages/${page}`);
      expect(content, page).toContain("useMobileFormProtection");
      expect(content, page).toContain("useMobileSafeNavigate");
      expect(content, page).toContain("保存本机草稿");
    }
  });

  it("草稿帮助文案明确照片和文件不能存到设备草稿", () => {
    for (const page of ["MobileConstructionPage.tsx", "MobileMachineryPage.tsx", "MobileDieselPage.tsx", "MobilePurchasingPage.tsx", "MobileTransportPage.tsx"]) {
      const content = source(`src/pages/${page}`);
      expect(content, page).toMatch(/照片.*(?:不会|需重新)|凭证.*需重新|文件.*不会/);
    }
  });
});
