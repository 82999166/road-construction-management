import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import OperatingCommandCenter, { type OperatingDashboardData } from "./OperatingCommandCenter";

const baseDashboard: OperatingDashboardData = {
  scope: { projectId: null, period: "2026-11" },
  finance: { totalIncome: 0, totalExpense: 0, receivable: 0, payable: 0, paidAmount: 0, invoiceAmount: 0, paymentRatio: null, settlementRatio: null, categories: [] },
  measurement: { declaredAmount: 0, approvedAmount: 0, settledAmount: 0, pendingCount: 0 },
  progress: { averageProgressPercent: null, reportCount: 0, approvedReportCount: 0 },
  resources: { payrollActualAmount: 0, dailyWageActualAmount: 0, transportTripCount: 0 },
};

describe("交通施工指挥中心大屏", () => {
  it("呈现道路铁路施工布局并保持真实台账、资金、进度和运输业务跳转", () => {
    const source = readFileSync(new URL("./OperatingCommandCenter.tsx", import.meta.url), "utf8");
    expect(source).toContain("交通施工指挥中心");
    expect(source).toContain("施工线路与工程进度");
    expect(source).toContain("运输与现场动态");
    expect(source).toContain("资金结算态势");
    expect(source).toContain("各类成本、付款与结算明细");
    expect(source).toContain("真实台账汇总");
    expect(source).toContain("/admin/transport");
    expect(source).toContain("/admin/construction");
    expect(source).toContain("/admin/finance");
  });

  it("月度费用面板展示核定应付/成本和实际付款两套真实口径及四类导航", () => {
    const onNavigate = vi.fn();
    const markup = renderToStaticMarkup(
      <OperatingCommandCenter
        data={{
          ...baseDashboard,
          monthlyCosts: {
            totalAccrualAmount: 1000,
            totalCashAmount: 600,
            categories: [
              { category: "人员工资", accrualAmount: 400, cashAmount: 250, accrualCount: 2, cashCount: 1, sourceHint: "工资结算单" },
              { category: "机械租金", accrualAmount: 300, cashAmount: 200, accrualCount: 1, cashCount: 1, sourceHint: "机械月结单" },
              { category: "车辆运费", accrualAmount: 200, cashAmount: 100, accrualCount: 3, cashCount: 1, sourceHint: "运输结算单" },
              { category: "生活开支", accrualAmount: 100, cashAmount: 50, accrualCount: 1, cashCount: 1, sourceHint: "财务费用单" },
            ],
          },
        }}
        scopeLabel="全部项目 · 2026-11"
        period="2026-11"
        isRefreshing={false}
        onRefresh={vi.fn()}
        onNavigate={onNavigate}
      />
    );

    expect(markup).toContain("本月五类费用");
    expect(markup).toContain("已核定应付/成本合计");
    expect(markup).toContain("实际付款合计");
    expect(markup).toContain("两项为不同口径，不相加");
    expect(markup).toContain("人员工资");
    expect(markup).toContain("机械租金");
    expect(markup).toContain("车辆运费");
    expect(markup).toContain("生活开支");
    expect(markup).toContain("应付/成本来源 2 单 · 付款来源 1 单 · 工资结算单");
    expect(markup).toContain("¥1,000.00");
    expect(markup).toContain("¥600.00");
  });

  it("兼容服务端 items/TOTAL 月度费用聚合结构", () => {
    const markup = renderToStaticMarkup(
      <OperatingCommandCenter
        data={{
          ...baseDashboard,
          monthlyCosts: {
            items: [
              { code: "TOTAL", name: "月度费用统计（五类合计）", accrualAmount: 500, cashAmount: 320, accrualCount: 5, cashCount: 3, sourceHint: "汇总" },
              { code: "PAYROLL", name: "人员工资", accrualAmount: 500, cashAmount: 320, accrualCount: 5, cashCount: 3, sourceHint: "工资结算" },
            ],
          },
        }}
        scopeLabel="全部项目 · 2026-11"
        period="2026-11"
        isRefreshing={false}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(markup).toContain("¥500.00");
    expect(markup).toContain("¥320.00");
    expect(markup).toContain("应付/成本来源 5 单 · 付款来源 3 单 · 工资结算");
  });

  it("服务端未返回 monthlyCosts 时回退零值与真实记录空态，全部期间不误标本月", () => {
    const markup = renderToStaticMarkup(
      <OperatingCommandCenter
        data={baseDashboard}
        scopeLabel="全部项目 · 全部期间"
        isRefreshing={false}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(markup).toContain("五类费用（全部期间）");
    expect(markup).toContain("暂无有效真实记录");
    expect(markup).toContain("¥0.00");
    expect(markup).toContain("不展示账户或付款账号信息");
  });

  it("以明确的可选 monthlyCosts 结构保留四类业务路由和劳务口径提示", () => {
    const source = readFileSync(new URL("./OperatingCommandCenter.tsx", import.meta.url), "utf8");
    expect(source).toContain("monthlyCosts?: MonthlyCosts");
    expect(source).toContain("/admin/labor");
    expect(source).toContain("/admin/machinery");
    expect(source).toContain("/admin/transport");
    expect(source).toContain("/admin/finance");
    expect(source).toContain("劳务执行台账（独立口径）");
    expect(source).toContain("本卡反映劳务执行台账，不与月度费用付款合计相加。");
  });
});
