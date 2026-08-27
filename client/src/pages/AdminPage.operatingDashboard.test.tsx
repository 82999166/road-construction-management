import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台经营数据汇总", () => {
  it("复用项目和期间筛选并恢复卡片式资金、票据、进度与分类付款明细", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("admin.business.operatingDashboard.useQuery(businessStatisticsInput");
    expect(source).toContain("经营数据汇总");
    expect(source).toContain("总欠款（应收+应付）");
    expect(source).toContain("已开发票");
    expect(source).toContain("结算比");
    expect(source).toContain("项目进度");
    expect(source).toContain("支出类别");
  });
});
