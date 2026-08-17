import { Camera } from "lucide-react";
import { useLocation } from "wouter";

const SOURCE_BY_PATH: Record<string, string> = {
  "/mobile/construction": "construction",
  "/mobile/labor": "labor",
  "/mobile/transport": "transport",
  "/mobile/purchasing": "purchasing",
  "/mobile/measurement": "measurement",
  "/mobile/finance": "finance",
};

/**
 * 各移动业务模块共用的现场取证入口。
 * 该组件仅预填业务来源，不绕过影像页的项目选择、服务端数据范围校验、定位水印和 OCR 人工复核要求。
 */
export function MobileEvidenceShortcut() {
  const [location, navigate] = useLocation();
  const pathname = location.split("?")[0];
  const sourceType = SOURCE_BY_PATH[pathname];
  if (!sourceType) return null;

  return <button type="button" aria-label="打开现场拍照与票据识别" className="fixed bottom-[76px] right-4 z-30 inline-flex h-11 items-center gap-2 rounded-full bg-[#9a5128] px-4 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(91,46,25,.28)] transition-transform active:scale-95" onClick={() => navigate(`/mobile/evidence?sourceType=${encodeURIComponent(sourceType)}`)}><Camera className="h-4 w-4" />现场拍照</button>;
}
