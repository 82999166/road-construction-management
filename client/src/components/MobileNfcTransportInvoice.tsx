import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { collectUnloadLocation } from "@/lib/transportUnloadLocation";
import { CircleCheck, Radio, RotateCw, SmartphoneNfc, Truck, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type NdefRecord = { recordType?: string; data?: string | DataView | ArrayBuffer; encoding?: string };
type NdefReadingEvent = Event & { message: { records: NdefRecord[] } };
type NdefReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (name: "reading", listener: (event: NdefReadingEvent) => void) => void;
};
type NdefReaderWindow = Window & typeof globalThis & { NDEFReader?: new () => NdefReaderLike };

function formatVehicleStageReceipt(plateNo: string | null | undefined, dailyVehicleTripOrdinal: number | null | undefined, eventType: "load" | "unload") {
  const ordinal = dailyVehicleTripOrdinal ?? 0;
  if (!plateNo || !Number.isInteger(ordinal) || ordinal < 1) return null;
  return `车牌 ${plateNo}，今日第 ${ordinal} 车${eventType === "load" ? "装土" : "卸土"}成功`;
}

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

export function MobileNfcTransportInvoice({ open, onOpenChange, initialToken, expectedUnloadTripId }: { open: boolean; onOpenChange: (open: boolean) => void; initialToken?: string; expectedUnloadTripId?: number }) {
  const utils = trpc.useUtils();
  const [token, setToken] = useState(initialToken?.trim() || "");
  const [routePresetId, setRoutePresetId] = useState("");
  const [scanStatus, setScanStatus] = useState(initialToken ? "已从车辆卡安全链接读取车辆信息。" : "正在等待车辆卡靠近手机…");
  const [successResult, setSuccessResult] = useState<{ stage: "in_transit" | "completed"; tripNo: string; singleScanClosed: boolean; vehiclePlateNo: string | null; dailyVehicleTripOrdinal: number | null } | null>(null);
  const [operationError, setOperationError] = useState("");
  const [readerState, setReaderState] = useState<"checking" | "ready" | "unsupported" | "blocked" | "waiting">("checking");
  const [speechStatus, setSpeechStatus] = useState("");
  const scanTokenRef = useRef("");
  const automaticUnloadTokenRef = useRef("");
  const scanControllerRef = useRef<AbortController | null>(null);

  const announce = (message: string) => {
    if (!("speechSynthesis" in window)) {
      setSpeechStatus("当前浏览器不支持语音播报，请查看页面大字号结果。");
      toast.info("当前浏览器不支持语音播报，请查看大字号成功提示");
      return;
    }
    const synthesizer = window.speechSynthesis;
    synthesizer.cancel();
    synthesizer.resume();
    const speech = new SpeechSynthesisUtterance(message);
    speech.lang = "zh-CN";
    speech.rate = 0.8;
    speech.volume = 1;
    speech.pitch = 1;
    const chineseVoice = synthesizer.getVoices().find(voice => voice.lang.toLowerCase().startsWith("zh"));
    if (chineseVoice) speech.voice = chineseVoice;
    speech.onstart = () => setSpeechStatus("正在播报…");
    speech.onend = () => setSpeechStatus("语音播报完成。");
    speech.onerror = () => {
      setSpeechStatus("自动播报被手机系统拦截，请点击“播放成功语音”重试，并检查手机媒体音量。");
      toast.info("自动播报被手机系统拦截，请点击“播放成功语音”重试，并检查手机媒体音量");
    };
    window.setTimeout(() => {
      synthesizer.speak(speech);
      window.setTimeout(() => synthesizer.resume(), 120);
    }, 80);
  };

  const unlockSpeech = () => {
    if (!("speechSynthesis" in window)) return;
    const synthesizer = window.speechSynthesis;
    synthesizer.cancel();
    synthesizer.resume();
    const primer = new SpeechSynthesisUtterance(" ");
    primer.lang = "zh-CN";
    primer.volume = 0;
    synthesizer.speak(primer);
  };

  const testSpeech = () => {
    setSpeechStatus("正在测试手机语音…");
    unlockSpeech();
    window.setTimeout(() => announce("语音测试正常，刷卡发票成功后将自动播报。"), 60);
  };

  /**
   * Chrome 要求 NDEFReader.scan() 直接由点击等用户手势触发；不能在弹窗打开后的副作用中自动调用。
   * 正式车辆卡直接触碰时，Android 会先按卡内 HTTPS 链接打开本页；此按钮用于已在页面内继续刷卡的场景。
   */
  const startNfcScan = () => {
    const Reader = (window as NdefReaderWindow).NDEFReader;
    if (!Reader) {
      setReaderState("unsupported");
      setScanStatus("当前浏览器不支持页面内读卡；请使用 Android Chrome，或直接触碰车辆卡通过安全链接打开本页。");
      return;
    }
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    scanControllerRef.current = controller;
    const reader = new Reader();
    const onReading = (event: NdefReadingEvent) => {
      const nextToken = event.message.records.map(getNfcToken).find(Boolean) || "";
      if (!nextToken) {
        setOperationError("未读取到有效车辆卡入口。请确认使用的是已完成正式写入的车辆卡，不要使用测试卡或空白卡。");
        setScanStatus("当前卡不是有效车辆卡，请更换已正式写入的车辆卡后重试。");
        return;
      }
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
    setReaderState("checking");
    setScanStatus("正在请求 Android Chrome 的 NFC 权限，请在系统提示中允许…");
    // 必须保持在按钮点击调用栈内，不能挪入 useEffect 或等待异步操作后再执行。
    void reader.scan({ signal: controller.signal }).then(() => {
      if (controller.signal.aborted) return;
      setReaderState("ready");
      setScanStatus("页面内读卡已启动，请将已启用的车辆卡贴近手机。");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setReaderState("blocked");
      setScanStatus("无法启动页面内读卡。请确认使用 Android Chrome、手机 NFC 已开启，并在系统提示中允许 NFC 权限；也可直接触碰车辆卡打开安全链接。");
    });
  };

  const preview = trpc.transport.previewMobileNfcInvoice.useQuery({ token }, { enabled: open && Boolean(token), retry: false });
  const issue = trpc.transport.confirmMobileNfcInvoice.useMutation({
    onSuccess: async result => {
      const singleScanClosed = Boolean(result.singleScanClosed);
      const eventType = result.stage === "in_transit" || singleScanClosed ? "load" : "unload";
      const vehiclePlateNo = "vehiclePlateNo" in result ? result.vehiclePlateNo ?? null : null;
      const dailyVehicleTripOrdinal = "dailyVehicleTripOrdinal" in result ? result.dailyVehicleTripOrdinal ?? null : null;
      const receiptText = formatVehicleStageReceipt(vehiclePlateNo, dailyVehicleTripOrdinal, eventType) ?? (eventType === "load" ? "装土成功" : "卸土成功");
      const successMessage = result.stage === "in_transit"
        ? `${receiptText}，车辆已发车，请前往卸土点。`
        : singleScanClosed
          ? `${receiptText}，本趟已按单次刷卡完成闭环，等待核验。`
          : `${receiptText}，本趟运输已完成。`;
      setSuccessResult({ stage: result.stage, tripNo: result.tripNo, singleScanClosed, vehiclePlateNo, dailyVehicleTripOrdinal });
      toast.success(successMessage);
      announce(successMessage);
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
      setScanStatus(result.stage === "in_transit"
        ? `开票成功，运单号 ${result.tripNo}；服务号通知已进入投递队列。`
        : singleScanClosed
          ? `单次刷卡闭环完成，运单号 ${result.tripNo}；已进入待核验状态。`
          : `卸土闭环成功，运单号 ${result.tripNo}；服务号通知已进入投递队列。`);
    },
    onError: error => {
      const guidance = error.message.includes("卸土点中文详细地址尚未完成地图定位校验")
        ? "该卸土点的中文详细地址尚未完成地图定位校验，当前不能安全确认卸土。请由 PC 超级管理员进入“运输管理 → 装卸土点与运输路线配置”，点击对应卸土点的“补录详细地址”，补全省、市、区县、道路/桩号或地标后保存，再重新刷卡确认。"
        : getUserFacingErrorMessage(error, "刷卡确认未完成，请稍后重试");
      setOperationError(guidance);
      toast.error(guidance);
    },
  });

  useEffect(() => {
    if (!open) return;
    scanTokenRef.current = "";
    automaticUnloadTokenRef.current = "";
    scanControllerRef.current?.abort();
    scanControllerRef.current = null;
    setToken(initialToken?.trim() || "");
    setRoutePresetId("");
    setSuccessResult(null);
    setOperationError("");
    setReaderState("checking");
    setSpeechStatus("");
    setScanStatus(initialToken ? "已从车辆卡安全链接读取车辆信息。" : "正在等待车辆卡靠近手机…");
  }, [initialToken, open]);

  useEffect(() => {
    if (!open || !successResult) return;
    const resetTimer = window.setTimeout(() => {
      scanTokenRef.current = "";
      setSuccessResult(null);
      setToken("");
      setRoutePresetId("");
      setSpeechStatus("");
      setScanStatus("本次开票已完成。可继续贴下一张卡；若页面内读卡尚未启动，请先点击“开始读取车辆卡”。");
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
    setScanStatus(initialToken
      ? "已从车辆卡安全链接读取车辆信息；如需继续在页面内读下一张卡，请点击“开始读取车辆卡”。"
      : "请点击“开始读取车辆卡”后再贴卡；首次会由 Android Chrome 请求 NFC 权限。");
    return () => {
      scanControllerRef.current?.abort();
      scanControllerRef.current = null;
    };
  }, [initialToken, open]);

  useEffect(() => {
    if (!preview.data?.routes?.length || preview.data.activeTrip) return;
    const preferred = preview.data.routes.find(route => route.isDefault) ?? preview.data.routes[0];
    setRoutePresetId(String(preferred.id));
  }, [preview.data]);

  const submit = async () => {
    if (expectedUnloadTripId && preview.data?.activeTrip?.id !== expectedUnloadTripId) {
      const message = "所刷车辆卡与待卸土运单不一致，请刷本运单对应的车辆卡。";
      setOperationError(message);
      toast.error(message);
      return;
    }
    if (!token || !preview.data) return;
    setOperationError("");
    if (!preview.data.activeTrip && !routePresetId) return toast.error("请先选择运输线路");
    unlockSpeech();
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (preview.data.activeTrip) {
      const location = await collectUnloadLocation(navigator.geolocation, 0);
      latitude = location?.latitude;
      longitude = location?.longitude;
      if (!location) toast.info("未取得卸土定位，正在按地点规则提交核验；定位硬拦截开启时不能确认已到达卸土点，关闭时会留提示待核验。");
    }
    issue.mutate({ token, expectedUnloadTripId, routePresetId: preview.data.activeTrip ? undefined : Number(routePresetId), idempotencyKey: `mobile-nfc-${crypto.randomUUID()}`, latitude, longitude, occurredAt: new Date().toISOString() });
  };

  const autoConfirmUnload = async () => {
    if (!token || !preview.data?.activeTrip) return;
    if (expectedUnloadTripId && preview.data.activeTrip.id !== expectedUnloadTripId) {
      setOperationError("所刷车辆卡与待卸土运单不一致，请刷本运单对应的车辆卡。");
      return;
    }
    setOperationError("");
    setScanStatus("已识别为卸土点补刷卡，正在核验最短运输时间与现场定位…");
    unlockSpeech();
    const location = await collectUnloadLocation(navigator.geolocation, 0);
    if (!location) toast.info("未取得卸土定位，正在提交服务端核验；定位硬拦截开启时不会自动确认卸土，关闭时会留提示待核验。");
    issue.mutate({ token, expectedUnloadTripId, idempotencyKey: `mobile-nfc-unload-${crypto.randomUUID()}`, latitude: location?.latitude, longitude: location?.longitude, occurredAt: new Date().toISOString() });
  };

  const unloadOnlyAutoClose = Boolean(preview.data?.activeTrip?.unloadOnlyCloseEnabled);

  useEffect(() => {
    if (!open || !token || !unloadOnlyAutoClose || issue.isPending || successResult || automaticUnloadTokenRef.current === token) return;
    automaticUnloadTokenRef.current = token;
    void autoConfirmUnload();
  }, [open, token, unloadOnlyAutoClose, issue.isPending, successResult]);

  const successEventType = successResult?.stage === "in_transit" || successResult?.singleScanClosed ? "load" : "unload";
  const successReceiptText = successResult ? formatVehicleStageReceipt(successResult.vehiclePlateNo, successResult.dailyVehicleTripOrdinal, successEventType) : null;
  const successMessage = successResult?.stage === "in_transit"
    ? `${successReceiptText ?? "装土成功"}，车辆已发车，请前往卸土点。`
    : successResult?.singleScanClosed
      ? `${successReceiptText ?? "装土成功"}，本趟已按单次刷卡完成闭环，等待核验。`
      : `${successReceiptText ?? "卸土成功"}，本趟运输已完成闭环。`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[#8eb6c7] bg-[#f4fbfe]">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-[#194d64]"><Radio className="h-5 w-5" />{unloadOnlyAutoClose ? "正在确认卸土刷卡" : expectedUnloadTripId ? "刷卡卸土" : "刷 NFC 卡发票"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs leading-5 text-[#38677a]">页面内读取车辆卡前，请先点击“开始读取车辆卡”。已写入 HTTPS 安全链接的车辆卡也可直接触碰手机，由 Android 自动打开本页。</p>
          <Button type="button" variant="outline" size="sm" className="w-full border-[#a9ccd9] bg-white text-[#24546b]" onClick={testSpeech}>
            <Volume2 className="mr-1 h-4 w-4" />测试语音播报（不提交发票）
          </Button>
          {speechStatus && !successResult ? <p aria-live="polite" className="text-xs text-[#527487]">{speechStatus}</p> : null}

          {successResult ? (
            <div aria-live="assertive" className="rounded-2xl border-2 border-[#4f875a] bg-[#eef9ee] px-4 py-5 text-center text-[#1f5f30]">
              <p className="text-2xl font-black tracking-wide">{successReceiptText ?? (successResult.stage === "in_transit" ? "装土成功" : successResult.singleScanClosed ? "单次刷卡闭环完成" : "卸土成功")}</p>
              <p className="mt-3 text-lg font-bold">{successResult.stage === "in_transit" ? "车辆已发车，请前往卸土点" : successResult.singleScanClosed ? "本趟运输已进入待核验状态" : "本趟运输已完成闭环"}</p>
              <p className="mt-2 text-sm font-semibold">运单号：{successResult.tripNo}</p>
              <Button variant="outline" className="mt-4 border-[#4f875a] bg-white text-[#1f5f30]" onClick={() => announce(successMessage)}>播放成功语音</Button>
              {speechStatus ? <p aria-live="polite" className="mt-2 text-xs font-medium">{speechStatus}</p> : null}
            </div>
          ) : null}

          <Card className="border-[#b4d0db] bg-white">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <SmartphoneNfc className={`mt-0.5 h-4 w-4 shrink-0 ${readerState === "ready" ? "text-[#2f8051]" : "text-[#286f8f]"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#24546b]">{scanStatus}</p>
                  <p className="mt-1 text-[11px] text-[#658495]">{readerState === "ready" ? "已启动 Android Chrome 页面内读卡。" : readerState === "unsupported" ? "当前浏览器不支持 Web NFC 页面内读取。" : readerState === "blocked" ? "NFC 权限未授权或被浏览器拦截。" : "正在检查 NFC 能力…"}</p>
                </div>
              </div>
              {readerState !== "unsupported" ? (
                <Button type="button" variant="outline" size="sm" className="mt-3 w-full border-[#a9ccd9] text-[#24546b]" onClick={() => { setToken(""); setRoutePresetId(""); setOperationError(""); scanTokenRef.current = ""; startNfcScan(); }}>
                  <RotateCw className="mr-1 h-3.5 w-3.5" />{readerState === "ready" ? "重新启动读卡" : "开始读取车辆卡"}
                </Button>
              ) : null}
              {preview.isLoading ? <p className="mt-2 text-xs text-[#658495]">正在核验卡片签名…</p> : null}
              {preview.error ? <p className="mt-2 text-xs text-[#9c4d27]">车辆卡不能开票：{getUserFacingErrorMessage(preview.error, "暂无法核验车辆卡，请稍后重试")}</p> : null}
              {operationError ? <div role="alert" className="mt-3 rounded-xl border border-[#c56632] bg-[#fff6ed] px-3 py-3 text-sm leading-6 text-[#824b2a]"><p className="font-bold">本次操作未完成</p><p className="mt-1">{operationError}</p></div> : null}

              {preview.data ? (
                <div className="mt-3 space-y-2">
                  <div className="rounded-xl bg-[#edf7fb] p-3">
                    <div className="flex items-center gap-2 text-[#194d64]"><Truck className="h-4 w-4" /><p className="font-semibold">{preview.data.vehicle.plateNo}</p></div>
                    <p className="mt-1 text-xs text-[#527487]">司机：{preview.data.vehicle.driverName || "未录入"}{preview.data.vehicle.driverPhoneMasked ? ` · ${preview.data.vehicle.driverPhoneMasked}` : ""}</p>
                  </div>
                  {preview.data.activeTrip && unloadOnlyAutoClose ? (
                    <div aria-live="polite" className="rounded-xl border-2 border-[#4f875a] bg-[#eef9ee] p-3 text-sm text-[#1f5f30]">
                      <p className="font-bold">已按路线设置进入卸土刷卡流程</p>
                      <p className="mt-1 font-semibold">当前在途运单：{preview.data.activeTrip.tripNo}</p>
                      <p className="mt-1 text-xs">正在核验最短运输时间与卸土现场定位，核验通过后将直接显示卸土成功。</p>
                    </div>
                  ) : preview.data.activeTrip ? (
                    <div className="rounded-xl border-2 border-[#c56632] bg-[#fff6ed] p-3 text-sm text-[#824b2a]">
                      <p className="font-bold">该车还未卸土，不能开具新发票</p>
                      <p className="mt-1 font-semibold">当前在途运单：{preview.data.activeTrip.tripNo}</p>
                      <p className="mt-1 text-xs">路线：{preview.data.activeTrip.loadSiteName} → {preview.data.activeTrip.unloadSiteName}</p>
                      <p className="mt-2 text-xs">请在卸土点确认卸土闭环后，才能开具下一张发票。</p>
                    </div>
                  ) : (
                    <>
                      <Select value={routePresetId} onValueChange={setRoutePresetId}>
                        <SelectTrigger className="border-[#a9ccd9]"><SelectValue placeholder="选择运输线路" /></SelectTrigger>
                        <SelectContent>{preview.data.routes.map(route => <SelectItem key={route.id} value={String(route.id)}>{route.isDefault ? "默认 · " : ""}{route.loadSiteName} → {route.unloadSiteName} · {route.distanceKm} km</SelectItem>)}</SelectContent>
                      </Select>
                      {!preview.data.routes.length ? <p className="text-xs text-[#9c4d27]">该项目尚未配置可用运输线路，不能开具发票。</p> : null}
                    </>
                  )}
                  {!unloadOnlyAutoClose ? <Button className="w-full bg-[#286f8f] text-base font-bold hover:bg-[#1d5972]" disabled={issue.isPending || (!preview.data.activeTrip && (!routePresetId || !preview.data.routes.length))} onClick={submit}>
                    <CircleCheck className="mr-1 h-4 w-4" />{issue.isPending ? "正在保存并开票…" : preview.data.activeTrip ? "确认卸土闭环" : "保存并开具发票"}
                  </Button> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
