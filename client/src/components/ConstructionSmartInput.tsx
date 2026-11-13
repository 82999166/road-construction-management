import React, { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConstructionVoiceInput } from "@/hooks/useConstructionVoiceInput";
import { useConstructionSmartInputApi } from "@/lib/constructionSmartInputApi";
import {
  constructionHistoryDate,
  constructionHistoryKeyword,
  constructionPreviewValue,
  type ConstructionAssistantStatus,
  type ConstructionAssistMode,
  type ConstructionHistoryItem,
  type ConstructionSmartField,
} from "@/lib/constructionSmartInput";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";

export interface ConstructionSmartInputProps {
  projectId: number;
  userId: number;
  field: ConstructionSmartField;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  active: boolean;
}

interface Preview {
  text: string;
  provider: string;
}
interface AiPreview extends Preview {
  original: string;
  revision: number;
  warnings: string[];
}
const panelClass =
  "w-full min-w-0 max-w-full space-y-2 rounded-lg border border-[#ead9c8] bg-[#fffaf2] p-3 text-xs text-[#634737] [overflow-wrap:anywhere]";

/** 每次项目、用户、字段或 active 变更都销毁旧实例，清除资源并丢弃迟到回调。 */
export function ConstructionSmartInput(props: ConstructionSmartInputProps) {
  return (
    <ConstructionSmartInputSession
      key={`${props.projectId}:${props.userId}:${props.field}:${props.active}`}
      {...props}
    />
  );
}

