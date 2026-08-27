import { describe, expect, it, vi } from "vitest";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false, user: null }),
}));

vi.mock("@/const", () => ({ startLogin: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: vi.fn() } } }),
    auth: {
      localAdminLogin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      permanentAdminLogin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      localManagerLogin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      changeLocalPassword: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login?returnTo=%2Fmobile%2Flabor", mockNavigate],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
    useState: <T,>(initialValue: T) => [initialValue, vi.fn()] as const,
  };
});

import LoginPage from "./LoginPage";

describe("LoginPage 已登录导航", () => {
  it("会话就绪时自动跳转至经校验的 returnTo 业务路径", () => {
    LoginPage();

    expect(mockNavigate).toHaveBeenCalledWith("/mobile/labor");
  });
});
