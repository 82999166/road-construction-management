import { describe, expect, it, vi } from "vitest";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("@/const", () => ({ startLogin: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/login?returnTo=%2Fmobile%2Flabor", mockNavigate],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
  };
});

import LoginPage from "./LoginPage";

describe("LoginPage 已登录导航", () => {
  it("会话就绪时自动跳转至经校验的 returnTo 业务路径", () => {
    LoginPage();

    expect(mockNavigate).toHaveBeenCalledWith("/mobile/labor");
  });
});
