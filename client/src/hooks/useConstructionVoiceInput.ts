import { useCallback, useEffect, useRef, useState } from "react";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";

export interface ConstructionSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type ConstructionSpeechConstructor =
  new () => ConstructionSpeechRecognition;

type VoiceState =
  | "idle"
  | "listening"
  | "permission"
  | "recording"
  | "transcribing";
interface VoiceOptions {
  scopeKey: string;
  active: boolean;
  cloudReady: boolean;
  transcribe: (input: {
    audioBase64: string;
    mimeType: string;
  }) => Promise<{ text: string }>;
  onResult: (text: string, provider: "浏览器识别" | "云端转写") => void;
  onCloudComplete?: () => void;
}

export const CONSTRUCTION_VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const CONSTRUCTION_VOICE_MAX_MS = 60_000;
const NETWORK_TIMEOUT_MS = 30_000;

function speechConstructor(): ConstructionSpeechConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as Window & {
    SpeechRecognition?: ConstructionSpeechConstructor;
    webkitSpeechRecognition?: ConstructionSpeechConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function constructionRecordingMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ].find(mime => MediaRecorder.isTypeSupported(mime));
}

function blobAsBase64(
  blob: Blob,
  assignReader: (reader: FileReader | null) => void
) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    assignReader(reader);
    reader.onload = () => {
      assignReader(null);
      resolve(String(reader.result).replace(/^data:[^,]+,/, ""));
    };
    reader.onerror = () => {
      assignReader(null);
      reject(new Error("录音读取失败，请重新录音"));
    };
    reader.onabort = () => {
      assignReader(null);
      reject(new Error("录音已取消"));
    };
    reader.readAsDataURL(blob);
  });
}

