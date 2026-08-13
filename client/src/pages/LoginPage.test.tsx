import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getAuthenticatedLoginRedirectTarget } from "@/lib/authNavigation";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false, user: null }),
}));

vi.mock("@/const", () => ({ startLogin: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: vi.fn() } } }),
    auth: {
      localAdminLogin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      localManagerLogin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      changeLocalPassword: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", vi.fn()],
}));

import LoginPage from "./LoginPage";

describe("独立登录页", () => {
  it("普通管理员入口保留企业、微信和本地管理登录，不展示超级管理员口令表单", () => {
    const markup = renderToStaticMarkup(<LoginPage />);
    expect(markup).toContain("企业身份登录");
    expect(markup).toContain("微信授权登录");
    expect(markup).toContain("使用已绑定微信授权登录");
    expect(markup).toContain("不会自动创建账号或扩大权限");
    expect(markup).toContain("账号恢复与密码重置");
    expect(markup).toContain('href="/api/identity-recovery"');
    expect(markup).toContain("进入超级管理员登录");
    expect(markup).not.toContain("超级管理员账号登录");
    expect(markup).toContain("管理人员账号登录");
    expect(markup).toContain("账号由超级管理员在后台创建");
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain("admin123");
  });

  it("认证会话已准备就绪时回到受控的原业务路径", () => {
    expect(getAuthenticatedLoginRedirectTarget(true, false, "/mobile/labor")).toBe("/mobile/labor");
    expect(getAuthenticatedLoginRedirectTarget(true, true, "/mobile/labor")).toBeNull();
  });

  it("专用超级管理入口只显示本地超级管理员表单，不泄露测试密码", () => {
    const markup = renderToStaticMarkup(<LoginPage localAdminOnly />);

    expect(markup).toContain("超级管理员登录");
    expect(markup).toContain("登录全局管理后台");
    expect(markup).toContain("返回普通管理员登录");
    expect(markup).not.toContain("企业身份登录");
    expect(markup).not.toContain("管理人员账号登录");
    expect(markup).not.toContain("admin123");
  });
});
