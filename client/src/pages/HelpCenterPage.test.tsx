import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HelpCenterPage from "./HelpCenterPage";

vi.mock("wouter", () => ({
  useLocation: () => ["/help", vi.fn()],
}));

describe("H5 帮助中心", () => {
  it("提供三类教程与完整移动业务模块说明", () => {
    const markup = renderToStaticMarkup(<HelpCenterPage />);

    expect(markup).toContain("悦信云智管帮助中心");
    expect(markup).toContain("安装部署");
    expect(markup).toContain("超级管理员");
    expect(markup).toContain("移动端使用");
    expect(markup).toContain("渣土运输");
    expect(markup).toContain("柴油管理");
    expect(markup).toContain("采购仓储");
    expect(markup).toContain("工程计量");
  });

  it("教程明确安全边界且不包含具体部署凭据", () => {
    const markup = renderToStaticMarkup(<HelpCenterPage />);

    expect(markup).toContain("不展示任何账号、口令、服务器地址或密钥");
    expect(markup).toContain("页面专用打印按钮");
    expect(markup).not.toContain("github_pat_");
  });
});
