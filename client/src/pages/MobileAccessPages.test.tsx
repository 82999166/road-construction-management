import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const query = vi.fn(() => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }));
  const mutation = vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }));
  const makeProcedureProxy = (): Record<string | symbol, unknown> => new Proxy({}, {
    get: (_target, key) => {
      if (key === "useQuery") return query;
      if (key === "useMutation") return mutation;
      if (key === "useUtils") return () => makeProcedureProxy();
      if (key === "invalidate" || key === "refetch") return vi.fn();
      return makeProcedureProxy();
    },
  });

  return {
    auth: { isAuthenticated: false, loading: false, authLoadingTimedOut: false, refresh: vi.fn() },
    trpc: makeProcedureProxy(),
  };
});

vi.mock("@/lib/trpc", () => ({ trpc: runtime.trpc }));
vi.mock("../_core/hooks/useAuth", () => ({ useAuth: () => runtime.auth }));
vi.mock("wouter", () => ({ useLocation: () => ["/mobile", vi.fn()] }));

import MobileFinancePage from "./MobileFinancePage";
import MobileLaborPage from "./MobileLaborPage";
import MobileWorkbench from "./MobileWorkbench";

const protectedMobilePages = [
  ["移动工作台", MobileWorkbench],
  ["劳务工资", MobileLaborPage],
  ["财务成本", MobileFinancePage],
] as const;

describe("移动业务页面认证与授权门禁", () => {
  beforeEach(() => {
    runtime.auth.isAuthenticated = false;
    runtime.auth.loading = false;
    runtime.auth.authLoadingTimedOut = false;
    runtime.auth.refresh = vi.fn();
  });

  it.each(protectedMobilePages)("%s 在未登录时显示重新加载和独立登录页入口", (_name, Page) => {
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain("重新加载");
    expect(markup).toContain("前往登录页");
  });

  it.each(protectedMobilePages)("%s 在身份核验超时时显示超时降级而非持续加载", (_name, Page) => {
    runtime.auth.loading = true;
    runtime.auth.authLoadingTimedOut = true;
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain("身份核验响应超时");
    expect(markup).toContain("重新加载");
    expect(markup).toContain("前往登录页");
  });
});
