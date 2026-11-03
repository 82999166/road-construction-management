export type TransportSpeechStatus = "idle" | "ready" | "queued" | "speaking" | "completed" | "blocked" | "unsupported";
export const TRANSPORT_SPEECH_STATUS_TEXT: Record<TransportSpeechStatus, string> = {
  idle: "点击提交后，成功结果将自动语音播报。",
  ready: "语音已准备；操作成功后将自动播报。",
  queued: "正在准备成功语音…",
  speaking: "正在播报…",
  completed: "语音播报完成。",
  blocked: "手机未播放自动语音，请点击“播放成功语音”重试，并检查媒体音量。",
  unsupported: "当前浏览器不支持语音播报，请查看文字结果或更换手机浏览器。",
};

type SpeechRuntime = { synthesizer: SpeechSynthesis; Utterance: typeof SpeechSynthesisUtterance };
function browserSpeechRuntime(): SpeechRuntime | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return null;
  return { synthesizer: window.speechSynthesis, Utterance: SpeechSynthesisUtterance };
}

/** 语音是成功回执的辅助反馈。浏览器失败不得抛出异常、更改业务状态或重新提交。 */
export function createTransportReceiptSpeech(
  onStatus: (status: TransportSpeechStatus) => void,
  runtime: () => SpeechRuntime | null = browserSpeechRuntime,
) {
  let current: SpeechSynthesisUtterance | null = null;
  let activeSynthesizer: SpeechSynthesis | null = null;
  let generation = 0;
  let lastAutomaticReceiptKey: string | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function later(callback: () => void, milliseconds: number) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, milliseconds);
    timers.add(timer);
  }
  function clearTimers() {
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
  }
  function getRuntime() {
    try { return runtime(); } catch { return null; }
  }
  function cancelCurrent() {
    generation += 1;
    clearTimers();
    const hadCurrent = Boolean(current);
    if (current) {
      current.onstart = null;
      current.onend = null;
      current.onerror = null;
    }
    current = null;
    try { if (hadCurrent) activeSynthesizer?.cancel(); } catch { /* 不能影响业务 */ }
  }
  function prepareSpeech() {
    const engine = getRuntime();
    if (!engine) { onStatus("unsupported"); return; }
    if (current && current.volume !== 0) return;
    // 必须由点击处理函数同步调用，不能等GPS、拍照归档或网络响应后才解锁。
    cancelCurrent();
    activeSynthesizer = engine.synthesizer;
    try {
      engine.synthesizer.resume();
      engine.synthesizer.getVoices();
      const primer = new engine.Utterance(" ");
      primer.lang = "zh-CN";
      primer.volume = 0;
      current = primer; // 保持引用，避免手机浏览器提前回收。
      engine.synthesizer.speak(primer);
      onStatus("ready");
    } catch { onStatus("blocked"); }
  }
  function speakTransportReceipt(message: string | null | undefined, immediate = false, receiptKey?: string) {
    if (!message?.trim()) return;
    if (!immediate && receiptKey && lastAutomaticReceiptKey === receiptKey) return;
    if (!immediate && receiptKey) lastAutomaticReceiptKey = receiptKey;
    const engine = getRuntime();
    if (!engine) { onStatus("unsupported"); return; }
    cancelCurrent();
    activeSynthesizer = engine.synthesizer;
    const ticket = generation;
    try {
      const utterance = new engine.Utterance(message);
      utterance.lang = "zh-CN";
      utterance.rate = 0.8;
      utterance.volume = 1;
      utterance.pitch = 1;
      current = utterance;
      let started = false;
      let finished = false;
      const finish = (status: TransportSpeechStatus) => {
        if (ticket !== generation || finished) return;
        finished = true;
        clearTimers();
        current = null;
        onStatus(status);
      };
      utterance.onstart = () => {
        if (ticket !== generation || finished) return;
        started = true;
        onStatus("speaking");
      };
      utterance.onend = () => finish("completed");
      utterance.onerror = () => finish("blocked");
      const play = () => {
        if (ticket !== generation || finished) return;
        try {
          engine.synthesizer.resume();
          const chineseVoice = engine.synthesizer.getVoices().find(voice => voice.lang.toLowerCase().startsWith("zh"));
          if (chineseVoice) utterance.voice = chineseVoice;
          engine.synthesizer.speak(utterance);
          later(() => {
            if (ticket !== generation || finished) return;
            try { engine.synthesizer.resume(); } catch { finish("blocked"); }
          }, 120);
          // 某些手机静默丢弃speak且没有onerror，不能一直显示“正在准备”。
          later(() => { if (!started) finish("blocked"); }, 5000);
        } catch { finish("blocked"); }
      };
      onStatus("queued");
      // 手工播放在点击调用栈内直接speak；自动回执采用与刷卡一致的短延迟。
      if (immediate) play(); else later(play, 80);
    } catch { onStatus("blocked"); }
  }
  return { prepareSpeech, speakTransportReceipt, dispose: cancelCurrent };
}
