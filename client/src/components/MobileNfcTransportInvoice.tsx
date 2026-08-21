import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { CircleCheck, Radio, RotateCw, SmartphoneNfc, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type NdefRecord = { recordType?: string; data?: string | DataView | ArrayBuffer; encoding?: string };
type NdefReadingEvent = Event & { message: { records: NdefRecord[] } };
type NdefReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (name: "reading", listener: (event: NdefReadingEvent) => void) => void;
};
type NdefReaderWindow = Window & typeof globalThis & { NDEFReader?: new () => NdefReaderLike };

function getNfcToken(record: NdefRecord) {
  const raw = typeof record.data === "string"
    ? record.data
    : record.data instanceof DataView
      ? new TextDecoder(record.encoding || "utf-8").decode(record.data)
      : record.data instanceof ArrayBuffer
        ? new TextDecoder(record.encoding || "utf-8").decode(new DataView(record.data))
        : "";
  try {
    const url = new URL(raw);
    return url.searchParams.get("nfc")?.trim() || "";
  } catch {
    return "";
  }
}

export function MobileNfcTransportInvoice({ open, onOpenChange, initialToken }: { open: boolean; onOpenChange: (open: boolean) => void; initialToken?: string }) {
  const utils = trpc.useUtils();
  const [token, setToken] = useState(initialToken?.trim() || "");
  const [routePresetId, setRoutePresetId] = useState("");
  const [scanStatus, setScanStatus] = useState(initialToken ? "已从车辆卡安全链接读取车辆信息。" : "正在等待车辆卡靠近手机…");
  const [successResult, setSuccessResult] = useState<{ stage: "in_transit" | "completed"; tripNo: string } | null>(null);
  const [operationError, setOperationError] = useState("");
  const [readerState, setReaderState] = useState<"checking" | "ready" | "unsupported" | "blocked" | "waiting">("checking");
  const [scanAttempt, setScanAttempt] = useState(0);
  const scanTokenRef = useRef("");
  const announce = (message: string) => {
    if (!("speechSynthesis" in window)) return toast.info("当前浏览器不支持语音播报，请查看大字号成功提示");
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const speech = new SpeechSynthesisUtterance(message);
    speech.lang = "zh-CN";
    speech.rate = 0.8;
    speech.volume = 1;
    window.setTimeout(() => window.speechSynthesis.speak(speech), 80);
  };
  const preview = trpc.transport.previewMobileNfcInvoice.useQuery({ token }, { enabled: open && Boolean(token), retry: false });
  const issue = trpc.transport.confirmMobileNfcInvoice.useMutation({
    onSuccess: async result => {
      const successMessage = result.stage === "in_transit" ? "发票成功，车辆已发车，请前往卸土点。" : "卸土成功，本趟运输已完成。";
      setSuccessResult({ stage: result.stage, tripNo: result.tripNo });
      toast.success(successMessage);
      announce(successMessage);
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
      setScanStatus(result.stage === "in_transit" ? `开票成功，运单号 ${result.tripNo}；服务号通知已进入投递队列。` : `卸土闭环成功，运单号 ${result.tripNo}；服务号通知已进入投递队列。`);
    },
    onError: error => {
      const guidance = error.message.includes("卸土点未配置定位坐标")
        ? "卸土点未配置定位坐标，当前不能安全确认卸土。请由 PC 超级管理员进入“运输管理 → 装卸土点与既有路线编辑”，点击对应卸土点的“补录坐标”，填写中文地址、纬度和经度后重新刷卡确认。"
        : error.message;
      setOperationError(guidance);
      toast.error(guidance);
    },
  });

  useEffect(() => {
    if (!open) return;
    scanTokenRef.current = "";
    setToken(initialToken?.trim() || "");
    setRoutePresetId("");
    setSuccessResult(null);
    setOperationError("");
    setReaderState("checking");
    setScanStatus(initialToken ? "已从车辆卡安全链接读取车辆信息。" : "正在等待车辆卡靠近手机…");
  }, [initialToken, open]);

  useEffect(() => {
    if (!open || !successResult) return;
    const resetTimer = window.setTimeout(() => {
      scanTokenRef.current = "";
      setSuccessResult(null);
      setToken("");
      setRoutePresetId("");
      setScanStatus("本次开票已完成，请贴下一张已启用车辆卡…");
    }, 3_000);
    return () => window.clearTimeout(resetTimer);
  }, [open, successResult]);

  useEffect(() => {
    if (!open) return;
    const Reader = (window as NdefReaderWindow).NDEFReader;
    if (!Reader) {
      setReaderState("unsupported");
      setScanStatus("当前浏览器不支持页面内读卡；请使用 Android Chrome，或直接触碰车辆卡通过安全链接打开本页。");
      return;
    }
    setReaderState("waiting");
    const controller = new AbortController();
    const reader = new Reader();
    const onReading = (event: NdefReadingEvent) => {
      const nextToken = event.message.records.map(getNfcToken).find(Boolean) || "";
      if (!nextToken) return;
      if (nextToken === scanTokenRef.current) {
        void utils.transport.previewMobileNfcInvoice.invalidate({ token: nextToken });
        setScanStatus("已重新读取车辆卡，正在刷新车辆与在途状态…");
        return;
      }
      scanTokenRef.current = nextToken;
      setToken(nextToken);
      setRoutePresetId("");
      setSuccessResult(null);
      setOperationError("");
      setScanStatus("车辆卡已读取，正在核验车辆身份与当前在途状态…");
      void utils.transport.previewMobileNfcInvoice.invalidate({ token: nextToken });
    };
    reader.addEventListener("reading", onReading);
    void reader.scan({ signal: controller.signal }).then(() => {
      setReaderState("ready");
      setScanStatus("页面内读卡已启动，请将已启用的车辆卡贴近手机。若 10 秒无反应，可点“重新启动读卡”。");
    }).catch(() => {
      setReaderState("blocked");
      setScanStatus("无法启动页面内读卡；请使用 Android Chrome 并允许 NFC 权限，或直接触碰车辆卡通过安全链接打开本页。");
    });
    return () => controller.abort();
  }, [open, scanAttempt, utils.transport.previewMobileNfcInvoice]);

  useEffect(() => {
    if (!preview.data?.routes?.length || preview.data.activeTrip) return;
    const preferred = preview.data.routes.find(route => route.isDefault) ?? preview.data.routes[0];
    setRoutePresetId(String(preferred.id));
  }, [preview.data]);

  const submit = async () => {
    if (!token || !preview.data) return;
    setOperationError("");
    if (!preview.data.activeTrip && !routePresetId) return toast.error("请先选择运输线路");
    if ("speechSynthesis" in window) window.speechSynthesis.resume();
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (preview.data.activeTrip) {
      if (!navigator.geolocation) return toast.error("当前设备无法获取定位，不能确认已到达卸土点");
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 }));
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } catch {
        return toast.error("未取得卸土定位，不能确认已到达卸土点。请允许定位权限后重试");
      }
    }
    issue.mutate({ token, routePresetId: preview.data.activeTrip ? undefined : Number(routePresetId), idempotencyKey: `mobile-nfc-${crypto.randomUUID()}`, latitude, longitude, occurredAt: new Date().toISOString() });
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md border-[#8eb6c7] bg-[#f4fbfe]"><DialogHeader><DialogTitle className="flex items-center gap-2 text-[#194d64]"><Radio className="h-5 w-5" />刷 NFC 卡发票</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-xs leading-5 text-[#38677a]">页面已打开时会自动等待车辆卡。将已启用的卡贴近手机即可读取车辆信息；无需点击开始扫描。</p>{successResult ? <div aria-live="assertive" className="rounded-2xl border-2 border-[#4f875a] bg-[#eef9ee] px-4 py-5 text-center text-[#1f5f30]"><p className="text-3xl font-black tracking-wide">{successResult.stage === "in_transit" ? "发票成功" : "卸土成功"}</p><p className="mt-3 text-lg font-bold">{successResult.stage === "in_transit" ? "车辆已发车，请前往卸土点" : "本趟运输已完成闭环"}</p><p className="mt-2 text-sm font-semibold">运单号：{successResult.tripNo}</p><Button variant="outline" className="mt-4 border-[#4f875a] bg-white text-[#1f5f30]" onClick={() => announce(successResult.stage === "in_transit" ? "发票成功，车辆已发车，请前往卸土点。" : "卸土成功，本趟运输已完成。")} >播放成功语音</Button></div> : null}<Card className="border-[#b4d0db] bg-white"><CardContent className="p-3"><div className="flex items-start gap-2"><SmartphoneNfc className={`mt-0.5 h-4 w-4 shrink-0 ${readerState === "ready" ? "text-[#2f8051]" : "text-[#286f8f]"}`} /><div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#24546b]">{scanStatus}</p><p className="mt-1 text-[11px] text-[#658495]">{readerState === "ready" ? "已启动 Android Chrome 页面内读卡。" : readerState === "unsupported" ? "当前浏览器不支持 Web NFC 页面内读取。" : readerState === "blocked" ? "NFC 权限未授权或被浏览器拦截。" : "正在检查 NFC 能力…"}</p></div></div>{(readerState === "blocked" || readerState === "ready") ? <Button type="button" variant="outline" size="sm" className="mt-3 w-full border-[#a9ccd9] text-[#24546b]" onClick={() => { setToken(""); setRoutePresetId(""); setOperationError(""); scanTokenRef.current = ""; setScanAttempt(value => value + 1); }}><RotateCw className="mr-1 h-3.5 w-3.5" />重新启动读卡</Button> : null}{preview.isLoading ? <p className="mt-2 text-xs text-[#658495]">正在核验卡片签名…</p> : null}{preview.error ? <p className="mt-2 text-xs text-[#9c4d27]">车辆卡不能开票：{preview.error.message}</p> : null}{operationError ? <div role="alert" className="mt-3 rounded-xl border border-[#c56632] bg-[#fff6ed] px-3 py-3 text-sm leading-6 text-[#824b2a]"><p className="font-bold">本次卸土未完成</p><p className="mt-1">{operationError}</p></div> : null}{preview.data ? <div className="mt-3 space-y-2"><div className="rounded-xl bg-[#edf7fb] p-3"><div className="flex items-center gap-2 text-[#194d64]"><Truck className="h-4 w-4" /><p className="font-semibold">{preview.data.vehicle.plateNo}</p></div><p className="mt-1 text-xs text-[#527487]">司机：{preview.data.vehicle.driverName || "未录入"}{preview.data.vehicle.driverPhoneMasked ? ` · ${preview.data.vehicle.driverPhoneMasked}` : ""}</p></div>{preview.data.activeTrip ? <div className="rounded-xl border-2 border-[#c56632] bg-[#fff6ed] p-3 text-sm text-[#824b2a]"><p className="font-bold">该车还未卸土，不能开具新发票</p><p className="mt-1 font-semibold">当前在途运单：{preview.data.activeTrip.tripNo}</p><p className="mt-1 text-xs">路线：{preview.data.activeTrip.loadSiteName} → {preview.data.activeTrip.unloadSiteName}</p><p className="mt-2 text-xs">请在卸土点确认卸土闭环后，才能开具下一张发票。</p></div> : <><Select value={routePresetId} onValueChange={setRoutePresetId}><SelectTrigger className="border-[#a9ccd9]"><SelectValue placeholder="选择运输线路" /></SelectTrigger><SelectContent>{preview.data.routes.map(route => <SelectItem key={route.id} value={String(route.id)}>{route.isDefault ? "默认 · " : ""}{route.loadSiteName} → {route.unloadSiteName} · {route.distanceKm} km</SelectItem>)}</SelectContent></Select>{!preview.data.routes.length ? <p className="text-xs text-[#9c4d27]">该项目尚未配置可用运输线路，不能开具发票。</p> : null}</>}<Button className="w-full bg-[#286f8f] text-base font-bold hover:bg-[#1d5972]" disabled={issue.isPending || (!preview.data.activeTrip && (!routePresetId || !preview.data.routes.length))} onClick={submit}><CircleCheck className="mr-1 h-4 w-4" />{issue.isPending ? "正在保存并开票…" : preview.data.activeTrip ? "确认卸土闭环" : "保存并开具发票"}</Button></div> : null}</CardContent></Card></div></DialogContent></Dialog>;
}
