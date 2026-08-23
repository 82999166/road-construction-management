import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Loader2, Truck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

function getTokenFromSearch() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export default function DriverWechatBindPage() {
  const [token] = useState(() => getTokenFromSearch());
  const [plateNo, setPlateNo] = useState("");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const status = trpc.officialAccount.driverBindingStatus.useQuery({ token }, { enabled: token.length >= 16, retry: false });
  const bind = trpc.officialAccount.completeDriverBinding.useMutation({
    onSuccess: async () => {
      await utils.officialAccount.driverBindingStatus.invalidate({ token });
    },
  });
  const state = useMemo(() => bind.data?.success ? "success" : status.data?.status ?? (status.isLoading ? "loading" : "invalid"), [bind.data, status.data, status.isLoading]);
  const message = bind.data && !bind.data.success ? bind.data.message : null;

  return (
    <main className="min-h-screen bg-[#f6f2ea] px-4 py-6 text-[#203c48]">
      <Card className="mx-auto max-w-md border-[#d8e3e0] shadow-sm">
        <CardHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#203c48] text-white"><Truck className="h-6 w-6" /></div>
          <CardTitle>渣土车司机微信绑定</CardTitle>
          <CardDescription>司机关注服务号后绑定车辆，只用于接收本车装土、卸土、结算和异常通知，不开通后台登录权限。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "loading" ? <div className="flex items-center gap-2 rounded-xl bg-white p-3 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />正在核验绑定链接…</div> : null}
          {["invalid", "expired", "used", "unavailable"].includes(state) ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><XCircle className="mb-2 h-5 w-5" />绑定链接无效、已过期或已使用。请回到服务号聊天窗口重新发送“绑定”获取新链接。</div> : null}
          {state === "ready" && !bind.data?.success ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); bind.mutate({ token, plateNo }); }}>
            <div className="space-y-2"><Label>车牌号</Label><Input value={plateNo} placeholder="例如 湘A12345" autoFocus onChange={event => setPlateNo(event.target.value.toUpperCase())} /></div>
            {message ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p> : null}
            <Button className="h-11 w-full bg-[#203c48] text-white hover:bg-[#17313b]" disabled={bind.isPending || plateNo.trim().length < 2}>{bind.isPending ? "正在绑定…" : "确认绑定车辆"}</Button>
          </form> : null}
          {bind.data?.success ? <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900"><CheckCircle2 className="h-6 w-6" /><p className="font-semibold">绑定成功</p><p>已绑定车辆：{bind.data.plateNo}{bind.data.driverName ? `，司机 ${bind.data.driverName}` : ""}。后续本车运输通知将发送到当前微信。</p><Button variant="outline" className="w-full border-emerald-200 bg-white" onClick={() => navigate("/")}>返回系统首页</Button></div> : null}
          <p className="text-xs leading-5 text-slate-500">如车牌无法匹配，请联系管理员先在“车辆统一台账”中录入该车牌，并确认车辆状态为可调度。</p>
        </CardContent>
      </Card>
    </main>
  );
}