function ConstructionSmartInputSession(props: ConstructionSmartInputProps) {
  const { projectId, userId, field, value, onChange, maxLength, active } =
    props;
  const enabled = active && projectId > 0 && userId > 0;
  const scopeKey = `${projectId}:${userId}:${field}`;
  const id = useId();
  const mounted = useRef(false);
  const statusSequence = useRef(0);
  const aiSequence = useRef(0);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRevision = useRef({ value, revision: 0 });
  if (valueRevision.current.value !== value)
    valueRevision.current = {
      value,
      revision: valueRevision.current.revision + 1,
    };
  const currentProps = useRef(props);
  currentProps.current = props;
  const [status, setStatus] = useState<ConstructionAssistantStatus | null>(
    null
  );
  const [statusError, setStatusError] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoHistory, setAutoHistory] = useState(true);
  const observedValue = useRef(value);
  const adoptedValue = useRef<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [history, setHistory] = useState<ConstructionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [forgetting, setForgetting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applyError, setApplyError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<ConstructionAssistMode>("polish");
  const [instruction, setInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPreview, setAiPreview] = useState<AiPreview | null>(null);
  const api = useConstructionSmartInputApi(
    projectId,
    userId,
    field,
    debouncedKeyword
  );
  const latestApi = useRef(api);
  latestApi.current = api;

  async function refreshStatus() {
    if (!enabled) return;
    const sequence = ++statusSequence.current;
    setStatusLoading(true);
    setStatusError("");
    // 失败后不保留旧额度或把未知额度显示成 0。
    setStatus(null);
    try {
      const next = await latestApi.current.readStatus();
      if (mounted.current && sequence === statusSequence.current)
        setStatus(next);
    } catch (error) {
      if (mounted.current && sequence === statusSequence.current)
        setStatusError(
          getUserFacingErrorMessage(
            error,
            "状态读取失败，不能判断服务或剩余额度，请重试"
          )
        );
    } finally {
      if (mounted.current && sequence === statusSequence.current)
        setStatusLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (enabled) void refreshStatus();
    return () => {
      mounted.current = false;
      statusSequence.current += 1;
      aiSequence.current += 1;
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (observedValue.current === value) return;
    observedValue.current = value;
    if (adoptedValue.current === value) {
      adoptedValue.current = null;
      return;
    }
    adoptedValue.current = null;
    if (!enabled || !autoHistory) return;
    const nextKeyword = constructionHistoryKeyword(value);
    if (nextKeyword !== keyword) {
      setKeyword(nextKeyword);
      setHistory([]);
      setHistoryLoading(true);
    }
    setHistoryOpen(true);
  }, [value, enabled, autoHistory, keyword]);

  useEffect(() => {
    if (keyword === debouncedKeyword) return;
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(timer);
  }, [keyword, debouncedKeyword]);

  useEffect(() => {
    if (
      !enabled ||
      !historyOpen ||
      !status?.historyEnabled ||
      keyword !== debouncedKeyword
    )
      return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError("");
    setHistory([]);
    void api
      .readHistory()
      .then(result => {
        if (!cancelled && mounted.current) setHistory(result.items.slice(0, 5));
      })
      .catch(error => {
        if (!cancelled && mounted.current)
          setHistoryError(
            getUserFacingErrorMessage(
              error,
              "最近内容读取失败，请重试，不能视为没有记录"
            )
          );
      })
      .finally(() => {
        if (!cancelled && mounted.current) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    historyOpen,
    status?.historyEnabled,
    keyword,
    debouncedKeyword,
    api.readHistory,
    historyRefresh,
  ]);

  const cloudReady = Boolean(
    status?.cloudVoiceReady && status.voiceUsed < status.voiceDailyLimit
  );
  const voice = useConstructionVoiceInput({
    scopeKey,
    active: enabled,
    cloudReady,
    transcribe: api.transcribe,
    onResult: (text, provider) => {
      if (mounted.current) {
        setPreview({ text, provider });
        setApplyError("");
      }
    },
    onCloudComplete: () => {
      if (mounted.current) void refreshStatus();
    },
  });

  function applyPreview(mode: "append" | "replace") {
    if (!preview || !currentProps.current.active) return;
    const result = constructionPreviewValue(
      currentProps.current.value,
      preview.text,
      mode,
      maxLength
    );
    if (result.error) {
      setApplyError(result.error);
      return;
    }
    adoptedValue.current = result.text;
    onChange(result.text);
    setPreview(null);
    setApplyError("");
  }

  async function forgetHistory(item?: ConstructionHistoryItem) {
    if (forgetting || !enabled) return;
    const question = item
      ? "确认删除这条最近内容？不会删除日报原始记录。"
      : "确认清空本人在当前项目所有字段的最近内容？不会删除日报原始记录。";
    if (!window.confirm(question)) return;
    setForgetting(true);
    setHistoryError("");
    try {
      const result = await api.forget(item?.id);
      if (!mounted.current) return;
      if (!result.success) throw new Error("删除未完成，请重试");
      setPreview(null);
      setHistoryRefresh(count => count + 1);
    } catch (error) {
      if (mounted.current)
        setHistoryError(
          getUserFacingErrorMessage(error, "删除最近内容失败，请重试")
        );
    } finally {
      if (mounted.current) setForgetting(false);
    }
  }

  function cancelAi() {
    aiSequence.current += 1;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = null;
    setAiBusy(false);
    setAiOpen(false);
    setAiPreview(null);
    setAiError("");
  }

  async function generateAi() {
    if (
      aiBusy ||
      !enabled ||
      !status?.aiReady ||
      status.aiUsed >= status.aiDailyLimit ||
      !value.trim()
    )
      return;
    if (aiMode === "revise" && !instruction.trim()) {
      setAiError("请填写修改要求");
      return;
    }
    const sequence = ++aiSequence.current;
    const original = value;
    const revision = valueRevision.current.revision;
    setAiBusy(true);
    setAiError("");
    setAiPreview(null);
    setApplyError("");
    aiTimer.current = setTimeout(() => {
      if (mounted.current && sequence === aiSequence.current) {
        aiSequence.current += 1;
        setAiBusy(false);
        setAiError(
          "AI整理网络超时，原文未改变；请求可能已计入额度，请刷新状态核对"
        );
        void refreshStatus();
      }
    }, 30_000);
    try {
      const result = await api.assist(
        original,
        aiMode,
        aiMode === "revise" ? instruction.trim() : undefined
      );
      if (!mounted.current || sequence !== aiSequence.current) return;
      if (!result.text.trim())
        throw new Error("AI没有返回候选内容，原文未改变，请重试");
      setAiPreview({
        text: result.text,
        provider: result.provider,
        original,
        revision,
        warnings: result.warnings,
      });
    } catch (error) {
      if (mounted.current && sequence === aiSequence.current)
        setAiError(
          getUserFacingErrorMessage(error, "AI整理失败，原文未改变，请稍后重试")
        );
    } finally {
      if (mounted.current && sequence === aiSequence.current) {
        if (aiTimer.current) clearTimeout(aiTimer.current);
        aiTimer.current = null;
        setAiBusy(false);
        void refreshStatus();
      }
    }
  }

  const aiStale = Boolean(
    aiPreview && aiPreview.revision !== valueRevision.current.revision
  );
  function adoptAi() {
    if (!aiPreview || aiStale || !currentProps.current.active) return;
    const result = constructionPreviewValue(
      currentProps.current.value,
      aiPreview.text,
      "replace",
      maxLength
    );
    if (result.error) {
      setApplyError(result.error);
      return;
    }
    adoptedValue.current = result.text;
    onChange(result.text);
    cancelAi();
    setApplyError("");
  }

  if (!enabled) return null;
  return (
    <div
      className="mt-1.5 w-full min-w-0 max-w-full space-y-2 [overflow-wrap:anywhere]"
      aria-label="施工日志智能录入"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-[#9f582b]"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen(open => !open)}
        >
          最近内容
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-[#9f582b]"
          aria-expanded={voiceOpen}
          onClick={() => {
            setVoiceOpen(open => !open);
            if (voiceOpen) voice.cancel();
          }}
        >
          语音录入
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-[#9f582b]"
          aria-expanded={aiOpen}
          onClick={() => {
            if (aiOpen) cancelAi();
            else {
              voice.cancel();
              setVoiceOpen(false);
              setAiOpen(true);
            }
          }}
        >
          AI整理
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs"
          aria-label="智能录入帮助"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen(open => !open)}
        >
          ?
        </Button>
      </div>

      <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-[#8f7566]">
        <input
          type="checkbox"
          checked={autoHistory}
          aria-label="输入时联想最近内容"
          onChange={event => {
            setAutoHistory(event.target.checked);
            if (!event.target.checked) setHistoryOpen(false);
          }}
        />
        输入时联想最近内容
      </label>

      {statusError && (
        <div role="alert" className="text-xs text-[#a34b3a]">
          {statusError}{" "}
          <Button
            type="button"
            size="sm"
            variant="link"
            onClick={() => void refreshStatus()}
          >
            重试状态
          </Button>
        </div>
      )}
      {helpOpen && (
        <section className={panelClass} aria-label="智能录入帮助说明">
          <p>
            ① 最近内容仅查本人当前项目。点选后预览，手动追加或替换。②
            语音先识别再核对。③
            AI仅辅助文字，不生成工程事实；采用后仍需您手动保存或提交日报。
          </p>
          <p>
            浏览器识别不消耗系统AI额度，需联网；可用性取决于设备和浏览器服务。请勿录入个人敏感信息。
          </p>
          {statusLoading ? (
            <p>正在读取服务状态与今日限额…</p>
          ) : status ? (
            <>
              <p>{status.message}</p>
              <p>
                AI：{status.aiReady ? "已配置" : "未配置"} · 今日{" "}
                {status.aiUsed}/{status.aiDailyLimit} 次
              </p>
              <p>
                云语音：{status.cloudVoiceReady ? "已配置" : "未配置"} · 今日{" "}
                {status.voiceUsed}/{status.voiceDailyLimit} 次
              </p>
            </>
          ) : (
            <p>服务状态和今日额度未知，请重试状态。</p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={statusLoading}
            onClick={() => void refreshStatus()}
          >
            刷新状态
          </Button>
        </section>
      )}

      {historyOpen && (
        <section className={panelClass} aria-label="最近内容面板">
          <p>本人 · 当前项目 · 最近内容最多 5 条</p>
          {!status ? (
            <p>请先读取服务状态，暂不能判断历史功能是否可用。</p>
          ) : !status.historyEnabled ? (
            <p>最近内容功能已关闭，请联系管理员。</p>
          ) : (
            <>
              <Input
                className="w-full min-w-0 text-sm"
                aria-label="最近内容关键词"
                placeholder="输入关键词联想"
                value={keyword}
                maxLength={100}
                onChange={event => {
                  if (event.target.value === keyword) return;
                  setKeyword(event.target.value);
                  setHistory([]);
                  setHistoryLoading(true);
                }}
              />
              {(historyLoading || keyword !== debouncedKeyword) && (
                <p role="status">正在查找最近内容…</p>
              )}
              {historyError && <p role="alert">{historyError}</p>}
              {!historyLoading &&
                !historyError &&
                keyword === debouncedKeyword &&
                history.length === 0 && (
                  <p>暂无匹配内容。保存日报或草稿后可记录最近内容。</p>
                )}
              <ul className="min-w-0 space-y-2">
                {history.map(item => (
                  <li
                    key={item.id}
                    className="min-w-0 rounded-md border border-[#ead9c8] p-2"
                  >
                    <button
                      type="button"
                      aria-label={`预览最近内容 ${item.id}`}
                      className="line-clamp-2 w-full min-w-0 whitespace-pre-wrap break-words text-left outline-none focus-visible:ring-2 focus-visible:ring-[#9f582b] [overflow-wrap:anywhere]"
                      onClick={() => {
                        setPreview({
                          text: item.content,
                          provider: "最近内容",
                        });
                        setApplyError("");
                      }}
                    >
                      {item.content}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                      <time className="text-[#8f7566]">
                        {constructionHistoryDate(item.usedAt)}
                      </time>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={forgetting}
                        aria-label={`删除最近内容 ${item.id}`}
                        onClick={() => void forgetHistory(item)}
                      >
                        删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setHistoryRefresh(count => count + 1)}
                >
                  刷新最近内容
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={forgetting}
                  onClick={() => void forgetHistory()}
                >
                  清空本项目最近内容
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {voiceOpen && (
        <section className={panelClass} aria-label="语音录入面板">
          {voice.browserSupported && (
            <>
              <p>优先浏览器中文识别：不消耗系统AI额度，需联网。</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={voice.state !== "idle"}
                onClick={voice.startBrowser}
              >
                开始浏览器识别
              </Button>
            </>
          )}
          {!voice.browserSupported && <p>当前浏览器不支持页面内语音识别。</p>}
          {status?.cloudVoiceReady && voice.cloudSupported ? (
            <div className="space-y-2 rounded-md border border-[#ead9c8] p-2">
              <p>
                可选云录音：录音将发送至管理员配置的转写服务处理。今日已用{" "}
                {status.voiceUsed}/{status.voiceDailyLimit}{" "}
                次；最长60秒、最多2MB。点击“同意并开始云录音”即同意本次处理；取消后已发送的服务请求可能仍计入额度。不会自动转用云服务。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="max-w-full whitespace-normal"
                disabled={!cloudReady || voice.state !== "idle"}
                onClick={() => void voice.startCloud()}
              >
                同意并开始云录音
              </Button>
              {!cloudReady && <p>今日云语音限额已用完。</p>}
            </div>
          ) : (
            <p>
              {statusLoading
                ? "正在检查云语音状态。"
                : !status
                  ? "云语音状态未知，请重试状态。"
                  : !status.cloudVoiceReady
                    ? "云语音未配置，请联系管理员。"
                    : "当前浏览器不支持云录音。"}
              可使用手机输入法麦克风直接输入。
            </p>
          )}
          {voice.message && (
            <p role="status" aria-live="polite">
              {voice.message}
            </p>
          )}
          {voice.state !== "idle" && (
            <div className="flex flex-wrap gap-2">
              {(voice.state === "listening" || voice.state === "recording") && (
                <Button type="button" size="sm" onClick={voice.finish}>
                  结束
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={voice.cancel}
              >
                取消语音
              </Button>
            </div>
          )}
        </section>
      )}

      {preview && (
        <section className={panelClass} aria-label="录入候选预览">
          <p>{preview.provider}候选 · 可修改，尚未写入原字段</p>
          <label htmlFor={`${id}-preview`}>核对候选文字</label>
          <Textarea
            id={`${id}-preview`}
            className="w-full min-w-0 text-sm"
            aria-label="录入候选文字"
            value={preview.text}
            onChange={event => {
              setPreview({ ...preview, text: event.target.value });
              setApplyError("");
            }}
          />
          <p>
            候选 {preview.text.length}/{maxLength}{" "}
            字。请核对数字、桩号和现场事实。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!preview.text.trim()}
              onClick={() => applyPreview("append")}
            >
              追加
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!preview.text.trim()}
              onClick={() => applyPreview("replace")}
            >
              替换
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setApplyError("");
              }}
            >
              取消候选
            </Button>
          </div>
        </section>
      )}

      {aiOpen && (
        <section className={panelClass} aria-label="AI整理面板">
          <p>仅辅助当前文字，不编造工程数量，不自动保存或提交。</p>
          {!status ? (
            <p>服务状态未知，请先重试状态。</p>
          ) : !status.aiReady ? (
            <p>AI尚未配置，请联系管理员配置AI接口。</p>
          ) : (
            <p>
              今日AI已用 {status.aiUsed}/{status.aiDailyLimit} 次
              {status.aiUsed >= status.aiDailyLimit ? "，限额已用完" : ""}。
            </p>
          )}
          <label htmlFor={`${id}-mode`}>整理方式</label>
          <select
            id={`${id}-mode`}
            className="block h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            aria-label="AI整理方式"
            value={aiMode}
            disabled={aiBusy}
            onChange={event => {
              setAiMode(event.target.value as ConstructionAssistMode);
              setAiPreview(null);
            }}
          >
            <option value="polish">整理润色</option>
            <option value="organize">分条整理</option>
            <option value="revise">按要求修改</option>
          </select>
          {aiMode === "revise" && (
            <Textarea
              aria-label="AI修改要求"
              placeholder="例如：保留全部桩号，改成简洁施工日志语气"
              maxLength={1000}
              value={instruction}
              disabled={aiBusy}
              onChange={event => {
                setInstruction(event.target.value);
                setAiPreview(null);
              }}
              className="w-full min-w-0 text-sm"
            />
          )}
          <Button
            type="button"
            size="sm"
            disabled={
              aiBusy ||
              !status?.aiReady ||
              status.aiUsed >= status.aiDailyLimit ||
              !value.trim() ||
              (aiMode === "revise" && !instruction.trim())
            }
            onClick={() => void generateAi()}
          >
            {aiBusy ? "正在生成…" : aiPreview ? "重新生成" : "生成候选"}
          </Button>
          {!value.trim() && <p>请先在上方填写原文。</p>}
          {aiError && <p role="alert">{aiError}</p>}
          {aiPreview && (
            <>
              <p>原文（生成时）</p>
              <div className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap rounded-md border border-[#ead9c8] p-2 [overflow-wrap:anywhere]">
                {aiPreview.original}
              </div>
              <label htmlFor={`${id}-ai`}>
                AI候选（{aiPreview.provider}，可人工修改）
              </label>
              <Textarea
                id={`${id}-ai`}
                aria-label="AI候选文字"
                value={aiPreview.text}
                onChange={event => {
                  setAiPreview({ ...aiPreview, text: event.target.value });
                  setApplyError("");
                }}
                className="w-full min-w-0 text-sm"
              />
              <p>
                候选 {aiPreview.text.length}/{maxLength} 字。
              </p>
              {aiStale && <p role="alert">原文已变化，请重新生成</p>}
              {aiPreview.warnings.map((warning, index) => (
                <p key={index} role="note">
                  {warning}
                </p>
              ))}
              <Button
                type="button"
                size="sm"
                disabled={aiStale || !aiPreview.text.trim()}
                onClick={adoptAi}
              >
                采用候选
              </Button>
            </>
          )}
          <p>
            务必核对数字、桩号、数量和事实；AI仅润色已有内容，最终以现场实际记录为准。
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={cancelAi}>
            取消AI整理
          </Button>
        </section>
      )}
      {applyError && (
        <p role="alert" className="text-xs text-[#a34b3a]">
          {applyError}
        </p>
      )}
    </div>
  );
}
