import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./secretVault", () => ({
  decryptSecret: vi.fn(() => "commercial-test-key"),
}));
import { decryptSecret } from "./secretVault";
import {
  clearSiteWeatherCache,
  projectMetNorwayWeather,
  querySiteWeather,
} from "./siteOperationsWeather";
import {
  DEFAULT_SITE_CONFIGURATION,
  type SiteConfiguration,
} from "../../shared/siteOperations";
const now = new Date("2026-11-23T00:20:00Z");
const configuration: SiteConfiguration = {
  ...DEFAULT_SITE_CONFIGURATION,
  location: {
    label: "项目固定地点",
    latitude: 23.123456,
    longitude: 113.987654,
  },
  weather: {
    ...DEFAULT_SITE_CONFIGURATION.weather,
    provider: "met_norway",
    metNorway: {
      termsAccepted: true,
      contact: "https://yx.maomaoyx.com/support",
    },
  },
};
const point = (time: string, temperature = 25, symbol = "rain_day") => ({
  time,
  data: {
    instant: {
      details: {
        air_temperature: temperature,
        relative_humidity: 70,
        wind_speed: 12.5,
        wind_from_direction: 90,
      },
    },
    next_1_hours: {
      summary: { symbol_code: symbol },
      details: { precipitation_amount: 8 },
    },
  },
});
const fixture = () => ({
  properties: {
    meta: {
      updated_at: "2026-11-22T23:00:00Z",
      units: {
        air_temperature: "celsius",
        relative_humidity: "%",
        wind_speed: "m/s",
        wind_from_direction: "degrees",
        precipitation_amount: "mm",
      },
    },
    timeseries: Array.from({ length: 36 }, (_, i) =>
      point(
        new Date(
          Date.parse("2026-11-23T00:00:00Z") + i * 3600000
        ).toISOString(),
        20 + i
      )
    ),
  },
});
const input = () => ({
  projectId: 1,
  configuration: structuredClone(configuration),
  configurationVersion: 1,
  credentialVersion: null,
  encryptedKey: null,
  now,
});
const response = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(fixture()), { headers });
beforeEach(() => {
  clearSiteWeatherCache();
  vi.clearAllMocks();
});
describe("MET Norway manual authorization and forecast semantics (fixtures only)", () => {
  it.each([
    undefined,
    { termsAccepted: false, contact: "https://yx.maomaoyx.com/support" },
    { termsAccepted: true, contact: "" },
    { termsAccepted: true, contact: "invented@example.com" },
    { termsAccepted: true, contact: "https://github.com/private/repo" },
    { termsAccepted: true, contact: "support@company.com\r\nX-Evil: yes" },
  ])("缺少人工确认或有效联系信息时不请求 %j", async metNorway => {
    const fetcher = vi.fn();
    const r = await querySiteWeather({
      ...input(),
      configuration: {
        ...configuration,
        weather: { ...configuration.weather, metNorway },
      },
      fetcher,
    });
    expect(r).toMatchObject({
      status: "not_configured",
      source: "met_norway",
      current: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(decryptSecret).not.toHaveBeenCalled();
  });
  it("未配置地点或停用不调用；默认不自动开通", async () => {
    const fetcher = vi.fn();
    expect(DEFAULT_SITE_CONFIGURATION.weather.provider).toBe("disabled");
    expect(
      (
        await querySiteWeather({
          ...input(),
          configuration: { ...configuration, location: null },
          fetcher,
        })
      ).status
    ).toBe("not_configured");
    expect(
      (
        await querySiteWeather({
          ...input(),
          configuration: DEFAULT_SITE_CONFIGURATION,
          fetcher,
        })
      ).status
    ).toBe("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("固定服务器HTTPS、坐标截断、真实站点+联系UA、gzip与无key", async () => {
    const fetcher = vi.fn(async () => response());
    const r = await querySiteWeather({ ...input(), fetcher });
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin).toBe("https://api.met.no");
    expect(url.pathname).toBe("/weatherapi/locationforecast/2.0/compact");
    expect(url.searchParams.get("lat")).toBe("23.1234");
    expect(url.searchParams.get("lon")).toBe("113.9876");
    expect(url.searchParams.has("apikey")).toBe(false);
    expect(options.headers).toMatchObject({
      "User-Agent":
        "https://yx.maomaoyx.com SiteOperations/1.0 https://yx.maomaoyx.com/support",
      "Accept-Encoding": "gzip, deflate",
    });
    expect(options.redirect).toBe("manual");
    expect(options.signal).toBeDefined();
    expect(decryptSecret).not.toHaveBeenCalled();
    expect(r.status).toBe("ready");
    expect(r.attribution).toMatchObject({
      name: "MET Norway",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    });
    expect(JSON.stringify(r)).not.toContain(
      configuration.weather.metNorway!.contact
    );
  });
  it("负数坐标也是截断不是四舍五入；邮箱联系可用", async () => {
    const fetcher = vi.fn(async () => response());
    await querySiteWeather({
      ...input(),
      configuration: {
        ...configuration,
        location: {
          label: "地点",
          latitude: -23.123499,
          longitude: -113.987699,
        },
        weather: {
          ...configuration.weather,
          metNorway: {
            termsAccepted: true,
            contact: "weather@yx.maomaoyx.com",
          },
        },
      },
      fetcher,
    });
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.searchParams.get("lat")).toBe("-23.1234");
    expect(url.searchParams.get("lon")).toBe("-113.9876");
    expect(new Headers(options.headers).get("User-Agent")).toContain(
      "weather@yx.maomaoyx.com"
    );
  });
  it("current选最近时点、m/s换km/h，降水保留未来1h且缺项null，提示非官方", () => {
    const r = projectMetNorwayWeather(fixture(), configuration, now);
    expect(r).toMatchObject({
      source: "met_norway",
      sourceKind: "model",
      timezone: "Asia/Shanghai",
      weatherDescription: "雨",
      updatedAt: "2026-11-22T23:00:00.000Z",
      officialAlerts: { status: "not_connected" },
    });
    expect(r.current).toMatchObject({
      time: "2026-11-23T00:00:00.000Z",
      windKmh: 45,
      gustKmh: null,
      apparentTemperatureC: null,
      weatherCode: null,
      precipitationMm: null,
    });
    expect(r.predictive).toMatchObject({
      label: "模型预报·非现场实测",
      precipitationPeriod: "next_1_hour",
      precipitationMm: 8,
      periodStart: "2026-11-23T00:00:00.000Z",
      periodEnd: "2026-11-23T01:00:00.000Z",
    });
    expect(r.hourly).toHaveLength(12);
    expect(
      r.hourly.every(
        h => h.visibilityMeters === null && h.precipitationProbability === null
      )
    ).toBe(true);
    expect(r.workHints.map(h => h.code)).toContain("rain");
    expect(r.workHints.every(h => h.source === "system_work_hint")).toBe(true);
    expect(r.workHints.find(h => h.code === "rain")?.label).toContain(
      "未来1小时"
    );
  });
  it("不把6h降水当1h；未知天气不映成晴天；单位不匹配不伪造", () => {
    const raw = fixture();
    const p: any = raw.properties.timeseries[0];
    delete p.data.next_1_hours;
    p.data.next_6_hours = {
      details: { precipitation_amount: 99 },
      summary: { symbol_code: "rain" },
    };
    const r = projectMetNorwayWeather(raw, configuration, now);
    expect(r.predictive?.precipitationMm).toBeNull();
    expect(r.weatherDescription).toBeNull();
    expect(r.workHints.map(h => h.code)).not.toContain("rain");
    raw.properties.timeseries[0].data.next_1_hours = {
      summary: { symbol_code: "UNKNOWN" },
      details: { precipitation_amount: 8 },
    };
    raw.properties.meta.units.wind_speed = "km/h";
    const bad = projectMetNorwayWeather(raw, configuration, now);
    expect(bad.current?.windKmh).toBeNull();
    expect(bad.weatherDescription).toBeNull();
  });
  it("数小时前预报是stale，不输出安全提示；坏数据不假天气", () => {
    const raw = fixture();
    raw.properties.timeseries = [point("2026-11-22T20:00:00Z")];
    const r = projectMetNorwayWeather(raw, configuration, now);
    expect(r.status).toBe("stale");
    expect(r.stale).toBe(true);
    expect(r.workHints).toEqual([]);
    for (const invalid of [
      null,
      {},
      { properties: { timeseries: [] } },
      { properties: { timeseries: [{ time: "bad" }] } },
    ])
      expect(projectMetNorwayWeather(invalid, configuration, now).status).toBe(
        "unavailable"
      );
  });
  it("小时ISO UTC、北京时间跨天，当日最高最低只来自剩余预报点", () => {
    const raw = fixture();
    raw.properties.timeseries = [
      point("2026-11-23T15:00:00Z", 99),
      point("2026-11-23T16:00:00Z", 21),
      point("2026-11-23T17:00:00Z", 26),
      point("2026-11-24T16:00:00Z", -50),
    ];
    const r = projectMetNorwayWeather(
      raw,
      configuration,
      new Date("2026-11-23T16:20:00Z")
    );
    expect(r.daily).toEqual({ date: "2026-11-24", maximumC: 26, minimumC: 26 });
    expect(r.hourly[0].time).toBe("2026-11-23T17:00:00.000Z");
    expect(r.predictive?.dailyBasis).toBe("remaining_forecast_points");
  });
});
describe("MET bounded HTTP cache, conditional requests, de-duplication and backoff", () => {
  it("相同坐标跨项目/版本共享原始缓存，Expires前不重请求，并实时重选预报/应用新阈值", async () => {
    const expiry = new Date(now.getTime() + 6 * 3600000);
    const fetcher = vi.fn(async () =>
      response({ Expires: expiry.toUTCString() })
    );
    await querySiteWeather({ ...input(), fetcher });
    const next = await querySiteWeather({
      ...input(),
      projectId: 9,
      configurationVersion: 99,
      credentialVersion: 12,
      now: new Date(now.getTime() + 4 * 3600000),
      configuration: {
        ...configuration,
        weather: {
          ...configuration.weather,
          thresholds: {
            ...configuration.weather.thresholds,
            windKmh: 100,
            precipitationMm: 90,
          },
        },
      },
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(next.current?.time).toBe("2026-11-23T04:00:00.000Z");
    expect(next.workHints.map(h => h.code)).not.toContain("rain");
    expect(next.workHints.map(h => h.code)).not.toContain("wind");
    expect(next.expiresAt).toBe(expiry.toISOString());
    expect(next.fetchedAt).toBe(now.toISOString());
  });
  it("短Expires也不得提前于3小时重复；精确Last-Modified变If-Modified-Since，304复用body", async () => {
    const lastModified = "Sun, 22 Nov 2026 23:00:00 GMT";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          Expires: new Date(now.getTime() + 60000).toUTCString(),
          "Last-Modified": lastModified,
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: {
            Expires: new Date(now.getTime() + 8 * 3600000).toUTCString(),
          },
        })
      );
    await querySiteWeather({ ...input(), fetcher });
    await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 2 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const r = await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 3 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetcher.mock.calls[1][1].headers).get("If-Modified-Since")
    ).toBe(lastModified);
    expect(r.status).toBe("ready");
    expect(r.current?.time).toBe("2026-11-23T03:00:00.000Z");
    await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 7 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("同URL并发请求仅一次；返回值互不污染", async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(r => (resolve = r)));
    const requests = Array.from({ length: 15 }, (_, i) =>
      querySiteWeather({ ...input(), projectId: i + 1, fetcher })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(response());
    const results = await Promise.all(requests);
    expect(results.every(r => r.status === "ready")).toBe(true);
    results[0].current!.temperatureC = -999;
    expect(results[1].current?.temperatureC).not.toBe(-999);
  });
  it.each(["18000", "Mon, 23 Nov 2026 05:20:00 GMT"])(
    "429遵守Retry-After %s并对provider全局退避",
    async retry => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("private provider details", {
            status: 429,
            headers: { "Retry-After": retry },
          })
        )
        .mockResolvedValue(response());
      const r = await querySiteWeather({ ...input(), fetcher });
      expect(r.status).toBe("unavailable");
      expect(r.current).toBeNull();
      expect(JSON.stringify(r)).not.toContain("private");
      await querySiteWeather({
        ...input(),
        now: new Date(now.getTime() + 4 * 3600000),
        fetcher,
      });
      await querySiteWeather({
        ...input(),
        configuration: {
          ...configuration,
          location: { label: "另一个项目", latitude: 30, longitude: 120 },
        },
        now: new Date(now.getTime() + 4 * 3600000),
        fetcher,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        (
          await querySiteWeather({
            ...input(),
            now: new Date(now.getTime() + 5 * 3600000),
            fetcher,
          })
        ).status
      ).toBe("ready");
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );
  it("连续失败指数退避，失败后不返回旧数据作正常天气", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValue(new Response("secret", { status: 500 }));
    await querySiteWeather({ ...input(), fetcher });
    const r = await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 3 * 3600000),
      fetcher,
    });
    expect(r.status).toBe("unavailable");
    expect(r.current).toBeNull();
    await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 4 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 6 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 11 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await querySiteWeather({
      ...input(),
      now: new Date(now.getTime() + 12 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([203, 403, 500, 304])(
    "HTTP %s安全失败，绝不伪造天气",
    async status => {
      const fetcher = vi.fn(
        async () =>
          new Response(status === 304 ? null : "sensitive", { status })
      );
      const r = await querySiteWeather({ ...input(), fetcher });
      expect(r.status).toBe("unavailable");
      expect(r.current).toBeNull();
      expect(r.workHints).toEqual([]);
      expect(JSON.stringify(r)).not.toContain("sensitive");
    }
  );
  it("只跟随同固定HTTPS域名重定向，拒绝其他域名/HTTP/凭据", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location:
              "/weatherapi/locationforecast/2.0/compact.json?lat=23.1234&lon=113.9876",
          },
        })
      )
      .mockResolvedValueOnce(response());
    expect((await querySiteWeather({ ...input(), fetcher })).status).toBe(
      "ready"
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const location of [
      "https://evil.invalid/forecast",
      "http://api.met.no/data",
      "https://user:pass@api.met.no/data",
    ]) {
      clearSiteWeatherCache();
      const blocked = vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { Location: location } })
      );
      expect(
        (await querySiteWeather({ ...input(), fetcher: blocked })).status
      ).toBe("unavailable");
      expect(blocked).toHaveBeenCalledTimes(1);
    }
  });
  it("未过期缓存达到250项时拒绝新项而不重复旧请求；过期后LRU驱逐", async () => {
    const modified = "Sun, 22 Nov 2026 23:00:00 GMT";
    const fetcher = vi.fn(async () => response({ "Last-Modified": modified }));
    const coordinates = (i: number) => ({
      ...configuration,
      location: { label: `项目${i}`, latitude: 10 + i / 1000, longitude: 110 },
    });
    for (let i = 0; i < 250; i++)
      await querySiteWeather({
        ...input(),
        configuration: coordinates(i),
        now: new Date(now.getTime() + i * 1001),
        fetcher,
      });
    expect(fetcher).toHaveBeenCalledTimes(250);
    expect(
      (
        await querySiteWeather({
          ...input(),
          configuration: coordinates(250),
          fetcher,
        })
      ).status
    ).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(250);
    await querySiteWeather({
      ...input(),
      configuration: coordinates(0),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(250);
    await querySiteWeather({
      ...input(),
      configuration: coordinates(250),
      now: new Date(now.getTime() + 4 * 3600000),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(251);
    // Coordinate 0 was touched most recently; coordinate 1 is the first expired LRU victim.
    await querySiteWeather({
      ...input(),
      configuration: coordinates(0),
      now: new Date(now.getTime() + 4 * 3600000),
      fetcher,
    });
    const conditional = new Headers(
      (fetcher.mock.calls.at(-1) as unknown as [URL, RequestInit])[1].headers
    ).get("If-Modified-Since");
    expect(conditional).toBe(modified);
    expect(fetcher).toHaveBeenCalledTimes(252);
    await querySiteWeather({
      ...input(),
      configuration: coordinates(1),
      now: new Date(now.getTime() + 4 * 3600000),
      fetcher,
    });
    expect(
      new Headers(
        (fetcher.mock.calls.at(-1) as unknown as [URL, RequestInit])[1].headers
      ).get("If-Modified-Since")
    ).toBeNull();
  });
  it("MET与旧commercial缓存和授权隔离，MET不用商业key且不能绕过撤销确认", async () => {
    const fetcher = vi.fn(async () => response());
    await querySiteWeather({ ...input(), fetcher });
    expect(
      (
        await querySiteWeather({
          ...input(),
          configuration: {
            ...configuration,
            weather: {
              ...configuration.weather,
              provider: "open_meteo_commercial",
            },
          },
          fetcher,
        })
      ).status
    ).toBe("not_configured");
    expect(
      (
        await querySiteWeather({
          ...input(),
          configuration: {
            ...configuration,
            weather: {
              ...configuration.weather,
              metNorway: {
                termsAccepted: false,
                contact: "https://yx.maomaoyx.com/support",
              },
            },
          },
          fetcher,
        })
      ).status
    ).toBe("not_configured");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("MET application traffic ceiling and unexpected provider failures", () => {
  it("同进程一秒最多10次外部请求，redirect同计数，其余安全unavailable", async () => {
    const fetcher = vi.fn(async () => response());
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        querySiteWeather({
          ...input(),
          configuration: {
            ...configuration,
            location: { label: "项目", latitude: 20 + i / 100, longitude: 110 },
          },
          fetcher,
        })
      )
    );
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(results.filter(r => r.status === "ready")).toHaveLength(10);
    expect(results.filter(r => r.status === "unavailable")).toHaveLength(20);
    await querySiteWeather({
      ...input(),
      configuration: {
        ...configuration,
        location: { label: "另一个项目", latitude: 30, longitude: 110 },
      },
      now: new Date(now.getTime() + 1001),
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(11);
  });
  it("自重定向只请求一次，不重复同URL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            Location:
              "/weatherapi/locationforecast/2.0/compact?lat=23.1234&lon=113.9876",
          },
        })
    );
    expect((await querySiteWeather({ ...input(), fetcher })).status).toBe(
      "unavailable"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("超时、坏JSON、空模型均失败且缓存冷却，不泄露响应", async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw Error("timeout sensitive");
      }),
      vi.fn(async () => new Response("invalid sensitive JSON")),
      vi.fn(
        async () =>
          new Response(JSON.stringify({ properties: { timeseries: [] } }))
      ),
    ]) {
      clearSiteWeatherCache();
      const r = await querySiteWeather({ ...input(), fetcher });
      expect(r.status).toBe("unavailable");
      expect(r.current).toBeNull();
      expect(JSON.stringify(r)).not.toContain("sensitive");
      await querySiteWeather({
        ...input(),
        now: new Date(now.getTime() + 1000),
        fetcher,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
