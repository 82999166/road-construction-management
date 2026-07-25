import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumePostLoginReturnPath,
  createLoginPath,
  getAuthenticatedLoginRedirectTarget,
  getLoginReturnPath,
  getUnauthorizedLoginRedirectPath,
  rememberPostLoginReturnPath,
  sanitizeReturnPath,
} from "./authNavigation";

describe("独立登录页认证导航", () => {
  it("只保留同源应用内的认证后返回路径", () => {
    expect(sanitizeReturnPath("/mobile/labor?project=project-1")).toBe("/mobile/labor?project=project-1");
    expect(sanitizeReturnPath("https://unsafe.example.com")).toBe("/mobile");
    expect(sanitizeReturnPath("//unsafe.example.com")).toBe("/mobile");
  });

  it("将受保护页面路径编码到独立登录页并拒绝登录页自循环", () => {
    expect(createLoginPath("/admin/settings?tab=security")).toBe("/login?returnTo=%2Fadmin%2Fsettings%3Ftab%3Dsecurity");
    expect(createLoginPath("/mobile/profile")).toBe("/login?returnTo=%2Fmobile%2Fprofile");
    expect(createLoginPath("/login")).toBe("/login");
    expect(getLoginReturnPath("?returnTo=https%3A%2F%2Funsafe.example.com")).toBe("/mobile");
  });

  it("在认证成功后仅消费一次经过校验的原业务路径", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    rememberPostLoginReturnPath("/mobile/profile");
    expect(consumePostLoginReturnPath()).toBe("/mobile/profile");
    expect(consumePostLoginReturnPath()).toBe("/mobile");
  });

  it("统一处理已登录访问和全局未授权时的登录页导航", () => {
    expect(getAuthenticatedLoginRedirectTarget(true, false, "/admin")).toBe("/admin");
    expect(getAuthenticatedLoginRedirectTarget(true, true, "/admin")).toBeNull();
    expect(getAuthenticatedLoginRedirectTarget(false, false, "/admin")).toBeNull();
    expect(getUnauthorizedLoginRedirectPath("/mobile/finance?project=project-1")).toBe("/login?returnTo=%2Fmobile%2Ffinance%3Fproject%3Dproject-1");
    expect(getUnauthorizedLoginRedirectPath("/login?returnTo=%2Fmobile")).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
