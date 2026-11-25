import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TakeoffEvidence } from "@/lib/takeoffEditorModel";
import { useState } from "react";
export const TAKEOFF_DIALOG_LAYOUT = "flex h-[min(90dvh,900px)] flex-col overflow-hidden sm:max-w-5xl xl:max-w-5xl data-[state=open]:animate-none data-[state=closed]:animate-none";
export function TakeoffPhotoGallery({ photos }: { photos: Pick<TakeoffEvidence, "evidenceId" | "url" | "fileName" | "description">[] }) {
  const [active, setActive] = useState<(typeof photos)[number] | null>(null);
  const [failed, setFailed] = useState(false);
  return <><div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">{photos.map(photo => <button key={photo.evidenceId} type="button" className="min-w-0 rounded-lg border bg-background p-2 text-left" aria-label={`站内查看：${photo.fileName}`} onClick={() => { setFailed(false); setActive(photo); }}><img className="h-24 w-full object-contain" src={photo.url} alt={photo.fileName} /><span className="mt-1 block break-all text-xs">{photo.fileName}</span>{photo.description ? <span className="block whitespace-pre-wrap break-all text-xs text-muted-foreground">{photo.description}</span> : null}</button>)}</div>
    <Dialog open={Boolean(active)} onOpenChange={open => { if (!open) setActive(null); }}><DialogContent className={`${TAKEOFF_DIALOG_LAYOUT} bg-background`}><DialogHeader><DialogTitle className="break-all pr-6 text-sm">{active?.fileName} · 站内查看</DialogTitle></DialogHeader><div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">{failed ? <p className="text-sm">图片暂时无法加载，请重新读取详情后重试。</p> : active ? <img src={active.url} alt={active.fileName} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} /> : null}</div><Button variant="outline" onClick={() => setActive(null)}>关闭预览</Button></DialogContent></Dialog>
  </>;
}
export const MAX_TAKEOFF_PHOTO_BYTES = 8 * 1024 * 1024;
export async function readTakeoffPhoto(file: File): Promise<{ mimeType: "image/jpeg" | "image/png"; base64Data: string }> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") throw new Error("仅支持 JPEG / PNG 图片");
  if (!file.size || file.size > MAX_TAKEOFF_PHOTO_BYTES) throw new Error("单张图片须为非空文件且不超过 8MB");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
  if (!(file.type === "image/jpeg" ? jpeg : png)) throw new Error("图片内容与 JPEG / PNG 文件类型不符");
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("图片读取失败，请重新选择"));
    reader.onload = () => { if (typeof reader.result === "string" && reader.result.includes(",")) resolve(reader.result.split(",")[1]); else reject(new Error("图片读取失败")); };
    reader.readAsDataURL(file);
  });
  return { mimeType: file.type, base64Data };
}
export function takeoffCoordinates(required: boolean): Promise<{ longitude: number; latitude: number } | undefined> {
  if (!required) return Promise.resolve(undefined);
  if (!navigator.geolocation) return Promise.reject(new Error("此配置要求真实定位，当前设备不支持定位"));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => {
    const { longitude, latitude } = position.coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) reject(new Error("无法取得有效真实定位"));
    else resolve({ longitude, latitude });
  }, () => reject(new Error("现场图片要求真实定位，请允许定位权限后重试")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
}
