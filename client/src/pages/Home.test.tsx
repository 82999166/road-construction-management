import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactTestRenderer } from "react-test-renderer";
import { DEFAULT_SITE_CONFIGURATION } from "@shared/siteOperations";
const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  navigate: vi.fn(),
  projects: vi.fn(),
  dashboard: vi.fn(),
  config: vi.fn(),
  weather: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth() }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    siteOperations: {
      projects: { useQuery: (...a: unknown[]) => mocks.projects(...a) },
      dashboard: { useQuery: (...a: unknown[]) => mocks.dashboard(...a) },
      getConfiguration: { useQuery: (...a: unknown[]) => mocks.config(...a) },
      getWeather: { useQuery: (...a: unknown[]) => mocks.weather(...a) },
    },
  },
}));
import Home, { getChinaBusinessMonth } from "./Home";
import { getChinaBusinessDate } from "@/lib/siteOperations";
let tree: ReactTestRenderer;
const result = (data?: unknown) => ({
  data,
  isFetching: false,
  isLoading: !data,
  isError: false,
  refetch: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    activeElement: null,
  });
  vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem: vi.fn() });
  mocks.auth.mockReturnValue({
    user: null,
    loading: false,
    isAuthenticated: false,
  });
  mocks.projects.mockReturnValue(result([]));
  mocks.dashboard.mockReturnValue(result());
  mocks.config.mockReturnValue(result());
  mocks.weather.mockReturnValue(result());
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.unstubAllGlobals();
});
describe("首页现场运行大屏", () => {
  it("未登录及非admin不启用任何敏感现场查询", () => {
    let markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain("交通施工指挥中心");
    expect(markup).toContain("超级管理员查看现场大屏");
    expect(markup).not.toContain("资金");
    expect(mocks.navigate).not.toHaveBeenCalled();
    for (const q of [
      mocks.projects,
      mocks.dashboard,
      mocks.config,
      mocks.weather,
    ])
      expect(q.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: false });
    mocks.auth.mockReturnValue({
      user: { role: "user", id: 2 },
      loading: false,
      isAuthenticated: true,
    });
    markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain("无现场大屏权限");
    for (const q of [
      mocks.projects,
      mocks.dashboard,
      mocks.config,
      mocks.weather,
    ])
      expect(q.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: false });
  });
  it("保留北京时间月工具但默认按北京时间当天，不再查旧财务接口", () => {
    expect(getChinaBusinessMonth(new Date("2026-01-31T16:30:00Z"))).toBe(
      "2026-02"
    );
    expect(getChinaBusinessDate(new Date("2026-01-31T16:30:00Z"))).toBe(
      "2026-02-01"
    );
  });
  it("默认首个active项目，项目偏好按账号隔离且日期切换走真实query", async () => {
    mocks.auth.mockReturnValue({
      user: { role: "admin", id: 7 },
      loading: false,
      isAuthenticated: true,
    });
    mocks.projects.mockReturnValue(
      result([
        { id: 1, name: "规划", status: "planning" },
        { id: 2, name: "施工", status: "active" },
      ])
    );
    mocks.config.mockImplementation(i =>
      result({
        projectId: i.projectId,
        configuration: DEFAULT_SITE_CONFIGURATION,
        videos: [],
      })
    );
    await act(async () => {
      tree = create(<Home />);
    });
    expect(mocks.dashboard.mock.calls.at(-1)?.[0]).toEqual({
      projectId: 2,
      businessDate: getChinaBusinessDate(),
    });
    expect(mocks.dashboard.mock.calls.at(-1)?.[1]).toMatchObject({
      enabled: true,
      refetchInterval: 45000,
      refetchIntervalInBackground: false,
    });
    expect(localStorage.getItem).toHaveBeenCalledWith(
      "site-operations-project:7"
    );
    await act(async () =>
      tree.root
        .findByProps({ "aria-label": "现场项目" })
        .props.onChange({ target: { value: "1" } })
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "site-operations-project:7",
      "1"
    );
    expect(mocks.dashboard.mock.calls.at(-1)?.[0].projectId).toBe(1);
    await act(async () =>
      tree.root
        .findByProps({ "aria-label": "现场统计日期" })
        .props.onChange({ target: { value: "2026-10-01" } })
    );
    expect(mocks.dashboard.mock.calls.at(-1)?.[0]).toEqual({
      projectId: 1,
      businessDate: "2026-10-01",
    });
    mocks.auth.mockReturnValue({
      user: { role: "admin", id: 8 },
      loading: false,
      isAuthenticated: true,
    });
    await act(async () => tree.update(<Home />));
    expect(localStorage.getItem).toHaveBeenCalledWith(
      "site-operations-project:8"
    );
    expect(mocks.dashboard.mock.calls.at(-1)?.[0].projectId).toBe(2);
  });
  it("后台Tab隐藏暂停45秒刷新，查询失败不是暂无项目", async () => {
    mocks.auth.mockReturnValue({
      user: { role: "admin", id: 7 },
      loading: false,
      isAuthenticated: true,
    });
    mocks.projects.mockReturnValue(
      result([{ id: 1, name: "施工", status: "active" }])
    );
    await act(async () => {
      tree = create(<Home />);
    });
    const f = (document.addEventListener as any).mock.calls.find(
      (x: any[]) => x[0] === "visibilitychange"
    )[1];
    Object.assign(document, { visibilityState: "hidden" });
    await act(async () => f());
    expect(mocks.dashboard.mock.calls.at(-1)?.[1].refetchInterval).toBe(false);
    mocks.projects.mockReturnValue({ ...result([]), isError: true });
    await act(async () => tree.update(<Home />));
    expect(JSON.stringify(tree.toJSON())).toContain(
      "读取失败，旧数据不作为当前结果。"
    );
    expect(JSON.stringify(tree.toJSON())).not.toContain("暂无可选项目");
  });
});
