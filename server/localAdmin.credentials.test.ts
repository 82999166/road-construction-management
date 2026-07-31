import { describe, expect, it } from "vitest";

const localAuthBaseUrl = process.env.LOCAL_AUTH_TEST_BASE_URL || "http://127.0.0.1:3000";

describe("测试环境临时超级管理员凭据", () => {
  it("使用已配置的环境凭据可通过轻量认证接口建立会话", async () => {
    const username = process.env.TEMP_ADMIN_USERNAME;
    const password = process.env.TEMP_ADMIN_PASSWORD;

    expect(username, "TEMP_ADMIN_USERNAME 应由测试环境注入").toBeTruthy();
    expect(password, "TEMP_ADMIN_PASSWORD 应由测试环境注入").toBeTruthy();

    const response = await fetch(`${localAuthBaseUrl}/api/trpc/auth.localAdminLogin?batch=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 0: { json: { username, password } } }),
    });
    const payload = await response.json() as Array<{ result?: { data?: { json?: { success?: boolean } } }; error?: { json?: { message?: string } } }>;

    expect(response.ok, payload[0]?.error?.json?.message || "临时超级管理员登录请求失败").toBe(true);
    expect(payload[0]?.result?.data?.json?.success).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("session");
  });
});