/** 所有设备、音频和计时器仅属于本组件实例；取消后任何迟到结果都不会被采用。 */
export function useConstructionVoiceInput(options: VoiceOptions) {
  const latest = useRef(options);
  latest.current = options;
  const alive = useRef(false);
  const operation = useRef(0);
  const speech = useRef<ConstructionSpeechRecognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const reader = useRef<FileReader | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState("");
  const browserSupported = Boolean(speechConstructor());
  const cloudSupported = Boolean(
    typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      constructionRecordingMime()
  );

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);
  const stopTracks = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }, []);
  const cleanup = useCallback(() => {
    operation.current += 1;
    clearTimers();
    if (speech.current) {
      speech.current.onresult = null;
      speech.current.onerror = null;
      speech.current.onend = null;
      try {
        speech.current.abort();
      } catch {
        /* 已结束 */
      }
      speech.current = null;
    }
    if (recorder.current) {
      recorder.current.ondataavailable = null;
      recorder.current.onstop = null;
      recorder.current.onerror = null;
      try {
        if (recorder.current.state !== "inactive") recorder.current.stop();
      } catch {
        /* 已结束 */
      }
      recorder.current = null;
    }
    if (reader.current?.readyState === 1) reader.current.abort();
    reader.current = null;
    stopTracks();
    chunks.current = [];
  }, [clearTimers, stopTracks]);

  useEffect(() => {
    alive.current = true;
    setState("idle");
    setMessage("");
    return () => {
      alive.current = false;
      cleanup();
    };
  }, [options.scopeKey, options.active, cleanup]);

  const cancel = useCallback(() => {
    cleanup();
    if (alive.current) {
      setState("idle");
      setMessage("语音录入已取消，原文未改变");
    }
  }, [cleanup]);

  const isCurrent = (id: number, scope: string) =>
    alive.current &&
    latest.current.active &&
    latest.current.scopeKey === scope &&
    operation.current === id;

  const addTimer = (callback: () => void, milliseconds: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, milliseconds);
    timers.current.add(timer);
    return timer;
  };

  const startBrowser = () => {
    if (!latest.current.active || state !== "idle") return;
    const Recognition = speechConstructor();
    if (!Recognition) {
      setMessage(
        "当前浏览器不支持识别，可查看云录音是否可用，或使用手机输入法麦克风"
      );
      return;
    }
    cleanup();
    const id = operation.current;
    const scope = latest.current.scopeKey;
    let transcript = "";
    let failed = false;
    try {
      const recognition = new Recognition();
      speech.current = recognition;
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = event => {
        if (!isCurrent(id, scope)) return;
        transcript = Array.from(event.results)
          .map(result => result[0]?.transcript ?? "")
          .join("");
      };
      recognition.onerror = event => {
        if (!isCurrent(id, scope)) return;
        failed = true;
        const reason =
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "麦克风或浏览器识别权限被拒绝，请在浏览器设置中允许麦克风"
            : event.error === "no-speech"
              ? "未听到清晰语音，请靠近麦克风重试"
              : "浏览器识别失败，请检查网络或浏览器设置";
        cleanup();
        setState("idle");
        setMessage(
          `${reason}。可自行选择云录音（若已配置），不会自动使用云服务；也可使用手机输入法麦克风。`
        );
      };
      recognition.onend = () => {
        if (!isCurrent(id, scope)) return;
        cleanup();
        setState("idle");
        if (!failed && transcript.trim()) {
          latest.current.onResult(transcript.trim(), "浏览器识别");
          setMessage("识别已结束，请核对候选后追加或替换");
        } else if (!failed)
          setMessage("未识别到文字，请重试或使用手机输入法麦克风");
      };
      setState("listening");
      setMessage("正在听… 浏览器识别不消耗系统AI额度，需联网");
      recognition.start();
      if (!isCurrent(id, scope)) return;
      addTimer(() => {
        if (!isCurrent(id, scope)) return;
        try {
          recognition.stop();
        } catch {
          cancel();
        }
        if (!isCurrent(id, scope)) return;
        addTimer(() => {
          if (isCurrent(id, scope)) {
            cleanup();
            setState("idle");
            setMessage("浏览器识别等待超时，请重试；未自动使用云服务");
          }
        }, 5_000);
      }, CONSTRUCTION_VOICE_MAX_MS);
    } catch {
      if (isCurrent(id, scope)) {
        cleanup();
        setState("idle");
        setMessage(
          "无法启动浏览器识别。可自行选择云录音（若已配置），不会自动使用云服务；也可使用手机输入法麦克风。"
        );
      }
    }
  };

  const startCloud = async () => {
    if (!latest.current.active || state !== "idle") return;
    if (!latest.current.cloudReady) {
      setMessage("云录音尚未配置或今日限额已用完，请使用手机输入法麦克风");
      return;
    }
    const mime = constructionRecordingMime();
    if (!cloudSupported || !mime) {
      setMessage("当前浏览器不支持云录音，请使用手机输入法麦克风");
      return;
    }
    cleanup();
    const id = operation.current;
    const scope = latest.current.scopeKey;
    setState("permission");
    setMessage("正在请求麦克风权限…");
    addTimer(() => {
      if (isCurrent(id, scope)) {
        cleanup();
        setState("idle");
        setMessage("麦克风权限等待超时，请确认权限后重试");
      }
    }, NETWORK_TIMEOUT_MS);
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!isCurrent(id, scope)) {
        audioStream.getTracks().forEach(track => track.stop());
        return;
      }
      clearTimers();
      stream.current = audioStream;
      const media = new MediaRecorder(audioStream, {
        mimeType: mime,
        audioBitsPerSecond: 32_000,
      });
      recorder.current = media;
      let bytes = 0;
      let sizeExceeded = false;
      media.ondataavailable = event => {
        if (!isCurrent(id, scope) || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > CONSTRUCTION_VOICE_MAX_BYTES) {
          sizeExceeded = true;
          // 丢弃超过边界的数据，不发送被截断的录音。
          chunks.current = [];
          if (media.state !== "inactive") media.stop();
          stopTracks();
          return;
        }
        chunks.current.push(event.data);
        if (
          bytes === CONSTRUCTION_VOICE_MAX_BYTES &&
          media.state !== "inactive"
        ) {
          media.stop();
          stopTracks();
        }
      };
      media.onerror = () => {
        if (!isCurrent(id, scope)) return;
        cleanup();
        setState("idle");
        setMessage("录音失败，请检查麦克风后重试，原文未改变");
      };
      media.onstop = async () => {
        if (!isCurrent(id, scope)) return;
        clearTimers();
        stopTracks();
        recorder.current = null;
        const blob = new Blob(chunks.current, { type: media.mimeType || mime });
        chunks.current = [];
        if (sizeExceeded || blob.size > CONSTRUCTION_VOICE_MAX_BYTES) {
          cleanup();
          setState("idle");
          setMessage("录音超过 2MB，已停止且未上传，请缩短录音后重试");
          return;
        }
        if (!blob.size) {
          cleanup();
          setState("idle");
          setMessage("没有录到声音，请重试");
          return;
        }
        setState("transcribing");
        setMessage("正在云端转写，可取消；原文不会自动改变");
        addTimer(() => {
          if (isCurrent(id, scope)) {
            cleanup();
            setState("idle");
            setMessage(
              "云端转写网络超时，请稍后重试，原文未改变；请求可能已计入额度，可刷新状态核对"
            );
          }
        }, NETWORK_TIMEOUT_MS);
        try {
          const audioBase64 = await blobAsBase64(blob, next => {
            reader.current = next;
          });
          if (!isCurrent(id, scope)) return;
          const result = await latest.current.transcribe({
            audioBase64,
            mimeType: blob.type,
          });
          if (!isCurrent(id, scope)) return;
          cleanup();
          setState("idle");
          latest.current.onCloudComplete?.();
          if (!result.text.trim()) {
            setMessage("云服务未返回文字，请重新录音，原文未改变");
            return;
          }
          latest.current.onResult(result.text.trim(), "云端转写");
          setMessage("转写已结束，请核对候选后追加或替换");
        } catch (error) {
          if (!isCurrent(id, scope)) return;
          cleanup();
          setState("idle");
          latest.current.onCloudComplete?.();
          setMessage(
            getUserFacingErrorMessage(
              error,
              "云端转写失败，请检查网络后重试，原文未改变"
            )
          );
        }
      };
      media.start(250);
      setState("recording");
      setMessage("正在录音… 最长 60 秒、最多 2MB；结束后交由转写服务处理");
      addTimer(() => {
        if (!isCurrent(id, scope)) return;
        if (media.state !== "inactive") media.stop();
        stopTracks();
      }, CONSTRUCTION_VOICE_MAX_MS);
    } catch (error) {
      if (!isCurrent(id, scope)) return;
      cleanup();
      setState("idle");
      const denied =
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "NotAllowedError";
      setMessage(
        denied
          ? "麦克风权限被拒绝，请在浏览器设置中允许麦克风，或使用手机输入法麦克风"
          : "无法打开麦克风，请检查 HTTPS、设备占用与浏览器权限，或使用手机输入法麦克风"
      );
    }
  };

  const finish = () => {
    try {
      if (state === "listening") {
        const id = operation.current;
        const scope = latest.current.scopeKey;
        clearTimers();
        speech.current?.stop();
        if (!isCurrent(id, scope)) return;
        addTimer(() => {
          if (isCurrent(id, scope)) {
            cleanup();
            setState("idle");
            setMessage("浏览器识别等待超时，请重试；未自动使用云服务");
          }
        }, 5_000);
      } else if (state === "recording") {
        if (recorder.current?.state !== "inactive") recorder.current?.stop();
        stopTracks();
      }
    } catch {
      cancel();
    }
  };

  return {
    state,
    message,
    browserSupported,
    cloudSupported,
    startBrowser,
    startCloud,
    finish,
    cancel,
  };
}
