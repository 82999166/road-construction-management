import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { capturedButtonProps, mockLogout, mockNavigate } = vi.hoisted(() => ({
  capturedButtonProps: [] as Array<{ children?: unknown; onClick?: () => void }>,
  mockLogout: vi.fn(),
  mockNavigate: vi.fn(),
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
vi.mock("@/components/ui/button", () => ({
  Button: (props: { children?: unknown; onClick?: () => void }) => {
    capturedButtonProps.push(props);
    return null;
  },
}));
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

function hasCapturedButtonLabel(label: string) {
  return capturedButtonProps.some((button) => React.Children.toArray(button.children as React.ReactNode).includes(label));
}

describe("MobileProfilePage", () => {
  beforeEach(() => {
    capturedButtonProps.length = 0;
    mockLogout.mockReset();
    mockNavigate.mockReset();
  });

  it("明确密码托管边界，并呈现重新认证和安全退出入口", () => {
    const markup = renderToStaticMarkup(<MobileProfilePage />);

    expect(markup).toContain("账户安全");
    expect(markup).toContain("不保存您的企业密码");
    expect(hasCapturedButtonLabel("重新验证身份")).toBe(true);
    expect(hasCapturedButtonLabel("安全退出")).toBe(true);
  });

  it("重新认证与安全退出均通过独立登录页保留个人中心返回路径", async () => {
    mockLogout.mockResolvedValue(undefined);
    renderToStaticMarkup(<MobileProfilePage />);

    const reauthenticateButton = capturedButtonProps.find((button) => React.Children.toArray(button.children as React.ReactNode).includes("重新验证身份"));
    const logoutButton = capturedButtonProps.find((button) => React.Children.toArray(button.children as React.ReactNode).includes("安全退出"));

    reauthenticateButton?.onClick?.();
    expect(mockNavigate).toHaveBeenCalledWith("/login?returnTo=%2Fmobile%2Fprofile");

    logoutButton?.onClick?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenLastCalledWith("/login?returnTo=%2Fmobile%2Fprofile");
  });
});
