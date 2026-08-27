import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { formatChinaDateTime } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Bell, CheckCheck, ChevronRight, HardHat, Inbox, LayoutDashboard, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useState } from "react";
import { useAuth } from "../_core/hooks/useAuth";

/** 移动端底部导航只使用移动路由，避免从消息中心误跳至后台个人页。 */
export const MOBILE_BOTTOM_NAVIGATION = {
  workbench: "/mobile",
  profile: "/mobile/profile",
} as const;

/** 将服务器 UTC 时间统一转换为中国业务时区；没有时间时使用安全占位符。 */
function formatMessageTime(value: Date | string | null | undefined) {
  return formatChinaDateTime(value);
}

/**
 * 移动端站内消息中心。
 * 消息内容由服务端依据当前登录用户过滤，本页不接受也不传递可被篡改的收件人标识。
 */
export default function MobileMessagesPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const messages = trpc.messages.list.useQuery({ limit: 50 }, { enabled: isAuthenticated, retry: false });
  const pendingBroadcasts = trpc.broadcast.myPendingAcknowledgements.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const [selectedMessage, setSelectedMessage] = useState<NonNullable<typeof messages.data>[number] | null>(null);
  const markRead = trpc.messages.markRead.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.messages.list.invalidate(), utils.messages.unreadCount.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: () => toast.error("消息状态更新失败，请稍后重试"),
  });
  const acknowledgeBroadcast = trpc.broadcast.acknowledgeReceipt.useMutation({
    onSuccess: async result => {
      toast.success(result.alreadyAcknowledged ? "该通知已确认收到" : "已确认收到，回执已提交");
      await Promise.all([utils.broadcast.myPendingAcknowledgements.invalidate(), utils.messages.list.invalidate(), utils.messages.unreadCount.invalidate(), utils.mobile.workbench.invalidate()]);
    },
    onError: () => toast.error("确认回执提交失败，请稍后重试"),
  });

  if (loading || !isAuthenticated || messages.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && messages.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在同步业务消息…" title="消息中心" description="登录后可查看与您岗位、审批和业务单据相关的通知。" Icon={Bell} onRetry={() => { void refresh(); void messages.refetch(); }} />;

  function openMessage(message: NonNullable<typeof messages.data>[number]) {
    if (message.status !== "read") markRead.mutate({ id: message.id });
    setSelectedMessage(message);
  }

  return (
    <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
      <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
        <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-7 pt-6 text-[#fff7ea]">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[#c9854a]/20 blur-2xl" />
          <div className="relative flex items-center gap-3"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div><p className="text-sm font-semibold">悦信云智管</p><h1 className="mt-0.5 text-xl font-semibold">消息中心</h1></div></div>
          <p className="relative mt-4 text-xs leading-5 text-[#e8cfb2]">工资审核、实名核验与业务办理状态将以站内消息形式留痕提醒。</p>
        </header>

        <main className="space-y-3 px-5 py-5">
          {pendingBroadcasts.data?.map(item => <Card key={item.deliveryId} className="border-[#d7b06c] bg-[#fff8e8] shadow-[0_8px_22px_rgba(128,84,32,.09)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-semibold tracking-wide text-[#9b5d20]">群发通知 · 待确认</p><h2 className="mt-1 text-sm font-semibold text-[#5b321e]">{item.title}</h2><p className="mt-1.5 text-xs leading-5 text-[#805b42]">{item.content}</p><p className="mt-2 text-[11px] text-[#987154]">送达时间：{formatMessageTime(item.deliveredAt)}</p></div><Button size="sm" className="shrink-0 bg-[#8b4d23] text-white hover:bg-[#6f3d1e]" disabled={acknowledgeBroadcast.isPending} onClick={() => acknowledgeBroadcast.mutate({ deliveryId: Number(item.deliveryId) })}>{acknowledgeBroadcast.isPending ? "提交中…" : "确认收到"}</Button></div></CardContent></Card>)}
          {messages.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">消息暂时无法加载，请重新获取。<Button size="sm" variant="outline" className="ml-3 border-[#c9854a] text-[#7d421f]" onClick={() => messages.refetch()}>重新获取</Button></CardContent></Card> : null}
          {!messages.error && !messages.data?.length ? <Card className="overflow-hidden border-0 bg-[#fffaf3] shadow-[0_8px_22px_rgba(71,42,30,.07)]"><CardContent className="px-5 py-12 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#f6e6d2] text-[#a85e31]"><Inbox className="h-7 w-7" /></div><h2 className="mt-4 text-base font-semibold">暂时没有业务消息</h2><p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#765544]">当您提交工资条、收到审核结论或系统发现需处理事项时，消息会在此保留。</p></CardContent></Card> : null}
          {messages.data?.map(message => {
            const unread = message.status !== "read";
            return <button key={message.id} className="w-full text-left" onClick={() => openMessage(message)}><Card className={`border-0 transition-transform active:scale-[.99] ${unread ? "bg-white shadow-[0_8px_22px_rgba(71,42,30,.10)]" : "bg-[#fbf4ea] shadow-[0_5px_14px_rgba(71,42,30,.04)]"}`}><CardContent className="flex gap-3 p-4"><div className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${unread ? "bg-[#f4dfc3] text-[#9d5128]" : "bg-[#eee5da] text-[#8f7566]"}`}><Bell className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h2 className={`line-clamp-1 text-sm ${unread ? "font-semibold" : "font-medium"}`}>{message.title}</h2><span className="shrink-0 text-[11px] text-[#9d8574]">{formatMessageTime(message.createdAt)}</span></div><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#80685b]">{message.content}</p><div className="mt-2 flex items-center justify-between"><span className={`rounded-full px-2 py-0.5 text-[10px] ${unread ? "bg-[#fff0d9] text-[#a7602d]" : "bg-[#eee8e2] text-[#867465]"}`}>{unread ? "未读" : "已读"}</span>{message.deepLink ? <span className="inline-flex items-center text-[11px] font-medium text-[#9b5128]">查看详情 <ChevronRight className="h-3.5 w-3.5" /></span> : <CheckCheck className="h-4 w-4 text-[#b29b8a]" />}</div></div></CardContent></Card></button>;
          })}
        </main>
        <Dialog open={Boolean(selectedMessage)} onOpenChange={open => { if (!open) setSelectedMessage(null); }}>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{selectedMessage?.title ?? "消息详情"}</DialogTitle></DialogHeader><div className="space-y-3 py-2"><p className="whitespace-pre-wrap text-sm leading-6 text-[#634737]">{selectedMessage?.content}</p><p className="text-xs text-[#927665]">接收时间：{formatMessageTime(selectedMessage?.createdAt)}</p>{selectedMessage?.deepLink ? <p className="rounded-lg bg-[#f8eee2] p-3 text-xs leading-5 text-[#80543d]">该消息关联一条业务记录。查看详情不会自动跳转；请确认内容后再打开关联业务。</p> : null}</div><DialogFooter><Button variant="outline" onClick={() => setSelectedMessage(null)}>关闭</Button>{selectedMessage?.deepLink ? <Button className="bg-[#9a5128] text-white hover:bg-[#7e3d1c]" onClick={() => { const target = selectedMessage?.deepLink; setSelectedMessage(null); if (target) navigate(target); }}>打开关联业务</Button> : null}</DialogFooter></DialogContent>
        </Dialog>

        <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate(MOBILE_BOTTOM_NAVIGATION.workbench)}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Bell className="h-5 w-5" /><span className="text-[10px] font-medium">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate(MOBILE_BOTTOM_NAVIGATION.profile)}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
      </div>
    </div>
  );
}
