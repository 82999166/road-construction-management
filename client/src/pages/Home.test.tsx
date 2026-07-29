import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConsumePostLoginReturnPath, mockNavigate, mockUseAuth } = vi.hoisted(() => ({
  mockConsumePostLoginReturnPath: vi.fn(() => "/mobile/finance?project=project-1"),
  mockNavigate: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/authNavigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authNavigation")>();
  return {
    ...actual,
    consumePostLoginReturnPath: mockConsumePostLoginReturnPath,
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
  };
});

import Home from "./Home";

describe("首页 OAuth 回跳", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { name: "项目测试成员" },
      loading: false,
      isAuthenticated: true,
    });
  });

  it("认证成功后消费一次受控返回路径并回到原业务页", () => {
    Home();

    expect(mockConsumePostLoginReturnPath).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/mobile/finance?project=project-1");
  });

  it("未登录访问根路径时进入独立登录页并保留统一管理入口回跳", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, isAuthenticated: false });

    Home();

    expect(mockConsumePostLoginReturnPath).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/login?returnTo=%2Fadmin");
  });

  it("认证查询超时降级为未登录后同样进入独立登录页", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, isAuthenticated: false, authLoadingTimedOut: true });

    Home();

    expect(mockNavigate).toHaveBeenCalledWith("/login?returnTo=%2Fadmin");
  });
});
