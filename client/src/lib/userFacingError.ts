/**
 * 用户界面仅展示可理解、可操作的中文异常说明。
 * 服务端明确返回的中文业务校验说明会保留；网络、SQL、堆栈、英文内部编码等只显示调用方提供的安全回退。
 */
function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message.trim();
  }
  return "";
}

function containsInternalDiagnostic(message: string) {
  return /\b(?:error|exception|typeerror|referenceerror|syntaxerror|sql|select|insert|update|delete|stack|errno|econn|er_[a-z0-9_]+)\b|\b[a-z]+(?:_[a-z0-9]+){1,}\b|https?:\/\/|(?:^|\s)at\s+\S+\s*\(/i.test(
    message
  );
}

/** 中文业务说明可原样展示；未知或内部诊断统一改为安全中文提示。 */
export function getUserFacingErrorMessage(
  error: unknown,
  fallback = "操作未能完成，请稍后重试"
) {
  const message = readErrorMessage(error);
  if (!message || containsInternalDiagnostic(message)) return fallback;
  return /[\u4e00-\u9fff]/.test(message) ? message : fallback;
}
