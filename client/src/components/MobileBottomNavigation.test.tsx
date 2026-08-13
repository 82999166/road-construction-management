import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  location: "/mobile/profile?from_webdev=1",
  navigate: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => [runtime.location, runtime.navigate],
}));

import { MobileBottomNavigation } from "./MobileBottomNavigation";

describe("移动端固定底部导航", () => {
  beforeEach(() => {
    runtime.location = "/mobile/profile?from_webdev=1";
    runtime.navigate.mockClear();
  });

  it("首次登录回跳携带查询参数时仍显示工作台、消息和我的导航", () => {
    const markup = renderToStaticMarkup(<MobileBottomNavigation />);

    expect(markup).toContain('aria-label="移动端底部导航"');
    expect(markup).toContain("工作台");
    expect(markup).toContain("消息");
    expect(markup).toContain("我的");
  });

  it("非移动业务页面不渲染移动端固定导航", () => {
    runtime.location = "/admin/permission";

    expect(renderToStaticMarkup(<MobileBottomNavigation />)).toBe("");
  });
});
