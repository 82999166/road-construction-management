import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import OperatingCommandCenter, {
  type OperatingDashboardData,
} from "./OperatingCommandCenter";

const data: OperatingDashboardData = {
  scope: { projectId: null, period: "2026-11" },
  finance: {
    totalIncome: 3230.41,
    totalExpense: 0,
    receivable: 0,
    payable: 0,
    paidAmount: 0,
    invoiceAmount: 0,
    paymentRatio: null,
    settlementRatio: null,
    categories: [],
  },
  measurement: {
    declaredAmount: 0,
    approvedAmount: 0,
    settledAmount: 0,
    pendingCount: 0,
  },
  progress: {
    averageProgressPercent: 0,
    reportCount: 2,
    approvedReportCount: 1,
  },
  resources: {
    payrollActualAmount: 0,
    dailyWageActualAmount: 0,
    transportTripCount: 25,
  },
  monthlyCosts: {
    totalAccrualAmount: 1000,
    totalCashAmount: 600,
    categories: [
      {
        category: "人员工资",
        accrualAmount: 1000,
        cashAmount: 600,
        accrualCount: 2,
        cashCount: 1,
      },
    ],
  },
};
const props = {
  data,
  scopeLabel: "全部项目 · 2026-11",
  period: "2026-11",
  isRefreshing: false,
  onRefresh: vi.fn(),
  onNavigate: vi.fn(),
};

describe("数据大屏均衡布局", () => {
  it("六板块位于同一栅格的前两行，费用和详单通栏，不再在中间单独堆叠", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<OperatingCommandCenter {...props} />);
    });
    const grid = renderer.root.findByProps({ "data-command-grid": "balanced" });
    const panels = grid.children.filter(
      child => typeof child !== "string"
    ) as TestRenderer.ReactTestInstance[];
    expect(panels.map(panel => panel.props.title)).toEqual([
      "资金结算态势",
      "施工线路与工程进度",
      "运输与现场动态",
      "劳务执行台账（独立口径）",
      "计量、产值与成本构成",
      "项目风险与控制",
      "本月五类费用",
      "各类成本、付款与结算明细",
    ]);
    expect(panels[6].props.className).toBe("col-span-full");
    expect(panels[7].props.className).toBe("col-span-full");
    await act(async () => renderer.unmount());
  });

  it("费用在宽屏四列、窄屏单列或双列，不创建手机隐式三列", () => {
    const markup = renderToStaticMarkup(<OperatingCommandCenter {...props} />);
    expect(markup).toContain("items-stretch");
    expect(markup).toContain("sm:grid-cols-2 xl:grid-cols-4");
    expect(markup).toContain('aria-label="本月五类费用"');
    expect(markup).not.toContain('class="col-span-3');
    expect(markup).toContain("¥3,230.41");
    expect(markup).toContain("25 趟");
    expect(markup).toContain(
      "本卡反映劳务执行台账，不与月度费用付款合计相加。"
    );
  });

  it("四类费用卡片仍点击进入各自PC业务页，刷新回调保持不变", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const navigate = vi.fn(),
      refresh = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <OperatingCommandCenter
          {...props}
          onNavigate={navigate}
          onRefresh={refresh}
        />
      );
    });
    for (const [label, path] of [
      ["人员工资", "/admin/labor"],
      ["机械租金", "/admin/machinery"],
      ["车辆运费", "/admin/transport"],
      ["生活开支", "/admin/finance"],
    ]) {
      const card = renderer.root
        .findAllByType("button")
        .find(button =>
          button.findAllByType("p").some(p => p.children.includes(label))
        );
      expect(card).toBeDefined();
      await act(async () => card!.props.onClick());
      expect(navigate).toHaveBeenLastCalledWith(path);
    }
    const button = renderer.root
      .findAllByType("button")
      .find(node => node.children.includes("刷新数据"));
    await act(async () => button!.props.onClick());
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("不增加入场上弹动画、不通过固定整屏高度或占位数据填补两侧", () => {
    const source = readFileSync(
      new URL("./OperatingCommandCenter.tsx", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(
      /slide-in-from-bottom|animate-in|motion\.|h-screen|grid-rows-\[.*vh/
    );
    expect(source).toContain("暂无有效真实记录");
    expect(source).toContain("金额单位：元");
    expect(source).toContain("不展示账户或付款账号信息");
  });
});
