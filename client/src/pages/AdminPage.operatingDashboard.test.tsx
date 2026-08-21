import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台交通施工指挥大屏", () => {
  it("复用项目和期间筛选并懒加载道路铁路施工指挥中心", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("admin.business.operatingDashboard.useQuery(businessStatisticsInput");
    expect(source).toContain('lazy(() => import("@/components/OperatingCommandCenter"))');
    expect(source).toContain("交通施工指挥数据");
    expect(source).toContain("<OperatingCommandCenter");
  });
});
