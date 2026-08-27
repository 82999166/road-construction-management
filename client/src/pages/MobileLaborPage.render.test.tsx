import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const runtime = vi.hoisted(() => ({
  projectOptions: vi.fn(),
  workers: vi.fn(),
  attendance: vi.fn(),
  checkInStatus: vi.fn(),
  payroll: vi.fn(),
  dailyWages: vi.fn(),
  summary: vi.fn(),
  certificates: vi.fn(),
  workbench: vi.fn(),
  mutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 901, name: "测试劳资管理员" },
    loading: false,
    isAuthenticated: true,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useManagementPermissions", () => ({
  useManagementPermissions: () => ({ isSuperAdmin: false }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    labor: {
      projectOptions: { useQuery: runtime.projectOptions },
      listWorkers: { useQuery: runtime.workers },
      summary: { useQuery: runtime.summary },
      saveWorker: { useMutation: runtime.mutation },
      attendance: {
        list: { useQuery: runtime.attendance },
        save: { useMutation: runtime.mutation },
        myCheckInStatus: { useQuery: runtime.checkInStatus },
        checkIn: { useMutation: runtime.mutation },
      },
      payroll: {
        list: { useQuery: runtime.payroll },
        save: { useMutation: runtime.mutation },
        submit: { useMutation: runtime.mutation },
        approve: { useMutation: runtime.mutation },
        pay: { useMutation: runtime.mutation },
        void: { useMutation: runtime.mutation },
      },
      dailyWage: {
        list: { useQuery: runtime.dailyWages },
        save: { useMutation: runtime.mutation },
        submit: { useMutation: runtime.mutation },
        review: { useMutation: runtime.mutation },
        pay: { useMutation: runtime.mutation },
      },
      certificates: {
        list: { useQuery: runtime.certificates },
        upload: { useMutation: runtime.mutation },
      },
    },
    mobile: { workbench: { useQuery: runtime.workbench } },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/mobile/labor", vi.fn()],
}));

import MobileLaborPage from "./MobileLaborPage";

const emptyQuery = { isLoading: false, error: null, refetch: vi.fn() };

function prepareAuthorizedLaborQueries() {
  runtime.projectOptions.mockReturnValue({ ...emptyQuery, data: [{ id: 30001, name: "测试验收项目-劳务工资" }] });
  runtime.workers.mockReturnValue({ ...emptyQuery, data: [{
    id: 1,
    projectId: 30001,
    realName: "测试验收人员-王工",
    teamName: "测试路基班组",
    identityNoMasked: "**************1234",
    phoneMasked: "*******8000",
    bankAccountMasked: "************7890",
    bankName: "测试银行",
    identityVerificationStatus: "verified",
    identityVerificationNote: "测试实名核验通过",
    attendanceStatus: "active",
    entryDate: new Date("2026-07-01T00:00:00.000Z"),
  }] });
  runtime.attendance.mockReturnValue({ ...emptyQuery, data: [{
    id: 11,
    workerId: 1,
    workerName: "测试验收人员-王工",
    teamName: "测试路基班组",
    attendanceDate: new Date("2026-07-02T00:00:00.000Z"),
    workHours: 8,
    overtimeHours: 1,
    source: "mobile",
    status: "confirmed",
    note: "测试考勤",
  }] });
  runtime.checkInStatus.mockReturnValue({ ...emptyQuery, data: { checkedIn: false, businessDate: "2026-08-12", checkIn: null } });
  runtime.payroll.mockReturnValue({ ...emptyQuery, data: [{
    id: 21,
    workerId: 1,
    workerName: "测试验收人员-王工",
    teamName: "测试路基班组",
    bankAccountMasked: "************7890",
    status: "reviewing",
    payableAmount: "8500.00",
    deductionAmount: "0.00",
    actualAmount: "8500.00",
    paymentReference: null,
  }] });
  runtime.dailyWages.mockReturnValue({ ...emptyQuery, data: [] });
  runtime.summary.mockReturnValue({ ...emptyQuery, data: {
    activeWorkers: 1,
    attendanceDays: 3,
    awaitingReviewCount: 1,
    actualAmount: 8500,
    payableAmount: 8500,
    deductionAmount: 0,
    awaitingReviewAmount: 8500,
  } });
  runtime.certificates.mockReturnValue({ ...emptyQuery, data: [] });
  runtime.workbench.mockReturnValue({ ...emptyQuery, data: { user: { roleCodes: ["LABOR_MANAGER"] } } });
}

describe("移动劳务页真实数据与普通人员操作投影", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareAuthorizedLaborQueries();
  });

  it("使用服务端已授权项目的人员、考勤、工资统计与打印数据渲染页面，不依赖静态示例数据", () => {
    const markup = renderToStaticMarkup(<MobileLaborPage />);

    expect(markup).toContain("测试验收项目-劳务工资");
    expect(markup).toContain("测试验收人员-王工");
    expect(markup).toContain("¥8,500.00");
    expect(markup).toContain("打印汇总");
    expect(markup).not.toContain("劳务工资统计表");
    expect(runtime.workers).toHaveBeenCalledWith(expect.objectContaining({ projectId: 30001 }), expect.anything());
    expect(runtime.attendance).toHaveBeenCalledWith(expect.objectContaining({ projectId: 30001 }), expect.anything());
    expect(runtime.payroll).toHaveBeenCalledWith(expect.objectContaining({ projectId: 30001 }), expect.anything());
    expect(runtime.summary).toHaveBeenCalledWith(expect.objectContaining({ projectId: 30001 }), expect.anything());
  });

  it("普通劳资管理员在审核中工资条上看不到会计审核、财务发放或作废入口", () => {
    const markup = renderToStaticMarkup(<MobileLaborPage />);

    expect(markup).not.toContain("审核通过");
    expect(markup).not.toContain("确认发放");
    expect(markup).not.toContain("作废");
  });

  it("工资统计打印使用当前授权项目、期间、服务端工资条与汇总生成独立 A4 文档", () => {
    const source = readFileSync(new URL("./MobileLaborPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("const printPayrollSummary");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("当前账号已授权项目与人员");
    expect(source).toContain("工资条 ${statements.length} 份");
    expect(source).toContain("onClick={printPayrollSummary}");
    expect(source).not.toContain("window.print()");
  });

  it("将人员进退场日期回填为设备日期，并按中国时区展示打卡时间", () => {
    const source = readFileSync(new URL("./MobileLaborPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("function formatChinaTime");
    expect(source).toContain("return full ? full.slice(-8, -3) : \"—\"");
    expect(source).toContain("toDeviceDateInput(worker.entryDate)");
    expect(source).toContain("toDeviceDateInput(worker.exitDate)");
    expect(source).toContain("formatChinaTime(checkInStatus.data.checkIn!.checkedInAt)");
    expect(source).toContain("formatChinaTime(checkInStatus.data.checkOut!.checkedOutAt)");
    expect(source).not.toContain("checkedInAt).toLocaleTimeString");
    expect(source).not.toContain("checkedOutAt).toLocaleTimeString");
  });

  it("项目授权查询失败时使用中文安全提示并提供重新获取入口", () => {
    runtime.projectOptions.mockReturnValue({ ...emptyQuery, error: new Error("Failed to fetch internal permission payload") });

    const markup = renderToStaticMarkup(<MobileLaborPage />);

    expect(markup).toContain("暂时无法读取已授权项目");
    expect(markup).toContain("重新获取授权项目");
    expect(markup).not.toContain("Failed to fetch internal permission payload");
  });
});
