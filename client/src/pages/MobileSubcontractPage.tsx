import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Calculator, CheckCircle2, CircleHelp, FilePlus2, HardHat, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";

type SubcontractUnit = "m3" | "m2" | "m" | "t" | "piece" | "set" | "other";

function money(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function packageStatus(status: string) {
  return ({ draft: "草稿", allocated: "已下达", confirmed: "已确认", settled: "已结算", void: "已作废" } as Record<string, string>)[status] ?? status;
}

/** 移动端分包台账始终调用 PC 端共用的 tRPC 路由，不在设备侧保存业务数据。 */
export default function MobileSubcontractPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState<number>();
  const [teamOpen, setTeamOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [teamDraft, setTeamDraft] = useState({ teamName: "", contactName: "", contactPhone: "", remarks: "" });
  const [packageDraft, setPackageDraft] = useState({
    subcontractTeamId: "",
    measurementTakeoffId: "",
    workItem: "",
    workLocation: "",
    unit: "m3" as SubcontractUnit,
    quantity: "",
    upstreamUnitPrice: "",
    subcontractUnitPrice: "",
    remarks: "",
  });

  const projects = trpc.measurement.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

  const selectedProjectId = projectId ?? 0;
  const projectInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const capabilities = trpc.subcontract.capabilities.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const teams = trpc.subcontract.listTeams.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const packages = trpc.subcontract.listPackages.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.subcontract.summary.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const takeoffs = trpc.measurement.listTakeoffs.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId) && packageOpen, retry: false });

  const activeTeams = (teams.data ?? []).filter(team => team.status === "active");
  const eligibleTakeoffs = (takeoffs.data ?? []).filter(takeoff => ["approved", "locked"].includes(takeoff.status));
  const chosenTakeoff = packageDraft.measurementTakeoffId ? eligibleTakeoffs.find(takeoff => String(takeoff.id) === packageDraft.measurementTakeoffId) : undefined;
  const upstreamAmount = Number(packageDraft.quantity || 0) * Number(packageDraft.upstreamUnitPrice || 0);
  const subcontractAmount = Number(packageDraft.quantity || 0) * Number(packageDraft.subcontractUnitPrice || 0);
  const canMaintainDraft = Boolean(capabilities.data?.canMaintainDraft);

  const refreshData = async () => {
    await Promise.all([
      utils.subcontract.listTeams.invalidate(),
      utils.subcontract.listPackages.invalidate(),
      utils.subcontract.summary.invalidate(),
      utils.measurement.listTakeoffs.invalidate(),
    ]);
  };

  const saveTeam = trpc.subcontract.saveTeam.useMutation({
    onSuccess: async () => {
      toast.success("施工队台账已保存，现在可录入分包批次");
      setTeamOpen(false);
      setTeamDraft({ teamName: "", contactName: "", contactPhone: "", remarks: "" });
      await refreshData();
    },
    onError: error => toast.error(error.message),
  });

  const savePackage = trpc.subcontract.savePackage.useMutation({
    onSuccess: async result => {
      toast.success(`分包批次草稿已保存，测算差额 ${money(result.marginAmount)}`);
      setPackageOpen(false);
      setPackageDraft({ subcontractTeamId: "", measurementTakeoffId: "", workItem: "", workLocation: "", unit: "m3", quantity: "", upstreamUnitPrice: "", subcontractUnitPrice: "", remarks: "" });
      await refreshData();
    },
    onError: error => toast.error(error.message),
  });

  const transition = trpc.subcontract.transitionPackage.useMutation({
    onSuccess: async () => {
      toast.success("分包批次状态已更新");
      await refreshData();
    },
    onError: error => toast.error(error.message),
  });

  const chooseTakeoff = (value: string) => {
    if (value === "UNLINKED") {
      setPackageDraft(current => ({ ...current, measurementTakeoffId: "" }));
      return;
    }
    const takeoff = eligibleTakeoffs.find(item => String(item.id) === value);
    if (!takeoff) return;
    setPackageDraft(current => ({
      ...current,
      measurementTakeoffId: value,
      workItem: takeoff.workItem,
      workLocation: takeoff.workLocation ?? "",
      unit: takeoff.unit as SubcontractUnit,
      quantity: String(takeoff.quantity),
      upstreamUnitPrice: String(takeoff.unitPrice),
    }));
  };

  if (loading || !isAuthenticated || projects.isLoading) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projects.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载工程分包权限…" title="工程分包" description="请使用已授权账号进入项目工程分包与结算数据。" Icon={HardHat} onRetry={() => { void refresh(); void projects.refetch(); }} />;
  }

  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
    <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-28 shadow-[0_0_50px_rgba(74,42,29,.12)]">
      <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea]">
        <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative flex items-center justify-between">
          <Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => navigate("/mobile/measurement")}><ArrowLeft className="h-5 w-5" /></Button>
          <div className="text-center"><p className="text-sm font-semibold">工程结算与分包</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">项目部收方 · 劳务队分包 · 财务结算</p></div>
          <Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => toast.info("已结算批次不可修改；分配、复核和结算均由服务端按项目范围、岗位和状态机校验。")}><CircleHelp className="h-5 w-5" /></Button>
        </div>
      </header>

      <main className="space-y-4 px-5 py-5">
        {!projects.data?.length ? <Card className="border-0"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs text-[#765544]">请联系管理员配置工程计量与项目范围。</p></CardContent></Card> : <>
          <Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}>
            <SelectTrigger className="h-11 border-[#e9d8c6] bg-white"><SelectValue placeholder="选择项目" /></SelectTrigger>
            <SelectContent>{projects.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent>
          </Select>

          <section className="rounded-2xl border border-[#d8b781] bg-[#fff4e2] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#683a24]">手机端劳务队分包计量</p><p className="mt-1 text-xs leading-5 text-[#7d563d]">办理顺序：① 在计量页录入项目部收方；② 新建施工队；③ 录入分包批次并带入已审核收方；④ 下达、复核、财务结算。</p></div><HardHat className="mt-0.5 h-5 w-5 shrink-0 text-[#a55c2c]" /></div>
            <Button size="sm" variant="outline" className="mt-3 w-full border-[#d1ad77] bg-white text-[#7a4024] hover:bg-[#fffaf4]" onClick={() => navigate("/mobile/measurement")}><FilePlus2 className="mr-1 h-4 w-4" />返回项目部收方录入</Button>
          </section>

          <section className="grid grid-cols-2 gap-3"><Metric label="上游金额" value={money(summary.data?.upstreamAmount)} /><Metric label="分包金额" value={money(summary.data?.subcontractAmount)} /><Metric label="测算差额" value={money(summary.data?.marginAmount)} tone="text-emerald-700" /><Metric label="待财务结算" value={String(summary.data?.byStatus.find(item => item.status === "confirmed")?.packageCount ?? 0)} tone="text-amber-700" /></section>

          <section className="rounded-2xl bg-[#f0dfc7] px-4 py-3">
            <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">施工队与分包批次录入</p><p className="mt-1 text-xs leading-5 text-[#7d563d]">先建立施工队。录入批次时选择已审核收方即可自动带入工程量与上游单价。</p></div><div className="flex shrink-0 gap-1">{canMaintainDraft ? <Button size="sm" variant="ghost" className="text-[#8b3f20] hover:bg-[#e8cda9]" onClick={() => setTeamOpen(true)}><UsersRound className="mr-1 h-4 w-4" />施工队</Button> : null}{canMaintainDraft ? <Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" disabled={!activeTeams.length} onClick={() => setPackageOpen(true)}><FilePlus2 className="mr-1 h-4 w-4" />录入批次</Button> : null}</div></div>
            {!canMaintainDraft ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">当前岗位仅可查看分包批次。项目经理或施工负责人可建立施工队并录入分包草稿。</p> : null}
            {canMaintainDraft && !activeTeams.length ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">当前项目尚无启用施工队，请先点击“施工队”建立外包劳务队台账。</p> : null}
          </section>

          <section className="space-y-2"><div className="flex items-center justify-between px-1"><h2 className="text-sm font-semibold">施工队台账</h2><span className="text-xs text-[#7d563d]">{teams.data?.length ?? 0} 支</span></div>{teams.isLoading ? <p className="py-4 text-center text-xs text-[#8f7566]">正在读取施工队…</p> : teams.data?.length ? teams.data.map(team => <Card key={team.id} className="border-0 bg-white shadow-sm"><CardContent className="flex items-center justify-between p-3.5"><div><p className="text-sm font-semibold">{team.teamName}</p><p className="mt-1 text-[11px] text-[#8f7566]">{team.contactName || "未登记联系人"} · {team.contactPhoneMasked || "未登记电话"}</p></div><span className={`rounded-full px-2 py-1 text-[11px] ${team.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{team.status === "active" ? "启用" : team.status === "suspended" ? "暂停" : "已关闭"}</span></CardContent></Card>) : <p className="rounded-xl border border-dashed border-[#e3cbb4] px-4 py-5 text-center text-xs text-[#8f7566]">当前项目尚无施工队。请由项目负责人先建立施工队台账。</p>}</section>

          <section className="space-y-2"><div className="flex items-center justify-between px-1"><h2 className="text-sm font-semibold">劳务队分包批次</h2><span className="text-xs text-[#7d563d]">{packages.data?.length ?? 0} 条</span></div>{packages.isLoading ? <p className="py-4 text-center text-xs text-[#8f7566]">正在读取分包批次…</p> : packages.data?.length ? packages.data.map(item => <Card key={item.id} className="border-0 bg-white shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{item.workItem}</p><p className="mt-1 text-[11px] text-[#8f7566]">{item.packageNo} · {item.teamName} · {item.quantity} {item.unit}</p><p className="mt-1 text-[11px] text-[#8f7566]">上游 {money(item.upstreamAmount)} · 分包 {money(item.subcontractAmount)} · 差额 {money(item.marginAmount)}</p></div><span className="shrink-0 rounded-full bg-[#f8ead8] px-2 py-1 text-[11px] text-[#94603a]">{packageStatus(item.status)}</span></div><div className="mt-3 flex flex-wrap justify-end gap-2">{item.status === "draft" && capabilities.data?.canMaintainDraft ? <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: Number(item.id), projectId: selectedProjectId, targetStatus: "allocated", remarks: null })}>下达施工队</Button> : null}{item.status === "allocated" && capabilities.data?.canConfirm ? <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: Number(item.id), projectId: selectedProjectId, targetStatus: "confirmed", remarks: null })}>复核确认</Button> : null}{item.status === "confirmed" && capabilities.data?.canSettle ? <Button size="sm" className="bg-[#47754d] hover:bg-[#355c3c]" onClick={() => transition.mutate({ id: Number(item.id), projectId: selectedProjectId, targetStatus: "settled", remarks: null })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />财务结算</Button> : null}</div></CardContent></Card>) : <p className="rounded-xl border border-dashed border-[#e3cbb4] px-4 py-5 text-center text-xs text-[#8f7566]">暂无分包批次。请先建立施工队，再录入分包批次并关联已审核收方。</p>}</section>
        </>}
      </main>

      <Dialog open={teamOpen} onOpenChange={setTeamOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>新建外包劳务施工队</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>施工队名称</Label><Input className="mt-1" value={teamDraft.teamName} onChange={event => setTeamDraft(current => ({ ...current, teamName: event.target.value }))} /></div><div><Label>联系人</Label><Input className="mt-1" value={teamDraft.contactName} onChange={event => setTeamDraft(current => ({ ...current, contactName: event.target.value }))} /></div><div><Label>联系人电话（可选）</Label><Input className="mt-1" inputMode="tel" value={teamDraft.contactPhone} onChange={event => setTeamDraft(current => ({ ...current, contactPhone: event.target.value }))} /></div><div><Label>备注</Label><Textarea className="mt-1" value={teamDraft.remarks} onChange={event => setTeamDraft(current => ({ ...current, remarks: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setTeamOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" disabled={!teamDraft.teamName.trim() || saveTeam.isPending} onClick={() => saveTeam.mutate({ projectId: selectedProjectId, teamName: teamDraft.teamName.trim(), contactName: teamDraft.contactName.trim() || null, contactPhone: teamDraft.contactPhone.trim() || undefined, status: "active", remarks: teamDraft.remarks.trim() || null })}>保存施工队</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={packageOpen} onOpenChange={setPackageOpen}><DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl"><DialogHeader><DialogTitle>录入劳务队分包批次</DialogTitle></DialogHeader><div className="space-y-3"><p className="rounded-lg bg-[#f8ead8] px-3 py-2 text-xs text-[#7d563d]">优先选择已审核收方。关联后，工作项、位置、单位、工程量和上游单价由收方快照带入；累计分配量由服务端校验。</p><div><Label>施工队</Label><Select value={packageDraft.subcontractTeamId || "UNASSIGNED"} onValueChange={value => setPackageDraft(current => ({ ...current, subcontractTeamId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="选择施工队" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择施工队</SelectItem>{activeTeams.map(team => <SelectItem key={team.id} value={String(team.id)}>{team.teamName}</SelectItem>)}</SelectContent></Select></div><div><Label>关联已审核收方（可选）</Label><Select value={packageDraft.measurementTakeoffId || "UNLINKED"} onValueChange={chooseTakeoff}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNLINKED">独立分包测算</SelectItem>{eligibleTakeoffs.map(takeoff => <SelectItem key={takeoff.id} value={String(takeoff.id)}>{takeoff.takeoffNo} · {takeoff.workItem}</SelectItem>)}</SelectContent></Select></div>{!eligibleTakeoffs.length && !takeoffs.isLoading ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">当前项目没有已审核收方。可选择独立分包测算，或返回计量页先录入并审核项目部收方。</p> : null}<div><Label>工作项</Label><Input className="mt-1" disabled={Boolean(chosenTakeoff)} value={packageDraft.workItem} onChange={event => setPackageDraft(current => ({ ...current, workItem: event.target.value }))} /></div><div><Label>施工位置</Label><Input className="mt-1" disabled={Boolean(chosenTakeoff)} value={packageDraft.workLocation} onChange={event => setPackageDraft(current => ({ ...current, workLocation: event.target.value }))} /></div><div className="grid grid-cols-2 gap-3"><div><Label>单位</Label><Select value={packageDraft.unit} disabled={Boolean(chosenTakeoff)} onValueChange={value => setPackageDraft(current => ({ ...current, unit: value as SubcontractUnit }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="m3">m³</SelectItem><SelectItem value="m2">m²</SelectItem><SelectItem value="m">m</SelectItem><SelectItem value="t">t</SelectItem><SelectItem value="piece">件</SelectItem><SelectItem value="set">套</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div><div><Label>工程量</Label><Input className="mt-1" disabled={Boolean(chosenTakeoff)} inputMode="decimal" value={packageDraft.quantity} onChange={event => setPackageDraft(current => ({ ...current, quantity: event.target.value }))} /></div></div><div className="grid grid-cols-2 gap-3"><div><Label>上游单价</Label><Input className="mt-1" disabled={Boolean(chosenTakeoff)} inputMode="decimal" value={packageDraft.upstreamUnitPrice} onChange={event => setPackageDraft(current => ({ ...current, upstreamUnitPrice: event.target.value }))} /></div><div><Label>劳务队分包单价</Label><Input className="mt-1" inputMode="decimal" value={packageDraft.subcontractUnitPrice} onChange={event => setPackageDraft(current => ({ ...current, subcontractUnitPrice: event.target.value }))} /></div></div><div className="grid grid-cols-3 gap-2 rounded-xl bg-[#f0dfc7] p-3 text-center text-xs"><div>上游<p className="mt-1 font-semibold">{money(upstreamAmount)}</p></div><div>分包<p className="mt-1 font-semibold">{money(subcontractAmount)}</p></div><div>差额<p className="mt-1 font-semibold">{money(upstreamAmount - subcontractAmount)}</p></div></div><div><Label>备注</Label><Textarea className="mt-1" value={packageDraft.remarks} onChange={event => setPackageDraft(current => ({ ...current, remarks: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setPackageOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" disabled={!packageDraft.subcontractTeamId || packageDraft.workItem.trim().length < 2 || Number(packageDraft.quantity) <= 0 || Number(packageDraft.upstreamUnitPrice) < 0 || Number(packageDraft.subcontractUnitPrice) < 0 || savePackage.isPending} onClick={() => savePackage.mutate({ projectId: selectedProjectId, measurementTakeoffId: packageDraft.measurementTakeoffId ? Number(packageDraft.measurementTakeoffId) : null, subcontractTeamId: Number(packageDraft.subcontractTeamId), workItem: packageDraft.workItem.trim(), workLocation: packageDraft.workLocation.trim() || null, unit: packageDraft.unit, quantity: Number(packageDraft.quantity), upstreamUnitPrice: Number(packageDraft.upstreamUnitPrice), subcontractUnitPrice: Number(packageDraft.subcontractUnitPrice), remarks: packageDraft.remarks.trim() || null })}><Calculator className="mr-1 h-4 w-4" />保存分包草稿</Button></DialogFooter></DialogContent></Dialog>
    </div>
  </div>;
}

function Metric({ label, value, tone = "text-[#3b2118]" }: { label: string; value: string; tone?: string }) {
  return <Card className="border-0 shadow-sm"><CardContent className="p-3.5"><p className={`text-sm font-semibold ${tone}`}>{value}</p><p className="mt-1 text-[11px] text-[#8f7566]">{label}</p></CardContent></Card>;
}
