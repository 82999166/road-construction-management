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
});
