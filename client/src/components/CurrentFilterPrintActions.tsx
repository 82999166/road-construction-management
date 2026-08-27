import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

/**
 * 统一业务台账操作条：始终以页面已经生效的服务端筛选作为导出和打印范围。
 * 各模块只传入各自的受控导出/打印函数，组件不读取、不缓存、不重算任何业务数据。
 */
export function CurrentFilterPrintActions({
  onPrint,
  onExport,
  disabled = false,
  printing = false,
  exporting = false,
  printLabel = "打印当前筛选明细与汇总",
  exportLabel = "导出当前筛选",
}: {
  onPrint: () => void;
  onExport?: () => void;
  disabled?: boolean;
  printing?: boolean;
  exporting?: boolean;
  printLabel?: string;
  exportLabel?: string;
}) {
  return <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
    {onExport ? <Button size="sm" variant="outline" className="h-10 border-[#cbd7d5] bg-white text-[#284651] hover:bg-[#eff6f4]" disabled={disabled || exporting} onClick={onExport}>
      <Download className="mr-1.5 h-4 w-4" />{exporting ? "正在导出…" : exportLabel}
    </Button> : null}
    <Button size="sm" className="h-10 bg-[#203c48] px-4 text-white shadow-sm hover:bg-[#17313b]" disabled={disabled || printing} onClick={onPrint}>
      <Printer className="mr-1.5 h-4 w-4" />{printing ? "正在生成…" : printLabel}
    </Button>
  </div>;
}
