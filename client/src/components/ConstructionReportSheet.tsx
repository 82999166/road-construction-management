import React from "react";
import {
  CONSTRUCTION_REPORT_SHEET_CSS,
  constructionReportSheetHtml,
  type ConstructionWorkspaceReport,
} from "@/lib/constructionOutput";

export interface ConstructionReportSheetProps {
  report: ConstructionWorkspaceReport;
  projectName: string;
}

/** 与打印使用同一显式字段投影和 HTML 转义；不包含筛选或批次说明。 */
export function ConstructionReportSheet({
  report,
  projectName,
}: ConstructionReportSheetProps) {
  return (
    <>
      <style>{CONSTRUCTION_REPORT_SHEET_CSS}</style>
      <div
        style={{ minWidth: 0, width: "100%" }}
        dangerouslySetInnerHTML={{
          __html: constructionReportSheetHtml(report, projectName),
        }}
      />
    </>
  );
}

export default ConstructionReportSheet;
