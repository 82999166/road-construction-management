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
  const utils = trpc.useUtils();
  const writerDevices = trpc.transport.listRfidWriterDevices.useQuery({ projectId }, { enabled: projectId > 0 });
  const recordTest = trpc.transport.recordRfidHardwareTest.useMutation({
    onSuccess: () => {
      utils.transport.listRfidWriterDevices.invalidate({ projectId });
    },
  });

  const requestBridge = async (path: string) => {
    const response = await fetch(`${LOCAL_BRIDGE_URL}${path}`, { method: path === "/health" ? "GET" : "POST", headers: { "Content-Type": "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.detail || "本地写卡桥接未返回有效结果");
    return body as BridgeResult;
  };

  const checkBridge = async () => {
    try {
      await requestBridge("/health");
      setBridgeStatus("ready");
      toast.success("uTrust 本地桥接已就绪，可执行测试卡写入。");
    } catch (error) {
      setBridgeStatus("offline");
      toast.error(error instanceof Error ? error.message : "未连接本地写卡桥接");
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
          <Button type="button" variant="outline" onClick={checkBridge}><Radio className="mr-1.5 h-4 w-4" />检测本地桥接</Button>
          <Button type="button" onClick={runTestWrite} disabled={recordTest.isPending}><ShieldCheck className="mr-1.5 h-4 w-4" />{recordTest.isPending ? "正在回读校验…" : "写入测试卡"}</Button>
        </div>
        <p className="rounded-lg border border-cyan-200 bg-white/70 px-3 py-2 text-xs leading-5 text-cyan-950">操作顺序：先将可覆盖的测试 NTAG216 放至 <strong>uTrust 4701 F CL Reader</strong> 感应区，点击“检测本地桥接”，再点击“写入测试卡”。桥接会先读取 UID 指纹、写入 `RC3T` 测试 NDEF、回读验证；不触碰锁定页、配置页或写保护口令。</p>
      </CardContent>
    </Card>
  );
}
