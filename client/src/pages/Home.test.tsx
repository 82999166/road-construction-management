import { describe, expect, it, vi } from "vitest";

const { mockConsumePostLoginReturnPath, mockNavigate } = vi.hoisted(() => ({
  mockConsumePostLoginReturnPath: vi.fn(() => "/mobile/finance?project=project-1"),
  mockNavigate: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { name: "项目测试成员" },
    loading: false,
    isAuthenticated: true,
  }),
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
  it("认证成功后消费一次受控返回路径并回到原业务页", () => {
    Home();

    expect(mockConsumePostLoginReturnPath).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/mobile/finance?project=project-1");
  });
});
