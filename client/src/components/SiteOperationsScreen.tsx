import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  CircleHelp,
  CloudSun,
  Expand,
  HardHat,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Truck,
  Video,
  X,
} from "lucide-react";
import {
  SITE_SAMPLE_METADATA,
  type SiteConfigurationResult,
  type SiteDashboard,
  type SiteProject,
  type SiteRisk,
  type SiteTransportEvent,
  type SiteTransportMetric,
  type SiteWeather,
} from "@shared/siteOperations";
import {
  eventTarget,
  getChinaBusinessDate,
  riskTarget,
  siteDetailPath,
  siteTime,
} from "@/lib/siteOperations";
import { trpc } from "@/lib/trpc";
import { formatQuantity } from "@shared/numberFormat";
import "./site-operations/siteOperations.css";

export type SiteQuery<T> = {
  data?: T;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  refetch: () => unknown;
};
export function SitePlaceholder({
  query,
  label,
}: {
  query: SiteQuery<unknown>;
  label: string;
}) {
  return (
    <div className="so-placeholder" role={query.isError ? "alert" : "status"}>
      {query.isError ? (
        <>
          <span>{label}读取失败，旧数据不作为当前结果。</span>
          <button onClick={() => query.refetch()}>重试本区</button>
        </>
      ) : (
        <span>正在读取{label}…</span>
      )}
    </div>
  );
}
export function SiteModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement)
        : null;
    ref.current?.focus();
    return () => old?.focus?.();
  }, []);
  return (
    <div
      className="so-modal-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="so-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={e => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const nodes = ref.current?.querySelectorAll<HTMLElement>(
              'button,a,input,select,[tabindex="0"]'
            );
            if (!nodes?.length) return;
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="关闭详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="so-modal-body">{children}</div>
      </div>
    </div>
  );
}
const routeText = (r: { load: string | null; unload: string | null }) =>
  `${r.load || "装土点未记录"} → ${r.unload || "卸土点未记录"}`;
