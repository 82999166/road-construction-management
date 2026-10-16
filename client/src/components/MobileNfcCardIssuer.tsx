import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { CreditCard, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type NdefWriterLike = { write: (message: { records: Array<{ recordType: "url" | "text"; data: string }> }) => Promise<void> };
type NdefWindow = Window & typeof globalThis & { NDEFWriter?: new () => NdefWriterLike };

export function MobileNfcCardIssuer({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const candidates = trpc.transport.listMobileNfcInitialIssueCandidates.useQuery({ projectId }, { enabled: Boolean(projectId), retry: false });
  const [vehicleId, setVehicleId] = useState("");
  const eligibleVehicles = useMemo(() => (candidates.data ?? []).filter(vehicle => vehicle.eligible), [candidates.data]);
  const blockedVehicles = useMemo(() => (candidates.data ?? []).filter(vehicle => !vehicle.eligible), [candidates.data]);
  const selectedVehicle = useMemo(() => eligibleVehicles.find(vehicle => String(vehicle.id) === vehicleId) ?? null, [eligibleVehicles, vehicleId]);
  useEffect(() => {
    if (!eligibleVehicles.length) {
      if (vehicleId) setVehicleId("");
      return;
    }
    if (!eligibleVehicles.some(vehicle => String(vehicle.id) === vehicleId)) setVehicleId(String(eligibleVehicles[0].id));
  }, [eligibleVehicles, vehicleId]);
  const prepare = trpc.transport.prepareMobileNfcInitialIssue.useMutation({ onError: error => toast.error(getUserFacingErrorMessage(error, "手机发卡未完成，请稍后重试")) });
  const confirm = trpc.transport.confirmRfidCardWrite.useMutation({ onError: error => toast.error(getUserFacingErrorMessage(error, "手机发卡未完成，请稍后重试")) });

  async function issue() {
    if (!selectedVehicle) return toast.error("请先选择待首次发卡的车辆");
    const Writer = (window as NdefWindow).NDEFWriter;
    if (!Writer) return toast.error("当前手机浏览器不支持 Web NFC 发卡，请使用 Android Chrome 或保留拍车牌方式");
    try {
      const task = await prepare.mutateAsync({ projectId, vehicleId: selectedVehicle.id });
      const writer = new Writer();
      await writer.write({ records: [
        { recordType: "url", data: task.nfcEntryUrl },
        { recordType: "text", data: JSON.stringify(task.payload) },
      ] });
      await confirm.mutateAsync({ id: task.jobId, projectId, success: true });
      await Promise.all([utils.transport.listMobileNfcInitialIssueCandidates.invalidate(), utils.transport.listVehicleRfidCards.invalidate(), utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
      toast.success(`车辆 ${selectedVehicle.plateNo} 已完成首次发卡（${task.cardCode}）；后续装土、卸土只需手机触碰读卡`);
    } catch (error) {
      const message = getUserFacingErrorMessage(error, "手机发卡未完成，请稍后重试");
      toast.error(message);
    }
  }

  const nfcSupported = typeof window !== "undefined" && Boolean((window as NdefWindow).NDEFWriter);
  const selectionDisabled = !projectId || candidates.isLoading || Boolean(candidates.error) || !eligibleVehicles.length;
  return <Card className="border border-[#80a7b8] bg-[#eef8fb] print:hidden"><CardContent className="p-4"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#256a88]" /><div className="min-w-0 flex-1"><p className="font-semibold text-[#194d64]">手机 NFC 首次发卡</p><p className="mt-1 text-xs leading-5 text-[#38677a]">全新空白 NTAG216 不需要预先绑定。选择已录入司机姓名和手机号的车辆后，贴近新卡一次即可完成系统卡号生成、签名写入和车辆绑定；后续装土和卸土均仅读卡。</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><Select value={vehicleId || undefined} onValueChange={setVehicleId} disabled={selectionDisabled}><SelectTrigger className="border-[#a9ccd9] bg-white"><SelectValue placeholder={!projectId ? "请先在页面顶部选择项目" : candidates.isLoading ? "正在读取待发卡车辆…" : candidates.error ? "车辆发卡资格读取失败" : "选择待首次发卡车辆"} /></SelectTrigger><SelectContent>{eligibleVehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo} · {vehicle.driverName} · 可首次发卡</SelectItem>)}</SelectContent></Select><Button className="bg-[#256a88] hover:bg-[#1d5972]" disabled={!selectedVehicle || !nfcSupported || prepare.isPending || confirm.isPending} onClick={() => void issue()}><Radio className="mr-1 h-4 w-4" />{prepare.isPending || confirm.isPending ? "正在发卡…" : "贴卡首次发卡"}</Button></div>{candidates.error ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#9c4d27]"><span>无法读取待发卡车辆：{getUserFacingErrorMessage(candidates.error, "暂无法读取待发卡车辆，请稍后重试")}</span><Button type="button" size="sm" variant="outline" className="h-7 border-[#c88960] px-2 text-xs" onClick={() => void candidates.refetch()}>重新读取</Button></div> : null}{!candidates.isLoading && !candidates.error && !eligibleVehicles.length ? <div className="mt-2 rounded-lg border border-[#edd1b5] bg-[#fff9f2] p-2 text-xs leading-5 text-[#8d4d28]"><p className="font-medium">当前没有可首次发卡的车辆：</p>{blockedVehicles.length ? <div className="mt-1 space-y-1">{blockedVehicles.map(vehicle => <p key={vehicle.id}>{vehicle.plateNo}：{getUserFacingErrorMessage(vehicle.reason, "当前车辆暂不符合首次发卡条件")}</p>)}</div> : <p className="mt-1">请先在车辆台账新增车辆，并录入外部司机姓名和手机号。</p>}</div> : null}{!nfcSupported ? <p className="mt-2 text-xs text-[#9c4d27]">当前浏览器不支持 Web NFC。请使用 Android Chrome；其他手机可继续拍车牌发票。</p> : null}</div></div></CardContent></Card>;
}
