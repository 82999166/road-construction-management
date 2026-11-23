import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/secretVault", () => ({
  encryptSecret: vi.fn(() => "cipher:opaque"),
  decryptSecret: vi.fn(() => "fake"),
  maskSecret: vi.fn(() => "MASK"),
  fingerprintSecret: vi.fn(() => "fake"),
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({
    key: key.replace(".enc", "_safe.enc"),
    url: "/manus-storage/NEVER_RETURN",
  })),
  storageGetSignedUrl: vi.fn(),
}));
import { getDb } from "./db";
import { siteOperationsRouter } from "./routers/siteOperations";
import { adminRouter } from "./routers/admin";
import {
  DEFAULT_SITE_CONFIGURATION,
  siteConfigurationSchema,
  siteWeatherCredentialInput,
} from "../shared/siteOperations";
import { encryptSecret } from "./services/secretVault";
import {
  assertSiteVersion,
  isPublicAddress,
  requireSiteVideoReference,
} from "./services/siteOperationsConfiguration";
import type { TrpcContext } from "./_core/context";
const context = (role = "admin"): TrpcContext => ({
  user: {
    id: 1,
    role,
    loginMethod: "manus",
    openId: "siteops-test",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as any,
  req: {} as any,
  res: {} as any,
});
const project = { id: 2, name: "现场", status: "active" };
function fakeDb(
  responses: unknown[][] = [],
  options: { affected?: number; duplicate?: boolean; failAudit?: boolean } = {}
) {
  let index = 0;
  const inserts: any[] = [],
    updates: any[] = [],
    deletes: any[] = [];
  const query = () => {
    let resolved = false,
      rows: unknown[] = [];
    const q: any = {};
    for (const k of [
      "where",
      "limit",
      "orderBy",
      "innerJoin",
      "leftJoin",
      "for",
    ])
      q[k] = () => q;
    q.then = (yes: any, no: any) => {
      if (!resolved) {
        rows = responses[index++] ?? [];
        resolved = true;
      }
      return Promise.resolve(rows).then(yes, no);
    };
    return q;
  };
  const db: any = {
    select: vi.fn(() => ({ from: () => query() })),
    insert: vi.fn(() => ({
      values: async (v: any) => {
        if (options.duplicate && v.settingKey)
          throw Object.assign(Error("duplicate"), { code: "ER_DUP_ENTRY" });
        if (options.failAudit && v.module) throw Error("audit_failed");
        inserts.push(v);
        return [{ insertId: 99, affectedRows: 1 }];
      },
    })),
    update: vi.fn(() => ({
      set: (v: any) => ({
        where: async () => {
          updates.push(v);
          return [{ affectedRows: options.affected ?? 1 }];
        },
      }),
    })),
    delete: vi.fn(() => ({
      where: async () => {
        deletes.push(1);
        return [{ affectedRows: 1 }];
      },
    })),
    inserts,
    updates,
    deletes,
  };
  db.transaction = vi.fn(async (fn: any) => {
    const i = inserts.length,
      u = updates.length;
    try {
      return await fn(db);
    } catch (e) {
      inserts.splice(i);
      updates.splice(u);
      throw e;
    }
  });
  return db;
}
const existing = () => ({
  id: 10,
  version: 3,
  settingKey: "SITE_OPERATIONS_PROJECT_2",
  valueJson: JSON.stringify(DEFAULT_SITE_CONFIGURATION),
  isSensitive: false,
  status: "published",
  updatedAt: new Date(),
});
describe("siteOperations caller privileges and unavailable errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it.each([
    "projects",
    "dashboard",
    "transportDetails",
    "getConfiguration",
    "getWeather",
    "getWeatherCredential",
    "saveConfiguration",
    "saveWeatherCredential",
    "uploadVideo",
  ])("%s匿名和非超管拒绝", async name => {
    const db = fakeDb([[]]);
    vi.mocked(getDb).mockResolvedValue(db);
    const inputs: any = {
      dashboard: { projectId: 2, businessDate: "2026-11-23" },
      transportDetails: {
        projectId: 2,
        businessDate: "2026-11-23",
        metric: "departures",
      },
      getConfiguration: { projectId: 2 },
      getWeather: { projectId: 2 },
      saveConfiguration: {
        projectId: 2,
        configuration: DEFAULT_SITE_CONFIGURATION,
      },
      saveWeatherCredential: {},
      uploadVideo: {
        projectId: 2,
        fileName: "a.mp4",
        mimeType: "video/mp4",
        base64: "AAAA",
      },
    };
    const anonymous: any = siteOperationsRouter.createCaller({
        ...context(),
        user: null,
      }),
      ordinary: any = siteOperationsRouter.createCaller(context("user"));
    await expect(anonymous[name](inputs[name])).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(ordinary[name](inputs[name])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.inserts).toEqual([]);
  });
  it.each([
    "projects",
    "dashboard",
    "transportDetails",
    "getConfiguration",
    "getWeather",
    "getWeatherCredential",
  ])("%s getDb缺失报错不能返回假零", async name => {
    vi.mocked(getDb).mockResolvedValue(null);
    const caller: any = siteOperationsRouter.createCaller(context());
    await expect(
      caller[name](
        name === "transportDetails"
          ? { projectId: 2, businessDate: "2026-11-23", metric: "departures" }
          : name === "dashboard"
            ? { projectId: 2, businessDate: "2026-11-23" }
            : { projectId: 2 }
      )
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("不存在项目报NOT_FOUND，日期与id严格校验", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb([[]]));
    const c = siteOperationsRouter.createCaller(context());
    await expect(c.getConfiguration({ projectId: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      c.dashboard({ projectId: 0, businessDate: "2026-11-31" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      c.dashboard({ projectId: 2, businessDate: "2026-11-31" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("新配置未填商业服务则摘要not configured且无假监控正常", async () => {
    const db = fakeDb([[project], [], []]);
    vi.mocked(getDb).mockResolvedValue(db);
    const r = await siteOperationsRouter
      .createCaller(context())
      .getConfiguration({ projectId: 2 });
    expect(r.version).toBeNull();
    expect(r.videoStatus).toBe("not_configured");
    expect(r.weatherCredential).toEqual({
      version: null,
      keyConfigured: false,
    });
    expect(db.inserts).toHaveLength(0);
  });
});
describe("dedicated configuration CAS and safe secrets", () => {
  beforeEach(() => vi.clearAllMocks());
  it("已有配置expectedVersion必需且错误版本CONFLICT", async () => {
    for (const version of [undefined, 2]) {
      const db = fakeDb([[project], [project], [existing()]]);
      vi.mocked(getDb).mockResolvedValue(db);
      await expect(
        siteOperationsRouter
          .createCaller(context())
          .saveConfiguration({
            projectId: 2,
            expectedVersion: version,
            configuration: DEFAULT_SITE_CONFIGURATION,
          })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(db.updates).toEqual([]);
      expect(db.inserts).toEqual([]);
    }
  });
  it("新建竞争唯一约束CONFLICT且事务不留下审计", async () => {
    const db = fakeDb([[project], [project], []], { duplicate: true });
    vi.mocked(getDb).mockResolvedValue(db);
    await expect(
      siteOperationsRouter
        .createCaller(context())
        .saveConfiguration({
          projectId: 2,
          configuration: DEFAULT_SITE_CONFIGURATION,
        })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.inserts).toEqual([]);
  });
  it("正确版本事务发布并保留旧非敏感snapshot，未改历史业务", async () => {
    const db = fakeDb([[project], [project], [existing()]]);
    vi.mocked(getDb).mockResolvedValue(db);
    const config = {
      ...DEFAULT_SITE_CONFIGURATION,
      location: { label: "真实地点", latitude: 23, longitude: 113 },
    };
    expect(
      await siteOperationsRouter
        .createCaller(context())
        .saveConfiguration({
          projectId: 2,
          expectedVersion: 3,
          configuration: config,
        })
    ).toEqual({ success: true, version: 4 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.updates[0]).toMatchObject({ status: "published", version: 4 });
    expect(JSON.parse(db.inserts[0].snapshotJson)).toMatchObject({
      version: 3,
      configuration: DEFAULT_SITE_CONFIGURATION,
    });
    expect(db.inserts[1]).toMatchObject({
      module: "siteOperations",
      action: "save_configuration",
    });
  });
  it("CAS affectedRows=0拒绝，不留下publish/audit", async () => {
    const db = fakeDb([[project], [project], [existing()]], { affected: 0 });
    vi.mocked(getDb).mockResolvedValue(db);
    await expect(
      siteOperationsRouter
        .createCaller(context())
        .saveConfiguration({
          projectId: 2,
          expectedVersion: 3,
          configuration: DEFAULT_SITE_CONFIGURATION,
        })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.inserts).toEqual([]);
  });
  it("审计失败使发布回滚", async () => {
    const db = fakeDb([[project], [project], [existing()]], {
      failAudit: true,
    });
    vi.mocked(getDb).mockResolvedValue(db);
    await expect(
      siteOperationsRouter
        .createCaller(context())
        .saveConfiguration({
          projectId: 2,
          expectedVersion: 3,
          configuration: DEFAULT_SITE_CONFIGURATION,
        })
    ).rejects.toThrow("audit_failed");
    expect(db.updates).toEqual([]);
    expect(db.inserts).toEqual([]);
  });
  it("天气key仅AES敏感栏，响应/审计/快照不含明密文", async () => {
    const db = fakeDb([[], []]);
    vi.mocked(getDb).mockResolvedValue(db);
    const r = await siteOperationsRouter
      .createCaller(context())
      .saveWeatherCredential({ apiKey: "authorized-test-key" });
    expect(encryptSecret).toHaveBeenCalledWith("authorized-test-key");
    expect(db.inserts[0]).toMatchObject({
      secretEncrypted: "cipher:opaque",
      valueJson: null,
      isSensitive: true,
      status: "published",
    });
    expect(JSON.stringify(r)).not.toMatch(/authorized-test-key|cipher/);
    expect(JSON.stringify(db.inserts.slice(1))).not.toMatch(
      /authorized-test-key|cipher:opaque|secretEncrypted/
    );
  });
  it("省略apiKey保留不重写，明确clear才清空并递增CAS", async () => {
    const old = {
      ...existing(),
      settingKey: "SITE_OPERATIONS_WEATHER_CREDENTIAL",
      isSensitive: true,
      valueJson: null,
      secretEncrypted: "cipher:old",
    };
    const db = fakeDb([[old], [old], [old]]);
    vi.mocked(getDb).mockResolvedValue(db);
    const c = siteOperationsRouter.createCaller(context());
    expect(await c.saveWeatherCredential({ expectedVersion: 3 })).toEqual({
      success: true,
      version: 3,
      keyConfigured: true,
    });
    expect(db.updates).toEqual([]);
    expect(
      await c.saveWeatherCredential({ expectedVersion: 3, clear: true })
    ).toEqual({ success: true, version: 4, keyConfigured: false });
    expect(db.updates[0].secretEncrypted).toBeNull();
    expect(JSON.stringify(db.inserts)).not.toContain("cipher:old");
  });
  it("凭据摘要不输出key/预览尾码/密文，空字符串与同时clear拒绝", async () => {
    vi.mocked(getDb).mockResolvedValue(
      fakeDb([[{ ...existing(), secretEncrypted: "cipher:old" }]])
    );
    expect(
      await siteOperationsRouter.createCaller(context()).getWeatherCredential()
    ).toEqual({ version: 3, keyConfigured: true });
    expect(siteWeatherCredentialInput.safeParse({ apiKey: "" }).success).toBe(
      false
    );
    expect(
      siteWeatherCredentialInput.safeParse({ apiKey: "abc", clear: true })
        .success
    ).toBe(false);
    expect(() => assertSiteVersion({ version: 3 })).toThrow();
  });
  it("配置schema严格拒绝额外密钥、超量视频、双默认和不合理阈值", () => {
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        apiKey: "leak",
      }).success
    ).toBe(false);
    const video = {
      id: "v",
      name: "录像",
      pointLabel: "点位",
      kind: "sample",
      sampleAsset: "excavator_cc_by_sa_4",
      recordedAt: null,
      enabled: true,
      sortOrder: 0,
      default: true,
    };
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        videos: Array.from({ length: 13 }, (_, i) => ({
          ...video,
          id: String(i),
        })),
      }).success
    ).toBe(false);
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        videos: [video, { ...video, id: "v2" }],
      }).success
    ).toBe(false);
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        weather: {
          ...DEFAULT_SITE_CONFIGURATION.weather,
          thresholds: {
            ...DEFAULT_SITE_CONFIGURATION.weather.thresholds,
            windKmh: 999,
          },
        },
      }).success
    ).toBe(false);
  });
  it("cross project storage reference拒绝，storage key永不当input", async () => {
    const db = fakeDb([[]]);
    await expect(requireSiteVideoReference(db, 2, 55)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        videos: [
          {
            id: "v",
            name: "视频",
            pointLabel: "现场",
            kind: "recorded",
            storageKey: "another-project.mp4",
            recordedAt: null,
            enabled: true,
            sortOrder: 0,
            default: true,
          },
        ],
      }).success
    ).toBe(false);
  });
  it("私网DNS和公开IP区分", () => {
    expect(isPublicAddress("10.2.3.4")).toBe(false);
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("93.184.216.34")).toBe(true);
  });
  it("固定授权sample可选择且不可标为真实现场", () => {
    const video = {
      id: "sample",
      name: "样片",
      pointLabel: "授权示例",
      kind: "sample",
      sampleAsset: "excavator_cc_by_sa_4",
      recordedAt: null,
      enabled: true,
      sortOrder: 0,
      default: true,
    };
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        videos: [video],
      }).success
    ).toBe(true);
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        videos: [{ ...video, kind: "recorded" }],
      }).success
    ).toBe(false);
  });
});
describe("ordinary settings cannot bypass dedicated domain", () => {
  beforeEach(() => vi.clearAllMocks());
  it("列表过滤专用配置和weather key", async () => {
    vi.mocked(getDb).mockResolvedValue(
      fakeDb([
        [
          existing(),
          {
            settingKey: "SITE_OPERATIONS_WEATHER_CREDENTIAL",
            valueJson: "MUST_NOT_LEAK",
          },
          { settingKey: "MAP_API_KEY", valueJson: null },
        ],
      ])
    );
    const r = await adminRouter.createCaller(context()).settings.list();
    expect(r).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("MUST_NOT_LEAK");
  });
  it("saveDraft专用key拒绝", async () => {
    const db = fakeDb();
    vi.mocked(getDb).mockResolvedValue(db);
    await expect(
      adminRouter
        .createCaller(context())
        .settings.saveDraft({
          category: "现场",
          settingKey: "SITE_OPERATIONS_PROJECT_2",
          displayName: "大屏配置",
          value: "{}",
          isSensitive: false,
        })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.inserts).toEqual([]);
  });
  it.each(["publish", "disable", "remove", "test", "history"])(
    "%s按id也不得操作专用配置",
    async name => {
      const db = fakeDb([[existing()]]);
      vi.mocked(getDb).mockResolvedValue(db);
      const caller: any = adminRouter.createCaller(context()).settings;
      await expect(
        caller[name](
          name === "history"
            ? { settingId: 10 }
            : { id: 10, expectedVersion: 3 }
        )
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.updates).toEqual([]);
      expect(db.inserts).toEqual([]);
      expect(db.deletes).toEqual([]);
    }
  );
});

