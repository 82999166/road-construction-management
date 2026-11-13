import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  CONSTRUCTION_ASSISTANT_DEFAULTS,
  type AssistantConfiguration,
} from "@shared/constructionAssistant";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";

type SettingsDraft = Omit<AssistantConfiguration, "speechKeyConfigured"> & {
  speechApiKey: string;
};
export function ConstructionAssistantSettings({
  active,
  onDirtyChange,
}: {
  active: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const settings = trpc.constructionAssistant.configuration.useQuery(
    undefined,
    { enabled: active, retry: false }
  );
  const [draft, setDraft] = useState<SettingsDraft>({
    ...CONSTRUCTION_ASSISTANT_DEFAULTS,
    speechApiKey: "",
  });
  const [original, setOriginal] = useState<SettingsDraft | null>(null);
  const dirty = Boolean(
    original && JSON.stringify(draft) !== JSON.stringify(original)
  );
  useEffect(() => {
    if (!settings.data || dirty) return;
    const {
      speechKeyConfigured: _ignored,
      builtinVoiceAvailable: _builtin,
      ...values
    } = settings.data;
    const next = { ...values, speechApiKey: "" };
    setDraft(next);
    setOriginal(next);
    // 刷新结果不能覆盖正在编辑的草稿；保存后由新服务端结果同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const save = trpc.constructionAssistant.saveConfiguration.useMutation({
    onSuccess: async () => {
      const next = { ...draft, speechApiKey: "" };
      setDraft(next);
      setOriginal(next);
      await Promise.all([
        utils.constructionAssistant.configuration.invalidate(),
        utils.constructionAssistant.status.invalidate(),
      ]);
      toast.success("施工智能录入设置已保存；不会改变日报或审核记录");
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "设置未保存，输入仍保留，请重试")
      ),
  });
  const update = <K extends keyof SettingsDraft>(
    key: K,
    value: SettingsDraft[K]
  ) => setDraft(current => ({ ...current, [key]: value }));
  const toggles = [
    [
      "historyEnabled",
      "启用本人当前项目的最近内容记忆与联想",
      "不调用AI，不读取他人记录；删除记忆不会删除日报。",
    ],
    [
      "aiEnabled",
      "启用施工日志AI整理",
      "复用上方已启用的AI模型接口。仅点击生成时调用，无配置时不会假装生成成功。",
    ],
    [
      "cloudVoiceEnabled",
      "启用云录音转文字（可选）",
      "优先使用浏览器语音。内置云语音可用时无需重复配置；也可配置自定义转写接口，录音不作为业务附件保存。",
    ],
  ] as const;
  return (
    <Card className="min-w-0 border-[#d4ddeb] bg-[#f8faff]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mic className="h-4 w-4" />
          施工日志智能录入
        </CardTitle>
        <CardDescription>
          语音、AI整理和本人最近内容联想。AI与语音只提供可修改建议，不会自动提交、审核或更改历史日报。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {settings.isLoading ? (
          <p className="text-sm">正在读取设置…</p>
        ) : settings.isError ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 p-3 text-sm"
          >
            设置读取失败，不会按默认值覆盖已有配置。
            <Button
              type="button"
              variant="outline"
              onClick={() => settings.refetch()}
            >
              重新读取
            </Button>
          </div>
        ) : null}
        {settings.data?.builtinVoiceAvailable ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            系统内置云语音已托管：开启云录音后可直接使用，无需再填写接口或密钥；费用按实际转写请求计算。填写完整外部接口后将优先使用外部服务。
          </p>
        ) : null}
        <fieldset
          disabled={!original || settings.isError || save.isPending}
          className="space-y-3"
        >
          {toggles.map(([key, label, help]) => (
            <label
              key={key}
              className="flex items-start gap-2 rounded-lg border bg-white p-3 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={draft[key]}
                onChange={event => update(key, event.target.checked)}
              />
              <span>
                {label}
                <span className="mt-1 block text-xs text-slate-500">
                  {help}
                </span>
              </span>
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="assistant-ai-limit">
                每人每日AI请求上限（1—100）
              </Label>
              <Input
                id="assistant-ai-limit"
                type="number"
                min={1}
                max={100}
                value={draft.aiDailyLimit}
                onChange={event =>
                  update("aiDailyLimit", Number(event.target.value))
                }
              />
            </div>
            <div>
              <Label htmlFor="assistant-voice-limit">
                每人每日云语音请求上限（1—100）
              </Label>
              <Input
                id="assistant-voice-limit"
                type="number"
                min={1}
                max={100}
                value={draft.voiceDailyLimit}
                onChange={event =>
                  update("voiceDailyLimit", Number(event.target.value))
                }
              />
            </div>
          </div>
          <details
            className="rounded-lg border bg-white p-3"
            open={draft.cloudVoiceEnabled && Boolean(draft.speechEndpoint)}
          >
            <summary className="cursor-pointer text-sm font-semibold">
              云语音接口配置
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <Label htmlFor="assistant-speech-endpoint">
                  语音API基础地址（公开HTTPS）
                </Label>
                <Input
                  id="assistant-speech-endpoint"
                  type="url"
                  value={draft.speechEndpoint}
                  placeholder="https://api.example.com/v1"
                  onChange={event =>
                    update("speechEndpoint", event.target.value)
                  }
                />
                <p className="mt-1 text-xs text-slate-500">
                  系统在基础地址后追加
                  /audio/transcriptions；接口必须支持音频上传，文字模型接口不一定支持。
                </p>
              </div>
              <div>
                <Label htmlFor="assistant-speech-model">语音转写模型名称</Label>
                <Input
                  id="assistant-speech-model"
                  value={draft.speechModel}
                  placeholder="填写供应商提供的语音转写模型ID"
                  onChange={event => update("speechModel", event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="assistant-speech-key">语音API Key</Label>
                <Input
                  id="assistant-speech-key"
                  type="password"
                  autoComplete="new-password"
                  value={draft.speechApiKey}
                  placeholder={
                    settings.data?.speechKeyConfigured
                      ? "已托管；留空保留原密钥"
                      : "自定义外部接口首次启用需填写；内置语音无需填写"
                  }
                  onChange={event => update("speechApiKey", event.target.value)}
                />
              </div>
            </div>
          </details>
          <p className="rounded-lg bg-white p-3 text-xs leading-5 text-slate-600">
            <Sparkles className="mr-1 inline h-3 w-3" />
            请求失败的尝试也计入当天额度，防止重复请求产生费用；额度不是免费额度或金额上限，实际费用由接口供应商决定。浏览器语音不占用系统云语音额度，服务失败不会丢失原文。请勿把身份证、银行卡等个人资料送入施工AI正文。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              {save.isPending ? "正在保存…" : "保存智能录入设置"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || save.isPending}
              onClick={() => original && setDraft({ ...original })}
            >
              取消修改
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
