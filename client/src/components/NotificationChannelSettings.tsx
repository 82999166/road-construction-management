import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { BellRing, MessageSquareText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const MODULES = [
  ["purchasing", "采购"], ["measurement", "计量/分包"], ["finance", "财务"], ["machinery", "机械"], ["transport", "运输"],
  ["security", "安全/系统"], ["labor", "劳务"], ["construction", "施工"], ["diesel", "柴油"], ["contract", "合同"],
] as const;
type ModuleCode = (typeof MODULES)[number][0];

function ModuleChecks({ selected, onChange, disabled = false }: { selected: ModuleCode[]; onChange: (next: ModuleCode[]) => void; disabled?: boolean }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{MODULES.map(([code, label]) => <Label key={code} className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-2.5 py-2 text-xs font-normal text-slate-700"><Checkbox disabled={disabled} checked={selected.includes(code)} onCheckedChange={checked => onChange(checked ? [...selected, code] : selected.filter(item => item !== code))} />{label}</Label>)}</div>;
}

export default function NotificationChannelSettings() {
  const configuration = trpc.admin.settings.getNotificationChannelConfiguration.useQuery();
  const [form, setForm] = useState({
    smsEnabled: false, smsProvider: "none" as "none" | "aliyun" | "tencent", smsModules: [] as ModuleCode[],
    aliyunAccessKeyId: "", aliyunAccessKeySecret: "", aliyunSignName: "", aliyunTemplateCode: "",
    tencentSecretId: "", tencentSecretKey: "", tencentSdkAppId: "", tencentSignName: "", tencentTemplateId: "",
    officialEnabled: false, officialModules: [] as ModuleCode[],
  });
  useEffect(() => {
    const data = configuration.data;
    if (!data) return;
    setForm(current => ({ ...current, smsEnabled: data.smsEnabled, smsProvider: data.smsProvider as "none" | "aliyun" | "tencent", smsModules: data.smsModules as ModuleCode[], aliyunSignName: data.aliyunSignName, aliyunTemplateCode: data.aliyunTemplateCode, tencentSdkAppId: data.tencentSdkAppId, tencentSignName: data.tencentSignName, tencentTemplateId: data.tencentTemplateId, officialEnabled: data.officialEnabled, officialModules: data.officialModules as ModuleCode[] }));
  }, [configuration.data]);
  const save = trpc.admin.settings.saveNotificationChannelConfiguration.useMutation({ onSuccess: result => { toast.success(result.message); configuration.refetch(); }, onError: error => toast.error(error.message) });
  const providerReady = form.smsProvider === "aliyun" ? configuration.data?.aliyunAccessKeyConfigured : form.smsProvider === "tencent" ? configuration.data?.tencentSecretConfigured : false;
  return <Card className="border-[#cfe0dc] bg-[#f7fbfa]">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-[#1f6b60]" />短信与服务号通知通道</CardTitle><CardDescription className="mt-1">站内消息始终保留。短信和服务号均为可选补充通道，失败只记录审计，不回滚业务办理。</CardDescription></div><Badge variant="outline" className="border-slate-300 bg-white text-slate-700">密钥仅加密托管</Badge></div></CardHeader>
    <CardContent className="space-y-5">
      <section className="rounded-xl border border-[#d7e8e3] bg-white p-3"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-slate-800">短信通知</p><p className="mt-1 text-xs leading-5 text-slate-600">内置阿里云短信和腾讯云短信。仅向系统内有有效手机号的已授权收件人发送。</p></div><Checkbox checked={form.smsEnabled} onCheckedChange={checked => setForm(current => ({ ...current, smsEnabled: checked === true }))} aria-label="启用短信通知" /></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label className="text-xs">短信服务商</Label><Select value={form.smsProvider} onValueChange={value => setForm(current => ({ ...current, smsProvider: value as typeof current.smsProvider }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">暂不启用</SelectItem><SelectItem value="aliyun">阿里云短信</SelectItem><SelectItem value="tencent">腾讯云短信</SelectItem></SelectContent></Select></div><div className="rounded-lg bg-[#f2f7f5] px-3 py-2 text-xs leading-5 text-slate-600">{form.smsProvider === "none" ? "选择服务商后填写已审核的签名和模板；未配置密钥时不会发短信。" : providerReady ? "该服务商密钥已加密托管；留空保存会保留原密钥。" : "该服务商尚未配置完整密钥，保存后仍保持不可投递状态。"}</div></div>
        {form.smsProvider === "aliyun" ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><Input aria-label="阿里云访问密钥标识" type="password" placeholder="阿里云访问密钥标识（留空保持）" value={form.aliyunAccessKeyId} onChange={event => setForm(current => ({ ...current, aliyunAccessKeyId: event.target.value }))} /><Input aria-label="阿里云访问密钥" type="password" placeholder="阿里云访问密钥（留空保持）" value={form.aliyunAccessKeySecret} onChange={event => setForm(current => ({ ...current, aliyunAccessKeySecret: event.target.value }))} /><Input aria-label="阿里云已审核短信签名" placeholder="已审核短信签名" value={form.aliyunSignName} onChange={event => setForm(current => ({ ...current, aliyunSignName: event.target.value }))} /><Input aria-label="阿里云短信模板编码" placeholder="短信模板编码，例如 SMS_…" value={form.aliyunTemplateCode} onChange={event => setForm(current => ({ ...current, aliyunTemplateCode: event.target.value }))} /></div> : null}
        {form.smsProvider === "tencent" ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><Input aria-label="腾讯云密钥标识" type="password" placeholder="腾讯云密钥标识（留空保持）" value={form.tencentSecretId} onChange={event => setForm(current => ({ ...current, tencentSecretId: event.target.value }))} /><Input aria-label="腾讯云访问密钥" type="password" placeholder="腾讯云访问密钥（留空保持）" value={form.tencentSecretKey} onChange={event => setForm(current => ({ ...current, tencentSecretKey: event.target.value }))} /><Input aria-label="腾讯云短信应用标识" placeholder="腾讯云短信应用标识" value={form.tencentSdkAppId} onChange={event => setForm(current => ({ ...current, tencentSdkAppId: event.target.value }))} /><Input aria-label="腾讯云已审核短信签名" placeholder="已审核短信签名" value={form.tencentSignName} onChange={event => setForm(current => ({ ...current, tencentSignName: event.target.value }))} /><Input aria-label="腾讯云已审核模板编号" placeholder="已审核模板编号" value={form.tencentTemplateId} onChange={event => setForm(current => ({ ...current, tencentTemplateId: event.target.value }))} /></div> : null}
        <p className="mt-3 text-xs font-medium text-slate-700">短信通知模块</p><div className="mt-2"><ModuleChecks selected={form.smsModules} onChange={smsModules => setForm(current => ({ ...current, smsModules }))} disabled={!form.smsEnabled} /></div>
      </section>
      <section className="rounded-xl border border-[#eadfc6] bg-[#fffdf8] p-3"><div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 font-medium text-slate-800"><BellRing className="h-4 w-4 text-[#a86b20]" />服务号即时通知</p><p className="mt-1 text-xs leading-5 text-slate-600">仅用户即时操作后即时返回结果时可用；持续状态、日结、绑定后推送与范围提醒会自动降级至站内通知或短信。</p></div><Checkbox checked={form.officialEnabled} onCheckedChange={checked => setForm(current => ({ ...current, officialEnabled: checked === true }))} aria-label="启用服务号即时通知" /></div><p className="mt-3 text-xs font-medium text-slate-700">允许服务号即时通知的模块</p><div className="mt-2"><ModuleChecks selected={form.officialModules} onChange={officialModules => setForm(current => ({ ...current, officialModules }))} disabled={!form.officialEnabled} /></div><p className="mt-3 flex items-start gap-2 rounded-lg bg-[#fff4df] px-3 py-2 text-xs leading-5 text-[#865514]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />模块勾选不是持续群发许可。服务端会继续按事件和收件人关系校验微信运营规范。</p></section>
      <Button className="w-full bg-[#1f6b60] hover:bg-[#18564e]" disabled={save.isPending || configuration.isLoading} onClick={() => save.mutate(form)}>{save.isPending ? "正在发布通知通道配置…" : "保存并发布通知通道配置"}</Button>
    </CardContent>
  </Card>;
}
