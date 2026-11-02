import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockUseAuth, mockOperatingDashboard } = vi.hoisted(() => ({ mockNavigate: vi.fn(), mockUseAuth: vi.fn(), mockOperatingDashboard: vi.fn() }));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("@/lib/trpc", () => ({ trpc: { admin: { business: { operatingDashboard: { useQuery: (...args: unknown[]) => mockOperatingDashboard(...args) } } } } }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mockNavigate] }));

import Home, { getChinaBusinessMonth } from "./Home";

const emptyDashboard = {
  scope: { projectId: null, period: null },
  finance: { totalIncome: 0, totalExpense: 0, receivable: 0, payable: 0, paidAmount: 0, invoiceAmount: 0, paymentRatio: null, settlementRatio: null, categories: [] },
  measurement: { declaredAmount: 0, approvedAmount: 0, settledAmount: 0, pendingCount: 0 },
  progress: { averageProgressPercent: null, reportCount: 0, approvedReportCount: 0 },
  resources: { payrollActualAmount: 0, dailyWageActualAmount: 0, transportTripCount: 0 },
};

describe("首页交通施工指挥大屏", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, loading: false, isAuthenticated: false });
    mockOperatingDashboard.mockReturnValue({ data: null, isFetching: false, refetch: vi.fn() });
  });

  it("根路径不再自动跳转，而是展示受控的交通施工指挥大屏登录入口", () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain("交通施工指挥中心");
    expect(markup).toContain("超级管理员查看数据大屏");
    expect(markup).toContain("进入我的业务工作台");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("以中国业务时区计算默认月，避免 UTC 月末误落入上月", () => {
    expect(getChinaBusinessMonth(new Date("2026-01-31T16:30:00.000Z"))).toBe("2026-02");
  });

  it("超级管理员以默认中国业务月查询并展示受控月份筛选与同步范围", () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin", name: "测试管理员" }, loading: false, isAuthenticated: true });
    mockOperatingDashboard.mockReturnValue({ data: emptyDashboard, isFetching: false, refetch: vi.fn() });

    const markup = renderToStaticMarkup(<Home />);

    expect(mockOperatingDashboard).toHaveBeenCalledWith(
      { projectId: undefined, period: expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])$/) },
      expect.objectContaining({ enabled: true })
    );
    expect(markup).toContain('type="month"');
    expect(markup).toContain('aria-label="大屏统计月份"');
    expect(markup).toMatch(/范围：全部项目 · \d{4}-(0[1-9]|1[0-2])/);
    expect(markup).toContain("查看全部期间");
    expect(markup).toContain("真实台账汇总");
  });

  it("保留受控月份、全部期间重置以及按 period 查询的实现", () => {
    const source = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
    expect(source).toContain("value={period}");
    expect(source).toContain("onChange={event => setPeriod(event.target.value)}");
    expect(source).toContain("onClick={() => setPeriod(\"\")}");
    expect(source).toContain("period: canReadOperatingDashboard ? period || undefined : undefined");
    expect(source).toContain('"全部项目 · 全部期间"');
  });
});