const statusText = {
  issued: "已发车",
  accepted: "有效事件",
  needs_review: "待业务核验",
  rejected: "未通过",
};
const severityText = {
  critical: "紧急",
  warning: "待核查",
  notice: "资料提示",
};
const evidenceText = {
  transport_trip: "运输运单",
  transport_card_event: "装卸刷卡事件",
  diesel_refuel: "加油记录",
  transport_vehicle: "车辆当前状态",
};
const reviewText = {
  pending_review: "待核查",
  acknowledged: "已关注",
  in_rectification: "整改中",
};
const metricMeta = [
  ["departures", "当日发车", "按开票时间", Truck],
  ["normalCompletions", "真实完成", "有效卸土 + 核验", Activity],
  ["currentInTransitVehicles", "当前在途", "当前快照 · 非历史", Truck],
  ["pendingReview", "待业务核验", "当日关联运单", ShieldAlert],
] as const;
const sampleVideo: SiteConfigurationResult["videos"][number] = {
  id: "authorized-preview",
  name: "授权施工样片",
  pointLabel: "非本项目工地",
  kind: "sample",
  sampleAsset: "excavator_cc_by_sa_4",
  recordedAt: null,
  enabled: true,
  default: true,
  sortOrder: 0,
  playbackUrl: "/manus-storage/excavator-sample_f339c2da.mp4",
  playbackStatus: "ready",
  attribution: SITE_SAMPLE_METADATA,
};
export function SiteVideoPlayer({
  item,
}: {
  item: SiteConfigurationResult["videos"][number];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(item.playbackStatus !== "ready");
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);
  const [paused, setPaused] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const v = ref.current;
    return () => {
      v?.pause();
    };
  }, [item.playbackUrl, attempt]);
  async function play() {
    try {
      await ref.current?.play();
      setManual(false);
      setPaused(false);
    } catch {
      setManual(true);
      setPaused(true);
    }
  }
  return (
    <div className="so-video-player">
      <div className="so-video-frame">
        <video
          key={`${item.id}:${attempt}`}
          ref={ref}
          src={item.playbackUrl || undefined}
          poster={
            item.sampleAsset
              ? "/manus-storage/excavator-poster_1e75a874.jpg"
              : undefined
          }
          muted
          loop
          playsInline
          controls
          preload="metadata"
          onCanPlay={() => {
            setReady(true);
            if (!failed) void play();
          }}
          onError={() => {
            setFailed(true);
            setReady(false);
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        />
        <span className="so-video-label">
          {item.kind === "sample" ? "示例录像 · 非实时" : "录播 · 非实时"}
        </span>
        {failed ? (
          <div className="so-video-state" role="alert">
            <strong>视频加载失败</strong>
            <span>录播播放失败不代表监控正常。</span>
            <button
              onClick={() => {
                setFailed(item.playbackStatus !== "ready");
                setReady(false);
                setManual(false);
                setPaused(true);
                setAttempt(a => a + 1);
              }}
            >
              重试视频
            </button>
          </div>
        ) : manual ? (
          <div className="so-video-state">
            <span>自动播放被阻止</span>
            <button onClick={() => void play()}>手动播放</button>
          </div>
        ) : !ready ? (
          <div className="so-video-loading">正在加载录像…</div>
        ) : null}
      </div>
      <div className="so-video-toolbar">
        <span>
          {item.pointLabel} ·{" "}
          {item.recordedAt
            ? `录像时间 ${siteTime(item.recordedAt, true)}`
            : item.sampleAsset
              ? `素材拍摄日期 ${SITE_SAMPLE_METADATA.recordedDate}`
              : "录像时间未记录"}
        </span>
        <div>
          <button
            disabled={failed}
            onClick={() => {
              if (paused) void play();
              else ref.current?.pause();
            }}
          >
            {paused ? "播放" : "暂停"}
          </button>
          <button
            onClick={() => {
              void ref.current
                ?.requestFullscreen?.()
                .catch(() => setManual(true));
            }}
          >
            视频全屏
          </button>
        </div>
      </div>
      {item.attribution && (
        <p className="so-attribution">
          {item.attribution.label} · 作者 {item.attribution.author} ·{" "}
          <a href={item.attribution.sourceUrl} target="_blank" rel="noreferrer">
            素材来源
          </a>{" "}
          ·{" "}
          <a
            href={item.attribution.licenseUrl}
            target="_blank"
            rel="noreferrer"
          >
            {item.attribution.license}
          </a>{" "}
          · {item.attribution.modification}
        </p>
      )}
    </div>
  );
}
function VideoPanel({
  query,
  identity,
}: {
  query: SiteQuery<SiteConfigurationResult>;
  identity: string;
}) {
  const [choice, setChoice] = useState("");
  const enabled =
    query.data?.videos
      .filter(v => v.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder) || [];
  const items = enabled.length ? enabled : [sampleVideo];
  const selected =
    items.find(v => v.id === choice) || items.find(v => v.default) || items[0];
  return (
    <section className="so-panel so-video">
      <div className="so-section-title">
        <h2>
          <Video size={17} />
          现场影像
        </h2>
        {!query.isError && query.data && (
          <select
            aria-label="视频点位"
            value={selected.id}
            onChange={e => setChoice(e.target.value)}
          >
            {items.map(v => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.pointLabel}
              </option>
            ))}
          </select>
        )}
      </div>
      {query.isError || !query.data ? (
        <SitePlaceholder query={query} label="视频配置" />
      ) : (
        <>
          <SiteVideoPlayer
            key={`${identity}:${selected.id}:${selected.playbackUrl}`}
            item={selected}
          />
          {!enabled.length && (
            <span className="so-sample-note">
              项目视频待配置，当前仅播放授权样片。
            </span>
          )}
        </>
      )}
    </section>
  );
}
export function SiteWeatherPanel({
  query,
  location,
}: {
  query: SiteQuery<SiteWeather>;
  location?: string;
}) {
  const w = !query.isError ? query.data : undefined;
  const ok = w && (w.status === "ready" || w.status === "stale") && w.current;
  const value = (v: number | null | undefined, unit: string) =>
    v == null ? "未提供" : `${v}${unit}`;
  const weatherCode = (n: number | null) =>
    n == null
      ? "天气状况未提供"
      : n === 0
        ? "晴"
        : n <= 3
          ? "多云"
          : n <= 48
            ? "雾"
            : n <= 67
              ? "雨"
              : n <= 77
                ? "雪"
                : n <= 82
                  ? "阵雨"
                  : n >= 95
                    ? "雷暴"
                    : "天气码 " + n;
  return (
    <section className="so-panel so-weather">
      <div className="so-section-title">
        <h2>
          <CloudSun size={17} />
          工地天气
        </h2>
        <span>{location || "地点待配置"}</span>
      </div>
      {query.isError || !w ? (
        <SitePlaceholder query={query} label="天气" />
      ) : !ok ? (
        <div className="so-placeholder">
          <CloudSun size={32} />
          <strong>
            {w.status === "disabled" || w.status === "not_configured"
              ? "天气服务待配置"
              : "天气服务暂不可用"}
          </strong>
          <span>仅接入商业授权服务，不使用设备定位。</span>
          {w.status === "unavailable" && (
            <button onClick={() => query.refetch()}>重试天气</button>
          )}
        </div>
      ) : (
        <>
          {w.status === "stale" && (
            <p className="so-warning">
              天气数据已过期 · 待更新{" "}
              <button onClick={() => query.refetch()}>更新</button>
            </p>
          )}
          <div className="so-weather-head">
            <strong>{value(w.current!.temperatureC, "°C")}</strong>
            <div>
              {weatherCode(w.current!.weatherCode)}
              <small>体感 {value(w.current!.apparentTemperatureC, "°C")}</small>
            </div>
          </div>
          <div className="so-weather-grid">
            {[
              ["相对湿度", value(w.current!.humidityPercent, "%")],
              ["风速", value(w.current!.windKmh, " km/h")],
              ["风向", value(w.current!.windDirectionDegrees, "°")],
              ["阵风", value(w.current!.gustKmh, " km/h")],
              ["降水量", value(w.current!.precipitationMm, " mm")],
              [
                "今日高 / 低",
                `${value(w.daily?.maximumC, "°C")} / ${value(w.daily?.minimumC, "°C")}`,
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <small>{k}</small>
                <b>{v}</b>
              </div>
            ))}
          </div>
          <h3 className="so-subtitle">未来 12 小时趋势</h3>
          <div className="so-hourly">
            <div className="so-hour-row so-muted">
              <span>北京时间</span>
              <span>气温</span>
              <span>降雨概率</span>
              <span>雨量 / 能见度</span>
            </div>
            {w.hourly.slice(0, 12).map(h => (
              <div key={h.time} className="so-hour-row">
                <span>{siteTime(h.time).slice(0, 5)}</span>
                <span>{value(h.temperatureC, "°C")}</span>
                <span>{value(h.precipitationProbability, "%")}</span>
                <span>
                  {value(h.precipitationMm, "mm")} /{" "}
                  {value(h.visibilityMeters, "m")}
                </span>
              </div>
            ))}
          </div>
          <p className="so-source">
            商业天气模型预报 · 非工地实测
            <br />
            更新时间 {siteTime(w.updatedAt || w.fetchedAt, true)}
          </p>
        </>
      )}
      <div className="so-work-hints">
        <h3>系统作业提示</h3>
        {ok ? (
          w.workHints.length ? (
            w.workHints.map(h => (
              <p key={h.code} data-source={h.source}>
                {h.label}
              </p>
            ))
          ) : (
            <p>当前模型未触发配置阈值，不代表现场安全结论。</p>
          )
        ) : (
          <p>天气未就绪，无法生成天气作业提示。</p>
        )}
        <p className="so-muted">官方气象预警源未接入 · 不自动判定停工</p>
      </div>
    </section>
  );
}
type Detail =
  | { kind: "metric"; metric: SiteTransportMetric; title: string }
  | { kind: "event"; item: SiteTransportEvent }
  | { kind: "risk"; item: SiteRisk }
  | { kind: "vehicle"; item: SiteDashboard["vehicles"][number] }
  | { kind: "help" };
