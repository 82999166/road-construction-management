import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Radio, ShieldCheck, Usb } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LOCAL_BRIDGE_URL = "http://127.0.0.1:47601";

type BridgeResult = {
  success?: boolean;
  cardUid?: string;
  cardUidFingerprint?: string;
  message?: string;
  detail?: string;
};

export default function RfidLocalWriterPanel({ projectId, onUidRead }: { projectId: number; onUidRead: (uid: string) => void }) {
  const [writerDeviceId, setWriterDeviceId] = useState("UNASSIGNED");
  const [bridgeStatus, setBridgeStatus] = useState<"unknown" | "ready" | "offline">("unknown");
  const [bridgeMessage, setBridgeMessage] = useState("尚未检测本机 uTrust 桥接服务。");
  const [checkingBridge, setCheckingBridge] = useState(false);
  const [readingUid, setReadingUid] = useState(false);
  const [erasingInitial, setErasingInitial] = useState(false);
  const [readerSiteId, setReaderSiteId] = useState("UNSELECTED");
  const [readerDeviceCode, setReaderDeviceCode] = useState("");
  const [readerDisplayName, setReaderDisplayName] = useState("");
  const utils = trpc.useUtils();
  const writerDevices = trpc.transport.listRfidWriterDevices.useQuery({ projectId }, { enabled: projectId > 0 });
  const transportSites = trpc.transport.listSites.useQuery({ projectId }, { enabled: projectId > 0 });
  const readerDevices = trpc.transport.listReaderDevices.useQuery({ projectId }, { enabled: projectId > 0 });
  const recordTest = trpc.transport.recordRfidHardwareTest.useMutation({
    onSuccess: () => {
      utils.transport.listRfidWriterDevices.invalidate({ projectId });
    },
  });
  const saveReaderDevice = trpc.transport.saveReaderDevice.useMutation({
    onSuccess: async () => {
      toast.success("现场读卡设备已登记，可用于装土/卸土双刷卡闭环。");
      setReaderDeviceCode("");
      setReaderDisplayName("");
      await readerDevices.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const requestBridge = async (path: string) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const isHealthCheck = path === "/health";
      const response = await fetch(`${LOCAL_BRIDGE_URL}${path}`, {
        method: isHealthCheck ? "GET" : "POST",
        ...(isHealthCheck ? {} : { headers: { "Content-Type": "application/json" } }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.detail || `本地桥接返回 HTTP ${response.status}`);
      return body as BridgeResult;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("检测超时：本机桥接 8 秒内未响应，请确认桥接程序仍在运行。");
      if (error instanceof TypeError) throw new Error("浏览器无法访问本机 127.0.0.1 桥接。请确认 Windows 终端已在线、桥接程序运行，且浏览器允许该站点访问本机设备。");
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const checkBridge = async () => {
    setCheckingBridge(true);
    setBridgeMessage("正在检测本机 127.0.0.1:47601 桥接与 uTrust 读写器…");
    try {
      const result = await requestBridge("/health") as BridgeResult & { readers?: string[]; service?: string };
      setBridgeStatus("ready");
      const readers = result.readers?.join("、") || "读写器通道";
      setBridgeMessage(`已连接：智能卡服务 ${result.service || "正常"}；已识别 ${readers}。现在可写入测试卡。`);
      toast.success("uTrust 本地桥接已就绪，可执行测试卡写入。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未连接本地写卡桥接";
      setBridgeStatus("offline");
      setBridgeMessage(message);
      toast.error(message);
    } finally {
      setCheckingBridge(false);
    }
  };

  const runTestWrite = async () => {
    try {
      const result = await requestBridge("/api/test-write");
      if (!result.success) throw new Error(result.message || result.detail || "测试写卡未通过回读校验");
      await recordTest.mutateAsync({
        projectId,
        writerDeviceId: writerDeviceId === "UNASSIGNED" ? null : Number(writerDeviceId),
        success: true,
        cardUidFingerprint: result.cardUidFingerprint ?? null,
      });
      toast.success("测试卡写入、回读与审计登记均已完成。");
    } catch (error) {
      await recordTest.mutateAsync({
        projectId,
        writerDeviceId: writerDeviceId === "UNASSIGNED" ? null : Number(writerDeviceId),
        success: false,
        failureReason: error instanceof Error ? error.message.slice(0, 500) : "本地桥接测试失败",
      }).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "测试写卡失败");
    }
  };

  const readUidForBinding = async () => {
    setReadingUid(true);
    setBridgeMessage("正在通过 uTrust 4701 F CL Reader 读取卡 UID…");
    try {
      const result = await requestBridge("/api/read-uid");
      if (!result.success || !result.cardUid) throw new Error(result.message || "未读取到有效卡 UID");
      onUidRead(result.cardUid);
      setBridgeMessage("已读取卡 UID，正在打开车辆卡绑定窗口；UID 仅在本次绑定请求中使用。");
      toast.success("已读取卡 UID，请在弹出的窗口确认车辆和联系电话。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取卡 UID 失败";
      setBridgeMessage(message);
      toast.error(message);
    } finally {
      setReadingUid(false);
    }
  };

  const eraseToInitial = async () => {
    if (!window.confirm("确认擦除当前 NTAG216 的 NDEF 用户区并恢复为空白初卡？此操作不可撤销，但不会修改制造商区、锁定位、配置页或写保护口令。")) return;
    setErasingInitial(true);
    try {
      const result = await requestBridge("/api/erase-initial-card") as BridgeResult & { initialNdef?: boolean };
      if (!result.success || !result.initialNdef) throw new Error(result.message || "初卡恢复回读校验失败");
      setBridgeMessage("已擦除 NDEF 用户区并回读确认空白初卡；请在车辆卡台账中重新办理绑定和正式写入。");
      toast.success("NFC 卡已恢复为空白初卡，未修改锁定位或写保护。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复初卡失败");
    } finally {
      setErasingInitial(false);
    }
  };

  const registerReaderDevice = () => {
    if (readerSiteId === "UNSELECTED") return toast.error("请先选择读卡设备所在的装土点或卸土点");
    if (!readerDeviceCode.trim() || !readerDisplayName.trim()) return toast.error("请填写现场设备编号和显示名称");
    saveReaderDevice.mutate({ projectId, siteId: Number(readerSiteId), deviceCode: readerDeviceCode, displayName: readerDisplayName, status: "active" });
  };

  return (
    <Card className="border-cyan-200 bg-cyan-50/40">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <div className="flex items-center gap-2"><Usb className="h-5 w-5 text-cyan-700" /><CardTitle className="text-base">uTrust 4701 F 本地测试写卡</CardTitle></div>
          <CardDescription className="mt-1">管理后台只向本机 `127.0.0.1` 受控桥接发起测试请求。测试载荷不绑定车辆、不含司机或结算数据；正式车辆卡仍须在下方射频卡台账中完成选择、绑定和签名任务。</CardDescription>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${bridgeStatus === "ready" ? "bg-emerald-100 text-emerald-800" : bridgeStatus === "offline" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"}`}><Radio className="h-3.5 w-3.5" />{bridgeStatus === "ready" ? "本地桥接已连接" : bridgeStatus === "offline" ? "本地桥接未连接" : "待检测"}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end">
          <div>
            <Label>登记写卡器（用于审计）</Label>
            <Select value={writerDeviceId} onValueChange={setWriterDeviceId}>
              <SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="选择写卡器" /></SelectTrigger>
              <SelectContent><SelectItem value="UNASSIGNED">未登记设备（仅本次测试）</SelectItem>{(writerDevices.data ?? []).filter(device => device.status === "active").map(device => <SelectItem key={device.id} value={String(device.id)}>{device.displayName} · {device.model || device.deviceCode}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={checkBridge} disabled={checkingBridge}><Radio className="mr-1.5 h-4 w-4" />{checkingBridge ? "正在检测…" : "检测本地桥接"}</Button>
          <Button type="button" variant="outline" onClick={readUidForBinding} disabled={readingUid || bridgeStatus !== "ready"}><Usb className="mr-1.5 h-4 w-4" />{readingUid ? "正在读取 UID…" : "读取卡 UID 并绑定"}</Button>
          <Button type="button" onClick={runTestWrite} disabled={recordTest.isPending || bridgeStatus !== "ready"}><ShieldCheck className="mr-1.5 h-4 w-4" />{recordTest.isPending ? "正在回读校验…" : "写入测试卡"}</Button>
          <Button type="button" variant="destructive" onClick={eraseToInitial} disabled={erasingInitial || bridgeStatus !== "ready"}>{erasingInitial ? "正在恢复初卡…" : "擦除并恢复初卡"}</Button>
        </div>
        <p aria-live="polite" className={`rounded-lg border px-3 py-2 text-xs leading-5 ${bridgeStatus === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : bridgeStatus === "offline" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{bridgeMessage}</p>
        <p className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2 text-xs leading-5 text-cyan-950">操作顺序：先将可覆盖的测试 NTAG216 放至 <strong>uTrust 4701 F CL Reader</strong> 感应区，点击“检测本地桥接”，再点击“写入测试卡”。桥接会先读取 UID 指纹、写入 `RC3T` 测试 NDEF、回读验证；不触碰锁定页、配置页或写保护口令。</p>
        <div className="rounded-xl border border-[#b6d6df] bg-white/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-[#174c60]">装卸点读卡设备</p><p className="mt-0.5 text-xs text-[#577b88]">装土点和卸土点各登记一台设备。手机 NFC 触碰车辆卡后，系统将按所选设备绑定地点自动判断首次发车或二次闭环。</p></div><span className="rounded-full bg-[#e7f4f7] px-2 py-1 text-xs font-medium text-[#23657b]">已登记 {readerDevices.data?.length ?? 0} 台</span></div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,1fr)_auto]">
            <Select value={readerSiteId} onValueChange={setReaderSiteId}><SelectTrigger className="bg-white"><SelectValue placeholder="选择装土点或卸土点" /></SelectTrigger><SelectContent><SelectItem value="UNSELECTED">请选择地点</SelectItem>{(transportSites.data ?? []).filter(site => site.status === "active").map(site => <SelectItem key={site.id} value={String(site.id)}>{site.siteType === "load" ? "装土" : "卸土"} · {site.name}</SelectItem>)}</SelectContent></Select>
            <Input value={readerDeviceCode} onChange={event => setReaderDeviceCode(event.target.value.toUpperCase())} placeholder="设备编号，如 LOAD-NFC-01" />
            <Input value={readerDisplayName} onChange={event => setReaderDisplayName(event.target.value)} placeholder="设备名称，如 1#装土点读卡器" />
            <Button type="button" variant="outline" onClick={registerReaderDevice} disabled={saveReaderDevice.isPending}>{saveReaderDevice.isPending ? "登记中…" : "登记设备"}</Button>
          </div>
          {readerDevices.data?.length ? <div className="mt-3 flex flex-wrap gap-2">{readerDevices.data.map(device => <span key={device.id} className={`rounded-lg border px-2 py-1 text-xs ${device.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{device.siteType === "load" ? "装土" : "卸土"} · {device.siteName} · {device.displayName} ({device.deviceCode})</span>)}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
