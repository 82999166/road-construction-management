import React, { useEffect, useRef, useState } from "react";
import type { EvidenceWatermarkTemplate } from "@shared/watermarkTemplate";
import { drawEngineeringWatermark } from "@/lib/engineeringWatermark";
import { cn } from "@/lib/utils";

/** 使用与归档照片完全相同的布局算法；未归档的时间与防伪编号由调用方明确标注。 */
export function EngineeringWatermarkPreview({
  template,
  lines,
  imageUrl,
  className,
}: {
  template: EvidenceWatermarkTemplate;
  lines: string[];
  imageUrl?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const contentKey = JSON.stringify({ template, lines });
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    setError("");
    const render = (image?: HTMLImageElement) => {
      if (disposed) return;
      try {
        if (!context) throw new Error("当前浏览器不支持水印预览");
        canvas.width = image?.naturalWidth || 1200;
        canvas.height = image?.naturalHeight || 900;
        if (image) context.drawImage(image, 0, 0);
        else {
          const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
          background.addColorStop(0, "#b6d0d9");
          background.addColorStop(0.58, "#67838d");
          background.addColorStop(1, "#435a65");
          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        const data = JSON.parse(contentKey) as { template: EvidenceWatermarkTemplate; lines: string[] };
        drawEngineeringWatermark(context, canvas.width, canvas.height, data.lines, data.template);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "水印预览生成失败");
      }
    };
    // 修改项目、字段或图片后先清屏，旧图片异步载入不得覆盖新预览。
    context?.clearRect(0, 0, canvas.width, canvas.height);
    let image: HTMLImageElement | undefined;
    if (imageUrl) {
      image = new Image();
      image.onload = () => render(image);
      image.onerror = () => { if (!disposed) setError("照片预览读取失败，请重新选择照片"); };
      image.src = imageUrl;
    } else render();
    return () => {
      disposed = true;
      if (image) { image.onload = null; image.onerror = null; }
    };
  }, [contentKey, imageUrl]);
  return (
    <div className={cn("overflow-hidden rounded-lg bg-slate-100", className)}>
      <canvas ref={canvasRef} aria-label="工程水印完整预览" className={cn("h-auto w-full object-contain", error && "hidden")} />
      {error ? <p role="alert" className="p-3 text-xs leading-5 text-amber-800">{error}</p> : null}
    </div>
  );
}
