export type ConstructionSmartField =
  | "workArea"
  | "workContent"
  | "constructionPlan"
  | "safetyNotes"
  | "issueNotes";

export type ConstructionAssistMode = "polish" | "organize" | "revise";

export interface ConstructionAssistantStatus {
  aiReady: boolean;
  cloudVoiceReady: boolean;
  aiDailyLimit: number;
  aiUsed: number;
  voiceDailyLimit: number;
  voiceUsed: number;
  message: string;
  historyEnabled: boolean;
}

export interface ConstructionHistoryItem {
  id: number;
  content: string;
  usedAt: Date | string;
}

/** 不静默截断现场事实；超过主输入字数限制时要求用户修改候选。 */
export function constructionPreviewValue(
  current: string,
  candidate: string,
  mode: "append" | "replace",
  maxLength: number
): { text: string; error?: string } {
  const text =
    mode === "append" && current ? `${current}\n${candidate}` : candidate;
  return text.length > maxLength
    ? { text, error: `采用后将超过 ${maxLength} 字，请先缩短候选内容或原文` }
    : { text };
}

export function constructionHistoryDate(value: Date | string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "日期未知"
    : date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
}

/** 输入时联想只使用最后一个非空行的末100字，不将8000字正文当查询发送。 */
export function constructionHistoryKeyword(value: string) {
  const lastLine =
    value
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  return lastLine.slice(-100);
}
