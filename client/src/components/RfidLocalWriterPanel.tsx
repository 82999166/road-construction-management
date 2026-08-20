import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Radio, ShieldCheck, Usb } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LOCAL_BRIDGE_URL = "http://127.0.0.1:47601";

type BridgeResult = {
  success?: boolean;
  cardUidFingerprint?: string;
  message?: string;
  detail?: string;
};

export default function RfidLocalWriterPanel({ projectId }: { projectId: number }) {
  const [writerDeviceId, setWriterDeviceId] = useState("UNASSIGNED");
  const [bridgeStatus, setBridgeStatus] = useState<"unknown" | "ready" | "offline">("unknown");
  const [bridgeMessage, setBridgeMessage] = useState("尚未检测本机 uTrust 桥接服务。");
  const [checkingBridge, setCheckingBridge] = useState(false);
  const utils = trpc.useUtils();
  const writerDevices = trpc.transport.listRfidWriterDevices.useQuery({ projectId }, { enabled: projectId > 0 });
  const recordTest = trpc.transport.recordRfidHardwareTest.useMutation({
    onSuccess: () => {
      utils.transport.listRfidWriterDevices.invalidate({ projectId });
    },
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
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <div>
            <Label>登记写卡器（用于审计）</Label>
            <Select value={writerDeviceId} onValueChange={setWriterDeviceId}>
              <SelectTrigger className="mt-1 bg-white"><SelectValue placeholder="选择写卡器" /></SelectTrigger>
              <SelectContent><SelectItem value="UNASSIGNED">未登记设备（仅本次测试）</SelectItem>{(writerDevices.data ?? []).filter(device => device.status === "active").map(device => <SelectItem key={device.id} value={String(device.id)}>{device.displayName} · {device.model || device.deviceCode}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={checkBridge} disabled={checkingBridge}><Radio className="mr-1.5 h-4 w-4" />{checkingBridge ? "正在检测…" : "检测本地桥接"}</Button>
          <Button type="button" onClick={runTestWrite} disabled={recordTest.isPending || bridgeStatus !== "ready"}><ShieldCheck className="mr-1.5 h-4 w-4" />{recordTest.isPending ? "正在回读校验…" : "写入测试卡"}</Button>
        </div>
        <p aria-live="polite" className={`rounded-lg border px-3 py-2 text-xs leading-5 ${bridgeStatus === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : bridgeStatus === "offline" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{bridgeMessage}</p>
        <p className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2 text-xs leading-5 text-cyan-950">操作顺序：先将可覆盖的测试 NTAG216 放至 <strong>uTrust 4701 F CL Reader</strong> 感应区，点击“检测本地桥接”，再点击“写入测试卡”。桥接会先读取 UID 指纹、写入 `RC3T` 测试 NDEF、回读验证；不触碰锁定页、配置页或写保护口令。</p>
      </CardContent>
    </Card>
  );
}
