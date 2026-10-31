import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FileText, ImageIcon, LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";

export type ProtectedPreviewFile = {
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
};

const IMAGE_FILE_NAME_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i;

/**
 * 后端只下发已经完成项目范围及岗位校验的短时签名 URL。
 * 本工具仅决定浏览器内展示方式，绝不绕开既有的服务端鉴权。
 */
export function isPreviewableImage(file: ProtectedPreviewFile) {
  const mimeType = file.mimeType?.toLowerCase().trim() ?? "";
  return mimeType.startsWith("image/") || IMAGE_FILE_NAME_PATTERN.test(file.fileName ?? file.url);
}

type ProtectedImagePreviewProps = {
  file: ProtectedPreviewFile;
  title?: string;
  description?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * 将受控照片直接显示在站内弹窗，不再将照片 URL 当成附件下载链接。
 * PDF 等非图片文件维持浏览器原生受控打开，避免伪装成图片造成空白预览。
 */
export function ProtectedImagePreview({
  file,
  title = "查看已上传照片",
  description = "图片仅在当前项目与岗位授权范围内展示。",
  className,
  children,
}: ProtectedImagePreviewProps) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const image = isPreviewableImage(file);
  const fileName = file.fileName?.trim() || "已上传图片";

  if (!image) {
    return (
      <a
        className={cn("inline-flex items-center gap-1", className)}
        href={file.url}
        target="_blank"
        rel="noreferrer"
      >
        {children ?? <><FileText className="h-4 w-4" />打开文件：{fileName}</>}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cn("inline-flex cursor-zoom-in items-center gap-1 text-left", className)}
        onClick={() => {
          setImageFailed(false);
          setOpen(true);
        }}
        aria-label={`站内预览图片：${fileName}`}
      >
        {children ?? <><ImageIcon className="h-4 w-4" />查看图片</>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl overflow-hidden border-slate-200 bg-slate-950 p-0 text-slate-50 sm:w-[calc(100vw-2rem)]">
          <DialogHeader className="border-b border-white/15 px-5 py-4 pr-12 text-left">
            <DialogTitle className="truncate text-base text-white">{title}</DialogTitle>
            <DialogDescription className="truncate text-xs text-slate-300">{fileName} · {description}</DialogDescription>
          </DialogHeader>
          <div className="relative flex min-h-[40dvh] max-h-[calc(100dvh-11rem)] items-center justify-center bg-black/45 p-3 sm:p-5">
            {imageFailed ? (
              <div className="max-w-sm rounded-xl border border-amber-300/30 bg-amber-100/10 p-5 text-center text-sm leading-6 text-amber-100">
                图片暂时无法加载。请关闭预览后重新进入业务详情刷新签名地址再试。
              </div>
            ) : (
              <img
                src={file.url}
                alt={fileName}
                className="max-h-[calc(100dvh-13rem)] max-w-full rounded-md object-contain shadow-2xl"
                onError={() => setImageFailed(true)}
              />
            )}
          </div>
          <DialogFooter className="border-t border-white/15 bg-slate-900 px-5 py-3 sm:justify-between">
            <span className="hidden items-center gap-1.5 text-xs text-slate-300 sm:inline-flex"><LoaderCircle className="h-3.5 w-3.5" />站内原图预览，不触发下载</span>
            <Button type="button" variant="outline" className="border-slate-600 bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white" onClick={() => setOpen(false)}>关闭预览</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
