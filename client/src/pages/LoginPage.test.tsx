import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getAuthenticatedLoginRedirectTarget } from "@/lib/authNavigation";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false }),
}));

vi.mock("@/const", () => ({ startLogin: vi.fn() }));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", vi.fn()],
}));

import LoginPage from "./LoginPage";

describe("独立登录页", () => {
  it("展示统一身份认证入口且不渲染本地密码字段", () => {
    const markup = renderToStaticMarkup(<LoginPage />);
    expect(markup).toContain("企业身份登录");
    expect(markup).toContain("账号恢复与密码重置");
    expect(markup).toContain('href="/api/identity-recovery"');
    expect(markup).toContain("系统不保存企业账号密码");
    expect(markup).not.toContain('type="password"');
  });

  it("认证会话已准备就绪时回到受控的原业务路径", () => {
    expect(getAuthenticatedLoginRedirectTarget(true, false, "/mobile/labor")).toBe("/mobile/labor");
    expect(getAuthenticatedLoginRedirectTarget(true, true, "/mobile/labor")).toBeNull();
  });
});
