import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const { mockLogout, mockNavigate, mockStartLogin } = vi.hoisted(() => ({
  mockLogout: vi.fn(),
  mockNavigate: vi.fn(),
  mockStartLogin: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7, name: "项目测试成员" },
    loading: false,
    isAuthenticated: true,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
    logout: mockLogout,
  }),
}));
vi.mock("@/const", () => ({ startLogin: mockStartLogin }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mobile: {
      workbench: {
        useQuery: () => ({
          isLoading: false,
          data: {
            dataScope: { hasAllProjects: false, projectIds: [88], organizationIds: [] },
            user: { roleCodes: ["PROJECT_MANAGER"] },
          },
        }),
      },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/mobile/profile", mockNavigate] }));

import MobileProfilePage from "./MobileProfilePage";

describe("MobileProfilePage", () => {
  it("明确密码托管边界，并呈现重新认证和安全退出入口", () => {
    const markup = renderToStaticMarkup(<MobileProfilePage />);

    expect(markup).toContain("账户安全");
    expect(markup).toContain("不保存您的企业密码");
    expect(markup).toContain("重新验证身份");
    expect(markup).toContain("安全退出");
  });
});
