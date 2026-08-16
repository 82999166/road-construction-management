import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { mockWorkbenchUseQuery, mockAttendanceProjectsUseQuery, mockAttendanceStatusUseQuery, mockAttendancePunchUseMutation } = vi.hoisted(() => ({ mockWorkbenchUseQuery: vi.fn(), mockAttendanceProjectsUseQuery: vi.fn(), mockAttendanceStatusUseQuery: vi.fn(), mockAttendancePunchUseMutation: vi.fn() }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7, name: "劳务测试人员" },
    loading: false,
    isAuthenticated: true,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { mobile: { workbench: { useQuery: mockWorkbenchUseQuery }, attendanceProjects: { useQuery: mockAttendanceProjectsUseQuery } }, labor: { attendance: { myCheckInStatus: { useQuery: mockAttendanceStatusUseQuery }, checkIn: { useMutation: mockAttendancePunchUseMutation } } } },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/mobile", vi.fn()],
}));

import MobileWorkbench, { shouldRetryMobileWorkbenchRequest } from "./MobileWorkbench";

/** 工作台只展示服务端按岗位、部门和项目范围投影后的结果，前端不自行推导权限。 */
function renderWorkbench(data: unknown) {
  vi.stubGlobal("navigator", { onLine: true });
  mockWorkbenchUseQuery.mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn() });
  mockAttendanceProjectsUseQuery.mockReturnValue({ data: { projects: [] }, isLoading: false, error: null, refetch: vi.fn() });
  mockAttendanceStatusUseQuery.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
  mockAttendancePunchUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  return renderToStaticMarkup(<MobileWorkbench />);
}

describe("移动工作台部门业务投影", () => {
  it("展示当前部门并仅呈现服务端已授权的劳务业务入口", () => {
    const markup = renderWorkbench({
      user: {
        id: 7,
        name: "劳务测试人员",
        roleCodes: ["LABOR_MANAGER"],
        departments: [{ id: 31, name: "劳务管理部", type: "department" }],
        departmentModules: ["LABOR"],
      },
      menus: [
        { code: "WORKBENCH", title: "工作台" },
        { code: "LABOR", title: "劳务工资" },
        { code: "MESSAGES", title: "消息中心" },
      ],
      statistics: { pendingApprovals: 0, unreadMessages: 0, todayTrips: 0, pendingPayroll: 1 },
    });

    expect(markup).toContain("当前部门：劳务管理部");
    expect(markup).toContain("劳务工资");
    expect(markup).not.toContain("财务成本");
    expect(markup).toContain("已开通 1 项部门业务");
    expect(markup).not.toContain("待处理审批");
    expect(markup).not.toContain("现场取证已就绪");
    expect(markup).not.toContain('aria-label="打开未读消息"');
    expect(markup).toContain('aria-label="进入消息中心"');
  });

  it("没有部门业务授权时展示受控的空状态而不是猜测菜单", () => {
    const markup = renderWorkbench({
      user: { id: 7, name: "待授权人员", roleCodes: [], departments: [], departmentModules: [] },
      menus: [{ code: "WORKBENCH", title: "工作台" }, { code: "MESSAGES", title: "消息中心" }],
      statistics: { pendingApprovals: 0, unreadMessages: 0, todayTrips: 0, pendingPayroll: 0 },
    });

    expect(markup).toContain("当前账号尚未配置业务部门");
    expect(markup).toContain("当前账号尚未获分配业务岗位，请联系超级管理员授权。");
  });

  it("超级管理员明确显示全局业务授权来源，而不伪装成普通部门成员", () => {
    const markup = renderWorkbench({
      user: { id: 1, name: "系统管理员", roleCodes: ["ALL", "SUPER_ADMIN"], departments: [], departmentModules: [] },
      menus: [{ code: "WORKBENCH", title: "工作台" }, { code: "FINANCE", title: "财务成本" }, { code: "MESSAGES", title: "消息中心" }],
      statistics: { pendingApprovals: 0, unreadMessages: 0, todayTrips: 0, pendingPayroll: 0 },
    });

    expect(markup).toContain("当前权限：超级管理员（全局业务授权）");
    expect(markup).toContain("已启用超级管理员全局业务授权，接口仍执行服务端校验");
    expect(markup).toContain("返回统一管理后台");
  });

  it("仅对短暂网络传输失败作有限重试，并在浏览器恢复联网后重新同步", () => {
    const markup = renderWorkbench({
      user: { id: 7, name: "劳务测试人员", roleCodes: ["LABOR_MANAGER"], departments: [], departmentModules: ["LABOR"] },
      menus: [{ code: "WORKBENCH", title: "工作台" }, { code: "LABOR", title: "劳务工资" }],
      statistics: { pendingApprovals: 0, unreadMessages: 0, todayTrips: 0, pendingPayroll: 0 },
    });

    expect(markup).toContain("劳务工资");
    expect(shouldRetryMobileWorkbenchRequest(0, new Error("Failed to fetch"))).toBe(true);
    expect(shouldRetryMobileWorkbenchRequest(1, new Error("Network request failed"))).toBe(true);
    expect(shouldRetryMobileWorkbenchRequest(2, new Error("Failed to fetch"))).toBe(false);
    expect(shouldRetryMobileWorkbenchRequest(0, new Error("无权访问该项目"))).toBe(false);
    const [, queryOptions] = mockWorkbenchUseQuery.mock.calls.at(-1) ?? [];
    expect(queryOptions).toMatchObject({ refetchOnReconnect: true });
  });

  it("没有缓存摘要时以可恢复状态替代原始网络错误文本", () => {
    vi.stubGlobal("navigator", { onLine: true });
    mockWorkbenchUseQuery.mockReturnValue({ data: undefined, isLoading: false, error: new Error("Failed to fetch"), refetch: vi.fn() });
    mockAttendanceProjectsUseQuery.mockReturnValue({ data: { projects: [] }, isLoading: false, error: null, refetch: vi.fn() });
    mockAttendanceStatusUseQuery.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
    mockAttendancePunchUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    const markup = renderToStaticMarkup(<MobileWorkbench />);

    expect(markup).toContain("工作台暂时无法连接");
    expect(markup).toContain("重新同步");
    expect(markup).not.toContain("工作台加载失败：Failed to fetch");
  });
});
