import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  SITE_SAMPLE_METADATA,
  SITE_VIDEO_MAX_BYTES,
  siteConfigurationSchema,
  type SiteConfiguration,
  type SiteVideo,
} from "@shared/siteOperations";
import { SitePlaceholder } from "./SiteOperationsScreen";
import "./site-operations/siteOperations.css";

type Draft = {
  projectId: number;
  version: number | null;
  configuration: SiteConfiguration;
  baseline: string;
};
const tabs = ["视频管理", "天气地点", "天气接入", "使用说明"] as const;
const thresholdLabels = {
  windKmh: "风速 km/h（10–150）",
  gustKmh: "阵风 km/h（10–200）",
  precipitationMm: "降水量 mm（0.1–100）",
  visibilityMeters: "低能见度 m（50–10000）",
  heatC: "高温 °C（25–50）",
  coldC: "低温 °C（-40–10）",
};
const id = () =>
  `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("视频文件读取失败"));
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(file);
  });
}
export default function SiteOperationsSettings({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { user, isAuthenticated, loading } = useAuth();
  const allowed = !loading && isAuthenticated && user?.role === "admin";
  const projects = trpc.siteOperations.projects.useQuery(undefined, {
    enabled: allowed,
    retry: false,
    placeholderData: undefined,
  });
  const [projectId, setProjectId] = useState(0);
  const [tab, setTab] = useState<(typeof tabs)[number]>("视频管理");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [key, setKey] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [location, setLocation] = useState<{
    label: string;
    latitude: string;
    longitude: string;
  }>({ label: "", latitude: "", longitude: "" });
  const [locationBaseline, setLocationBaseline] = useState("");
  const generation = useRef(0);
  const currentProject = useRef(0);
  const mounted = useRef(true);
  const configuration = trpc.siteOperations.getConfiguration.useQuery(
    { projectId },
    {
      enabled: allowed && projectId > 0,
      retry: false,
      placeholderData: undefined,
    }
  );
  const credential = trpc.siteOperations.getWeatherCredential.useQuery(
    undefined,
    { enabled: allowed, retry: false }
  );
  const testWeather = trpc.siteOperations.getWeather.useQuery(
    { projectId },
    { enabled: false, retry: false, placeholderData: undefined }
  );
  const save = trpc.siteOperations.saveConfiguration.useMutation();
  const saveKey = trpc.siteOperations.saveWeatherCredential.useMutation();
  const upload = trpc.siteOperations.uploadVideo.useMutation();
  const dirty =
    Boolean(
      draft &&
        (JSON.stringify(draft.configuration) !== draft.baseline ||
          JSON.stringify(location) !== locationBaseline)
    ) ||
    Boolean(key.trim()) ||
    uploading ||
    saving ||
    saveKey.isPending;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    if (
      !allowed ||
      projects.isError ||
      !projects.data?.length ||
      projects.data.some(p => p.id === projectId)
    )
      return;
    const p =
      projects.data.find(p => p.status === "active") || projects.data[0];
    currentProject.current = p.id;
    setProjectId(p.id);
  }, [allowed, projects.data, projects.isError, projectId]);
  const hydrate = (data: NonNullable<typeof configuration.data>) => {
    setDraft({
      projectId: data.projectId,
      version: data.version,
      configuration: structuredClone(data.configuration),
      baseline: JSON.stringify(data.configuration),
    });
    const loc = data.configuration.location;
    const l = {
      label: loc?.label || "",
      latitude: loc ? String(loc.latitude) : "",
      longitude: loc ? String(loc.longitude) : "",
    };
    setLocation(l);
    setLocationBaseline(JSON.stringify(l));
  };
  useEffect(() => {
    if (
      !configuration.isError &&
      configuration.data?.projectId === projectId &&
      draft?.projectId !== projectId
    )
      hydrate(configuration.data);
  }, [configuration.data, configuration.isError, projectId, draft?.projectId]);
  function confirmLeave() {
    return (
      !dirty ||
      window.confirm(
        "现场大屏有未保存配置或进行中的上传，切换将放弃草稿。确认继续吗？"
      )
    );
  }
  function changeProject(next: number) {
    if (next === projectId || !confirmLeave()) return;
    generation.current++;
    currentProject.current = next;
    setProjectId(next);
    setDraft(null);
    setUploading(false);
    setSaving(false);
    setMessage("");
    setKey("");
    setKeyMessage("");
  }
  function update(fn: (c: SiteConfiguration) => SiteConfiguration) {
    setDraft(d =>
      d?.projectId === projectId
        ? { ...d, configuration: fn(d.configuration) }
        : d
    );
    setSuccess(false);
  }
  function videoChange(videoId: string, patch: Partial<SiteVideo>) {
    update(c => ({
      ...c,
      videos: c.videos.map(v =>
        v.id === videoId
          ? {
              ...v,
              ...patch,
              ...(patch.enabled === false ? { default: false } : {}),
            }
          : patch.default
            ? { ...v, default: false }
            : v
      ),
    }));
  }
  function addVideo(sample: boolean) {
    if (!draft || draft.configuration.videos.length >= 12) return;
    update(c => ({
      ...c,
      videos: [
        ...c.videos,
        {
          id: id(),
          name: sample ? "授权施工样片" : "新录像",
          pointLabel: sample ? "非本项目工地" : "施工点位",
          kind: sample ? "sample" : "recorded",
          ...(sample
            ? { sampleAsset: "excavator_cc_by_sa_4" as const }
            : { url: "" }),
          recordedAt: null,
          enabled: true,
          default: !c.videos.some(v => v.default),
          sortOrder: c.videos.length,
        },
      ],
    }));
    setMessage("已加入草稿，点击“保存配置”后才会启用。");
    setSuccess(false);
  }
  async function uploadFile(file: File) {
    const token = generation.current,
      project = currentProject.current;
    if (
      !draft ||
      draft.projectId !== project ||
      draft.configuration.videos.length >= 12 ||
      uploading
    )
      return;
    if (
      file.size <= 0 ||
      file.size > SITE_VIDEO_MAX_BYTES ||
      !["video/mp4", "video/webm"].includes(file.type)
    ) {
      setMessage("仅允许不超过 16MB 的 MP4 / WebM，文件 MIME 必须正确。");
      setSuccess(false);
      return;
    }
    setUploading(true);
    setMessage("正在上传到受控服务端，尚未启用…");
    setSuccess(false);
    try {
      const base64 = await fileToBase64(file);
      if (
        !mounted.current ||
        generation.current !== token ||
        currentProject.current !== project
      )
        return;
      const result = await upload.mutateAsync({
        projectId: project,
        fileName: file.name,
        mimeType: file.type as "video/mp4" | "video/webm",
        base64,
      });
      if (
        !mounted.current ||
        generation.current !== token ||
        currentProject.current !== project ||
        result.projectId !== project
      )
        return;
      setDraft(d =>
        d?.projectId === project
          ? {
              ...d,
              configuration: {
                ...d.configuration,
                videos: [
                  ...d.configuration.videos,
                  {
                    id: id(),
                    name: file.name.slice(0, 100),
                    pointLabel: "施工点位",
                    kind: "recorded",
                    storageReference: result.storageReference,
                    recordedAt: null,
                    enabled: true,
                    default: !d.configuration.videos.some(v => v.default),
                    sortOrder: d.configuration.videos.length,
                  },
                ],
              },
            }
          : d
      );
      setMessage(
        "上传已完成，已保留草稿；必须点击“保存配置”才能启用，原始存储地址不公开。"
      );
      setSuccess(true);
    } catch (e) {
      if (mounted.current && generation.current === token) {
        setMessage(
          `上传失败，现有草稿保留：${e instanceof Error ? e.message : "请重试"}`
        );
        setSuccess(false);
      }
    } finally {
      if (mounted.current && generation.current === token) setUploading(false);
    }
  }
  const config: SiteConfiguration | undefined = draft
    ? {
        ...draft.configuration,
        location:
          location.label || location.latitude || location.longitude
            ? {
                label: location.label,
                latitude:
                  location.latitude.trim() === ""
                    ? NaN
                    : Number(location.latitude),
                longitude:
                  location.longitude.trim() === ""
                    ? NaN
                    : Number(location.longitude),
              }
            : null,
      }
    : undefined;
  const valid = config ? siteConfigurationSchema.safeParse(config) : null;
  const ready =
    allowed &&
    configuration.data?.projectId === projectId &&
    projectId > 0 &&
    !projects.isError &&
    !configuration.isError &&
    !configuration.isLoading &&
    draft?.projectId === projectId;
  async function saveConfiguration() {
    if (!ready || !valid?.success || uploading || saving) return;
    const token = generation.current,
      project = projectId;
    setSaving(true);
    setMessage("");
    setSuccess(false);
    try {
      const result = await save.mutateAsync({
        projectId: project,
        expectedVersion: draft!.version ?? undefined,
        configuration: valid.data,
      });
      if (!mounted.current || token !== generation.current) return;
      const readback = await configuration.refetch();
      if (!mounted.current || token !== generation.current) return;
      if (
        readback.isError ||
        readback.data?.projectId !== project ||
        readback.data.version !== result.version
      ) {
        setMessage(
          "服务端已保存，但版本回读未完成；草稿保留，请刷新核对，不重复覆盖。"
        );
        return;
      }
      hydrate(readback.data);
      setMessage(`项目配置已保存并回读，版本 v${readback.data.version}。`);
      setSuccess(true);
    } catch (e) {
      if (mounted.current && token === generation.current)
        setMessage(
          `保存失败，草稿保留。${(e as { data?: { code?: string } })?.data?.code === "CONFLICT" ? "版本冲突，请刷新核对；不会自动覆盖。" : e instanceof Error ? e.message : "请重试"}`
        );
    } finally {
      if (mounted.current && token === generation.current) setSaving(false);
    }
  }
  async function saveCredential(clear = false) {
    if (
      !allowed ||
      credential.isLoading ||
      credential.isError ||
      !credential.data ||
      saveKey.isPending
    )
      return;
    if (
      clear &&
      !window.confirm(
        "确认清空全局商业天气 API 密钥？这会影响所有使用该服务的项目。"
      )
    )
      return;
    try {
      await saveKey.mutateAsync({
        expectedVersion: credential.data.version ?? undefined,
        ...(clear ? { clear: true } : key.trim() ? { apiKey: key.trim() } : {}),
      });
      setKey("");
      const r = await credential.refetch();
      setKeyMessage(
        r.isError
          ? "密钥操作已保存，但状态回读失败，请重试核对。"
          : clear
            ? "全局密钥已清空并回读状态。"
            : "密钥状态已保存并回读；空输入保持原密钥。"
      );
    } catch (e) {
      setKeyMessage(
        `密钥保存失败，输入保留；版本冲突不自动覆盖。${e instanceof Error ? e.message : ""}`
      );
    }
  }
  if (!allowed)
    return (
      <div className="site-operations-settings">
        仅超级管理员可配置现场大屏。
      </div>
    );
  return (
    <section className="site-operations-settings">
      <div className="so-settings-head">
        <h2>现场大屏 · 项目配置</h2>
        <label>
          所属项目
          <select
            aria-label="配置所属项目"
            value={projectId}
            disabled={projects.isError || !projects.data?.length}
            onChange={e => changeProject(Number(e.target.value))}
          >
            <option value={0} disabled>
              选择授权项目
            </option>
            {projects.data?.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {projects.isError || !projects.data ? (
        <SitePlaceholder query={projects} label="配置项目" />
      ) : !projects.data.length ? (
        <p className="so-muted">暂无可选项目。</p>
      ) : (
        <>
          <nav
            className="so-settings-tabs"
            aria-label="现场大屏配置栏目"
            role="tablist"
          >
            {tabs.map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  if (t !== tab && confirmLeave()) setTab(t);
                }}
              >
                {t}
              </button>
            ))}
          </nav>
          {!ready ? (
            <SitePlaceholder query={configuration} label="项目配置" />
          ) : (
            <fieldset
              role="tabpanel"
              disabled={saving || uploading}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              {tab === "视频管理" && (
                <>
                  <div className="so-setting-tools">
                    <button
                      disabled={
                        uploading ||
                        saving ||
                        draft!.configuration.videos.length >= 12
                      }
                      onClick={() => addVideo(true)}
                    >
                      加入授权样片
                    </button>
                    <button
                      disabled={
                        uploading ||
                        saving ||
                        draft!.configuration.videos.length >= 12
                      }
                      onClick={() => addVideo(false)}
                    >
                      添加 HTTPS 视频
                    </button>
                    <label>
                      上传 MP4 / WebM ≤16MB
                      <input
                        aria-label="上传现场录像"
                        type="file"
                        accept="video/mp4,video/webm"
                        disabled={
                          uploading ||
                          saving ||
                          draft!.configuration.videos.length >= 12
                        }
                        onChange={e => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void uploadFile(f);
                        }}
                      />
                    </label>
                  </div>
                  <p className="so-muted">
                    最多 12 个视频。上传完成只是草稿，保存项目配置后才可播放。
                  </p>
                  {draft!.configuration.videos.length ? (
                    draft!.configuration.videos.map(v => (
                      <article className="so-video-editor" key={v.id}>
                        <h3>
                          {v.name || "未命名录像"} ·{" "}
                          {v.sampleAsset
                            ? "授权样片（非实时）"
                            : v.storageReference
                              ? "受控上传"
                              : "HTTPS 链接"}
                        </h3>
                        <div className="so-video-edit-grid">
                          <label>
                            视频名称
                            <input
                              aria-label={`视频名称 ${v.id}`}
                              value={v.name}
                              maxLength={100}
                              onChange={e =>
                                videoChange(v.id, { name: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            点位 / 地点
                            <input
                              aria-label={`视频点位 ${v.id}`}
                              value={v.pointLabel}
                              maxLength={100}
                              onChange={e =>
                                videoChange(v.id, {
                                  pointLabel: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            显示类别
                            <select
                              aria-label={`视频类别 ${v.id}`}
                              value={v.kind}
                              disabled={Boolean(v.sampleAsset)}
                              onChange={e =>
                                videoChange(v.id, {
                                  kind: e.target.value as SiteVideo["kind"],
                                })
                              }
                            >
                              <option value="recorded">录播 · 非实时</option>
                              <option value="sample">示例 · 非实时</option>
                            </select>
                          </label>
                          {v.url !== undefined && (
                            <label>
                              公开 HTTPS 视频地址
                              <input
                                aria-label={`视频地址 ${v.id}`}
                                value={v.url}
                                placeholder="https://media.your-domain.com/site.mp4"
                                onChange={e =>
                                  videoChange(v.id, { url: e.target.value })
                                }
                              />
                            </label>
                          )}
                          <label>
                            真实录像时间（北京时间，可留空）
                            <input
                              aria-label={`录像时间 ${v.id}`}
                              type="datetime-local"
                              value={
                                v.recordedAt
                                  ? new Date(
                                      new Date(v.recordedAt).getTime() +
                                        8 * 3600000
                                    )
                                      .toISOString()
                                      .slice(0, 16)
                                  : ""
                              }
                              onChange={e =>
                                videoChange(v.id, {
                                  recordedAt: e.target.value
                                    ? new Date(
                                        `${e.target.value}:00+08:00`
                                      ).toISOString()
                                    : null,
                                })
                              }
                            />
                          </label>
                          <label>
                            排序（0–1000）
                            <input
                              aria-label={`视频排序 ${v.id}`}
                              type="number"
                              min={0}
                              max={1000}
                              step={1}
                              value={v.sortOrder}
                              onChange={e =>
                                videoChange(v.id, {
                                  sortOrder: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="so-video-edit-options">
                          <label>
                            <input
                              aria-label={`启用视频 ${v.id}`}
                              type="checkbox"
                              checked={v.enabled}
                              onChange={e =>
                                videoChange(v.id, { enabled: e.target.checked })
                              }
                            />
                            启用
                          </label>
                          <label>
                            <input
                              aria-label={`默认视频 ${v.id}`}
                              type="checkbox"
                              checked={v.default}
                              disabled={!v.enabled}
                              onChange={e =>
                                videoChange(v.id, { default: e.target.checked })
                              }
                            />
                            默认播放
                          </label>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  `确认从本项目配置删除“${v.name}”？保存后才生效。`
                                )
                              ) {
                                update(c => ({
                                  ...c,
                                  videos: c.videos.filter(x => x.id !== v.id),
                                }));
                                setMessage("已从草稿删除，保存配置后生效。");
                              }
                            }}
                          >
                            删除视频
                          </button>
                        </div>
                        {v.sampleAsset && (
                          <p className="so-attribution">
                            {SITE_SAMPLE_METADATA.label} · 作者{" "}
                            {SITE_SAMPLE_METADATA.author} ·{" "}
                            <a
                              href={SITE_SAMPLE_METADATA.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              来源
                            </a>{" "}
                            ·{" "}
                            <a
                              href={SITE_SAMPLE_METADATA.licenseUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {SITE_SAMPLE_METADATA.license}
                            </a>{" "}
                            · 素材日期 {SITE_SAMPLE_METADATA.recordedDate}
                          </p>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="so-placeholder">
                      项目视频未配置，大屏可播放明确署名的授权示例录像。
                    </p>
                  )}
                </>
              )}
              {tab === "天气地点" && (
                <>
                  <div className="so-setting-form">
                    <label>
                      工地天气地点名称
                      <input
                        aria-label="天气地点名称"
                        value={location.label}
                        maxLength={120}
                        onChange={e =>
                          setLocation(l => ({ ...l, label: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      纬度（-90 至 90，北纬为正）
                      <input
                        aria-label="天气纬度"
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        value={location.latitude}
                        onChange={e =>
                          setLocation(l => ({ ...l, latitude: e.target.value }))
                        }
                      />
                    </label>
                    <label>
                      经度（-180 至 180，东经为正）
                      <input
                        aria-label="天气经度"
                        type="number"
                        step="any"
                        min={-180}
                        max={180}
                        value={location.longitude}
                        onChange={e =>
                          setLocation(l => ({
                            ...l,
                            longitude: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <p className="so-muted">
                    三个字段全部留空表示未配置。经纬度以项目工地为准，不读取浏览器
                    GPS。
                  </p>
                  <button
                    onClick={() =>
                      setLocation({ label: "", latitude: "", longitude: "" })
                    }
                  >
                    清除地点草稿
                  </button>
                </>
              )}
              {tab === "天气接入" && (
                <>
                  <div className="so-setting-form">
                    <label>
                      天气服务
                      <select
                        aria-label="商业天气服务"
                        value={draft!.configuration.weather.provider}
                        onChange={e =>
                          update(c => ({
                            ...c,
                            weather: {
                              ...c.weather,
                              provider: e.target
                                .value as SiteConfiguration["weather"]["provider"],
                            },
                          }))
                        }
                      >
                        <option value="disabled">停用 / 天气服务待配置</option>
                        <option value="open_meteo_commercial">
                          Open-Meteo 商业授权服务
                        </option>
                      </select>
                    </label>
                    {Object.entries(thresholdLabels).map(([k, label]) => (
                      <label key={k}>
                        {label}
                        <input
                          aria-label={label}
                          type="number"
                          step="any"
                          value={
                            draft!.configuration.weather.thresholds[
                              k as keyof typeof thresholdLabels
                            ]
                          }
                          onChange={e =>
                            update(c => ({
                              ...c,
                              weather: {
                                ...c.weather,
                                thresholds: {
                                  ...c.weather.thresholds,
                                  [k]: Number(e.target.value),
                                },
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="so-muted">
                    阈值仅用于系统作业提示，低能见度为低于阈值，其余按对应高低温
                    /
                    风雨条件判断；不自动停工。商业服务须自行取得授权，不调用免费接口。
                  </p>
                  <button
                    disabled={testWeather.isFetching}
                    onClick={async () => {
                      const r = await testWeather.refetch();
                      const labels = {
                        disabled: "天气服务待配置（已停用）",
                        not_configured: "天气服务待配置（地点或凭据未配置）",
                        unavailable: "天气服务不可用",
                        ready: "已取得商业模型天气数据（非实测）",
                        stale: "天气数据已过期，待更新",
                      };
                      setMessage(
                        r.isError
                          ? "天气测试请求失败。"
                          : r.data
                            ? `实际天气状态：${labels[r.data.status]}`
                            : "未取得天气状态。"
                      );
                      setSuccess(false);
                    }}
                  >
                    测试天气（已保存配置）
                  </button>
                  <section className="so-settings-credential">
                    <h3>全局商业天气密钥 · 独立保存</h3>
                    <p>
                      此密钥供所有使用该商业服务的项目共享，不属于当前单个项目。仅返回配置状态，绝不回显原密钥；密码输入留空保持原值。
                    </p>
                    {credential.isError || !credential.data ? (
                      <SitePlaceholder
                        query={credential}
                        label="全局密钥状态"
                      />
                    ) : (
                      <>
                        <p>
                          当前：
                          {credential.data.keyConfigured
                            ? "已配置（原值不回显）"
                            : "未配置"}{" "}
                          · 版本 {credential.data.version ?? "未创建"}
                        </p>
                        <input
                          aria-label="商业天气 API 密钥"
                          type="password"
                          autoComplete="new-password"
                          value={key}
                          placeholder="留空保持，输入新值才更新"
                          onChange={e => setKey(e.target.value)}
                        />
                        <button
                          disabled={
                            saveKey.isPending ||
                            credential.isLoading ||
                            credential.isError
                          }
                          onClick={() => void saveCredential()}
                        >
                          独立保存密钥
                        </button>
                        <button
                          disabled={
                            saveKey.isPending ||
                            credential.isLoading ||
                            credential.isError
                          }
                          onClick={() => void saveCredential(true)}
                        >
                          显式清空全局密钥
                        </button>
                      </>
                    )}
                    {keyMessage && <p role="status">{keyMessage}</p>}
                  </section>
                </>
              )}
              {tab === "使用说明" && (
                <div className="so-settings-help">
                  <h3>配置与权限</h3>
                  <p>
                    视频与天气地点按项目保存，使用版本校验（CAS）。冲突不自动覆盖；保存失败保留草稿。切换项目或离开后台会询问未保存内容，刷新页面同样保护。
                  </p>
                  <h3>录像和授权</h3>
                  <p>
                    不接入实时摄像头。录播 /
                    示例明确标非实时，未知拍摄时间显示未记录。受控附件通过登录校验的播放接口访问，上传不等于发布。默认视频必须启用，最多一个默认项；删除需确认并保存才生效。
                  </p>
                  <h3>天气与系统提示</h3>
                  <p>
                    天气默认停用，尚无商业服务时显示待配置。天气由模型预报，不是传感器实测；降雨概率（%）与雨量（mm）分别展示。过期数据不当正常结果，官方预警未接入；现场负责人按制度判断作业安排。
                  </p>
                </div>
              )}
            </fieldset>
          )}
          {message && (
            <p
              className="so-setting-message"
              data-success={success}
              role="status"
            >
              {message}
            </p>
          )}
          {ready && valid && !valid.success && (
            <p className="so-setting-message" role="alert">
              草稿校验：{valid.error.issues[0]?.message}
            </p>
          )}
          <footer className="so-settings-actions">
            <span>
              项目 #{projectId} ·{" "}
              {draft?.version ? `版本 v${draft.version}` : "尚未保存"} ·{" "}
              {dirty ? "有未保存修改" : "已同步"}
            </span>
            <button
              disabled={saving || uploading || configuration.isLoading}
              onClick={async () => {
                if (!confirmLeave()) return;
                const r = await configuration.refetch();
                if (!r.isError && r.data?.projectId === projectId) {
                  hydrate(r.data);
                  setKey("");
                  setMessage("已重新读取配置版本，请核对后保存。");
                } else setMessage("配置刷新失败，草稿保留。");
              }}
            >
              重新读取配置
            </button>
            <button
              disabled={
                !ready ||
                !valid?.success ||
                saving ||
                uploading ||
                configuration.isError
              }
              onClick={() => void saveConfiguration()}
            >
              {saving
                ? "保存并回读中…"
                : uploading
                  ? "上传中，暂不能保存"
                  : "保存配置"}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
