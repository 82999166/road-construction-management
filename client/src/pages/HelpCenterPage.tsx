import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, BookOpenCheck, CheckCircle2, ChevronRight, ClipboardCheck, Download, HardHat, MonitorCog, ShieldCheck, Smartphone, Wrench } from "lucide-react";
import React, { useState } from "react";
import { useLocation } from "wouter";

type GuideKey = "deploy" | "admin" | "mobile";

const GUIDE_META: Record<GuideKey, { title: string; subtitle: string; icon: typeof MonitorCog; color: string }> = {
  deploy: { title: "安装部署", subtitle: "给运维与技术人员", icon: MonitorCog, color: "bg-sky-600" },
  admin: { title: "超级管理员", subtitle: "给系统负责人", icon: ShieldCheck, color: "bg-emerald-600" },
  mobile: { title: "移动端使用", subtitle: "给现场与业务人员", icon: Smartphone, color: "bg-amber-600" },
};

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="scroll-mt-8 border-b border-slate-100 py-7 last:border-0"><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><span className="h-6 w-1 rounded-full bg-[#1f6d5d]" />{title}</h2><div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">{children}</div></section>;
}

function StepList({ items }: { items: string[] }) {
  return <ol className="space-y-3">{items.map((item, index) => <li key={item} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1f6d5d] text-xs font-bold text-white">{index + 1}</span><span>{item}</span></li>)}</ol>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong>操作提示：</strong>{children}</div>;
}

function DeployGuide() {
  return <>
    <GuideSection title="适用范围与运行架构"><p>本教程面向负责首次安装、版本发布、日常巡检和故障恢复的技术人员。系统采用前端页面、服务端业务接口与 MySQL 数据库分层运行，业务时间统一以中国时区展示，数据库时间戳保持标准 UTC 存储。</p><Notice>部署文档不应记录域名解析地址、口令、令牌、数据库连接串或其他密钥。此类信息只保存在服务器受限环境文件与后台加密配置中。</Notice></GuideSection>
    <GuideSection title="上线前准备"><StepList items={["准备受控 Linux 服务器、Node.js 运行环境、MySQL 与反向代理服务，并分别使用最小权限运行账号。", "在服务器建立应用目录、发布版本目录、受限环境文件和日志目录；环境文件只允许服务账号读取。", "创建独立业务数据库与最小权限数据库账号，先核对迁移文件和备份策略，不在未确认维护窗口直接改动生产结构。", "在系统设置中由超级管理员录入并发布第三方配置；密钥字段仅支持加密保存和掩码回显。"]} /></GuideSection>
    <GuideSection title="初次安装"><StepList items={["获取经过审核的源码后安装锁定依赖，执行类型检查、全量测试和生产构建。", "核对迁移卫生状态；仅对新库或已审阅的维护窗口执行迁移，迁移前先完成可恢复备份。", "启动应用服务并使用本机健康检查确认首页与接口可用，再配置反向代理、HTTPS 证书和单页应用深链回退。", "访问首页、登录页、后台与移动端关键路径，确认均使用受信任 HTTPS 且静态资源没有加载错误。"]} /></GuideSection>
    <GuideSection title="标准原子发布"><StepList items={["先运行发布级质量门禁：全量回归、类型检查、生产构建、迁移卫生与依赖审计。", "将生产运行包上传到隔离暂存目录并计算 SHA-256 摘要；服务运行目录不得直接覆盖。", "在服务器校验摘要、解压到新的版本目录，再以原子方式切换 current 指向并重启应用服务。", "连续执行本机健康检查。只有连续成功才保留新版本；若启动或检查失败，立即切回上一稳定版本。", "最后核验正式域名的首页、登录、后台和受影响移动深链，并保留发布、版本和健康检查记录。"]} /></GuideSection>
    <GuideSection title="备份、恢复与排障"><p>数据库备份须由超级管理员在后台按受控流程发起，备份包应保存在受权限控制的位置。恢复前必须在隔离环境验证备份可读取，并确认恢复目标、影响范围与维护窗口。</p><div className="grid gap-3 sm:grid-cols-2"><Card className="border-slate-200"><CardHeader className="pb-2"><CardTitle className="text-sm">首选排查顺序</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-slate-600">先看应用健康检查与服务日志，再查反向代理的 HTTPS/深链规则，随后核对数据库连接和已发布配置版本。不要以删除数据、重置权限或关闭安全控制作为排障手段。</CardContent></Card><Card className="border-slate-200"><CardHeader className="pb-2"><CardTitle className="text-sm">发布后验收</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-slate-600">核验登录、授权范围、核心录入、图片预览、当前筛选导出与 A4 打印。真实短信、服务号、OSS、现场刷卡与 PDF 保存需由具备真实账号和设备的人员单独验收。</CardContent></Card></div></GuideSection>
  </>;
}

function AdminGuide() {
  return <>
    <GuideSection title="登录与职责边界"><p>超级管理员从专用入口登录后进入全局治理后台，可维护组织、项目、账号、授权、系统设置与审计。普通管理人员只能进入获授权的业务工作区；前端菜单隐藏不替代服务端的模块、组织与项目范围校验。</p><Notice>首次登录后请立即修改初始密码。临时管理员入口若已关闭，不应为排障目的重新启用。</Notice></GuideSection>
    <GuideSection title="推荐启用顺序"><StepList items={["先维护组织、部门、项目及项目状态，再创建人员与本地账号。", "为人员配置岗位角色、可办理业务、组织范围或具体项目范围，并核对有效期与启停状态。", "补齐车辆、司机、机械、供应商、运输线路等主数据，再开放具体业务录入。", "最后在系统设置中完成通知、OSS、业务参数等草稿测试、显式发布与版本记录核验。"]} /></GuideSection>
    <GuideSection title="主数据、运输与现场资源"><p>在资源与现场分类中维护车辆、司机绑定、NFC 写卡、运输线路与安全阈值。移动端运输页会将刷 NFC 发票和拍照车牌发票置于主要操作区，刷卡、装卸与票据仅在服务端校验项目、车辆、司机和状态机后生效。</p><p>机械、柴油与现场影像也须按项目管理。柴油日期采用中国业务日，录入时间采用设备当前时间；重复提交提示仅用于辅助防错，最终幂等和状态校验仍以服务端为准。</p></GuideSection>
    <GuideSection title="施工、采购、劳务与结算"><p>施工日报、工程计量、采购仓储、劳务工资、合同分包与车辆/机械结算均按项目范围和角色受控。每次状态变更前应阅读当前状态、金额和附件，已进入终态的记录不能通过前端回退。</p><div className="grid gap-3 sm:grid-cols-2"><Card className="border-emerald-100 bg-emerald-50/40"><CardHeader className="pb-2"><CardTitle className="text-sm">工资与财务</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-slate-600">工资条按人员、项目和期间管理；提交、审核、发放、作废分别受岗位与状态机限制。财务流水的作废和冲销必须保留可追溯审计。</CardContent></Card><Card className="border-emerald-100 bg-emerald-50/40"><CardHeader className="pb-2"><CardTitle className="text-sm">导出与打印</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-slate-600">先设置筛选条件，再使用“导出当前筛选”或“打印当前筛选明细与汇总”。打印使用独立 A4 横向文档，末行显示合计，不能依赖浏览器整页打印。</CardContent></Card></div></GuideSection>
    <GuideSection title="系统设置、审计与备份"><StepList items={["在系统设置中先保存草稿，再进行连接测试，确认无误后显式发布；发布前后版本可追溯、可按权限回滚。", "OSS 只保存照片类新文件，历史影像与其他附件保持原路径；连接测试为只读探测，不能用于覆盖或删除文件。", "在审计工作台按时间、对象和操作复核高影响行为。审计记录不展示密码、令牌或密钥。", "发起数据库备份前确认维护计划和存储位置；恢复演练必须在隔离环境完成，不能用生产业务数据模拟。"]} /></GuideSection>
  </>;
}

function MobileGuide() {
  const modules = [
    ["考勤管理", "完成上、下班打卡，查看当天记录；如出现状态不同步，先刷新授权与记录后再重复提交。"],
    ["施工日报", "按项目填写日期、进度、质量、安全、人员和设备情况，可附加现场影像；打印输出当前日报明细。"],
    ["劳务工资", "查看受授权项目的人员、考勤、工资条和统计；提交、审核、发放和作废按钮按岗位与状态显示。"],
    ["机械管理", "维护可见机械的台账、成本、维修、油料及月度结算；金额和状态以服务端结算记录为准。"],
    ["渣土运输", "先使用置顶的刷 NFC 发票或拍照车牌发票处理闭环，再录入趟次与装卸信息；异常按提示进入人工核验。"],
    ["柴油管理", "按车辆或机械登记领用，时间默认来自当前设备；筛选、统计与打印遵循中国业务日。"],
    ["采购仓储", "提交采购申请、查看订单、办理入库/领用/退库并查看库存；未知状态仅显示中文待处理，不以英文枚举判断。"],
    ["工程计量", "登记收方、提交计量申报、查看审核与回款记录；当前期间汇总可独立 A4 打印。"],
    ["合同与分包", "查看合同、分包批次、应付和付款状态。实际付款、发票与终态限制以服务端权限校验为准。"],
    ["财务与发票", "查看项目财务流水、票据、收入支出与汇总。日期显示为中国时区，财务汇总通过独立 A4 文档打印。"],
    ["影像取证", "上传现场照片并按提示关联项目和业务单据；附件预览权限由项目范围和业务记录共同控制。"],
    ["消息与我的", "消息中心先查看详情，再按消息内业务入口跳转；“我的”页用于查看岗位、数据范围和安全退出。"],
  ];
  return <>
    <GuideSection title="通用操作规则"><StepList items={["登录后先确认当前项目和岗位。若显示加载失败，请点击重新获取授权项目；只有接口成功且确无项目时才显示暂无授权项目。", "日期、时间和列表展示使用中国时区；新建带时间的记录默认读取当前设备时间，请在提交前核对。", "所有录入请在网络可用时完成。短时间重复点击时，界面会提示防重复；仍应在提交后等待成功或失败结果。", "状态、票据类型和通知通道均以中文显示。不要依据页面文字手工猜测内部状态或绕过审批。"]} /></GuideSection>
    <GuideSection title="工作台与打印"><p>工作台只展示当前账号已授权模块。进入模块后使用顶部项目、日期或状态筛选缩小范围；查询失败时使用页面提供的重试入口。需要打印时，请使用“打印汇总”或“打印当前筛选明细与汇总”，浏览器会生成独立 A4 横向页面。</p><Notice>真实 PDF 保存、现场刷卡、拍照上传、服务号通知和短信通知与设备、浏览器授权、第三方配置相关，需要使用真实账号与设备完成验收。</Notice></GuideSection>
    <GuideSection title="移动业务模块"><div className="grid gap-3 md:grid-cols-2">{modules.map(([name, description], index) => <Card key={name} className="border-slate-200"><CardHeader className="flex-row items-start gap-3 space-y-0 pb-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#eef6f2] text-xs font-bold text-[#1f6d5d]">{index + 1}</span><div><CardTitle className="text-sm">{name}</CardTitle><CardDescription className="mt-1 text-xs">业务操作说明</CardDescription></div></CardHeader><CardContent className="text-sm leading-6 text-slate-600">{description}</CardContent></Card>)}</div></GuideSection>
    <GuideSection title="常见问题与安全"><div className="space-y-3"><details className="rounded-xl border border-slate-200 px-4 py-3"><summary className="cursor-pointer font-semibold text-slate-800">看不到业务模块或项目怎么办？</summary><p className="mt-3">先退出后重新登录并点击重新获取授权项目。若仍无权限，请由超级管理员检查账号状态、岗位角色、部门业务范围、项目范围与有效期；不得通过共享账号处理。</p></details><details className="rounded-xl border border-slate-200 px-4 py-3"><summary className="cursor-pointer font-semibold text-slate-800">打印预览为空或内容不对怎么办？</summary><p className="mt-3">确认已选择项目和日期/期间筛选，等待数据加载完成后使用页面专用打印按钮。不要使用浏览器菜单的整页打印；若保存 PDF 后异常，请保留截图、筛选条件和发生时间交由管理员核查。</p></details><details className="rounded-xl border border-slate-200 px-4 py-3"><summary className="cursor-pointer font-semibold text-slate-800">如何防止重复录入？</summary><p className="mt-3">提交后等待结果，不连续点击。页面的重复提醒、服务端幂等校验与状态机共同避免重复写入；如网络中断，不要盲目重填，应先查询台账确认。</p></details></div></GuideSection>
  </>;
}

export default function HelpCenterPage() {
  const [, navigate] = useLocation();
  const [guide, setGuide] = useState<GuideKey>(() => {
    if (typeof window === "undefined") return "mobile";
    const type = new URLSearchParams(window.location.search).get("guide");
    return type === "deploy" || type === "admin" || type === "mobile" ? type : "mobile";
  });
  const meta = GUIDE_META[guide];
  const Icon = meta.icon;
  const changeGuide = (key: GuideKey) => {
    setGuide(key);
    window.history.replaceState(null, "", `/help?guide=${key}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const Guide = guide === "deploy" ? DeployGuide : guide === "admin" ? AdminGuide : MobileGuide;

  return <main className="min-h-screen bg-[#f3f6f5] text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-[#1f6d5d]" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4" />返回系统首页</button><div className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f6d5d]"><BookOpenCheck className="h-5 w-5" />悦信云智管帮助中心</div></div></header><section className="bg-[#09382f] px-4 py-10 text-white sm:py-14"><div className="mx-auto max-w-6xl"><div className="max-w-3xl"><span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-emerald-100"><HardHat className="h-3.5 w-3.5" />道路施工承包管理系统</span><h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">用得明白，管得规范</h1><p className="mt-4 text-sm leading-7 text-emerald-50/80 sm:text-base">这里汇集了系统部署、后台治理和移动端业务操作说明。教程只描述已上线功能与安全边界，不展示任何账号、口令、服务器地址或密钥。</p></div><div className="mt-7 grid gap-3 sm:grid-cols-3">{(Object.keys(GUIDE_META) as GuideKey[]).map(key => { const item = GUIDE_META[key]; const ItemIcon = item.icon; return <button key={key} type="button" onClick={() => changeGuide(key)} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${guide === key ? "border-white bg-white text-slate-900 shadow-lg" : "border-white/15 bg-white/5 text-white hover:bg-white/10"}`}><span className={`grid h-9 w-9 place-items-center rounded-lg ${guide === key ? item.color + " text-white" : "bg-white/10 text-white"}`}><ItemIcon className="h-5 w-5" /></span><span><span className="block text-sm font-bold">{item.title}</span><span className={`block text-xs ${guide === key ? "text-slate-500" : "text-emerald-100/70"}`}>{item.subtitle}</span></span><ChevronRight className="ml-auto h-4 w-4" /></button>; })}</div></div></section><div className="mx-auto grid max-w-6xl gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]"><aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 lg:sticky lg:top-4"><p className="px-3 pb-2 pt-1 text-xs font-semibold tracking-wider text-slate-400">教程主题</p>{(Object.keys(GUIDE_META) as GuideKey[]).map(key => <button key={key} type="button" onClick={() => changeGuide(key)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${guide === key ? "bg-[#eaf4f0] font-semibold text-[#1f6d5d]" : "text-slate-600 hover:bg-slate-50"}`}><span className={`h-2 w-2 rounded-full ${guide === key ? "bg-[#1f6d5d]" : "bg-slate-300"}`} />{GUIDE_META[key].title}</button>)}<div className="mt-3 border-t border-slate-100 px-3 pt-3 text-xs leading-5 text-slate-500">教程会随系统版本持续维护。关键业务请始终遵循页面实际权限提示与服务端校验结果。</div></aside><article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6"><div className="flex items-center gap-3"><span className={`grid h-11 w-11 place-items-center rounded-xl ${meta.color} text-white`}><Icon className="h-6 w-6" /></span><div><p className="text-xs font-semibold tracking-wider text-[#1f6d5d]">使用教程</p><h2 className="mt-1 text-2xl font-bold text-slate-900">{meta.title}</h2></div></div><span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600"><CheckCircle2 className="h-3.5 w-3.5 text-[#1f6d5d]" />按当前系统功能编写</span></div><Guide /><div className="mt-7 flex flex-col gap-3 rounded-xl border border-[#d8e7e1] bg-[#f2f8f5] p-4 text-sm text-[#285b53] sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />需要操作支持时，请先记录页面、筛选条件与发生时间。</span><Button variant="outline" className="border-[#91b9ac] bg-white text-[#285b53] hover:bg-[#e2f1ea]" onClick={() => navigate(guide === "mobile" ? "/mobile" : "/admin")}><Wrench className="mr-2 h-4 w-4" />进入对应工作区</Button></div></article></div><footer className="border-t border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" />Markdown 原始教程已随项目文档归档，可由系统维护人员按需下载。</span></footer></main>;
}
