import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDb, mockDecryptSecret } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockDecryptSecret: vi.fn(() => "openid-for-test"),
}));

vi.mock("./db", () => ({ getDb: mockGetDb }));
vi.mock("./services/secretVault", () => ({ decryptSecret: mockDecryptSecret }));

import { verifyOfficialAccountBindingFollowStatus } from "./services/officialAccountNotifier";

function createDb(userInfoBindingStatus: "active" | "unsubscribed") {
  const binding = { id: 31, userId: 7, openIdEncrypted: "encrypted-openid", status: userInfoBindingStatus, failureCount: 2 };
  const configRows = [
    { settingKey: "WECHAT_OFFICIAL_APP_ID", valueJson: "wx-test", secretEncrypted: null, status: "published" },
    { settingKey: "WECHAT_OFFICIAL_APP_SECRET", valueJson: null, secretEncrypted: "encrypted-app-secret", status: "published" },
  ];
  let selectIndex = 0;
  const updates: unknown[] = [];
  const query = (rows: unknown[]) => {
    const result = Object.assign(Promise.resolve(rows), { limit: vi.fn(async () => rows) });
    return { where: vi.fn(() => result) };
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => query(selectIndex++ === 0 ? [binding] : configRows)) })),
    update: vi.fn(() => ({ set: vi.fn((values: unknown) => { updates.push(values); return { where: vi.fn(async () => undefined) }; }) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    updates,
  };
}

describe("服务号关注状态实时核验", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/cgi-bin/token")) return new Response(JSON.stringify({ access_token: "token-test", expires_in: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ subscribe: 1 }), { status: 200 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("微信用户信息明确确认关注时恢复 active，而不要求用户重复 OAuth 绑定", async () => {
    const db = createDb("unsubscribed");
    mockGetDb.mockResolvedValue(db);

    await expect(verifyOfficialAccountBindingFollowStatus(7)).resolves.toEqual({ status: "active" });
    expect(db.updates).toEqual(expect.arrayContaining([expect.objectContaining({ status: "active", failureCount: 0, lastFailureAt: null })]));
  });

  it("微信用户信息接口异常时保留原绑定状态，不把已绑定账号误标为未关注", async () => {
    const db = createDb("active");
    mockGetDb.mockResolvedValue(db);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/cgi-bin/token")) return new Response(JSON.stringify({ access_token: "token-test", expires_in: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ errcode: 45009 }), { status: 200 });
    }));

    await expect(verifyOfficialAccountBindingFollowStatus(7)).resolves.toEqual({ status: "verification_failed", failureCode: "45009" });
    expect(db.updates).toEqual([]);
  });
});
