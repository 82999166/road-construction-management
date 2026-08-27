import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockUseAuth, mockOperatingDashboard } = vi.hoisted(() => ({ mockNavigate: vi.fn(), mockUseAuth: vi.fn(), mockOperatingDashboard: vi.fn() }));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("@/lib/trpc", () => ({ trpc: { admin: { business: { operatingDashboard: { useQuery: (...args: unknown[]) => mockOperatingDashboard(...args) } } } } }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mockNavigate] }));

import Home from "./Home";

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

  it("超级管理员身份在首页启用真实经营数据查询", () => {
    mockUseAuth.mockReturnValue({ user: { role: "admin", name: "测试管理员" }, loading: false, isAuthenticated: true });
    mockOperatingDashboard.mockReturnValue({ data: { scope: { projectId: null, period: null }, finance: { totalIncome: 0, totalExpense: 0, receivable: 0, payable: 0, paidAmount: 0, invoiceAmount: 0, paymentRatio: null, settlementRatio: null, categories: [] }, measurement: { declaredAmount: 0, approvedAmount: 0, settledAmount: 0, pendingCount: 0 }, progress: { averageProgressPercent: null, reportCount: 0, approvedReportCount: 0 }, resources: { payrollActualAmount: 0, dailyWageActualAmount: 0, transportTripCount: 0 } }, isFetching: false, refetch: vi.fn() });
    const markup = renderToStaticMarkup(<Home />);
    expect(mockOperatingDashboard).toHaveBeenCalledWith({ projectId: undefined, period: undefined }, expect.objectContaining({ enabled: true }));
    expect(markup).toContain("真实台账汇总");
  });
});
