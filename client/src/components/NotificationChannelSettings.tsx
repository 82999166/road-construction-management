import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import {
  BellRing,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  MessageSquareText,
  Plus,
  SearchCheck,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const MODULES = [
  ["purchasing", "采购"],
  ["measurement", "计量/分包"],
  ["finance", "财务"],
  ["machinery", "机械"],
  ["transport", "运输"],
  ["security", "安全/系统"],
  ["labor", "劳务"],
  ["construction", "施工"],
  ["diesel", "柴油"],
  ["contract", "合同"],
] as const;
const SMS_EVENTS = [
  ["transport_load_completed", "运输 · 装土刷卡成功"],
  ["transport_unload_completed", "运输 · 卸土完成"],
  ["transport_scan_exception", "运输 · 刷卡异常"],
  ["diesel_refuel_completed", "柴油 · 加油完成"],
  ["machine_refuel_completed", "机械 · 加油完成"],
  ["vehicle_expense_recorded", "车辆 · 维修保养费用"],
  ["machine_expense_recorded", "机械 · 维修保养费用"],
] as const;
const SMS_EVENT_VARIABLE_HINTS: Record<(typeof SMS_EVENTS)[number][0], string> =
  {
    transport_load_completed:
      "变量：vehicle（车牌号）、place（地点）、tripOrdinal（该车当日第几车）、time（北京时间）",
    transport_unload_completed:
      "变量：vehicle（车牌号）、place（地点）、tripOrdinal（该车当日第几车）、time（北京时间）",
    transport_scan_exception: "变量：vehicle（车牌号）、time（时间）",
    diesel_refuel_completed:
      "变量：vehicle（车牌号）、quantity（数量）、amount（金额）、time（时间）",
    machine_refuel_completed:
      "变量：vehicle（机械名称/编号）、quantity（数量）、amount（金额）、time（时间）",
    vehicle_expense_recorded:
      "变量：vehicle（车牌号）、category（费用类别）、amount（金额）、time（时间）",
    machine_expense_recorded:
      "变量：vehicle（机械名称/编号）、category（费用类别）、amount（金额）、time（时间）",
  };

type ModuleCode = (typeof MODULES)[number][0];
type SmsEventCode = (typeof SMS_EVENTS)[number][0];
type SmsEventTemplate = {
  eventCode: SmsEventCode;
  templateCode: string;
  enabled: boolean;
};

function ModuleChecks({
  selected,
  onChange,
  disabled = false,
}: {
  selected: ModuleCode[];
  onChange: (next: ModuleCode[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {MODULES.map(([code, label]) => (
        <Label
          key={code}
          className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-2.5 py-2 text-xs font-normal text-slate-700"
        >
          <Checkbox
            disabled={disabled}
            checked={selected.includes(code)}
            onCheckedChange={checked =>
              onChange(
                checked
                  ? [...selected, code]
                  : selected.filter(item => item !== code)
              )
            }
          />
          {label}
        </Label>
      ))}
    </div>
  );
}

function eventLabel(code: SmsEventCode) {
  return SMS_EVENTS.find(([value]) => value === code)?.[1] ?? code;
}

export default function NotificationChannelSettings() {
  const configuration =
    trpc.admin.settings.getNotificationChannelConfiguration.useQuery();
  const [form, setForm] = useState({
    smsEnabled: false,
    smsProvider: "none" as "none" | "aliyun" | "tencent",
    smsModules: [] as ModuleCode[],
    aliyunAccessKeyId: "",
    aliyunAccessKeySecret: "",
    aliyunSignName: "",
    aliyunTemplateCode: "",
    smsEventTemplates: [] as SmsEventTemplate[],
    tencentSecretId: "",
    tencentSecretKey: "",
    tencentSdkAppId: "",
    tencentSignName: "",
    tencentTemplateId: "",
    officialEnabled: false,
    officialModules: [] as ModuleCode[],
  });
  const [smsTestEventCode, setSmsTestEventCode] = useState<SmsEventCode>(
    "transport_load_completed"
  );
  const [smsTestPhone, setSmsTestPhone] = useState("");
  const [smsTestConfirmationOpen, setSmsTestConfirmationOpen] = useState(false);
  useEffect(() => {
    const data = configuration.data;
    if (!data) return;
    const templates = (data.smsEventTemplates ?? []).flatMap(template => {
      if (!SMS_EVENTS.some(([code]) => code === template.eventCode)) return [];
      return [
        {
          eventCode: template.eventCode as SmsEventCode,
          templateCode: template.templateCode,
          enabled: template.enabled,
        },
      ];
    });
    setForm(current => ({
      ...current,
      smsEnabled: data.smsEnabled,
      smsProvider: data.smsProvider as "none" | "aliyun" | "tencent",
      smsModules: data.smsModules as ModuleCode[],
      aliyunSignName: data.aliyunSignName,
      aliyunTemplateCode: data.aliyunTemplateCode,
      smsEventTemplates: templates,
      tencentSdkAppId: data.tencentSdkAppId,
      tencentSignName: data.tencentSignName,
      tencentTemplateId: data.tencentTemplateId,
      officialEnabled: data.officialEnabled,
      officialModules: data.officialModules as ModuleCode[],
    }));
  }, [configuration.data]);
  const save =
    trpc.admin.settings.saveNotificationChannelConfiguration.useMutation({
      onSuccess: result => {
        toast.success(result.message);
        configuration.refetch();
      },
      onError: error =>
        toast.error(
          getUserFacingErrorMessage(error, "通知渠道配置未完成，请稍后重试")
        ),
    });
  const smsTestReadiness =
    trpc.admin.settings.inspectAliyunSmsNotificationReadiness.useQuery(
      { eventCode: smsTestEventCode },
      { enabled: form.smsProvider === "aliyun" && form.smsEnabled }
    );
  const smsTemplateVerification =
    trpc.admin.settings.inspectAliyunSmsTemplateVariables.useQuery(
      { eventCode: smsTestEventCode },
      { enabled: false, retry: false }
    );
  const sendSmsTest =
    trpc.admin.settings.sendAliyunSmsNotificationTest.useMutation({
      onSuccess: result => {
        if (result.success)
          toast.success(
            `${result.message}${result.auditLogId ? ` 审计编号：${result.auditLogId}` : ""}`
          );
        else
          toast.error(
            `${result.message}${result.providerCode ? `（${result.providerCode}）` : ""}${result.auditLogId ? ` 审计编号：${result.auditLogId}` : ""}`
          );
        smsTestReadiness.refetch();
      },
      onError: error =>
        toast.error(
          getUserFacingErrorMessage(error, "通知渠道配置未完成，请稍后重试")
        ),
    });
  const providerReady =
    form.smsProvider === "aliyun"
      ? configuration.data?.aliyunAccessKeyConfigured
      : form.smsProvider === "tencent"
        ? configuration.data?.tencentSecretConfigured
        : false;
  const usedEvents = new Set(
    form.smsEventTemplates.map(item => item.eventCode)
  );
  const enabledSmsTemplates = form.smsEventTemplates.filter(
    template => template.enabled && template.templateCode.trim()
  );
  const addTemplate = () => {
    const nextEvent = SMS_EVENTS.find(
      ([eventCode]) => !usedEvents.has(eventCode)
    );
    if (!nextEvent) return;
    setForm(current => ({
      ...current,
      smsEventTemplates: [
        ...current.smsEventTemplates,
        { eventCode: nextEvent[0], templateCode: "", enabled: false },
      ],
    }));
  };
  const patchTemplate = (index: number, patch: Partial<SmsEventTemplate>) =>
    setForm(current => ({
      ...current,
      smsEventTemplates: current.smsEventTemplates.map(
        (template, templateIndex) =>
          templateIndex === index ? { ...template, ...patch } : template
      ),
    }));
  const removeTemplate = (index: number) =>
    setForm(current => ({
      ...current,
      smsEventTemplates: current.smsEventTemplates.filter(
        (_, templateIndex) => templateIndex !== index
      ),
    }));

  return (
    <Card className="border-[#cfe0dc] bg-[#f7fbfa]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="h-4 w-4 text-[#1f6b60]" />
              短信与服务号通知通道
            </CardTitle>
            <CardDescription className="mt-1">
              站内消息始终保留。短信和服务号均为可选补充通道，失败只记录审计，不回滚业务办理。
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="border-slate-300 bg-white text-slate-700"
          >
            密钥仅加密托管
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="rounded-xl border border-[#d7e8e3] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-800">短信通知</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                内置阿里云短信和腾讯云短信。仅向系统内有有效手机号的已授权收件人发送。
              </p>
            </div>
            <Checkbox
              checked={form.smsEnabled}
              onCheckedChange={checked =>
                setForm(current => ({
                  ...current,
                  smsEnabled: checked === true,
                }))
              }
              aria-label="启用短信通知"
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">短信服务商</Label>
              <Select
                value={form.smsProvider}
                onValueChange={value =>
                  setForm(current => ({
                    ...current,
                    smsProvider: value as typeof current.smsProvider,
                  }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">暂不启用</SelectItem>
                  <SelectItem value="aliyun">阿里云短信</SelectItem>
                  <SelectItem value="tencent">腾讯云短信</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-[#f2f7f5] px-3 py-2 text-xs leading-5 text-slate-600">
              {form.smsProvider === "none"
                ? "选择服务商后填写已审核的签名和模板；未配置密钥时不会发短信。"
                : providerReady
                  ? "该服务商密钥已加密托管；留空保存会保留原密钥。"
                  : "该服务商尚未配置完整密钥，保存后仍保持不可投递状态。"}
            </div>
          </div>
          {form.smsProvider === "aliyun" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="阿里云访问密钥标识"
                type="password"
                placeholder="阿里云访问密钥标识（留空保持）"
                value={form.aliyunAccessKeyId}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    aliyunAccessKeyId: event.target.value,
                  }))
                }
              />
              <Input
                aria-label="阿里云访问密钥"
                type="password"
                placeholder="阿里云访问密钥（留空保持）"
                value={form.aliyunAccessKeySecret}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    aliyunAccessKeySecret: event.target.value,
                  }))
                }
              />
              <Input
                aria-label="阿里云已审核短信签名"
                placeholder="已审核短信签名"
                value={form.aliyunSignName}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    aliyunSignName: event.target.value,
                  }))
                }
              />
            </div>
          ) : null}
          {form.smsProvider === "tencent" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="腾讯云密钥标识"
                type="password"
                placeholder="腾讯云密钥标识（留空保持）"
                value={form.tencentSecretId}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    tencentSecretId: event.target.value,
                  }))
                }
              />
              <Input
                aria-label="腾讯云访问密钥"
                type="password"
                placeholder="腾讯云访问密钥（留空保持）"
                value={form.tencentSecretKey}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    tencentSecretKey: event.target.value,
                  }))
                }
              />
              <Input
                aria-label="腾讯云短信应用标识"
                placeholder="腾讯云短信应用标识"
                value={form.tencentSdkAppId}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    tencentSdkAppId: event.target.value,
                  }))
                }
              />
              <Input
                aria-label="腾讯云已审核短信签名"
                placeholder="已审核短信签名"
                value={form.tencentSignName}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    tencentSignName: event.target.value,
                  }))
                }
              />
              <Input
                aria-label="腾讯云已审核模板编号"
                placeholder="已审核模板编号"
                value={form.tencentTemplateId}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    tencentTemplateId: event.target.value,
                  }))
                }
              />
            </div>
          ) : null}
          <div className="mt-4 rounded-lg border border-[#d7e8e3] bg-[#fbfefc] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  业务事件模板编码
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  运输装土、卸土模板如需显示“第几车”，须在阿里云新建并审核包含 $
                  {"${tripOrdinal}"} 的模板，再将新 CODE
                  填入对应事件。每个事件只能启用一个
                  CODE；留空或关闭时绝不发送。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={form.smsEventTemplates.length >= SMS_EVENTS.length}
                onClick={addTemplate}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                新增模板
              </Button>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-md border border-[#f0c889] bg-[#fff7e8] px-3 py-2 text-xs leading-5 text-[#865514]">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>短信显示车数需要更换新模板：</strong>
                已审核旧模板正文不会被系统自动增加“第几车”。请在阿里云克隆或新建含车次变量的运输模板，审核通过后，将新
                CODE
                分别替换到装土、卸土事件并启用；旧模板在替换前仍可正常发送。
              </span>
            </p>
            <div className="mt-3 space-y-3">
              {form.smsEventTemplates.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-3 text-xs text-slate-500">
                  尚未添加业务模板。可先新增“运输 ·
                  装土刷卡成功”，审核通过后再补填模板编码。
                </p>
              ) : (
                form.smsEventTemplates.map((template, index) => (
                  <div
                    key={template.eventCode}
                    className="rounded-lg border bg-white p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto_auto]">
                      <Select
                        value={template.eventCode}
                        onValueChange={value =>
                          patchTemplate(index, {
                            eventCode: value as SmsEventCode,
                          })
                        }
                      >
                        <SelectTrigger aria-label={`短信业务事件-${index}`}>
                          <SelectValue>
                            {eventLabel(template.eventCode)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {SMS_EVENTS.map(([code, label]) => (
                            <SelectItem
                              key={code}
                              value={code}
                              disabled={
                                code !== template.eventCode &&
                                usedEvents.has(code)
                              }
                            >
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label={`${eventLabel(template.eventCode)}模板编码`}
                        placeholder="审核通过后填写，例如 SMS_…"
                        value={template.templateCode}
                        onChange={event =>
                          patchTemplate(index, {
                            templateCode: event.target.value,
                            enabled: event.target.value.trim()
                              ? template.enabled
                              : false,
                          })
                        }
                      />
                      <Label className="flex items-center gap-2 whitespace-nowrap px-1 text-xs font-normal">
                        <Checkbox
                          checked={template.enabled}
                          disabled={
                            !template.templateCode.trim() || !form.smsEnabled
                          }
                          onCheckedChange={checked =>
                            patchTemplate(index, { enabled: checked === true })
                          }
                        />
                        启用
                      </Label>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-slate-500 hover:text-red-600"
                        onClick={() => removeTemplate(index)}
                        aria-label={`删除${eventLabel(template.eventCode)}模板`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {template.enabled
                        ? "已启用：对应业务成功后将按该事件投递短信。"
                        : template.templateCode.trim()
                          ? "编码已保存但未启用：暂不发送。"
                          : "待审核：可先保存，审核通过后补填 CODE 并启用。"}{" "}
                      {SMS_EVENT_VARIABLE_HINTS[template.eventCode]}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-[#bfd8d2] bg-[#f4faf8] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <Send className="h-4 w-4 text-[#1f6b60]" />
                  阿里云短信测试
                </p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
                  选择一个已启用模板，填写本人或已获授权的测试手机号。测试使用固定示例变量发送一次，结果仅返回服务商状态和审计编号，不回显手机号、密钥或模板编码。
                </p>
              </div>
              <Badge
                variant="outline"
                className="border-[#b8d4ce] bg-white text-[#1f6b60]"
              >
                每 60 秒限发一次
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Select
                value={smsTestEventCode}
                onValueChange={value =>
                  setSmsTestEventCode(value as SmsEventCode)
                }
                disabled={
                  form.smsProvider !== "aliyun" ||
                  !form.smsEnabled ||
                  enabledSmsTemplates.length === 0
                }
              >
                <SelectTrigger aria-label="选择短信测试事件">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SMS_EVENTS.map(([code, label]) => (
                    <SelectItem
                      key={code}
                      value={code}
                      disabled={
                        !enabledSmsTemplates.some(
                          template => template.eventCode === code
                        )
                      }
                    >
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="短信测试手机号"
                inputMode="numeric"
                placeholder="填写测试手机号，仅用于本次发送"
                maxLength={11}
                value={smsTestPhone}
                onChange={event =>
                  setSmsTestPhone(
                    event.target.value.replace(/\D/g, "").slice(0, 11)
                  )
                }
                disabled={
                  form.smsProvider !== "aliyun" ||
                  !form.smsEnabled ||
                  enabledSmsTemplates.length === 0
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={
                  form.smsProvider !== "aliyun" ||
                  !form.smsEnabled ||
                  !smsTestReadiness.data?.ready ||
                  !/^1[3-9]\d{9}$/.test(smsTestPhone) ||
                  sendSmsTest.isPending
                }
                onClick={() => setSmsTestConfirmationOpen(true)}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {sendSmsTest.isPending ? "正在提交…" : "发送测试短信"}
              </Button>
            </div>
            <div
              className={`mt-2 flex items-start gap-2 rounded-md px-2.5 py-2 text-xs leading-5 ${smsTestReadiness.data?.ready ? "bg-[#e9f6f1] text-[#1d6559]" : "bg-[#fff5e6] text-[#895719]"}`}
            >
              {smsTestReadiness.data?.ready ? (
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>
                {smsTestReadiness.isLoading
                  ? "正在核对当前事件的短信配置…"
                  : (smsTestReadiness.data?.message ??
                    (form.smsProvider !== "aliyun"
                      ? "仅阿里云短信支持当前测试入口。"
                      : !form.smsEnabled
                        ? "请先启用短信总开关并保存发布。"
                        : enabledSmsTemplates.length === 0
                          ? "请先为至少一个业务事件填写已审核的模板 CODE、启用并保存发布。"
                          : "当前事件尚未完成可发送配置。"))}
              </span>
            </div>
            <div className="mt-3 rounded-md border border-[#c8ded8] bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    模板变量实查
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    查询阿里云已发布模板的审核状态与变量名，不显示模板正文、密钥、手机号或模板编码。请先保存通知通道配置后再核验。
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    form.smsProvider !== "aliyun" ||
                    !form.smsEnabled ||
                    !smsTestReadiness.data?.ready ||
                    smsTemplateVerification.isFetching
                  }
                  onClick={() => void smsTemplateVerification.refetch()}
                >
                  {smsTemplateVerification.isFetching ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SearchCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {smsTemplateVerification.isFetching
                    ? "正在实查…"
                    : "核验当前模板变量"}
                </Button>
              </div>
              {smsTemplateVerification.data ? (
                <div
                  className={`mt-3 rounded-md px-3 py-2 text-xs leading-5 ${smsTemplateVerification.data.verified ? "bg-[#e9f6f1] text-[#1d6559]" : "bg-[#fff5e6] text-[#895719]"}`}
                >
                  <div className="flex items-start gap-2">
                    {smsTemplateVerification.data.verified ? (
                      <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <div>
                      <p>{smsTemplateVerification.data.message}</p>
                      <p className="mt-1">
                        系统会发送：
                        {smsTemplateVerification.data.expectedVariables
                          .map(variable => `\${${variable}}`)
                          .join("、") || "无变量"}
                        ；阿里云模板识别：
                        {smsTemplateVerification.data.variables
                          .map(variable => `\${${variable}}`)
                          .join("、") || "无变量"}
                        。
                      </p>
                      {smsTemplateVerification.data.legacyDollarVariables
                        .length ? (
                        <p className="mt-1 font-semibold">
                          发现无效旧写法：
                          {smsTemplateVerification.data.legacyDollarVariables
                            .map(variable => `$${variable}$`)
                            .join("、")}
                          。请在阿里云新建或更新为{" "}
                          {smsTemplateVerification.data.legacyDollarVariables
                            .map(variable => `\${${variable}}`)
                            .join("、")}{" "}
                          后审核，并把新模板 CODE 保存到本事件。
                        </p>
                      ) : null}
                      {smsTemplateVerification.data.unusedEventVariables
                        .length ? (
                        <p className="mt-1">
                          当前模板未使用但系统仍会提供的变量：
                          {smsTemplateVerification.data.unusedEventVariables
                            .map(variable => `\${${variable}}`)
                            .join("、")}
                          。
                        </p>
                      ) : null}
                      {smsTemplateVerification.data.unsupportedVariables
                        .length ? (
                        <p className="mt-1">
                          模板含系统未发送变量：
                          {smsTemplateVerification.data.unsupportedVariables
                            .map(variable => `\${${variable}}`)
                            .join("、")}
                          。
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <p className="mt-3 text-xs font-medium text-slate-700">
            短信通知模块
          </p>
          <div className="mt-2">
            <ModuleChecks
              selected={form.smsModules}
              onChange={smsModules =>
                setForm(current => ({ ...current, smsModules }))
              }
              disabled={!form.smsEnabled}
            />
          </div>
        </section>
        <section className="rounded-xl border border-[#eadfc6] bg-[#fffdf8] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-medium text-slate-800">
                <BellRing className="h-4 w-4 text-[#a86b20]" />
                服务号即时通知
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                仅用户即时操作后即时返回结果时可用；持续状态、日结、绑定后推送与范围提醒会自动降级至站内通知或短信。
              </p>
            </div>
            <Checkbox
              checked={form.officialEnabled}
              onCheckedChange={checked =>
                setForm(current => ({
                  ...current,
                  officialEnabled: checked === true,
                }))
              }
              aria-label="启用服务号即时通知"
            />
          </div>
          <p className="mt-3 text-xs font-medium text-slate-700">
            允许服务号即时通知的模块
          </p>
          <div className="mt-2">
            <ModuleChecks
              selected={form.officialModules}
              onChange={officialModules =>
                setForm(current => ({ ...current, officialModules }))
              }
              disabled={!form.officialEnabled}
            />
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-[#fff4df] px-3 py-2 text-xs leading-5 text-[#865514]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            模块勾选不是持续群发许可。服务端会继续按事件和收件人关系校验微信运营规范。
          </p>
        </section>
        <Button
          className="w-full bg-[#1f6b60] hover:bg-[#18564e]"
          disabled={save.isPending || configuration.isLoading}
          onClick={() => save.mutate(form)}
        >
          {save.isPending ? "正在发布通知通道配置…" : "保存并发布通知通道配置"}
        </Button>
      </CardContent>
      <AlertDialog
        open={smsTestConfirmationOpen}
        onOpenChange={setSmsTestConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发送测试短信</AlertDialogTitle>
            <AlertDialogDescription>
              系统将向本次填写的测试手机号发送一条“
              {eventLabel(smsTestEventCode)}
              ”测试短信。短信会消耗服务商条数，且测试变量为固定示例值；请确认该号码的使用已获得授权。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendSmsTest.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={sendSmsTest.isPending}
              onClick={() => {
                setSmsTestConfirmationOpen(false);
                sendSmsTest.mutate({
                  eventCode: smsTestEventCode,
                  recipientPhone: smsTestPhone,
                });
              }}
            >
              确认发送
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
