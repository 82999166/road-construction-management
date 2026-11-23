import React from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";
import {
  DEFAULT_SITE_CONFIGURATION,
  SITE_SAMPLE_METADATA,
  SITE_MET_NORWAY_ATTRIBUTION,
  type SiteDashboard,
  type SiteConfigurationResult,
  type SiteWeather,
} from "@shared/siteOperations";
const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    siteOperations: {
      transportDetails: { useQuery: (...a: unknown[]) => query(...a) },
    },
  },
}));
import Screen, {
  VideoPanel,
  SiteVideoPlayer,
  SiteWeatherPanel,
} from "./SiteOperationsScreen";
import {
  eventTarget,
  filterFocusedTrips,
  filterFocusedRefuels,
  filterSiteTrips,
  getChinaBusinessDate,
  parseOnsiteFocus,
  siteDetailPath,
  siteTime,
} from "@/lib/siteOperations";
let tree: ReactTestRenderer;
const text = (x: ReactTestInstance): string =>
  x.children.map(c => (typeof c === "string" ? c : text(c))).join("");
const button = (s: string) =>
  tree.root.findAllByType("button").find(b => text(b).includes(s))!;
const result = (data?: any) => ({
  data,
  isLoading: !data,
  isError: false,
  refetch: vi.fn(),
});
const config: SiteConfigurationResult = {
  projectId: 1,
  version: 3,
  updatedAt: null,
  configuration: DEFAULT_SITE_CONFIGURATION,
  videoStatus: "not_configured",
  videos: [],
  weatherCredential: { keyConfigured: false, version: null },
};
const weather: SiteWeather = {
  status: "disabled",
  source: "open_meteo_commercial",
  sourceKind: "model",
  timezone: "Asia/Shanghai",
  updatedAt: null,
  fetchedAt: null,
  expiresAt: null,
  stale: false,
  officialAlerts: { status: "not_connected" },
  units: {
    temperature: "°C",
    wind: "km/h",
    precipitation: "mm",
    probability: "%",
    visibility: "m",
  },
  current: null,
  hourly: [],
  daily: null,
  workHints: [],
};
const dashboard: SiteDashboard = {
  scope: {
    projectId: 1,
    projectName: "甲工地",
    businessDate: "2026-11-23",
    timezone: "Asia/Shanghai",
    startAt: "",
    endExclusive: "",
  },
  updatedAt: "2026-11-23T00:00:00Z",
  transport: {
    departures: 75,
    normalCompletions: 0,
    currentInTransitVehicles: 2,
    pendingReview: 1,
    specialClosures: 1,
    inTransitBasis: "current_snapshot",
    inTransitAsOf: "2026-11-23T00:00:00Z",
    pendingReviewBasis: "business_day_related_trips",
    countBasis: "all_matching_records",
    events: [
      {
        key: "event1",
        type: "review",
        tripId: 91,
        eventId: 92,
        vehicleId: 9,
        plate: "粤A12345",
        route: { load: "装土A", unload: "卸土B" },
        occurredAt: "2026-11-23T00:00:00Z",
        status: "needs_review",
        closureKind: "normal",
        normalCompletion: false,
      },
    ],
    eventTotal: 75,
    eventLimit: 50,
    eventsTruncated: true,
  },
  construction: {
    total: 1,
    limit: 50,
    truncated: false,
    reports: [
      {
        id: 1,
        workArea: "路基",
        workContent: "真实碾压",
        constructionPlan: "明日铺设",
        issueNotes: "排水待核查",
        issuePriority: "urgent",
        status: "approved",
        updatedAt: "2026-11-23T00:00:00Z",
        issueResolution: "not_tracked",
      },
    ],
  },
  vehicles: [
    {
      vehicleId: 9,
      plate: "粤A12345",
      registeredFuelLiters: 100,
      refuelRecordCount: 2,
      pendingFuelRecords: 1,
      normalCompletedTrips: 0,
      fuelTankCapacityLiters: null,
      capacityStatus: "data_insufficient",
      evidenceStatus: "data_insufficient",
      fuelConsumptionStatus: "data_insufficient",
      tripEfficiencyStatus: "data_insufficient",
    },
  ],
  risks: {
    enabled: true,
    status: "ready",
    items: [
      {
        key: "r1",
        ruleCode: "FUEL_FILL_OVER_CAPACITY",
        vehicleId: 9,
        plate: "粤A12345",
        project: { id: 1, name: "甲工地" },
        route: { load: null, unload: null },
        occurredAt: "2026-11-23T00:00:00Z",
        severity: "warning",
        reason: "登记量待核查，不是实际油耗",
        evidence: { type: "diesel_refuel", id: 88 },
        reviewStatus: "pending_review",
        alertId: null,
        basis: "business_day",
        detail: {
          target: "diesel",
          projectId: 1,
          vehicleId: 9,
          tripId: null,
          refuelId: 88,
          eventId: null,
        },
      },
    ],
    total: 1,
    limit: 100,
    truncated: false,
    interpretation: "待核查，不认定偷油或违规；真实油耗和趟数效率缺少基线",
  },
};
function props() {
  return {
    projects: [{ id: 1, name: "甲工地", status: "active" as const }],
    projectId: 1,
    businessDate: "2026-11-23",
    onProjectChange: vi.fn(),
    onDateChange: vi.fn(),
    dashboard: result(dashboard),
    configuration: result(config),
    weather: result(weather),
    onNavigate: vi.fn(),
    onRefresh: vi.fn(),
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null });
  query.mockReturnValue(
    result({
      projectId: 1,
      businessDate: "2026-11-23",
      metric: "departures",
      count: 0,
      vehicleCount: 0,
      rows: [],
    })
  );
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("现场大屏真实行为", () => {
  it("北京时间业务日和时钟不依赖设备时区", () => {
    expect(getChinaBusinessDate(new Date("2026-01-31T16:30:00Z"))).toBe(
      "2026-02-01"
    );
    expect(siteTime("2026-11-23T00:00:00Z")).toBe("08:00:00");
  });
  it("真实零与截断说明、录播署名、问题和资料不足完整展示", async () => {
    await act(async () => {
      tree = create(<Screen {...props()} />);
    });
    const s = text(tree.root);
    expect(s).toContain("75");
    expect(s).toContain("真实完成0");
    expect(s).not.toContain("最近现场动态");
    expect(tree.root.findAllByProps({ className: "so-event" })).toHaveLength(0);
    expect(s).toContain("明日铺设");
    expect(s).toContain("待业务核验");
    expect(s).toContain("KaiKemmann");
    expect(s).toContain("CC BY-SA 4.0");
    expect(s).toContain("示例录像 · 非实时");
    expect(s).toContain("天气服务待配置");
    expect(s).toContain("整改状态未跟踪");
    expect(s).toContain("数据不足（非异常结论）");
    expect(s).toContain("智能风控预警");
    expect(s).toContain("车辆登记资料");
    expect(s).toContain("规则辅助 · 不替代人工判断");
  });
  it("错误隐藏缓存成功数且分区重试不破坏视频天气", async () => {
    const p = props();
    p.dashboard = { ...p.dashboard, isError: true };
    await act(async () => {
      tree = create(<Screen {...p} />);
    });
    expect(text(tree.root)).not.toContain("当日发车75");
    expect(text(tree.root)).toContain("读取失败");
    expect(text(tree.root)).toContain("天气服务待配置");
    await act(async () => button("重试本区").props.onClick());
    expect(p.dashboard.refetch).toHaveBeenCalled();
  });
  it("旧项目/日期结果不能显示运输、风险或视频", async () => {
    const p = props();
    await act(async () => {
      tree = create(<Screen {...p} projectId={2} />);
    });
    expect(text(tree.root)).not.toContain("粤A12345");
    expect(tree.root.findAllByType("video")).toHaveLength(0);
    await act(async () =>
      tree.update(<Screen {...p} businessDate="2026-11-22" />)
    );
    expect(text(tree.root)).not.toContain("粤A12345");
  });
  it("移除最近动态并将天气与视频配置定位到当前项目", async () => {
    const p = props();
    await act(async () => {
      tree = create(<Screen {...p} />);
    });
    expect(text(tree.root)).not.toContain("最近现场动态");
    await act(async () => button("天气配置").props.onClick());
    expect(p.onNavigate).toHaveBeenLastCalledWith(
      "/admin/settings?category=onsite&siteTab=weather&siteProjectId=1"
    );
    await act(async () => button("配置视频").props.onClick());
    expect(p.onNavigate).toHaveBeenLastCalledWith(
      "/admin/settings?category=onsite&siteProjectId=1&siteTab=video"
    );
  });
  it("未配置第二视频时保留两个窗口但不伪造另一点位", async () => {
    const onConfigure = vi.fn();
    await act(async () => {
      tree = create(
        <VideoPanel
          query={result(config)}
          identity="1"
          onConfigure={onConfigure}
        />
      );
    });
    expect(
      tree.root.findAllByProps({ className: "so-video-window" })
    ).toHaveLength(2);
    expect(tree.root.findAllByType("video")).toHaveLength(1);
    expect(text(tree.root)).toContain("右侧视频待配置");
    await act(async () => button("添加视频点位").props.onClick());
    expect(onConfigure).toHaveBeenCalledOnce();
  });
  it("左右视频独立选源，默认选不同启用点位，停用项不显示", async () => {
    const videos = ["a", "b", "c", "disabled"].map((id, i) => ({
      id,
      name: `录像${id}`,
      pointLabel: `点位${id}`,
      kind: "sample" as const,
      sampleAsset: "excavator_cc_by_sa_4" as const,
      recordedAt: null,
      enabled: id !== "disabled",
      default: id === "b",
      sortOrder: i,
      playbackUrl: `/sample-${id}.mp4`,
      playbackStatus: "ready" as const,
      attribution: SITE_SAMPLE_METADATA,
    }));
    await act(async () => {
      tree = create(
        <VideoPanel
          query={result({ ...config, videos })}
          identity="1"
          onConfigure={vi.fn()}
        />
      );
    });
    const left = tree.root.findByProps({ "aria-label": "左侧视频点位" });
    const right = tree.root.findByProps({ "aria-label": "右侧视频点位" });
    expect(left.props.value).toBe("b");
    expect(right.props.value).toBe("a");
    expect(tree.root.findAllByType("video").map(v => v.props.src)).toEqual([
      "/sample-b.mp4",
      "/sample-a.mp4",
    ]);
    expect(text(tree.root)).not.toContain("录像disabled");
    await act(async () => right.props.onChange({ target: { value: "c" } }));
    expect(tree.root.findAllByType("video").map(v => v.props.src)).toEqual([
      "/sample-b.mp4",
      "/sample-c.mp4",
    ]);
    await act(async () => left.props.onChange({ target: { value: "a" } }));
    expect(
      tree.root.findByProps({ "aria-label": "右侧视频点位" }).props.value
    ).toBe("c");
  });
  it("视频配置错误时隐藏缓存画面并保持本区重试", async () => {
    const q = { ...result(config), isError: true };
    await act(async () => {
      tree = create(
        <VideoPanel query={q} identity="1" onConfigure={vi.fn()} />
      );
    });
    expect(tree.root.findAllByType("video")).toHaveLength(0);
    await act(async () => button("重试本区").props.onClick());
    expect(q.refetch).toHaveBeenCalledOnce();
  });
  it("移除所选点位后不继续播放被撤销的视频", async () => {
    const v = {
      id: "a",
      name: "现场",
      pointLabel: "点位",
      kind: "sample" as const,
      sampleAsset: "excavator_cc_by_sa_4" as const,
      recordedAt: null,
      enabled: true,
      default: true,
      sortOrder: 0,
      playbackUrl: "/old-a.mp4",
      playbackStatus: "ready" as const,
      attribution: SITE_SAMPLE_METADATA,
    };
    await act(async () => {
      tree = create(
        <VideoPanel
          query={result({ ...config, videos: [v] })}
          identity="1"
          onConfigure={vi.fn()}
        />
      );
    });
    await act(async () =>
      tree.root
        .findByProps({ "aria-label": "左侧视频点位" })
        .props.onChange({ target: { value: "a" } })
    );
    await act(async () =>
      tree.update(
        <VideoPanel query={result(config)} identity="1" onConfigure={vi.fn()} />
      )
    );
    expect(
      tree.root.findAllByType("video").some(v => v.props.src === "/old-a.mp4")
    ).toBe(false);
    expect(text(tree.root)).toContain("左侧视频待配置");
  });
  it("风险和车辆详情有真实字段及准确加油记录入口", async () => {
    const p = props();
    await act(async () => {
      tree = create(<Screen {...p} />);
    });
    await act(async () =>
      tree.root
        .findAllByType("button")
        .find(b => b.props.className === "so-risk so-risk-warning")!
        .props.onClick()
    );
    await act(async () => button("定位原加油记录").props.onClick());
    expect(p.onNavigate.mock.calls[0][0]).toContain("refuelId=88");
    await act(async () =>
      tree.root.findByProps({ "aria-label": "关闭详情" }).props.onClick()
    );
    await act(async () =>
      tree.root
        .findAllByType("button")
        .find(b => b.props.className === "so-vehicle")!
        .props.onClick()
    );
    expect(text(tree.root)).toContain("100.00 L（非实际油耗）");
    expect(text(tree.root)).toContain("数据不足：未登记");
    await act(async () => button("查看该车当日加油记录").props.onClick());
    expect(p.onNavigate.mock.calls[1][0]).toContain("vehicleId=9");
  });
  it("数量卡独立查询完整运单，不用最近50条冒充全部", async () => {
    const p = props();
    query.mockReturnValue(
      result({
        projectId: 1,
        businessDate: "2026-11-23",
        metric: "departures",
        count: 1,
        vehicleCount: 1,
        rows: [
          {
            tripId: 190,
            vehicleId: 9,
            tripNo: "T190",
            plate: "粤A12345",
            occurredAt: "2026-11-23T00:00:00Z",
            route: { load: "A", unload: "B" },
          },
        ],
      })
    );
    await act(async () => {
      tree = create(<Screen {...p} />);
    });
    await act(async () => button("当日发车").props.onClick());
    expect(query).toHaveBeenCalledWith(
      { projectId: 1, businessDate: "2026-11-23", metric: "departures" },
      expect.objectContaining({ retry: false })
    );
    expect(text(tree.root)).toContain("本次匹配 1 张运单");
    expect(text(tree.root)).toContain("独立查询完整现场运单");
    await act(async () => button("T190").props.onClick());
    expect(p.onNavigate.mock.calls[0][0]).toContain("tripId=190");
  });
  it("降雨概率和雨量分离且明确模型、过期与官方预警未接入", async () => {
    const w = {
      ...weather,
      status: "stale" as const,
      current: {
        time: "2026-11-23T00:00:00Z",
        temperatureC: 20,
        apparentTemperatureC: 18,
        humidityPercent: 80,
        weatherCode: 61,
        windKmh: 30,
        windDirectionDegrees: 90,
        gustKmh: 45,
        precipitationMm: 1.2,
      },
      hourly: [
        {
          time: "2026-11-23T01:00:00Z",
          temperatureC: 19,
          precipitationProbability: 77,
          visibilityMeters: 6000,
          windKmh: 32,
          precipitationMm: 2.3,
        },
      ],
      daily: { date: "2026-11-23", maximumC: 24, minimumC: 15 },
      workHints: [
        {
          code: "rain",
          label: "道路湿滑",
          source: "system_work_hint" as const,
        },
      ],
    };
    await act(async () => {
      tree = create(<SiteWeatherPanel query={result(w)} location="项目工地" />);
    });
    const s = text(tree.root);
    expect(s).toContain("1.2 mm");
    expect(s).toContain("77%");
    expect(s).toContain("2.3mm / 6000m");
    expect(s).toContain("模型预报 · 非工地实测");
    expect(s).toContain("天气数据已过期");
    expect(s).toContain("官方气象预警源未接入");
    expect(
      tree.root.findByProps({ "data-source": "system_work_hint" })
    ).toBeTruthy();
  });
  it("免费天气显示授权来源和预测雨量，不伪造体感阵风概率能见度", async () => {
    const w: SiteWeather = {
      ...weather,
      source: "met_norway",
      status: "ready",
      attribution: SITE_MET_NORWAY_ATTRIBUTION,
      weatherDescription: "小雨",
      current: {
        time: "2026-11-23T01:00:00Z",
        temperatureC: 20,
        apparentTemperatureC: null,
        humidityPercent: 80,
        weatherCode: null,
        windKmh: 18,
        windDirectionDegrees: 90,
        gustKmh: null,
        precipitationMm: null,
      },
      predictive: {
        label: "模型预报·非现场实测",
        precipitationPeriod: "next_1_hour",
        precipitationMm: 2,
        periodStart: "2026-11-23T01:00:00Z",
        periodEnd: "2026-11-23T02:00:00Z",
        dailyBasis: "remaining_forecast_points",
      },
      daily: { date: "2026-11-23", maximumC: 24, minimumC: 18 },
      hourly: [
        {
          time: "2026-11-23T02:00:00Z",
          temperatureC: 21,
          precipitationProbability: null,
          visibilityMeters: null,
          windKmh: 18,
          precipitationMm: 1,
        },
      ],
    };
    await act(async () => {
      tree = create(<SiteWeatherPanel query={result(w)} location="工地" />);
    });
    const s = text(tree.root);
    expect(s).toContain("小雨");
    expect(s).toContain("体感 未提供");
    expect(s).toContain("阵风未提供");
    expect(s).toContain("1小时预报雨量2 mm");
    expect(s).toContain("今日剩余预报高 / 低");
    expect(s).toContain("09:00:00");
    expect(s).toContain("10:00:00");
    expect(s).toContain("免费天气模型预报 · 非工地实测");
    expect(s).toContain("MET Norway");
    expect(s).toContain("CC BY 4.0");
    expect(tree.root.findAllByType("a").map(x => x.props.href)).toEqual([
      SITE_MET_NORWAY_ATTRIBUTION.sourceUrl,
      SITE_MET_NORWAY_ATTRIBUTION.licenseUrl,
    ]);
    expect(s).not.toContain("商业天气模型");
  });
  it("播放器保留控件，自动播放失败手动fallback，加载错误重试和源切换暂停旧画面", async () => {
    const play = vi.fn().mockRejectedValue(new Error("blocked")),
      pause = vi.fn();
    const v = {
      id: "v1",
      name: "录像",
      pointLabel: "点位",
      kind: "recorded" as const,
      url: "https://media.site.cn/a.mp4",
      recordedAt: null,
      enabled: true,
      default: true,
      sortOrder: 0,
      playbackUrl: "https://media.site.cn/a.mp4",
      playbackStatus: "ready" as const,
      attribution: null,
    };
    await act(async () => {
      tree = create(<SiteVideoPlayer item={v} />, {
        createNodeMock: e => (e.type === "video" ? { play, pause } : null),
      });
    });
    const video = tree.root.findByType("video");
    expect(video.props).toMatchObject({
      muted: true,
      loop: true,
      playsInline: true,
      controls: true,
    });
    expect(text(tree.root)).toContain("录播 · 非实时");
    expect(text(tree.root)).not.toContain("录像时间未记录");
    expect(
      tree.root.findAllByProps({ className: "so-attribution" })
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ className: "so-sample-note" })
    ).toHaveLength(0);
    expect(video.props["aria-label"]).toContain("录播 · 非实时");
    await act(async () => video.props.onCanPlay());
    expect(text(tree.root)).toContain("自动播放被阻止");
    play.mockResolvedValue(undefined);
    await act(async () => button("手动播放").props.onClick());
    expect(text(tree.root)).not.toContain("自动播放被阻止");
    await act(async () => video.props.onError());
    expect(text(tree.root)).toContain("视频加载失败");
    await act(async () => button("重试视频").props.onClick());
    expect(text(tree.root)).not.toContain("视频加载失败");
    expect(pause).toHaveBeenCalled();
  });
  it("精确ID跨夜不会被发车日期丢弃，正常重复事件不当作待核查", () => {
    const focus = parseOnsiteFocus(
      "onsite=1&projectId=1&businessDate=2026-11-23&vehicleId=9&tripId=7&eventId=8"
    )!;
    expect(
      filterFocusedTrips(
        [
          {
            id: 7,
            vehicleId: 9,
            status: "verified",
            startAt: "2026-11-22T00:00:00Z",
          },
          { id: 8, vehicleId: 9 },
        ],
        focus
      )
    ).toHaveLength(1);
    expect(
      filterFocusedRefuels(
        [
          { id: 4, vehicleId: 9 },
          { id: 5, vehicleId: 9 },
        ],
        { ...focus, tripId: null, refuelId: 4 }
      )
    ).toHaveLength(1);
    expect(
      siteDetailPath(
        eventTarget(dashboard.transport.events[0], 1),
        focus.businessDate
      )
    ).toContain("eventId=92");
    const trip = {
      id: 1,
      status: "verified",
      loadConfirmedBy: 1,
      loadConfirmedAt: "2026-11-23T00:00:00Z",
      unloadConfirmedAt: "2026-11-23T01:00:00Z",
      endAt: "2026-11-23T01:00:00Z",
      reviewEligibility: {
        eligible: true,
        closureKind: "normal",
        requiresExceptionReview: false,
      },
      cardEvents: [
        {
          eventType: "load",
          occurredAt: "2026-11-23T00:00:00Z",
          validationStatus: "校验通过",
        },
        {
          eventType: "unload",
          occurredAt: "2026-11-23T01:00:00Z",
          validationStatus: "校验通过",
        },
        { validationStatus: "duplicate" },
      ],
    };
    expect(
      filterSiteTrips([trip], "normalCompletions", "2026-11-23")
    ).toHaveLength(1);
    expect(filterSiteTrips([trip], "pendingReview", "2026-11-23")).toHaveLength(
      0
    );
  });
  it("320宽度scoped布局、局部滚动、没有bottom入场动画与财务API", () => {
    const css = readFileSync(
      new URL("./site-operations/siteOperations.css", import.meta.url),
      "utf8"
    );
    expect(css).toContain("--so-bg:#07141d");
    expect(css).toContain("--so-green:#6bdac2");
    expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(css).toContain("overflow-x:clip");
    expect(css).toContain("object-fit: cover");
    expect(css).toContain("flex: 0 0 auto");
    expect(css).not.toMatch(
      /slide-in-from-bottom|translateY|bottom:0.*animation/
    );
    expect(
      readFileSync(
        new URL("./SiteOperationsScreen.tsx", import.meta.url),
        "utf8"
      )
    ).not.toContain("operatingDashboard");
  });
});
