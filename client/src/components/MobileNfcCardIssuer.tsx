import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { CreditCard, Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type NdefWriterLike = { write: (message: { records: Array<{ recordType: "url" | "text"; data: string }> }) => Promise<void> };
type NdefWindow = Window & typeof globalThis & { NDEFWriter?: new () => NdefWriterLike };

export function MobileNfcCardIssuer({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const cards = trpc.transport.listVehicleRfidCards.useQuery({ projectId }, { enabled: Boolean(projectId), retry: false });
  const [cardId, setCardId] = useState("");
  const selectedCard = useMemo(() => cards.data?.find(card => String(card.id) === cardId) ?? null, [cardId, cards.data]);
  const prepare = trpc.transport.prepareRfidCardWrite.useMutation({ onError: error => toast.error(error.message) });
  const confirm = trpc.transport.confirmRfidCardWrite.useMutation({ onError: error => toast.error(error.message) });

  async function issue() {
    if (!selectedCard) return toast.error("请先选择已绑定的车辆卡");
    const Writer = (window as NdefWindow).NDEFWriter;
    if (!Writer) return toast.error("当前手机浏览器不支持 Web NFC 发卡，请使用 Android Chrome 或保留拍车牌方式");
    try {
      const task = await prepare.mutateAsync({ projectId, cardId: selectedCard.id, writerDeviceId: null, action: selectedCard.lastWrittenAt ? "rewrite" : "issue" });
      const writer = new Writer();
      await writer.write({ records: [
        { recordType: "url", data: task.nfcEntryUrl },
        { recordType: "text", data: JSON.stringify(task.payload) },
      ] });
      await confirm.mutateAsync({ id: task.jobId, projectId, success: true });
      await Promise.all([utils.transport.listVehicleRfidCards.invalidate(), utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
      toast.success(`车辆 ${selectedCard.plateNo} 发卡成功；后续装土、卸土只需手机触碰读卡`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "手机发卡失败";
      toast.error(message);
    }
  }

  const nfcSupported = typeof window !== "undefined" && Boolean((window as NdefWindow).NDEFWriter);
  return <Card className="border border-[#80a7b8] bg-[#eef8fb] print:hidden"><CardContent className="p-4"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#256a88]" /><div className="min-w-0 flex-1"><p className="font-semibold text-[#194d64]">手机 NFC 发卡</p><p className="mt-1 text-xs leading-5 text-[#38677a]">每张车辆卡首次绑定后只需发卡一次。手机将写入车牌、司机姓名、联系电话、签名身份与受控票据网址；后续装土和卸土均仅读卡。</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><Select value={cardId} onValueChange={setCardId}><SelectTrigger className="border-[#a9ccd9] bg-white"><SelectValue placeholder="选择已绑定车辆卡" /></SelectTrigger><SelectContent>{cards.data?.filter(card => card.status === "active").map(card => <SelectItem key={card.id} value={String(card.id)}>{card.plateNo} · 卡 {card.cardUidMasked} · {card.lastWrittenAt ? "补写" : "首次发卡"}</SelectItem>)}</SelectContent></Select><Button className="bg-[#256a88] hover:bg-[#1d5972]" disabled={!selectedCard || !nfcSupported || prepare.isPending || confirm.isPending} onClick={() => void issue()}><Radio className="mr-1 h-4 w-4" />{prepare.isPending || confirm.isPending ? "正在发卡…" : "手机发卡"}</Button></div>{!nfcSupported ? <p className="mt-2 text-xs text-[#9c4d27]">当前浏览器不支持 Web NFC。请使用 Android Chrome；其他手机可继续拍车牌发票。</p> : null}</div></div></CardContent></Card>;
}
