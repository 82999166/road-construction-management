import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { MachinerySummaryPrintDialog } from "@/components/MachinerySummaryPrintDialog";
import { trpc } from "@/lib/trpc";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { ArrowLeft, CalendarRange, Camera, CircleHelp, Cog, FileClock, Fuel, HardHat, LayoutDashboard, Pencil, Plus, Printer, ReceiptText, Settings2, UserRound, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, type EvidenceWatermarkTemplate } from "../../../shared/watermarkTemplate";

/** 将移动端本地日期转换为不带时区的业务日期文本。 */
function getTodayText() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** 月度结算筛选统一使用自然月，避免使用浏览器本地日期造成月末跨日。 */
function getCurrentPeriod() {
  return getTodayText().slice(0, 7);
}

/** 金额显示兼容后端 decimal 字段序列化后的字符串。 */
function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("费用照片读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 费用照片在浏览器端写入统一工程水印，原始图片不会直接进入业务档案。 */
function createWatermarkedCostImage(file: File, watermarkLines: string[], template: EvidenceWatermarkTemplate) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("费用水印照片生成失败")); };
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持费用水印绘制");
        context.drawImage(image, 0, 0);
        const fontSize = Math.max(15, Math.round(Math.min(canvas.width, canvas.height) / 34));
        const lineHeight = Math.round(fontSize * 1.46);
        const padding = Math.round(fontSize * 0.72);
        const lines = watermarkLines.filter(Boolean).slice(0, 8);
        context.font = `600 ${fontSize}px sans-serif`;
        const textWidth = Math.min(canvas.width - padding * 2, Math.max(...lines.map(line => context.measureText(line).width), canvas.width * 0.42));
        const headerHeight = Math.round(lineHeight * 1.35);
        const footerHeight = Math.round(lineHeight * 1.1);
        const boxHeight = headerHeight + lines.length * lineHeight + footerHeight + padding * 2;
        const boxY = canvas.height - boxHeight - padding;
        context.fillStyle = "rgba(255,255,255,.88)";
        context.fillRect(padding, boxY, textWidth + padding * 2, boxHeight);
        context.fillStyle = "rgba(33,119,211,.9)";
        context.fillRect(padding, boxY, textWidth + padding * 2, headerHeight + padding);
        context.fillStyle = "#fff";
        context.font = `700 ${Math.round(fontSize * 1.08)}px sans-serif`;
        context.fillText(template.title, padding * 2, boxY + Math.round(padding * .55));
        context.fillStyle = "#26333d";
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        lines.forEach((line, index) => context.fillText(line, padding * 2, boxY + headerHeight + padding + index * lineHeight));
        context.fillStyle = "rgba(33,119,211,.92)";
        context.fillRect(padding, boxY + boxHeight - footerHeight - padding, textWidth + padding * 2, footerHeight + padding);
        context.fillStyle = "#fff";
        context.font = `600 ${Math.round(fontSize * .78)}px sans-serif`;
        context.fillText(template.footerLabel, padding * 2, boxY + boxHeight - footerHeight - Math.round(padding * .1));
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return reject(new Error("费用水印照片生成失败"));
          resolve(new File([blob], `${file.name.replace(/\.(jpe?g|png)$/i, "") || "machine-cost"}-watermark.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", .9);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error("费用水印照片生成失败"));
      }
    };
    image.src = objectUrl;
  });
}

function getCurrentLocation() {
  return new Promise<{ latitude: number; longitude: number } | null>(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** 机械状态使用高对比度暖工业色，保证现场强光环境下仍容易区分。 */
function getMachineStatus(status: "idle" | "working" | "repairing" | "offsite" | "retired") {
  const dictionary = {
    idle: { label: "待命", className: "bg-[#f7ead8] text-[#94582d]" },
    working: { label: "作业中", className: "bg-[#e6f1e4] text-[#47754d]" },
    repairing: { label: "维修中", className: "bg-[#f8e4dd] text-[#a34b3a]" },
    offsite: { label: "场外", className: "bg-[#e6eef2] text-[#4d6f82]" },
    retired: { label: "已退场", className: "bg-[#eee8e2] text-[#806e60]" },
  } as const;
  return dictionary[status];
}

/** 机械成本状态在移动端明确区分录入、审核、结算与作废。 */
function getCostStatus(status: "draft" | "approved" | "settled" | "void") {
  const dictionary = {
    draft: { label: "待审核", className: "bg-[#f8ead8] text-[#94603a]" },
    approved: { label: "已审核", className: "bg-[#e7f1e5] text-[#47754d]" },
    settled: { label: "已结算", className: "bg-[#e2f0ed] text-[#3e746a]" },
    void: { label: "已作废", className: "bg-[#eee8e2] text-[#857365]" },
  } as const;
  return dictionary[status];
}

/** 会计月度明细需显式展示送审链路，避免将财务审核与普通成本审核混淆。 */
function getMonthlyStatementStatus(status: "draft" | "submitted" | "approved" | "settled" | "void") {
  const dictionary = {
    draft: { label: "草稿", className: "bg-[#f8ead8] text-[#94603a]" },
    submitted: { label: "待会计审核", className: "bg-[#e6eef2] text-[#4d6f82]" },
    approved: { label: "已审核", className: "bg-[#e7f1e5] text-[#47754d]" },
    settled: { label: "已结算", className: "bg-[#e2f0ed] text-[#3e746a]" },
    void: { label: "已作废", className: "bg-[#eee8e2] text-[#857365]" },
  } as const;
  return dictionary[status];
}

/** 机械付款仅在PC财务台账办理；手机端只显示状态和付款日期，避免现场端误操作。 */
function getMachinePaymentStatus(status: "draft" | "submitted" | "approved" | "paid" | "void") {
  const dictionary = {
    draft: { label: "付款草稿", className: "bg-[#f8ead8] text-[#94603a]" },
    submitted: { label: "待会计审核", className: "bg-[#e6eef2] text-[#4d6f82]" },
    approved: { label: "待付款", className: "bg-[#fff0cf] text-[#95621f]" },
    paid: { label: "已付款", className: "bg-[#e2f0ed] text-[#3e746a]" },
    void: { label: "已作废", className: "bg-[#eee8e2] text-[#857365]" },
  } as const;
  return dictionary[status];
}

/** 新建机械的表单默认值集中维护，避免表单字段与服务端契约漂移。 */
const EMPTY_MACHINE_DRAFT = {
  code: "",
  name: "",
  model: "",
  ownership: "owned" as "owned" | "leased",
  supplierName: "",
  plateOrAssetNo: "",
  operatorUserId: "",
  driverName: "",
  driverPhone: "",
  status: "idle" as "idle" | "working" | "repairing" | "offsite" | "retired",
  leaseBillingType: "monthly" as "monthly" | "daily" | "hourly" | "shift",
  leaseRate: "",
  leaseStartDate: "",
  leaseEndDate: "",
};

/**
 * 机械管理移动端页面。
 * 页面仅负责业务录入体验，项目范围、金额计算、状态机和最终权限均在服务端强制执行。
 */
export default function MobileMachineryPage() {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { isSuperAdmin } = useManagementPermissions();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [machineId, setMachineId] = useState<number | undefined>();
  const [period, setPeriod] = useState(getCurrentPeriod);
  const [activeTab, setActiveTab] = useState("ledger");
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [costHistoryMachineId, setCostHistoryMachineId] = useState<number | null>(null);
  const [statementDialogOpen, setStatementDialogOpen] = useState(false);
  const [machineryPrintOpen, setMachineryPrintOpen] = useState(false);
  const [editingMachineId, setEditingMachineId] = useState<number | null>(null);
  const [machineDraft, setMachineDraft] = useState(EMPTY_MACHINE_DRAFT);
  const [ruleDraft, setRuleDraft] = useState({ billingType: "monthly" as "monthly" | "daily" | "hourly" | "shift", rate: "", overtimeHourlyRate: "0", effectiveFrom: getTodayText(), effectiveTo: "", status: "active" as "active" | "disabled" });
  const [costDraft, setCostDraft] = useState({ costType: "fuel" as "fuel" | "repair" | "overtime" | "mobilization" | "other", quantity: "", unitPrice: "", occurredAt: new Date().toISOString().slice(0, 16), remarks: "" });
  const [costPhotoFile, setCostPhotoFile] = useState<File | null>(null);
  const [costPhotoPreview, setCostPhotoPreview] = useState<string | null>(null);
  const [costCameraOpen, setCostCameraOpen] = useState(false);
  const costCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const costCameraStreamRef = useRef<MediaStream | null>(null);
  const [statementDraft, setStatementDraft] = useState({ driverUserId: "", machineWorkDays: "0", machineOvertimeHours: "0", driverMonthlyWage: "0", driverWorkDays: "0", driverOvertimeHours: "0", signatureName: "", remarks: "" });
  const [leaseUsageUnits, setLeaseUsageUnits] = useState("1");

  const projectOptions = trpc.machinery.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  /** 首次获得授权项目时自动选中第一项，切换项目时重置当前机械避免跨项目查询。 */
  useEffect(() => {
    if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id);
  }, [projectId, projectOptions.data]);
  const selectedProjectId = projectId ?? 0;
  const machinesInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const machines = trpc.machinery.listMachines.useQuery(machinesInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  /** 当前项目机械列表变更后优先保留选择，否则自动切换至首台设备。 */
  useEffect(() => {
    if (!machineId && machines.data?.length) setMachineId(machines.data[0].id);
    if (machineId && machines.data && !machines.data.some(item => item.id === machineId)) setMachineId(machines.data[0]?.id);
  }, [machineId, machines.data]);
  const selectedMachineId = machineId ?? 0;
  const detailInput = useMemo(() => ({ projectId: selectedProjectId, machineId: selectedMachineId }), [selectedProjectId, selectedMachineId]);
  const costsInput = useMemo(() => ({ ...detailInput, period }), [detailInput, period]);
  const previewInput = useMemo(() => ({ ...detailInput, period, leaseUsageUnits: Number(leaseUsageUnits || 0), deductionAmount: 0 }), [detailInput, leaseUsageUnits, period]);
  const monthlyStatementsInput = useMemo(() => ({ projectId: selectedProjectId, period }), [period, selectedProjectId]);
  const monthlyStatementPreviewInput = useMemo(() => ({ machineId: selectedMachineId, projectId: selectedProjectId, period, driverUserId: statementDraft.driverUserId ? Number(statementDraft.driverUserId) : null, machineWorkDays: Number(statementDraft.machineWorkDays || 0), machineOvertimeHours: Number(statementDraft.machineOvertimeHours || 0), driverMonthlyWage: Number(statementDraft.driverMonthlyWage || 0), driverWorkDays: Number(statementDraft.driverWorkDays || 0), driverOvertimeHours: Number(statementDraft.driverOvertimeHours || 0), signatureName: statementDraft.signatureName.trim() || null, remarks: statementDraft.remarks.trim() || null }), [period, selectedMachineId, selectedProjectId, statementDraft]);
  const costOccurredAtIso = useMemo(() => {
    const occurredAt = new Date(costDraft.occurredAt);
    return Number.isNaN(occurredAt.getTime()) ? null : occurredAt.toISOString();
  }, [costDraft.occurredAt]);
  const leaseRules = trpc.machinery.listLeaseRules.useQuery(detailInput, { enabled: isAuthenticated && Boolean(selectedProjectId) && Boolean(selectedMachineId), retry: false });
  const costs = trpc.machinery.listCosts.useQuery(costsInput, { enabled: isAuthenticated && Boolean(selectedProjectId) && Boolean(selectedMachineId), retry: false });
  const settlement = trpc.machinery.settlementPreview.useQuery(previewInput, { enabled: isAuthenticated && Boolean(selectedProjectId) && Boolean(selectedMachineId), retry: false });
  const monthlyStatements = trpc.machinery.listMonthlyStatements.useQuery(monthlyStatementsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const paymentSettlements = trpc.machinery.listPaymentSettlements.useQuery({ projectId: selectedProjectId }, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const monthlyStatementPreview = trpc.machinery.previewMonthlyStatement.useQuery(monthlyStatementPreviewInput, { enabled: isAuthenticated && statementDialogOpen && Boolean(selectedProjectId) && Boolean(selectedMachineId), retry: false });
  const fuelCostDefault = trpc.machinery.fuelCostDefault.useQuery({ projectId: selectedProjectId, occurredAt: costOccurredAtIso ?? new Date().toISOString() }, { enabled: isAuthenticated && costDialogOpen && costDraft.costType === "fuel" && Boolean(selectedProjectId) && Boolean(costOccurredAtIso), retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const evidenceUpload = trpc.evidence.upload.useMutation({ onError: error => toast.error(error.message) });
  const reverseGeocode = trpc.location.reverseGeocode.useMutation();

  /** 油料单价始终从当前项目、当前加油发生时间有效的系统指导价回填；保存时服务端会再次复核。 */
  useEffect(() => {
    if (!costDialogOpen || costDraft.costType !== "fuel" || fuelCostDefault.data?.guidelinePrice === null || fuelCostDefault.data?.guidelinePrice === undefined) return;
    const guidelinePrice = String(fuelCostDefault.data.guidelinePrice);
    setCostDraft(current => current.unitPrice === guidelinePrice ? current : { ...current, unitPrice: guidelinePrice });
  }, [costDialogOpen, costDraft.costType, fuelCostDefault.data?.guidelinePrice]);

  /** 相机流仅用于当前费用凭证直拍；关闭、取消或离开页面时立即关闭设备摄像头。 */
  function stopCostCamera() {
    costCameraStreamRef.current?.getTracks().forEach(track => track.stop());
    costCameraStreamRef.current = null;
    if (costCameraVideoRef.current) costCameraVideoRef.current.srcObject = null;
    setCostCameraOpen(false);
  }

  async function startCostCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("当前浏览器不支持直接调用相机，请使用支持相机权限的手机浏览器");
    try {
      stopCostCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      costCameraStreamRef.current = stream;
      setCostCameraOpen(true);
    } catch {
      toast.error("无法打开后置相机。请在浏览器设置中允许相机权限后重试");
    }
  }

  function captureCostPhoto() {
    const video = costCameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return toast.error("相机仍在启动，请稍候再拍照");
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return toast.error("当前浏览器不支持相机照片处理");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return toast.error("现场照片生成失败，请重新拍摄");
      if (costPhotoPreview) URL.revokeObjectURL(costPhotoPreview);
      const file = new File([blob], `machine-cost-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      setCostPhotoFile(file);
      setCostPhotoPreview(URL.createObjectURL(file));
      stopCostCamera();
    }, "image/jpeg", 0.92);
  }

  useEffect(() => {
    if (!costCameraOpen || !costCameraVideoRef.current || !costCameraStreamRef.current) return;
    costCameraVideoRef.current.srcObject = costCameraStreamRef.current;
    void costCameraVideoRef.current.play().catch(() => toast.error("相机预览启动失败，请重新打开相机"));
  }, [costCameraOpen]);

  useEffect(() => () => {
    costCameraStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  /** 写入成功后只失效相关服务端数据，避免在客户端手工计算或篡改成本金额。 */
  const saveMachine = trpc.machinery.saveMachine.useMutation({
    onSuccess: async () => { toast.success(editingMachineId ? "机械台账已更新" : "机械台账已建立"); setMachineDialogOpen(false); setContactDialogOpen(false); await utils.machinery.listMachines.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const saveRule = trpc.machinery.saveLeaseRule.useMutation({
    onSuccess: async () => { toast.success("机械计价规则已保存"); setRuleDialogOpen(false); await Promise.all([utils.machinery.listLeaseRules.invalidate(), utils.machinery.settlementPreview.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const saveCost = trpc.machinery.saveCost.useMutation({
    onSuccess: async data => { stopCostCamera(); toast.success(`机械成本已录入，系统核算 ${formatMoney(data.amount)}${data.guidelinePriceId ? "，已采用系统柴油指导价" : ""}`); setCostDialogOpen(false); await Promise.all([utils.machinery.listCosts.invalidate(), utils.machinery.settlementPreview.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const transitionCost = trpc.machinery.transitionCost.useMutation({
    onSuccess: async () => { toast.success("机械成本状态已更新"); await Promise.all([utils.machinery.listCosts.invalidate(), utils.machinery.settlementPreview.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const saveMonthlyStatement = trpc.machinery.saveMonthlyStatement.useMutation({
    onSuccess: async result => { toast.success(`会计明细已保存：总产值 ${formatMoney(result.preview.statement.totalOutput)}`); setStatementDialogOpen(false); await Promise.all([utils.machinery.listMonthlyStatements.invalidate(), utils.machinery.previewMonthlyStatement.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const transitionMonthlyStatement = trpc.machinery.transitionMonthlyStatement.useMutation({
    onSuccess: async () => { toast.success("会计明细状态已更新"); await utils.machinery.listMonthlyStatements.invalidate(); },
    onError: error => toast.error(error.message),
  });

  /** 打开编辑对话框时仅加载当前台账的非敏感业务字段。 */
  function openMachineDialog(machine?: NonNullable<typeof machines.data>[number]) {
    setEditingMachineId(machine?.id ?? null);
    setMachineDraft(machine ? { code: machine.code, name: machine.name, model: machine.model ?? "", ownership: machine.ownership, supplierName: machine.supplierName ?? "", plateOrAssetNo: machine.plateOrAssetNo ?? "", operatorUserId: machine.operatorUserId ? String(machine.operatorUserId) : "", driverName: machine.driverName ?? "", driverPhone: machine.driverPhone ?? "", status: machine.status, leaseBillingType: machine.leaseTerms?.billingType ?? "monthly", leaseRate: machine.leaseTerms?.rate ? String(machine.leaseTerms.rate) : "", leaseStartDate: machine.leaseTerms?.effectiveFrom ? new Date(machine.leaseTerms.effectiveFrom).toISOString().slice(0, 10) : "", leaseEndDate: machine.leaseTerms?.effectiveTo ? new Date(machine.leaseTerms.effectiveTo).toISOString().slice(0, 10) : "" } : EMPTY_MACHINE_DRAFT);
    setMachineDialogOpen(true);
  }

  function openMachineContactDialog(machine?: NonNullable<typeof machines.data>[number]) {
    const targetMachine = machine ?? selectedMachine;
    if (!targetMachine) return toast.error("请先选择机械台账");
    setMachineId(targetMachine.id);
    openMachineDialog(targetMachine);
    setMachineDialogOpen(false);
    setContactDialogOpen(true);
  }

  /** 提交机械台账时前端只做必填体验校验，项目范围和跨项目编辑校验由服务端兜底。 */
  function submitMachine() {
    if (!selectedProjectId) return toast.error("请先选择项目");
    if (!machineDraft.code.trim() || !machineDraft.name.trim()) return toast.error("请填写机械编号和名称");
    if (machineDraft.ownership === "leased" && (!machineDraft.supplierName.trim() || !machineDraft.leaseRate || !machineDraft.leaseStartDate)) return toast.error("外租机械必须填写出租方、租金和起租日期");
    saveMachine.mutate({ id: editingMachineId ?? undefined, projectId: selectedProjectId, code: machineDraft.code.trim(), name: machineDraft.name.trim(), model: machineDraft.model.trim() || null, ownership: machineDraft.ownership, supplierName: machineDraft.supplierName.trim() || null, plateOrAssetNo: machineDraft.plateOrAssetNo.trim() || null, operatorUserId: machineDraft.operatorUserId ? Number(machineDraft.operatorUserId) : null, driverName: machineDraft.driverName.trim() || null, driverPhone: machineDraft.driverPhone.trim() || null, status: machineDraft.status, leaseTerms: machineDraft.ownership === "leased" ? { billingType: machineDraft.leaseBillingType, rate: Number(machineDraft.leaseRate), effectiveFrom: machineDraft.leaseStartDate, effectiveTo: machineDraft.leaseEndDate || null } : null });
  }

  /** 保存租赁规则时使用当前选定机械，避免客户端提交与机械无关的价格记录。 */
  function submitRule() {
    if (!selectedProjectId || !selectedMachineId) return toast.error("请先选择机械台账");
    if (!ruleDraft.rate) return toast.error("请填写合同计价单价");
    saveRule.mutate({ machineId: selectedMachineId, projectId: selectedProjectId, billingType: ruleDraft.billingType, rate: Number(ruleDraft.rate), overtimeHourlyRate: Number(ruleDraft.overtimeHourlyRate || 0), effectiveFrom: ruleDraft.effectiveFrom, effectiveTo: ruleDraft.effectiveTo || null, status: ruleDraft.status });
  }

  /** 成本金额由服务端按数量和单价计算，移动端不传递可篡改的金额字段。 */
  async function openCostDialog(machineIdToUse = selectedMachineId) {
    if (!machineIdToUse) return toast.error("请先选择机械台账");
    stopCostCamera();
    setMachineId(machineIdToUse);
    if (costPhotoPreview) URL.revokeObjectURL(costPhotoPreview);
    setCostPhotoFile(null);
    setCostPhotoPreview(null);
    const occurredAt = new Date();
    setCostDraft({ costType: "fuel", quantity: "", unitPrice: "", occurredAt: occurredAt.toISOString().slice(0, 16), remarks: "" });
    setCostDialogOpen(true);
    if (!selectedProjectId) return;
    try {
      const defaultPrice = await utils.machinery.fuelCostDefault.fetch({ projectId: selectedProjectId, occurredAt: occurredAt.toISOString() });
      if (defaultPrice.guidelinePrice !== null) {
        setCostDraft(current => current.costType === "fuel" ? { ...current, unitPrice: String(defaultPrice.guidelinePrice) } : current);
        toast.info(`已带入 ${defaultPrice.occurredOn} 有效柴油指导价 ¥${defaultPrice.guidelinePrice}/L`);
      } else {
        toast.warning("当前加油时间未匹配到有效柴油指导价，请先在柴油管理维护指导价");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "柴油指导价读取失败");
    }
  }

  async function submitCost() {
    if (!selectedProjectId || !selectedMachineId) return toast.error("请先选择机械台账");
    if (!costDraft.quantity || (!costDraft.unitPrice && costDraft.costType !== "fuel")) return toast.error("请填写数量与单价");
    if (costDraft.costType === "fuel" && !fuelCostDefault.data?.guidelinePrice) return toast.error(fuelCostDefault.error?.message || "当前加油时间未匹配到有效柴油指导价，请先在柴油管理维护指导价");
    try {
      let evidenceId: number | null = null;
      if (costPhotoFile) {
        const location = await getCurrentLocation();
        if (captureConfig.data?.location.required && !location) throw new Error("当前项目要求费用照片上传时读取现场定位");
        const locationAddress = location ? (await reverseGeocode.mutateAsync({ latitude: location.latitude, longitude: location.longitude })).address : null;
        const capturedAt = new Date();
        const template = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
        const projectName = projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? `项目 #${selectedProjectId}`;
        const machine = machines.data?.find(item => item.id === selectedMachineId);
        const antiCounterfeit = `${selectedProjectId}-${selectedMachineId}-${capturedAt.getTime().toString(36).toUpperCase()}`;
        const categoryLabel = { fuel: "油料", repair: "维修", overtime: "加班", mobilization: "进退场", other: "其他" }[costDraft.costType];
        const values: Record<string, string> = {
          capturedAt: `拍摄时间：${capturedAt.toLocaleString("zh-CN")}`,
          principal: `费用录入人：${user?.name || "当前管理员"}`,
          weather: `费用类别：${categoryLabel}`,
          location: `详细地点：${locationAddress || "未取得"}`,
          coordinates: `详细地点：${locationAddress || "未取得"}`,
          organization: `施工单位：${template.organizationLabel}`,
          project: `项目名称：${projectName}`,
          antiCounterfeit: `防伪编号：${antiCounterfeit}`,
        };
        const lines = template.fields.map(field => values[field]).filter(Boolean);
        const watermarkedFile = await createWatermarkedCostImage(costPhotoFile, lines, template);
        const upload = await evidenceUpload.mutateAsync({ projectId: selectedProjectId, sourceType: "other", sourceId: `machine-cost-pending-${selectedMachineId}-${capturedAt.getTime()}`, description: `机械费用 · ${machine?.name ?? selectedMachineId} · ${categoryLabel}${costDraft.remarks.trim() ? ` · ${costDraft.remarks.trim()}` : ""}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: location?.longitude ?? null, latitude: location?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data: await readImageAsBase64(watermarkedFile) });
        evidenceId = upload.id;
        if (!evidenceId) throw new Error("费用水印照片归档失败");
      }
      saveCost.mutate({ machineId: selectedMachineId, projectId: selectedProjectId, costType: costDraft.costType, quantity: Number(costDraft.quantity), unitPrice: Number(costDraft.unitPrice), occurredAt: new Date(costDraft.occurredAt).toISOString(), evidenceId, remarks: costDraft.remarks.trim() || null });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "费用照片处理失败，请重试");
    }
  }

  /** 移动浏览器对当前页 window.print 支持不稳定，改为同步打开一页真实月结快照后调用系统打印。 */
  function printMonthlySettlement() {
    if (!selectedMachine || !settlement.data) return toast.error("请先选择机械并等待月结预览完成");
    const popup = window.open("", "_blank");
    if (!popup) return toast.error("浏览器阻止了打印页，请允许弹出窗口后重试");
    popup.opener = null;
    const escape = (value: string | number | null | undefined) => String(value ?? "—").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
    const projectName = projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? "—";
    const costs = settlement.data.costBreakdown;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>机械月度结算预览表</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#2e211c;margin:28px}h1{text-align:center;font-size:20px}.sub{text-align:center;color:#705b4f;font-size:13px;margin:10px 0 22px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.card{border:1px solid #d9c4ae;border-radius:10px;padding:13px}.label{color:#795f4e;font-size:12px}.value{font-size:18px;font-weight:700;margin-top:6px}.footer{margin-top:24px;color:#795f4e;font-size:11px;line-height:1.7}@media print{body{margin:14mm}}</style></head><body><h1>机械月度结算预览表</h1><p class="sub">项目：${escape(projectName)}　设备：${escape(selectedMachine.name)}（${escape(selectedMachine.code)}）　期间：${escape(period)}</p><div class="grid"><div class="card"><div class="label">本期结算预览</div><div class="value">${escape(formatMoney(settlement.data.settlement.totalAmount))}</div></div><div class="card"><div class="label">纳入成本记录</div><div class="value">${escape(settlement.data.costRecordCount)} 笔</div></div><div class="card"><div class="label">油料成本</div><div class="value">${escape(formatMoney(costs.fuelAmount))}</div></div><div class="card"><div class="label">维修成本</div><div class="value">${escape(formatMoney(costs.repairAmount))}</div></div><div class="card"><div class="label">加班成本</div><div class="value">${escape(formatMoney(costs.overtimeAmount))}</div></div><div class="card"><div class="label">进退场成本</div><div class="value">${escape(formatMoney(costs.mobilizationAmount))}</div></div></div><p class="footer">本页由系统按当前项目、设备、期间及已授权成本台账生成，仅供项目月结核对。打印时间：${escape(new Date().toLocaleString("zh-CN"))}</p><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
    popup.document.close();
  }

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载机械管理权限…" title="机械管理" description="请使用企业统一身份进入已授权项目的机械台账。" Icon={Cog} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  const selectedMachine = machines.data?.find(machine => machine.id === selectedMachineId);
  const totalCost = costs.data?.filter(item => item.status !== "void").reduce((sum, item) => sum + Number(item.amount), 0) ?? 0;
  const workingCount = machines.data?.filter(item => item.status === "working").length ?? 0;

  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="text-sm font-semibold">机械管理</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">台账 · 成本 · 月度结算</p></div><button aria-label="查看机械计价说明" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => toast.info("成本录入后须经审核与财务结算，已结算记录不可回退。")}><CircleHelp className="h-5 w-5" /></button></div><div className="relative mt-5 flex items-end justify-between"><div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? "请选择项目"}</p></div><Wrench className="h-6 w-6 text-[#e7b779]" /></div></header>
    <main className="space-y-5 px-5 py-5">
      {projectOptions.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">模块权限加载失败：{projectOptions.error.message}</CardContent></Card> : null}
      {!projectOptions.data?.length ? <Card className="border-0 bg-white shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请联系超级管理员为机械管理岗位分配项目或组织数据范围。</p></CardContent></Card> : <>
        <section className="grid grid-cols-[1fr_auto] gap-3 print:hidden"><Select value={projectId ? String(projectId) : undefined} onValueChange={value => { setProjectId(Number(value)); setMachineId(undefined); }}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white text-[#4d2e22]"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select><Input aria-label="机械结算期间" className="h-11 w-[112px] border-[#e9d8c6] bg-white" type="month" value={period} onChange={event => setPeriod(event.target.value)} /></section>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3.5"><p className="text-lg font-semibold">{machines.data?.length ?? 0}</p><p className="mt-1 text-[11px] text-[#8f7566]">机械总数</p></CardContent></Card><Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3.5"><p className="text-lg font-semibold text-[#47754d]">{workingCount}</p><p className="mt-1 text-[11px] text-[#8f7566]">作业中</p></CardContent></Card><Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3.5"><p className="text-sm font-semibold">{formatMoney(totalCost)}</p><p className="mt-1 text-[11px] text-[#8f7566]">本月成本</p></CardContent></Card><Card className="border-0 bg-[#e7f1e5] shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3.5"><p className="text-sm font-semibold text-[#47754d]">{formatMoney(settlement.data?.settlement.totalAmount)}</p><p className="mt-1 text-[11px] text-[#638365]">结算预览</p></CardContent></Card></section>
        <section className="rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{period} 机械月结</p><p className="mt-1 text-xs text-[#7d563d]">合同规则、成本台账与结算状态均以服务端记录为准。</p></div><Button size="sm" variant="ghost" className="gap-1 text-[#8b3f20] hover:bg-[#e8cda9]" disabled={!selectedMachineId || !settlement.data} onClick={printMonthlySettlement}><Printer className="h-4 w-4" />打印月结</Button></div></section>
        <section className="print:hidden"><Button variant="outline" className="w-full border-[#d9b997] bg-white text-[#7a4728]" disabled={!selectedProjectId} onClick={() => setMachineryPrintOpen(true)}><Printer className="mr-1.5 h-4 w-4" />机械成本汇总 PDF</Button></section>
        <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">机械月度结算预览表</h1><p className="mt-2 text-center text-sm">项目：{projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? "—"}　设备：{selectedMachine?.name ?? "—"}　期间：{period}</p><div className="mt-4 grid grid-cols-3 gap-3 text-center"><div>合同计价<p className="mt-1 font-semibold">{formatMoney(settlement.data?.settlement.totalAmount)}</p></div><div>成本记录<p className="mt-1 font-semibold">{settlement.data?.costRecordCount ?? 0} 笔</p></div><div>生成时间<p className="mt-1 font-semibold">{new Date().toLocaleString("zh-CN")}</p></div></div></section>
        <Tabs value={activeTab} onValueChange={setActiveTab}><TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-[#f0e5d7] p-1 print:hidden"><TabsTrigger value="ledger" className="rounded-xl text-xs data-[state=active]:bg-white data-[state=active]:text-[#81411f]">机械台账</TabsTrigger><TabsTrigger value="settlement" className="rounded-xl text-xs data-[state=active]:bg-white data-[state=active]:text-[#81411f]">月结预览</TabsTrigger><TabsTrigger value="accounting" className="rounded-xl text-xs data-[state=active]:bg-white data-[state=active]:text-[#81411f]">会计明细</TabsTrigger></TabsList>
          <TabsContent value="ledger" className="mt-4 space-y-3">
            <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">设备台账</h2><p className="mt-0.5 text-xs text-[#8f7566]">自有与外租机械统一管理</p></div>{isSuperAdmin ? <Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openMachineDialog()}><Plus className="mr-1 h-4 w-4" />录入机械</Button> : null}</div>
            {machines.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">正在加载机械台账…</CardContent></Card> : null}
            {!machines.isLoading && !machines.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未录入机械台账。</CardContent></Card> : null}
            {machines.data?.map(machine => {
              const status = getMachineStatus(machine.status);
              return <Card key={machine.id} className={`border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)] ${machine.id === selectedMachineId ? "ring-2 ring-[#d6a273]/60" : ""}`}>
                <CardContent className="p-2.5">
                  <div className="flex items-start justify-between gap-3"><button className="min-w-0 text-left" onClick={() => setMachineId(machine.id)}><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{machine.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{machine.code} · {machine.ownership === "owned" ? "公司自有" : "外租机械"} · {machine.model || "未填型号"}</p></button>{isSuperAdmin ? <button aria-label={`编辑${machine.name}台账`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openMachineDialog(machine)}><Pencil className="h-4 w-4" /></button> : null}</div>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 rounded-lg bg-[#fcf8f2] px-2.5 py-1.5 text-[10px] leading-4 text-[#765a49]"><span>资产/车牌：{machine.plateOrAssetNo || "未录入"}</span><span>操作员（责任人）：{machine.operatorName || "未绑定"}</span><span>驾驶员：{machine.driverName || "未录入"}</span><span>驾驶员手机：{machine.driverPhone || "未录入"}</span><span className="col-span-2">供应方：{machine.supplierName || "—"}</span></div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5"><Button size="sm" variant="outline" className="h-7 border-[#d7b392] px-2 text-[11px] text-[#8a4b25]" onClick={() => { setMachineId(machine.id); setCostHistoryMachineId(current => current === machine.id ? null : machine.id); }}><ReceiptText className="mr-1 h-3.5 w-3.5" />成本记录</Button><Button size="sm" className="h-7 bg-[#a85f30] px-2 text-[11px] text-white hover:bg-[#8e4b22]" onClick={() => openCostDialog(machine.id)}><Plus className="mr-1 h-3.5 w-3.5" />费用录入</Button>{isSuperAdmin ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-[#8a4b25]" onClick={() => openMachineContactDialog(machine)}>维护联系人</Button> : null}</div>
                  {costHistoryMachineId === machine.id ? <div className="mt-2 rounded-lg border border-[#ead9c8] bg-[#fffdf9] p-2"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-[#6d3f2b]">{period} 成本记录</p><button className="text-[10px] text-[#8f7566]" onClick={() => setCostHistoryMachineId(null)}>收起</button></div>{costs.isLoading ? <p className="py-2 text-[11px] text-[#8f7566]">正在读取成本…</p> : !costs.data?.length ? <p className="py-2 text-[11px] text-[#8f7566]">本期暂无成本记录。</p> : <div className="mt-1 divide-y divide-[#f0e4d7]">{costs.data.map(cost => { const costStatus = getCostStatus(cost.status); return <div key={cost.id} className="py-2 text-[10px] text-[#765a49]"><div className="flex items-center justify-between gap-2"><span>{cost.costType === "fuel" ? "油料" : cost.costType === "repair" ? "维修" : cost.costType === "overtime" ? "加班" : cost.costType === "mobilization" ? "进退场" : "其他"} · {new Date(cost.occurredAt).toLocaleDateString("zh-CN")}</span><span className="font-semibold text-[#6d3f2b]">{formatMoney(cost.amount)}</span></div><div className="mt-0.5 flex items-center justify-between"><span>{cost.remarks || `${cost.quantity} × ${formatMoney(cost.unitPrice)}`}</span><span className={costStatus.className}>{costStatus.label}</span></div>{cost.evidenceId ? <span className="mt-0.5 block text-[#47754d]">已关联水印照片</span> : null}</div>; })}</div>}</div> : null}
                </CardContent>
              </Card>;
            })}
          </TabsContent>
          <TabsContent value="costs" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">机械成本</h2><p className="mt-0.5 text-xs text-[#8f7566]">油料、维修、加班与进退场费用</p></div><Button size="sm" disabled={!selectedMachineId} className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openCostDialog()}><Plus className="mr-1 h-4 w-4" />费用录入</Button></div><div className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-white p-3 shadow-[0_6px_18px_rgba(71,42,30,.06)]"><Select value={machineId ? String(machineId) : undefined} onValueChange={value => setMachineId(Number(value))}><SelectTrigger className="border-[#ead9c8] bg-[#fffaf5]"><SelectValue placeholder="选择机械" /></SelectTrigger><SelectContent>{machines.data?.map(machine => <SelectItem key={machine.id} value={String(machine.id)}>{machine.name} · {machine.code}</SelectItem>)}</SelectContent></Select><span className="rounded-lg bg-[#f8ead8] px-3 py-2 text-xs text-[#82523a]">{period}</span></div>{costs.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">成本台账加载失败：{costs.error.message}</CardContent></Card> : null}{!selectedMachineId ? <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">请先选择需要查看的机械。</CardContent></Card> : !costs.data?.length && !costs.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">本月尚未录入机械成本。</CardContent></Card> : costs.data?.map(cost => { const status = getCostStatus(cost.status); return <Card key={cost.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{cost.costType === "fuel" ? "油料" : cost.costType === "repair" ? "维修" : cost.costType === "overtime" ? "加班" : cost.costType === "mobilization" ? "进退场" : "其他"}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{new Date(cost.occurredAt).toLocaleString("zh-CN")} · {cost.quantity} × {formatMoney(cost.unitPrice)}</p>{cost.remarks ? <p className="mt-1 text-xs leading-5 text-[#765a49]">说明：{cost.remarks}</p> : null}{cost.evidenceId ? <p className="mt-1 text-[11px] text-[#47754d]">已关联工程水印照片</p> : null}</div><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(cost.amount)}</p></div>{isSuperAdmin ? (cost.status === "draft" ? <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="h-7 border-[#d7b392] text-xs text-[#8a4b25]" onClick={() => transitionCost.mutate({ id: cost.id, projectId: selectedProjectId, nextStatus: "approved" })}>审核</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-[#94604a]" onClick={() => transitionCost.mutate({ id: cost.id, projectId: selectedProjectId, nextStatus: "void" })}>作废</Button></div> : cost.status === "approved" ? <Button size="sm" className="mt-3 h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => transitionCost.mutate({ id: cost.id, projectId: selectedProjectId, nextStatus: "settled" })}>财务确认结算</Button> : null) : null}</CardContent></Card>; })}</TabsContent>
          <TabsContent value="settlement" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">月度结算预览</h2><p className="mt-0.5 text-xs text-[#8f7566]">预览不改变成本台账结算状态</p></div>{isSuperAdmin ? <Button size="sm" variant="outline" className="border-[#d7b392] text-[#8a4b25]" disabled={!selectedMachineId} onClick={() => { setRuleDraft({ billingType: "monthly", rate: "", overtimeHourlyRate: "0", effectiveFrom: getTodayText(), effectiveTo: "", status: "active" }); setRuleDialogOpen(true); }}><Settings2 className="mr-1 h-4 w-4" />计价规则</Button> : null}</div><Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="space-y-4 p-4"><div className="grid grid-cols-[1fr_auto] items-end gap-3"><div><Label>非月租的合同用量</Label><Input className="mt-2 border-[#ead9c8] bg-[#fffaf5]" type="number" min="0" value={leaseUsageUnits} onChange={event => setLeaseUsageUnits(event.target.value)} /></div><span className="rounded-lg bg-[#f8ead8] px-3 py-2 text-xs text-[#80543d]">{period}</span></div>{settlement.isLoading ? <p className="py-6 text-center text-sm text-[#8f7566]">正在核算月度结算预览…</p> : settlement.error ? <div className="rounded-xl bg-[#fff4ea] p-3 text-xs leading-5 text-[#9c4d27]">{settlement.error.message}<br />请先为当前机械配置生效的合同计价规则。</div> : settlement.data ? <><div className="rounded-2xl bg-[#3a2117] p-4 text-[#fff7ea]"><p className="text-xs text-[#e8cfb2]">本期结算预览</p><p className="mt-1 text-2xl font-semibold">{formatMoney(settlement.data.settlement.totalAmount)}</p><p className="mt-2 text-[11px] text-[#e8cfb2]">{settlement.data.rule.billingType === "monthly" ? "月租" : settlement.data.rule.billingType === "daily" ? "日租" : settlement.data.rule.billingType === "hourly" ? "小时租" : "台班"} · 合同单价 {formatMoney(settlement.data.rule.rate)}</p></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-[#fcf8f2] p-3">油料 <p className="mt-1 font-semibold">{formatMoney(settlement.data.costBreakdown.fuelAmount)}</p></div><div className="rounded-xl bg-[#fcf8f2] p-3">加班 <p className="mt-1 font-semibold">{formatMoney(settlement.data.costBreakdown.overtimeAmount)}</p></div><div className="rounded-xl bg-[#fcf8f2] p-3">维修 <p className="mt-1 font-semibold">{formatMoney(settlement.data.costBreakdown.repairAmount)}</p></div><div className="rounded-xl bg-[#fcf8f2] p-3">进退场 <p className="mt-1 font-semibold">{formatMoney(settlement.data.costBreakdown.mobilizationAmount)}</p></div></div><p className="text-[11px] leading-5 text-[#8f7566]">本期纳入 {settlement.data.costRecordCount} 笔未作废成本。最终结算需逐笔完成审核和财务确认。</p></> : null}</CardContent></Card>{leaseRules.data?.length ? <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><p className="text-sm font-semibold">当前机械计价规则</p>{leaseRules.data.map(rule => <div key={rule.id} className="mt-3 flex items-center justify-between border-t border-[#f0e4d7] pt-3 text-xs"><span>{rule.billingType === "monthly" ? "月租" : rule.billingType === "daily" ? "日租" : rule.billingType === "hourly" ? "小时租" : "台班"} · {new Date(rule.effectiveFrom).toLocaleDateString("zh-CN")}</span><span className={rule.status === "active" ? "text-[#47754d]" : "text-[#8f7566]"}>{formatMoney(rule.rate)} / {rule.status === "active" ? "生效" : "停用"}</span></div>)}</CardContent></Card> : null}</TabsContent>
          <TabsContent value="accounting" className="mt-4 space-y-3"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">会计月度明细</h2><p className="mt-0.5 text-xs text-[#8f7566]">机械产值、司机工资、维修、油耗与机械分成</p></div>{isSuperAdmin ? <Button size="sm" disabled={!selectedMachineId} className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => { setStatementDraft({ driverUserId: selectedMachine?.operatorUserId ? String(selectedMachine.operatorUserId) : "", machineWorkDays: "0", machineOvertimeHours: "0", driverMonthlyWage: "0", driverWorkDays: "0", driverOvertimeHours: "0", signatureName: "", remarks: "" }); setStatementDialogOpen(true); }}><FileClock className="mr-1 h-4 w-4" />生成明细</Button> : null}</div>{paymentSettlements.data?.filter(item => item.period === period).length ? <Card className="border-0 bg-[#f7fbf9] shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><p className="text-sm font-semibold">机械付款状态</p><p className="mt-1 text-[11px] text-[#638365]">仅同步查看；收款账户、会计审核和付款登记请在PC“机械管理 → 外租机械月结与付款台账”办理。</p><div className="mt-3 space-y-2">{paymentSettlements.data.filter(item => item.period === period).map(item => { const paymentStatus = getMachinePaymentStatus(item.status); return <div key={item.id} className="rounded-xl bg-white p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{item.machine?.name || `机械 #${item.machineId}`}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${paymentStatus.className}`}>{paymentStatus.label}</span></div><p className="mt-1 text-[#765a49]">{item.settlementNo} · 净应付 {formatMoney(item.netPayableAmount)}{item.paymentDate ? ` · 付款日期 ${String(item.paymentDate).slice(0, 10)}` : ""}</p></div>; })}</div></CardContent></Card> : null}{monthlyStatements.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">正在读取会计月度明细…</CardContent></Card> : null}{!monthlyStatements.isLoading && !monthlyStatements.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目和期间尚无会计机械明细。选择机械后可生成草稿。</CardContent></Card> : null}{monthlyStatements.data?.map(item => { const status = getMonthlyStatementStatus(item.status); const machine = machines.data?.find(candidate => candidate.id === item.machineId); return <Card key={item.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{machine?.name ?? `机械 #${item.machineId}`}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">司机：{item.driverNameSnapshot || "未分配"} · {item.machineModelSnapshot || "未登记型号"}</p></div><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(item.machineShareAmount)}</p></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#fcf8f2] p-3 text-[11px] text-[#765a49]"><span>总产值：{formatMoney(item.totalOutput)}</span><span>司机工资：{formatMoney(item.driverTotalWage)}</span><span>维修 / 油费：{formatMoney(item.repairAmount)} / {formatMoney(item.fuelAmount)}</span><span>签字：{item.signatureName || "未签"}</span></div>{isSuperAdmin ? <div className="mt-3 flex flex-wrap gap-2">{item.status === "draft" ? <Button size="sm" className="h-7 bg-[#a85f30] text-xs text-white hover:bg-[#8e4b22]" onClick={() => transitionMonthlyStatement.mutate({ id: item.id, projectId: selectedProjectId, nextStatus: "submitted" })}>提交会计审核</Button> : null}{item.status === "submitted" ? <><Button size="sm" className="h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => transitionMonthlyStatement.mutate({ id: item.id, projectId: selectedProjectId, nextStatus: "approved" })}>审核</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-[#94604a]" onClick={() => transitionMonthlyStatement.mutate({ id: item.id, projectId: selectedProjectId, nextStatus: "void" })}>作废</Button></> : null}{item.status === "approved" ? <span className="rounded-lg bg-[#eff6f2] px-2.5 py-1.5 text-[11px] text-[#47754d]">请在PC付款台账生成结算并登记付款</span> : null}</div> : null}</CardContent></Card>; })}</TabsContent>
        </Tabs>
      </>}
    </main>
    <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Cog className="h-5 w-5" /><span className="text-[10px] font-medium">机械</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>

    <Dialog open={statementDialogOpen} onOpenChange={setStatementDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>会计机械月度明细</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]">机械：{selectedMachine ? `${selectedMachine.name} · ${selectedMachine.code}` : "未选择"}　期间：{period}</div><div className="grid grid-cols-2 gap-3"><div><Label>机械出勤天数</Label><Input className="mt-1" type="number" min="0" max="31" step="0.5" value={statementDraft.machineWorkDays} onChange={event => setStatementDraft(current => ({ ...current, machineWorkDays: event.target.value }))} /></div><div><Label>机械加班（小时）</Label><Input className="mt-1" type="number" min="0" step="0.5" value={statementDraft.machineOvertimeHours} onChange={event => setStatementDraft(current => ({ ...current, machineOvertimeHours: event.target.value }))} /></div><div><Label>司机固定月工资</Label><Input className="mt-1" type="number" min="0" step="0.01" value={statementDraft.driverMonthlyWage} onChange={event => setStatementDraft(current => ({ ...current, driverMonthlyWage: event.target.value }))} /></div><div><Label>司机出勤天数</Label><Input className="mt-1" type="number" min="0" max="31" step="0.5" value={statementDraft.driverWorkDays} onChange={event => setStatementDraft(current => ({ ...current, driverWorkDays: event.target.value }))} /></div><div><Label>司机加班（小时）</Label><Input className="mt-1" type="number" min="0" step="0.5" value={statementDraft.driverOvertimeHours} onChange={event => setStatementDraft(current => ({ ...current, driverOvertimeHours: event.target.value }))} /></div><div><Label>签字 / 经办人</Label><Input className="mt-1" value={statementDraft.signatureName} onChange={event => setStatementDraft(current => ({ ...current, signatureName: event.target.value }))} placeholder="可选" /></div></div><div><Label>备注</Label><Input className="mt-1" value={statementDraft.remarks} onChange={event => setStatementDraft(current => ({ ...current, remarks: event.target.value }))} placeholder="核对说明或异常原因" /></div>{monthlyStatementPreview.isLoading ? <div className="rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]">正在按项目真实成本核算…</div> : monthlyStatementPreview.error ? <div className="rounded-xl bg-[#fff4ea] p-3 text-xs text-[#9c4d27]">{monthlyStatementPreview.error.message}</div> : monthlyStatementPreview.data ? <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#fff7ec] p-3 text-xs text-[#765a49]"><span>机械总产值：<b>{formatMoney(monthlyStatementPreview.data.statement.totalOutput)}</b></span><span>司机总工资：<b>{formatMoney(monthlyStatementPreview.data.statement.driverTotalWage)}</b></span><span>维修 / 油费：<b>{formatMoney(monthlyStatementPreview.data.statement.repairAmount)} / {formatMoney(monthlyStatementPreview.data.statement.fuelAmount)}</b></span><span>机械分成：<b>{formatMoney(monthlyStatementPreview.data.statement.machineShareAmount)}</b></span></div> : null}<p className="rounded-lg bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">模板口径：30 天月、每天 10 小时。机械分成按“总产值 − 司机总工资 − 维修费”五五分成；油耗与油费单独留存审计。</p></div><DialogFooter><Button variant="outline" onClick={() => setStatementDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveMonthlyStatement.isPending || !monthlyStatementPreview.data} onClick={() => saveMonthlyStatement.mutate({ machineId: selectedMachineId, projectId: selectedProjectId, period, driverUserId: statementDraft.driverUserId ? Number(statementDraft.driverUserId) : null, machineWorkDays: Number(statementDraft.machineWorkDays), machineOvertimeHours: Number(statementDraft.machineOvertimeHours), driverMonthlyWage: Number(statementDraft.driverMonthlyWage), driverWorkDays: Number(statementDraft.driverWorkDays), driverOvertimeHours: Number(statementDraft.driverOvertimeHours), signatureName: statementDraft.signatureName.trim() || null, remarks: statementDraft.remarks.trim() || null })}>{saveMonthlyStatement.isPending ? "正在生成…" : "生成草稿"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingMachineId ? "维护机械台账" : "录入机械台账"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><div><Label>机械编号</Label><Input className="mt-1" value={machineDraft.code} maxLength={64} onChange={event => setMachineDraft(current => ({ ...current, code: event.target.value }))} /></div><div><Label>机械名称</Label><Input className="mt-1" value={machineDraft.name} maxLength={128} onChange={event => setMachineDraft(current => ({ ...current, name: event.target.value }))} /></div></div><div className="grid grid-cols-2 gap-3"><div><Label>产权性质</Label><Select value={machineDraft.ownership} onValueChange={value => setMachineDraft(current => ({ ...current, ownership: value as typeof current.ownership }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租机械</SelectItem></SelectContent></Select></div><div><Label>设备状态</Label><Select value={machineDraft.status} onValueChange={value => setMachineDraft(current => ({ ...current, status: value as typeof current.status }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="idle">待命</SelectItem><SelectItem value="working">作业中</SelectItem><SelectItem value="repairing">维修中</SelectItem><SelectItem value="offsite">场外</SelectItem><SelectItem value="retired">已退场</SelectItem></SelectContent></Select></div></div><div><Label>型号</Label><Input className="mt-1" value={machineDraft.model} maxLength={128} onChange={event => setMachineDraft(current => ({ ...current, model: event.target.value }))} /></div><div className="grid grid-cols-2 gap-3"><div><Label>资产/车牌编号</Label><Input className="mt-1" value={machineDraft.plateOrAssetNo} maxLength={64} onChange={event => setMachineDraft(current => ({ ...current, plateOrAssetNo: event.target.value }))} /></div><div><Label>操作员用户 ID</Label><Input className="mt-1" inputMode="numeric" value={machineDraft.operatorUserId} placeholder="可选" onChange={event => setMachineDraft(current => ({ ...current, operatorUserId: event.target.value }))} /></div></div><div className="grid grid-cols-2 gap-3"><div><Label>驾驶员姓名</Label><Input className="mt-1" value={machineDraft.driverName} maxLength={128} placeholder="可选" onChange={event => setMachineDraft(current => ({ ...current, driverName: event.target.value }))} /></div><div><Label>驾驶员手机</Label><Input className="mt-1" inputMode="tel" maxLength={32} value={machineDraft.driverPhone} placeholder="加密保存" onChange={event => setMachineDraft(current => ({ ...current, driverPhone: event.target.value }))} /></div></div><div><Label>{machineDraft.ownership === "leased" ? "出租方" : "外租供应方"}</Label><Input className="mt-1" value={machineDraft.supplierName} maxLength={200} placeholder={machineDraft.ownership === "leased" ? "外租必填" : "自有机械可留空"} onChange={event => setMachineDraft(current => ({ ...current, supplierName: event.target.value }))} /></div>{machineDraft.ownership === "leased" ? <div className="space-y-3 rounded-xl border border-[#e7c8a5] bg-[#fff7ec] p-3"><p className="text-xs font-semibold text-[#83502f]">外租合同与租金</p><div className="grid grid-cols-2 gap-3"><div><Label>计费方式</Label><Select value={machineDraft.leaseBillingType} onValueChange={value => setMachineDraft(current => ({ ...current, leaseBillingType: value as typeof current.leaseBillingType }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">月租</SelectItem><SelectItem value="daily">日租</SelectItem><SelectItem value="hourly">小时租</SelectItem><SelectItem value="shift">台班</SelectItem></SelectContent></Select></div><div><Label>租金（元）</Label><Input className="mt-1" type="number" min="0.01" step="0.01" value={machineDraft.leaseRate} onChange={event => setMachineDraft(current => ({ ...current, leaseRate: event.target.value }))} /></div></div><div className="grid grid-cols-2 gap-3"><div><Label>起租日期</Label><Input className="mt-1" type="date" value={machineDraft.leaseStartDate} onChange={event => setMachineDraft(current => ({ ...current, leaseStartDate: event.target.value }))} /></div><div><Label>截止日期</Label><Input className="mt-1" type="date" min={machineDraft.leaseStartDate || undefined} value={machineDraft.leaseEndDate} onChange={event => setMachineDraft(current => ({ ...current, leaseEndDate: event.target.value }))} /></div></div></div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setMachineDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveMachine.isPending || (machineDraft.ownership === "leased" && (!machineDraft.supplierName || !machineDraft.leaseRate || !machineDraft.leaseStartDate))} onClick={submitMachine}>{saveMachine.isPending ? "正在保存…" : "保存台账"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}><DialogContent><DialogHeader><DialogTitle>新增机械计价规则</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><div><Label>计价方式</Label><Select value={ruleDraft.billingType} onValueChange={value => setRuleDraft(current => ({ ...current, billingType: value as typeof current.billingType }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">月租</SelectItem><SelectItem value="daily">日租</SelectItem><SelectItem value="hourly">小时租</SelectItem><SelectItem value="shift">台班</SelectItem></SelectContent></Select></div><div><Label>合同单价</Label><Input className="mt-1" type="number" min="0" value={ruleDraft.rate} onChange={event => setRuleDraft(current => ({ ...current, rate: event.target.value }))} /></div></div><div><Label>加班小时单价</Label><Input className="mt-1" type="number" min="0" value={ruleDraft.overtimeHourlyRate} onChange={event => setRuleDraft(current => ({ ...current, overtimeHourlyRate: event.target.value }))} /></div><div className="grid grid-cols-2 gap-3"><div><Label>生效日期</Label><Input className="mt-1" type="date" value={ruleDraft.effectiveFrom} onChange={event => setRuleDraft(current => ({ ...current, effectiveFrom: event.target.value }))} /></div><div><Label>截止日期</Label><Input className="mt-1" type="date" value={ruleDraft.effectiveTo} onChange={event => setRuleDraft(current => ({ ...current, effectiveTo: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setRuleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveRule.isPending} onClick={submitRule}>{saveRule.isPending ? "正在保存…" : "保存规则"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={costDialogOpen} onOpenChange={open => { if (!open) { stopCostCamera(); if (costPhotoPreview) URL.revokeObjectURL(costPhotoPreview); setCostPhotoPreview(null); setCostPhotoFile(null); } setCostDialogOpen(open); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>费用录入</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]">设备：{selectedMachine ? `${selectedMachine.name} · ${selectedMachine.code}` : "未选择"}<br />金额由系统按数量 × 单价核算，费用照片将自动写入工程水印。</div><div><Label>费用类别</Label><Select value={costDraft.costType} onValueChange={value => setCostDraft(current => ({ ...current, costType: value as typeof current.costType }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fuel">油料</SelectItem><SelectItem value="repair">维修</SelectItem><SelectItem value="overtime">加班</SelectItem><SelectItem value="mobilization">进退场</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div><Label>数量</Label><Input className="mt-1" type="number" min="0" step="0.001" value={costDraft.quantity} onChange={event => setCostDraft(current => ({ ...current, quantity: event.target.value }))} placeholder="例如：1" /></div><div><Label>单价（元）</Label><Input className="mt-1" type="number" min="0" step="0.01" value={costDraft.unitPrice} onChange={event => setCostDraft(current => ({ ...current, unitPrice: event.target.value }))} placeholder="例如：700" /></div></div><div><Label>发生时间</Label><Input className="mt-1" type="datetime-local" value={costDraft.occurredAt} onChange={event => setCostDraft(current => ({ ...current, occurredAt: event.target.value }))} /></div><div><Label>费用说明</Label><Input className="mt-1" maxLength={500} value={costDraft.remarks} onChange={event => setCostDraft(current => ({ ...current, remarks: event.target.value }))} placeholder="维修项目、材料名称或费用说明" /></div><div><Label>费用水印照片</Label>{costCameraOpen ? <div className="mt-1 overflow-hidden rounded-xl border border-[#c9956e] bg-[#261914]"><video ref={costCameraVideoRef} className="aspect-[4/3] w-full bg-black object-cover" autoPlay playsInline muted /><div className="grid grid-cols-2 gap-2 p-2"><Button type="button" variant="outline" className="border-[#d9b997] bg-white text-[#7a4728]" onClick={stopCostCamera}>取消拍照</Button><Button type="button" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={captureCostPhoto}><Camera className="mr-1 h-4 w-4" />确认拍照</Button></div></div> : <Button type="button" variant="outline" className="mt-1 h-11 w-full border-dashed border-[#c9956e] bg-[#fff8ef] text-[#8a4b25] hover:bg-[#f8ead8]" onClick={() => void startCostCamera()}><Camera className="mr-2 h-4 w-4" />打开后置相机拍照</Button>}<p className="mt-1 text-[11px] leading-5 text-[#8f7566]">仅支持现场直拍，不提供本地相册选择。照片将自动写入项目、时间、定位、操作人和防伪编号后归档。</p>{costPhotoPreview ? <div className="mt-2"><img src={costPhotoPreview} alt="待归档费用照片预览" className="max-h-40 w-full rounded-lg border border-[#ead9c8] object-cover" /><Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs text-[#8a4b25]" onClick={() => void startCostCamera()}><Camera className="mr-1 h-3.5 w-3.5" />重新拍摄</Button></div> : null}</div><p className="rounded-lg bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">费用保存后进入原有审核与财务结算流程；水印照片若已直拍则与该费用记录安全关联。</p></div><DialogFooter><Button variant="outline" onClick={() => setCostDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveCost.isPending || evidenceUpload.isPending || costCameraOpen} onClick={() => void submitCost()}>{saveCost.isPending || evidenceUpload.isPending ? "正在归档…" : "保存费用"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}><DialogContent><DialogHeader><DialogTitle>维护机械联系人</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]">设备：{selectedMachine ? `${selectedMachine.name} · ${selectedMachine.code}` : "未选择"}<br />操作员姓名：{selectedMachine?.operatorName || "未绑定系统账号"}</div><div><Label>操作员用户 ID</Label><Input className="mt-1" inputMode="numeric" value={machineDraft.operatorUserId} placeholder="绑定操作员账号后自动显示姓名" onChange={event => setMachineDraft(current => ({ ...current, operatorUserId: event.target.value }))} /></div><div><Label>驾驶员姓名</Label><Input className="mt-1" maxLength={128} value={machineDraft.driverName} onChange={event => setMachineDraft(current => ({ ...current, driverName: event.target.value }))} placeholder="实际驾驶员姓名" /></div><div><Label>驾驶员手机</Label><Input className="mt-1" inputMode="tel" maxLength={32} value={machineDraft.driverPhone} onChange={event => setMachineDraft(current => ({ ...current, driverPhone: event.target.value }))} placeholder="仅已授权项目可见，加密保存" /></div></div><DialogFooter><Button variant="outline" onClick={() => setContactDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveMachine.isPending} onClick={submitMachine}>{saveMachine.isPending ? "正在保存…" : "保存联系人"}</Button></DialogFooter></DialogContent></Dialog>
    <MachinerySummaryPrintDialog open={machineryPrintOpen} onOpenChange={setMachineryPrintOpen} projectId={selectedProjectId} projectName={projectOptions.data?.find(item => item.id === selectedProjectId)?.name ?? "—"} period={period} />
  </div></div>;
}
