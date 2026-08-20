import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { CreditCard, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type NdefWriterLike = { write: (message: { records: Array<{ recordType: "url" | "text"; data: string }> }) => Promise<void> };
type NdefWindow = Window & typeof globalThis & { NDEFWriter?: new () => NdefWriterLike };

export function MobileNfcCardIssuer({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const vehicles = trpc.transport.listVehicles.useQuery({ projectId }, { enabled: Boolean(projectId), retry: false });
  const cards = trpc.transport.listVehicleRfidCards.useQuery({ projectId }, { enabled: Boolean(projectId), retry: false });
  const [vehicleId, setVehicleId] = useState("");
  const activeCardVehicleIds = useMemo(() => new Set((cards.data ?? []).filter(card => card.status === "active").map(card => card.vehicleId)), [cards.data]);
  const eligibleVehicles = useMemo(() => (vehicles.data ?? []).filter(vehicle => vehicle.status === "active" && Boolean(vehicle.driverName?.trim()) && Boolean(vehicle.driverPhone?.trim()) && !activeCardVehicleIds.has(vehicle.id)), [activeCardVehicleIds, vehicles.data]);
  const selectedVehicle = useMemo(() => eligibleVehicles.find(vehicle => String(vehicle.id) === vehicleId) ?? null, [eligibleVehicles, vehicleId]);
  useEffect(() => {
    if (!eligibleVehicles.length) {
      if (vehicleId) setVehicleId("");
      return;
    }
    if (!eligibleVehicles.some(vehicle => String(vehicle.id) === vehicleId)) setVehicleId(String(eligibleVehicles[0].id));
  }, [eligibleVehicles, vehicleId]);
  const prepare = trpc.transport.prepareMobileNfcInitialIssue.useMutation({ onError: error => toast.error(error.message) });
  const confirm = trpc.transport.confirmRfidCardWrite.useMutation({ onError: error => toast.error(error.message) });

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
      await Promise.all([utils.transport.listVehicleRfidCards.invalidate(), utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
      toast.success(`车辆 ${selectedVehicle.plateNo} 已完成首次发卡（${task.cardCode}）；后续装土、卸土只需手机触碰读卡`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "手机发卡失败";
      toast.error(message);
    }
  }

  const nfcSupported = typeof window !== "undefined" && Boolean((window as NdefWindow).NDEFWriter);
  return <Card className="border border-[#80a7b8] bg-[#eef8fb] print:hidden"><CardContent className="p-4"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#256a88]" /><div className="min-w-0 flex-1"><p className="font-semibold text-[#194d64]">手机 NFC 首次发卡</p><p className="mt-1 text-xs leading-5 text-[#38677a]">全新空白 NTAG216 不需要预先绑定。选择已录入司机姓名和手机号的车辆后，贴近新卡一次即可完成系统卡号生成、签名写入和车辆绑定；后续装土和卸土均仅读卡。</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><Select value={vehicleId} onValueChange={setVehicleId} disabled={vehicles.isLoading || cards.isLoading || !eligibleVehicles.length}><SelectTrigger className="border-[#a9ccd9] bg-white"><SelectValue placeholder={vehicles.isLoading || cards.isLoading ? "正在读取待发卡车辆…" : "选择待首次发卡车辆"} /></SelectTrigger><SelectContent>{eligibleVehicles.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo} · {vehicle.driverName} · 未发卡</SelectItem>)}</SelectContent></Select><Button className="bg-[#256a88] hover:bg-[#1d5972]" disabled={!selectedVehicle || !nfcSupported || prepare.isPending || confirm.isPending} onClick={() => void issue()}><Radio className="mr-1 h-4 w-4" />{prepare.isPending || confirm.isPending ? "正在发卡…" : "贴卡首次发卡"}</Button></div>{vehicles.error ? <p className="mt-2 text-xs text-[#9c4d27]">无法读取车辆台账：{vehicles.error.message}</p> : null}{cards.error ? <p className="mt-2 text-xs text-[#9c4d27]">无法读取车辆卡状态：{cards.error.message}</p> : null}{!vehicles.isLoading && !cards.isLoading && !vehicles.error && !cards.error && !eligibleVehicles.length ? <p className="mt-2 text-xs text-[#9c4d27]">当前没有可首次发卡的车辆。请先在车辆台账新增启用车辆并录入外部司机姓名、手机号；已有启用卡的车辆请使用车辆卡台账进行补写或更换。</p> : null}{!nfcSupported ? <p className="mt-2 text-xs text-[#9c4d27]">当前浏览器不支持 Web NFC。请使用 Android Chrome；其他手机可继续拍车牌发票。</p> : null}</div></div></CardContent></Card>;
}
