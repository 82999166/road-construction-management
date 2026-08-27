import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("手机号司机账号认证契约", () => {
  it("复用本地限流与会话机制，但只能在手机端登录", () => {
    const source = readFileSync(new URL("./localAuth.ts", import.meta.url), "utf8");

    expect(source).toContain('const LOCAL_DRIVER_OPEN_ID_PREFIX = "local-driver:"');
    expect(source).toContain("createLocalDriverOpenId");
    expect(source).toContain('user.loginMethod === "local_driver" && terminal !== "mobile"');
    expect(source).toContain("local_driver_login_success");
    expect(source).toContain("local_driver_password_changed");
  });
});