describe("free weather configuration compatibility and explicit administrator save", () => {
  beforeEach(() => vi.clearAllMocks());
  it("旧disabled/commercial配置无需新字段可解析；met可保持未确认而不自动接受", () => {
    for (const provider of [
      "disabled",
      "open_meteo_commercial",
      "met_norway",
    ]) {
      const parsed = siteConfigurationSchema.parse({
        ...DEFAULT_SITE_CONFIGURATION,
        weather: { ...DEFAULT_SITE_CONFIGURATION.weather, provider },
      });
      expect(parsed.weather.provider).toBe(provider);
      expect(parsed.weather.metNorway).toBeUndefined();
    }
    expect(DEFAULT_SITE_CONFIGURATION.weather.provider).toBe("disabled");
  });
  it.each([
    "fake@example.com",
    "https://github.com/private/repo",
    "https://localhost/support",
    "http://yx.maomaoyx.com/support",
    "https://10.0.0.1/help",
    "bad email",
    "weather@company.local",
  ])("非法联系%s后端严格拒绝", contact => {
    expect(
      siteConfigurationSchema.safeParse({
        ...DEFAULT_SITE_CONFIGURATION,
        weather: {
          ...DEFAULT_SITE_CONFIGURATION.weather,
          provider: "met_norway",
          metNorway: { termsAccepted: true, contact },
        },
      }).success
    ).toBe(false);
  });
  it("admin CAS保存met联系与人工确认，无全局key写入", async () => {
    const db = fakeDb([[project], [project], [existing()]]);
    vi.mocked(getDb).mockResolvedValue(db);
    const configuration = {
      ...DEFAULT_SITE_CONFIGURATION,
      location: { label: "项目位置", latitude: 23, longitude: 113 },
      weather: {
        ...DEFAULT_SITE_CONFIGURATION.weather,
        provider: "met_norway" as const,
        metNorway: {
          termsAccepted: true,
          contact: "https://yx.maomaoyx.com/support",
        },
      },
    };
    expect(
      await siteOperationsRouter
        .createCaller(context())
        .saveConfiguration({ projectId: 2, expectedVersion: 3, configuration })
    ).toEqual({ success: true, version: 4 });
    expect(JSON.parse(db.updates[0].valueJson).weather).toMatchObject(
      configuration.weather
    );
    expect(db.updates[0].secretEncrypted).toBeNull();
    expect(encryptSecret).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(1);
  });
  it("getWeather缺少确认或contact时not_configured且fetch未调用", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(Error("must_not_call"));
    try {
      for (const metNorway of [
        undefined,
        { termsAccepted: false, contact: "https://yx.maomaoyx.com/support" },
        { termsAccepted: true, contact: "" },
      ]) {
        const configuration = {
          ...DEFAULT_SITE_CONFIGURATION,
          location: { label: "项目位置", latitude: 23, longitude: 113 },
          weather: {
            ...DEFAULT_SITE_CONFIGURATION.weather,
            provider: "met_norway",
            metNorway,
          },
        };
        vi.mocked(getDb).mockResolvedValue(
          fakeDb([
            [project],
            [{ ...existing(), valueJson: JSON.stringify(configuration) }],
            [],
          ])
        );
        expect(
          await siteOperationsRouter
            .createCaller(context())
            .getWeather({ projectId: 2 })
        ).toMatchObject({
          status: "not_configured",
          source: "met_norway",
          current: null,
        });
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});
