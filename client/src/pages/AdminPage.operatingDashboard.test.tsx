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

  it("按当前项目和期间把经营数据、支出分类与模块统计打印为独立A4文档", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const businessSection = source.slice(source.indexOf("const printBusinessGovernanceReport"), source.indexOf("const renderFinance"));

    expect(businessSection).toContain("const printBusinessGovernanceReport = () =>");
    expect(businessSection).toContain("经营数据汇总与业务统计");
    expect(businessSection).toContain("统计范围：${escapePrintHtml(projectName)} · ${escapePrintHtml(periodLabel)}");
    expect(businessSection).toContain("支出分类、待付与已付明细");
    expect(businessSection).toContain("业务模块记录统计");
    expect(businessSection).toContain("openA4LandscapePrintDocument");
    expect(businessSection).not.toContain("window.print()");
    expect(source).toContain('onClick={printBusinessGovernanceReport}');
    expect(source).toContain("打印当前筛选明细与汇总");
  });
});
