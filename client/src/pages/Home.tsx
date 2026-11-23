import { useAuth } from "@/_core/hooks/useAuth";
import SiteOperationsScreen, {
  SitePlaceholder,
} from "@/components/SiteOperationsScreen";
import { createAdminLoginPath, createLoginPath } from "@/lib/authNavigation";
import { getChinaBusinessDate } from "@/lib/siteOperations";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  BookOpenCheck,
  Calculator,
  HardHat,
  LockKeyhole,
  Smartphone,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

/** 保留旧经营组件测试需要的北京时间月工具；首页新入口按业务日查询。 */
export function getChinaBusinessMonth(now = new Date()): string {
  return getChinaBusinessDate(now).slice(0, 7);
}
export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const allowed = !loading && isAuthenticated && user?.role === "admin";
  const identity = String(user?.id ?? "anonymous");
  const [selected, setSelected] = useState<{
    identity: string;
    projectId: number;
  } | null>(null);
  const [businessDate, setBusinessDate] = useState(getChinaBusinessDate);
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden"
  );
  const projects = trpc.siteOperations.projects.useQuery(undefined, {
    enabled: allowed,
    retry: false,
    placeholderData: undefined,
  });
  const projectId =
    allowed &&
    !projects.isError &&
    selected?.identity === identity &&
    projects.data?.some(p => p.id === selected.projectId)
      ? selected.projectId
      : 0;
  useEffect(() => {
    if (!allowed || projects.isError || !projects.data?.length) return;
    if (
      selected?.identity === identity &&
      projects.data.some(p => p.id === selected.projectId)
    )
      return;
    let remembered = 0;
    try {
      remembered = Number(
        localStorage.getItem(`site-operations-project:${identity}`)
      );
    } catch {
      /* private mode */
    }
    const next =
      projects.data.find(p => p.id === remembered) ||
      projects.data.find(p => p.status === "active") ||
      projects.data[0];
    setSelected({ identity, projectId: next.id });
  }, [allowed, identity, projects.data, projects.isError, selected]);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const input = useMemo(
    () => ({ projectId, businessDate }),
    [projectId, businessDate]
  );
  const projectInput = useMemo(() => ({ projectId }), [projectId]);
  const enabled = allowed && projectId > 0;
  const options = {
    enabled,
    retry: false as const,
    placeholderData: undefined,
    refetchInterval: visible ? 45000 : (false as const),
    refetchIntervalInBackground: false,
  };
  const dashboard = trpc.siteOperations.dashboard.useQuery(input, options);
  const configuration = trpc.siteOperations.getConfiguration.useQuery(
    projectInput,
    options
  );
  const weatherSelect = React.useCallback(
    (data: import("@shared/siteOperations").SiteWeather) => ({
      projectId,
      weather: data,
    }),
    [projectId]
  );
  const weather = trpc.siteOperations.getWeather.useQuery(projectInput, {
    ...options,
    select: weatherSelect,
  });
  const changeProject = (id: number) => {
    setSelected({ identity, projectId: id });
    try {
      localStorage.setItem(`site-operations-project:${identity}`, String(id));
    } catch {
      /* optional preference */
    }
  };
  if (allowed)
    return enabled ? (
      <SiteOperationsScreen
        key={`${identity}:${projectId}:${businessDate}`}
        projects={projects.data || []}
        projectId={projectId}
        businessDate={businessDate}
        onProjectChange={changeProject}
        onDateChange={setBusinessDate}
        dashboard={dashboard}
        configuration={configuration}
        weather={{
          ...weather,
          data:
            weather.data?.projectId === projectId
              ? weather.data.weather
              : undefined,
        }}
        onNavigate={navigate}
        onRefresh={() => {
          void dashboard.refetch();
          void configuration.refetch();
          void weather.refetch();
        }}
      />
    ) : (
      <main className="site-operations-screen">
        <h1>现场运行与风险监控</h1>
        {projects.isError || !projects.data ? (
          <SitePlaceholder query={projects} label="授权项目" />
        ) : projects.data.length ? (
          <p>正在选择授权项目…</p>
        ) : (
          <p>暂无可选项目。请在管理后台维护授权项目。</p>
        )}
        <button onClick={() => navigate("/admin")}>管理后台</button>
      </main>
    );
  return (
    <main className="site-operations-screen">
      <section className="so-entry">
        <div className="so-entry-top">
          <span>
            <HardHat size={24} />
            悦信云智管 · 现场指挥
          </span>
          <button onClick={() => navigate("/help?guide=mobile")}>
            <BookOpenCheck size={16} />
            使用教程
          </button>
        </div>
        <div className="so-entry-content">
          <p className="so-entry-kicker">现场运行 / 真实事件 / 项目风险</p>
          <h1>交通施工指挥中心</h1>
          <h2>让现场情况，一屏清晰。</h2>
          <p>
            运输数量、装卸动态、施工日报、现场录像与天气作业提示，按授权项目与北京时间业务日展示。仅超级管理员可查看现场大屏，未经授权不查询现场数据。
          </p>
          <div className="so-entry-buttons">
            {loading ? (
              <span>正在核验登录状态…</span>
            ) : (
              <>
                <button onClick={() => navigate(createAdminLoginPath("/"))}>
                  <LockKeyhole size={17} />
                  超级管理员查看现场大屏
                  <ArrowRight size={17} />
                </button>
                <button onClick={() => navigate(createLoginPath("/mobile"))}>
                  <Smartphone size={17} />
                  进入我的业务工作台
                </button>
              </>
            )}
          </div>
          {isAuthenticated && !allowed && (
            <p className="so-warning-text">
              当前账号无现场大屏权限。请进入本人已授权业务。
            </p>
          )}
          <button
            className="so-entry-tools"
            onClick={() => navigate("/public-tools")}
          >
            <Calculator size={16} />
            无需登录，使用工程工具与知识
          </button>
        </div>
        <div className="so-entry-footer">
          <span>01 / 运输与动态</span>
          <span>02 / 现场影像</span>
          <span>03 / 天气与作业提示</span>
          <span>04 / 车辆待核查</span>
        </div>
      </section>
    </main>
  );
}
