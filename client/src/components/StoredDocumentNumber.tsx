import React from "react";

export const HISTORICAL_DOCUMENT_NUMBER_NOTE = "历史未编统一号";
export const DOCUMENT_NUMBER_ASSIGNMENT_NOTE = "保存成功后由服务器分配正式单号";

/** 只读响应的原始持久号；不从 ID、日期或来源号推导正式号。 */
export function storedDocumentNumber(record: object): string | null {
  return "documentNo" in record && typeof record.documentNo === "string"
    ? record.documentNo
    : null;
}

export function documentNumberText(record: object): string {
  return storedDocumentNumber(record) ?? HISTORICAL_DOCUMENT_NUMBER_NOTE;
}

export function StoredDocumentNumber({ record }: { record: object }) {
  return (
    <p className="min-w-0 max-w-full whitespace-normal break-all font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]" data-stored-document-number>
      单号：{documentNumberText(record)}
    </p>
  );
}
