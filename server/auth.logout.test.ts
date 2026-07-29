import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("auth.me 仅返回前端认证与权限投影所需资料，不暴露本地账号认证材料", async () => {
    const { ctx } = createAuthContext();
    ctx.user = {
      ...ctx.user!,
      loginMethod: "local_manager",
      localUsername: "field-manager",
      localPasswordHash: "scrypt$never-expose-this",
      localAccountStatus: "active",
      localPasswordChangeRequired: true,
    };

    const result = await appRouter.createCaller(ctx).auth.me();

    expect(result).toMatchObject({
      id: 1,
      name: "Sample User",
      loginMethod: "local_manager",
      localPasswordChangeRequired: false,
    });
    expect(result).not.toHaveProperty("localPasswordHash");
    expect(result).not.toHaveProperty("localUsername");
    expect(result).not.toHaveProperty("localAccountStatus");
  });

  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
});
