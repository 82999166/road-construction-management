import { UNAUTHED_ERR_MSG } from "@shared/const";
import { describe, expect, it, vi } from "vitest";
import { redirectToLoginForUnauthorizedError } from "./unauthorizedRedirect";

describe("全局未授权登录页重定向", () => {
  it("将当前受保护路径编码后重定向到独立登录页", () => {
    const replace = vi.fn();

    const redirected = redirectToLoginForUnauthorizedError(
      UNAUTHED_ERR_MSG,
      "/mobile/finance?project=project-1",
      replace,
    );

    expect(redirected).toBe(true);
    expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Fmobile%2Ffinance%3Fproject%3Dproject-1");
  });

  it("忽略非未授权错误，并阻止登录页自身产生循环跳转", () => {
    const replace = vi.fn();

    expect(redirectToLoginForUnauthorizedError("其他错误", "/mobile", replace)).toBe(false);
    expect(redirectToLoginForUnauthorizedError(UNAUTHED_ERR_MSG, "/login?returnTo=%2Fmobile", replace)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
