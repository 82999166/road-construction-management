export const INITIAL_ERASE_VERSION = "ntag216-initial-erase-v1";

export function isVerifiedInitialEraseResult(value: unknown): value is {
  success: true;
  initialNdef: true;
  erased: true;
  verified: true;
  writeProtectionChanged: false;
  cardUidFingerprint: string;
  writerVersion: string;
} {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    r.success === true &&
    r.initialNdef === true &&
    r.erased === true &&
    r.verified === true &&
    r.writeProtectionChanged === false &&
    r.writerVersion === INITIAL_ERASE_VERSION &&
    typeof r.cardUidFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(r.cardUidFingerprint)
  );
}

export function getInitialEraseErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object"
        ? ["message", "result", "rawPS", "detail"]
            .map(key => (error as Record<string, unknown>)[key])
            .filter((value): value is string => typeof value === "string")
            .map(value => value.slice(0, 2048))
            .join(" ")
        : String(error ?? "");
  if (
    /erase_script_missing|reader_script_missing|run_utrust_erase_initial|\-File.*(?:does not exist|不存在)/i.test(
      message
    )
  )
    return "本机缺少恢复初卡脚本。请下载最新版安装包，完整解压后运行 Install-Yuexin-RFID-Bridge.cmd，安装完成并重启桥接，再重新检测。仅刷新网页不能补齐本机脚本。";
  const messages: Record<string, string> = {
    erase_confirmation_required:
      "本机桥接未收到擦除确认，请刷新页面后重新确认操作。",
    erase_origin_not_allowed:
      "恢复请求来源未通过校验。请从正式管理后台操作，不要直接运行擦卡命令。",
    erase_writer_version_mismatch:
      "本机恢复程序版本不匹配，请完整安装最新版桥接后重新检测。",
    erase_card_uid_mismatch:
      "感应区实体卡与本次确认的卡片不一致，已拒绝恢复。请保持同一张卡片不动后重新核对。",
    erase_card_type_not_supported:
      "卡片型号或读卡器识别能力未通过 NTAG216 核验，已停止恢复，请核对型号与读卡器兼容性。",
    erase_card_capacity_invalid:
      "卡片容量声明异常，已停止恢复，不能按固定地址强行擦除。",
    erase_card_write_protected:
      "卡片存在锁定或写保护，已停止恢复；系统不会修改锁定位或口令。",
    erase_card_read_failed: "卡片读取失败，请保持卡片贴稳并检查读卡器连接。",
    erase_card_write_failed:
      "恢复写入未完成，请保持卡片不动，先核查卡片状态，不要重复写入测试卡。",
    erase_card_verify_failed:
      "恢复后的空白用户区回读未通过，不能认定恢复成功。请保持卡片不动并核查。",
    card_not_present:
      "未检测到实体卡，请将待恢复的 NTAG216 放稳在读卡器感应区。",
    erase_unknown_in_progress:
      "恢复请求等待超过一分钟，结果尚未确认。请保持卡片不动，先只读核查；不要重复点击恢复或更换卡片。",
  };
  if (messages[message]) return messages[message];
  if (/[A-Za-z]:\\|\.ps1|powershell|exception|\-File/i.test(message))
    return "本机恢复程序未能正常执行。请完整安装最新版桥接后重新检测，不要只替换单个脚本。";
  if (/^[\u4e00-\u9fff]/.test(message)) return message;
  return "初卡恢复尚未通过完整回读校验。请保持卡片不动并检查本机桥接，不能认定已恢复成功。";
}