function MetricDetail({
  metric,
  projectId,
  date,
  onNavigate,
}: {
  metric: SiteTransportMetric;
  projectId: number;
  date: string;
  onNavigate: (p: string) => void;
}) {
  const input = React.useMemo(() => ({ projectId, businessDate: date, metric }), [projectId, date, metric]);
  const q = trpc.siteOperations.transportDetails.useQuery(input, {
    retry: false,
    placeholderData: undefined,
  });
  const rows =
    !q.isError && q.data?.projectId === projectId && q.data.businessDate === date && q.data.metric === metric ? q.data.rows : undefined;
  return (
    <>
      <p className="so-muted">
        同项目 · {date}（北京时间）；独立查询完整现场运单，不使用最近动态截断列表，响应不含金额。
        {metric === "currentInTransitVehicles" &&
          "当前在途按车辆去重，下面列出对应当前运单，不是历史快照。"}
      </p>
      {rows ? (
        <>
          <p>
            本次匹配 {rows.length} 张运单
            {metric === "currentInTransitVehicles" &&
              ` / ${new Set(rows.map(r => r.vehicleId)).size} 辆车`}
          </p>
          {rows.length ? (
            rows.map(t => (
              <button
                className="so-detail-row"
                key={t.tripId}
                onClick={() =>
                  onNavigate(
                    siteDetailPath(
                      {
                        target: "transport",
                        projectId,
                        tripId: t.tripId,
                        vehicleId: t.vehicleId,
                        metric,
                      },
                      date
                    )
                  )
                }
              >
                <strong>{t.plate}</strong>
                <span>
                  {t.tripNo} · {siteTime(t.occurredAt, true)}
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <p>真实查询成功，暂无匹配运单。</p>
          )}
        </>
      ) : (
        <SitePlaceholder query={q} label="完整运单明细" />
      )}
    </>
  );
}
export default function SiteOperationsScreen({
  projects,
  projectId,
  businessDate,
  onProjectChange,
  onDateChange,
  dashboard,
  configuration,
  weather,
  onNavigate,
  onRefresh,
}: {
  projects: SiteProject[];
  projectId: number;
  businessDate: string;
  onProjectChange: (id: number) => void;
  onDateChange: (d: string) => void;
  dashboard: SiteQuery<SiteDashboard>;
  configuration: SiteQuery<SiteConfigurationResult>;
  weather: SiteQuery<SiteWeather>;
  onNavigate: (p: string) => void;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [detail, setDetail] = useState<Detail | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const d =
    !dashboard.isError &&
    dashboard.data?.scope.projectId === projectId &&
    dashboard.data.scope.businessDate === businessDate
      ? dashboard.data
      : undefined;
  const c =
    !configuration.isError && configuration.data?.projectId === projectId
      ? configuration.data
      : undefined;
  const title =
    detail?.kind === "metric"
      ? detail.title
      : detail?.kind === "event"
        ? "现场事件依据"
        : detail?.kind === "risk"
          ? "车辆待核查依据"
          : detail?.kind === "vehicle"
            ? "车辆登记资料"
            : "现场大屏使用说明";
  return (
    <main className="site-operations-screen" ref={root}>
      <header className="so-header">
        <div className="so-brand">
          <span className="so-brand-icon">
            <HardHat size={24} />
          </span>
          <div>
            <p>悦信云智管 · 现场指挥</p>
            <h1>现场运行与风险监控</h1>
          </div>
        </div>
        <div className="so-clock">
          <strong>{siteTime(now)}</strong>
          <span>北京时间 · {getChinaBusinessDate(now)}</span>
        </div>
        <div className="so-actions">
          <button aria-label="刷新现场数据" onClick={onRefresh}>
            <RefreshCw
              size={16}
              className={dashboard.isFetching ? "so-spinning" : ""}
            />
            <span>刷新</span>
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen?.();
              else
                void root.current
                  ?.requestFullscreen?.()
                  .catch(() => setDetail({ kind: "help" }));
            }}
          >
            <Expand size={16} />
            <span>全屏</span>
          </button>
          <button onClick={() => onNavigate("/admin")}>
            <Settings2 size={16} />
            <span>管理后台</span>
          </button>
          <button
            aria-label="现场大屏帮助"
            onClick={() => setDetail({ kind: "help" })}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <div className="so-scope">
        <label>
          当前项目
          <select
            aria-label="现场项目"
            value={projectId}
            onChange={e => onProjectChange(Number(e.target.value))}
          >
            {projects.map(p => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          统计日期
          <input
            aria-label="现场统计日期"
            type="date"
            value={businessDate}
            onChange={e => {
              if (e.target.value) onDateChange(e.target.value);
            }}
          />
        </label>
        <button onClick={() => onDateChange(getChinaBusinessDate())}>
          今天
        </button>
        <span className="so-update">
          {d
            ? `现场数据更新 ${siteTime(d.updatedAt)}`
            : dashboard.isError
              ? "现场数据未就绪"
              : "现场数据读取中"}{" "}
          · 每 45 秒刷新
        </span>
      </div>
      <div className="so-main-grid">
        <div className="so-left-column">
          <section className="so-panel">
            <div className="so-section-title">
              <h2>
                <Truck size={17} />
                运输运行
              </h2>
              <span>数量 · 非金额</span>
            </div>
            {d ? (
              <>
                <div className="so-metrics">
                  {metricMeta.map(([key, label, note, Icon]) => (
                    <button
                      key={key}
                      className={`so-metric ${key === "pendingReview" ? "so-metric-amber" : ""}`}
                      onClick={() =>
                        setDetail({
                          kind: "metric",
                          metric: key,
                          title: `${label}明细`,
                        })
                      }
                    >
                      <span>
                        <Icon size={15} />
                        {label}
                        <ArrowUpRight size={13} />
                      </span>
                      <strong>{d.transport[key]}</strong>
                      <small>{note}</small>
                    </button>
                  ))}
                </div>
                <button
                  className="so-special"
                  onClick={() =>
                    setDetail({
                      kind: "metric",
                      metric: "specialClosures",
                      title: "特殊闭环明细",
                    })
                  }
                >
                  特殊闭环 {d.transport.specialClosures} 趟 ·
                  单列，不计真实卸土完成 <ArrowUpRight size={13} />
                </button>
                <p className="so-snapshot">
                  当前在途快照 {siteTime(d.transport.inTransitAsOf, true)}
                </p>
              </>
            ) : (
              <SitePlaceholder query={dashboard} label="运输数量" />
            )}
          </section>
          <section className="so-panel so-events">
            <div className="so-section-title">
              <h2>
                <Activity size={17} />
                最近现场动态
              </h2>
              <span>北京时间</span>
            </div>
            <div className="so-scroll">
              {d ? (
                d.transport.events.length ? (
                  d.transport.events.map(e => (
                    <button
                      className="so-event"
                      key={e.key}
                      onClick={() => setDetail({ kind: "event", item: e })}
                    >
                      <div>
                        <strong className="so-plate">{e.plate}</strong>
                        <time>{siteTime(e.occurredAt)}</time>
                      </div>
                      <p>{routeText(e.route)}</p>
                      <span
                        className={
                          e.status === "needs_review"
                            ? "so-warning-text"
                            : "so-muted"
                        }
                      >
                        {e.type === "departure"
                          ? "发车"
                          : e.type === "review"
                            ? "核验"
                            : "卸土"}{" "}
                        · {statusText[e.status]}
                        {e.closureKind !== "normal"
                          ? " · 特殊闭环"
                          : e.normalCompletion
                            ? " · 真实完成"
                            : ""}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="so-placeholder">
                    真实查询成功，当日暂无现场事件。
                  </div>
                )
              ) : (
                <SitePlaceholder query={dashboard} label="现场动态" />
              )}
            </div>
            {d && (
              <p className="so-list-note">
                共 {d.transport.eventTotal} 条 · 展示最近{" "}
                {d.transport.events.length} 条 · 上限 {d.transport.eventLimit}
                {d.transport.eventsTruncated
                  ? " · 已截断，请点击数量卡查询完整明细"
                  : ""}
              </p>
            )}
          </section>
        </div>
        <div className="so-center-column">
          <VideoPanel
            key={`${projectId}:${businessDate}`}
            identity={`${projectId}:${businessDate}`}
            query={{ ...configuration, data: c }}
          />
          <section className="so-panel so-reports">
            <div className="so-section-title">
              <h2>
                <HardHat size={17} />
                施工日报与计划
              </h2>
              <span>{d ? `${d.construction.total} 份日报` : ""}</span>
            </div>
            <div className="so-scroll">
              {d ? (
                d.construction.reports.length ? (
                  d.construction.reports.map(r => (
                    <article className="so-report" key={r.id}>
                      <h3>
                        {r.workArea}
                        <small>{siteTime(r.updatedAt)}</small>
                      </h3>
                      <p>{r.workContent}</p>
                      {r.constructionPlan && (
                        <p>
                          <span className="so-muted">施工计划 / </span>
                          {r.constructionPlan}
                        </p>
                      )}
                      {r.issueNotes && (
                        <p
                          className={
                            r.issuePriority === "urgent"
                              ? "so-critical"
                              : "so-warning-text"
                          }
                        >
                          <b>
                            {r.issuePriority === "urgent"
                              ? "紧急问题"
                              : r.issuePriority === "normal"
                                ? "一般问题"
                                : "未分级问题"}{" "}
                            /{" "}
                          </b>
                          {r.issueNotes}
                          <small>整改状态未跟踪</small>
                        </p>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="so-placeholder">当日暂无非草稿施工日报。</div>
                )
              ) : (
                <SitePlaceholder query={dashboard} label="施工日报" />
              )}
            </div>
            {d?.construction.truncated && (
              <p className="so-list-note">
                共 {d.construction.total} 份 · 展示上限 {d.construction.limit}{" "}
                份，已截断。
              </p>
            )}
          </section>
        </div>
        <SiteWeatherPanel
          key={`${projectId}:${businessDate}`}
          query={weather}
          location={c?.configuration.location?.label}
        />
      </div>
      <section className="so-panel so-risk-panel">
        <div className="so-section-title">
          <h2>
            <ShieldAlert size={17} />
            车辆待核查与登记资料
          </h2>
          <span>
            {d?.risks.enabled
              ? `共 ${d.risks.total} 条待核查`
              : d
                ? "风险规则已禁用"
                : "状态未就绪"}
          </span>
          <button
            className="so-text-button"
            onClick={() => setDetail({ kind: "help" })}
          >
            口径 ?
          </button>
        </div>
        {d ? (
          <div className="so-risk-workspace">
            <div className="so-risk-list">
              {d.risks.status === "disabled" ? (
                <p className="so-muted">项目风险规则已禁用，未作风险判断。</p>
              ) : d.risks.items.length ? (
                d.risks.items.map(r => (
                  <button
                    className={`so-risk so-risk-${r.severity}`}
                    key={r.key}
                    onClick={() => setDetail({ kind: "risk", item: r })}
                  >
                    <strong className="so-plate">{r.plate}</strong>
                    <span className="so-risk-level">
                      {severityText[r.severity]}
                    </span>
                    <p>{r.reason}</p>
                    <small>
                      {siteTime(r.occurredAt, true)} · {routeText(r.route)} ·{" "}
                      {reviewText[r.reviewStatus]}
                      {r.basis === "current_snapshot" ? " · 当前快照" : ""}
                    </small>
                  </button>
                ))
              ) : (
                <p className="so-muted">
                  真实查询成功，当前范围暂无已支持规则的待核查事项；不代表油耗或效率正常。
                </p>
              )}
              {d.risks.truncated && (
                <p className="so-list-note">
                  共 {d.risks.total} 条 · 展示上限 {d.risks.limit} 条，已截断。
                </p>
              )}
            </div>
            <div className="so-vehicle-list">
              {d.vehicles.length ? (
                d.vehicles.map(v => (
                  <button
                    className="so-vehicle"
                    key={v.vehicleId}
                    onClick={() => setDetail({ kind: "vehicle", item: v })}
                  >
                    <strong className="so-plate">{v.plate}</strong>
                    <span>
                      登记加油 <b>{formatQuantity(v.registeredFuelLiters)} L</b> · 有效完成{" "}
                      <b>{v.normalCompletedTrips} 趟</b>
                    </span>
                    <small>真实油耗 / 趟数效率：数据不足（非异常结论）</small>
                  </button>
                ))
              ) : (
                <p className="so-muted">项目暂无车辆登记资料。</p>
              )}
            </div>
          </div>
        ) : (
          <SitePlaceholder query={dashboard} label="车辆风险与资料" />
        )}
      </section>
      {detail && (
        <SiteModal title={title} onClose={() => setDetail(null)}>
          {detail.kind === "help" ? (
            <div className="so-help">
              <h3>真实口径，不作无依据判断</h3>
              <p>
                发车按当日开票；真实完成依据有效卸土事件和核验。跨夜卸土归卸土日。当前在途始终是此刻快照，不伪造历史；特殊闭环单列。各卡不是可相加的分类。
              </p>
              <p>
                日报问题尚未跟踪整改完成。天气来自商业模型而非传感器，官方预警未接入；系统提示不自动停工。
              </p>
              <p>
                登记加油量不是实际油耗。油箱容量、有效里程、有效耗油周期或班次基线不足时，不判断油耗或趟数效率。正常重复提交不构成风险，不认定偷油或违规。
              </p>
              <p>
                录像不代表实时监控；未配置视频使用带署名的授权样片。项目配置可到系统设置维护。
              </p>
              <button
                onClick={() => onNavigate("/admin/settings?category=onsite")}
              >
                管理现场大屏配置
              </button>
            </div>
          ) : detail.kind === "metric" ? (
            <MetricDetail
              metric={detail.metric}
              projectId={projectId}
              date={businessDate}
              onNavigate={onNavigate}
            />
          ) : detail.kind === "event" ? (
            <>
              <strong className="so-plate">{detail.item.plate}</strong>
              <p>
                {siteTime(detail.item.occurredAt, true)} ·{" "}
                {statusText[detail.item.status]}
              </p>
              <p>{routeText(detail.item.route)}</p>
              <p>
                原运单 #{detail.item.tripId} · 原事件{" "}
                {detail.item.eventId ?? "未关联"} ·{" "}
                {detail.item.closureKind === "normal"
                  ? "普通装卸闭环"
                  : "特殊闭环（非正常卸土完成）"}
              </p>
              <button
                onClick={() =>
                  onNavigate(
                    siteDetailPath(
                      eventTarget(detail.item, projectId),
                      businessDate
                    )
                  )
                }
              >
                定位原运单与装卸凭据
              </button>
            </>
          ) : detail.kind === "risk" ? (
            <>
              <strong className="so-plate">{detail.item.plate}</strong>
              <p>
                {severityText[detail.item.severity]} ·{" "}
                {reviewText[detail.item.reviewStatus]} ·{" "}
                {siteTime(detail.item.occurredAt, true)}
              </p>
              <p>{routeText(detail.item.route)}</p>
              <p>{detail.item.reason}</p>
              <p>
                依据：{evidenceText[detail.item.evidence.type]} #
                {detail.item.evidence.id} ·{" "}
                {detail.item.basis === "current_snapshot"
                  ? "当前状态快照"
                  : "当日关联事实"}
              </p>
              <button
                onClick={() =>
                  onNavigate(
                    siteDetailPath(riskTarget(detail.item), businessDate)
                  )
                }
              >
                {detail.item.detail.target === "diesel"
                  ? "定位原加油记录"
                  : "定位原运单 / 车辆"}
              </button>
            </>
          ) : (
            <>
              <strong className="so-plate">{detail.item.plate}</strong>
              <dl className="so-detail-fields">
                {[
                  [
                    "登记加油量",
                    `${formatQuantity(detail.item.registeredFuelLiters)} L（非实际油耗）`,
                  ],
                  [
                    "加油记录",
                    `${detail.item.refuelRecordCount} 笔 / 待核定 ${detail.item.pendingFuelRecords} 笔`,
                  ],
                  ["正常完成", `${detail.item.normalCompletedTrips} 趟`],
                  [
                    "核定油箱容量",
                    detail.item.fuelTankCapacityLiters == null
                      ? "数据不足：未登记"
                      : `${formatQuantity(detail.item.fuelTankCapacityLiters)} L`,
                  ],
                  [
                    "加油凭据",
                    detail.item.evidenceStatus === "ready"
                      ? "已关联凭据"
                      : "数据不足：凭据或记录缺失",
                  ],
                  [
                    "真实油耗 / 趟数效率",
                    "数据不足，缺少有效周期、里程和班次基线；不是油耗异常",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() =>
                  onNavigate(
                    siteDetailPath(
                      {
                        target: "diesel",
                        projectId,
                        vehicleId: detail.item.vehicleId,
                        plate: detail.item.plate,
                      },
                      businessDate
                    )
                  )
                }
              >
                查看该车当日加油记录
              </button>
              <button
                onClick={() =>
                  onNavigate(
                    siteDetailPath(
                      {
                        target: "transport",
                        projectId,
                        vehicleId: detail.item.vehicleId,
                        plate: detail.item.plate,
                      },
                      businessDate
                    )
                  )
                }
              >
                查看该车当日关联运单
              </button>
            </>
          )}
        </SiteModal>
      )}
    </main>
  );
}
