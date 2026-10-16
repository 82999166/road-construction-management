import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { UserRound } from "lucide-react";
import { MobileAccessGate } from "./MobileAccessGate";

describe("MobileAccessGate", () => {
  it("认证和资源加载完成后渲染受保护的页面内容", () => {
    const markup = renderToStaticMarkup(
      <MobileAccessGate
        isAuthenticated
        isLoading={false}
        loadingText="加载中"
        title="个人中心"
        description="说明"
        Icon={UserRound}
        onRetry={() => undefined}
      >
        <main data-testid="profile-content">当前岗位与数据范围</main>
      </MobileAccessGate>,
    );

    expect(markup).toContain("当前岗位与数据范围");
  });

  it("认证超时时展示可操作的重新加载与企业身份登录出口，而非持续展示加载文案", () => {
    const markup = renderToStaticMarkup(
      <MobileAccessGate
        isAuthenticated={false}
        isLoading={true}
        authLoadingTimedOut
        loadingText="正在加载项目权限…"
        title="财务成本"
        description="需要企业身份授权"
        Icon={UserRound}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain("身份核验响应超时");
    expect(markup).toContain("重新加载");
    expect(markup).toContain("企业身份登录");
    expect(markup).not.toContain("正在加载项目权限…");
  });

  it("认证请求结束后访问移动业务地址会安全回跳统一登录页", () => {
    const source = readFileSync(new URL("./MobileAccessGate.tsx", import.meta.url), "utf8");

    expect(source).toContain("if (isLoading || isAuthenticated || authLoadingTimedOut) return;");
    expect(source).toContain("window.location.replace(createLoginPath(getCurrentAppPath()));");
    expect(source).toContain("避免网络抖动时把可能有效的会话错误送回登录页");
  });
});
