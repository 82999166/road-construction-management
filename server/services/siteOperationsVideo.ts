import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { TRPCError } from "@trpc/server";
import { evidenceRecords, auditLogs } from "../../drizzle/schema";
import { SITE_VIDEO_MAX_BYTES } from "../../shared/siteOperations";
import { assertSuperAdmin } from "../access";
import { createContext } from "../_core/context";
import { ENV } from "../_core/env";
import { storagePut, storageGetSignedUrl } from "../storage";
import { encryptSecret, decryptSecret } from "./secretVault";
import { requireSiteDb, requireSiteProject, requireSiteVideoReference, readSiteSetting, siteConfigurationKey, parseSiteConfiguration } from "./siteOperationsConfiguration";
export const SITE_SAMPLE_VIDEO_PATH = "/manus-storage/excavator-sample_f339c2da.mp4";
export const SITE_SAMPLE_POSTER_PATH = "/manus-storage/excavator-poster_1e75a874.jpg";
export function decodeSiteVideo(base64: string, mime: "video/mp4" | "video/webm") {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > Math.ceil(SITE_VIDEO_MAX_BYTES / 3) * 4) throw new TRPCError({ code: "BAD_REQUEST", message: "视频编码无效或超过16MB" });
  const bytes = Buffer.from(base64,"base64");
  if (!bytes.length || bytes.length > SITE_VIDEO_MAX_BYTES || bytes.toString("base64") !== base64) throw new TRPCError({ code: "BAD_REQUEST", message: "视频编码无效或超过16MB" });
  const mp4 = bytes.length >= 16 && bytes.toString("ascii",4,8) === "ftyp" && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length && /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash)/.test(bytes.toString("ascii",8,12));
  const webm = bytes.length >= 16 && bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && bytes.subarray(4,4096).includes(Buffer.from("webm"));
  if (mime === "video/mp4" ? !mp4 : !webm) throw new TRPCError({ code: "BAD_REQUEST", message: "视频内容与MP4/WebM类型不符" });
  return bytes;
}
export function isPrivateSiteVideoKey(raw: string) {
  let value = raw;
  for (let i=0;i<5;i++) { try { const next = decodeURIComponent(value); if (next === value) break; value = next; } catch { return true; } }
  return /(?:^|\/)site-operations-private(?:\/|$)/i.test(value.replace(/\\/g,"/")) || /(?:^|\/)site-operations-private(?:\/|$)/i.test(path.posix.normalize(value.replace(/\\/g,"/")));
}
export async function uploadSiteVideo(actorId: number, input: { projectId: number; fileName: string; mimeType: "video/mp4" | "video/webm"; base64: string }) {
  const db = await requireSiteDb(); await requireSiteProject(db,input.projectId);
  const bytes = decodeSiteVideo(input.base64,input.mimeType);
  // Encrypted at rest, like existing personnel/vehicle originals. Even managed public proxy cannot reveal a playable original.
  const stored = await storagePut(`site-operations-private/${input.projectId}/${randomUUID()}.enc`, encryptSecret(bytes.toString("base64")), "application/octet-stream");
  return db.transaction(async tx => {
    await requireSiteProject(tx,input.projectId);
    const [result] = await tx.insert(evidenceRecords).values({ projectId: input.projectId, sourceType: "site_operations_video", fileKey: stored.key, fileName: path.basename(input.fileName), mimeType: input.mimeType, contentBytes: bytes.length, contentSha256: createHash("sha256").update(bytes).digest("hex"), uploadedBy: actorId });
    const storageReference = Number(result.insertId);
    await tx.insert(auditLogs).values({ userId: actorId,module: "siteOperations",action: "upload_video",targetType:"evidence",targetId:String(storageReference),summary:"上传现场大屏受控录播附件；未公开原始存储键" });
    return { storageReference, projectId: input.projectId, mimeType: input.mimeType, contentBytes: bytes.length };
  });
}
async function readSiteVideoStorage(fileKey: string) {
  const max = SITE_VIDEO_MAX_BYTES * 2;
  if (ENV.selfHostStorageDir) {
    const root = path.resolve(ENV.selfHostStorageDir), file = path.resolve(root,fileKey);
    if (!file.startsWith(root+path.sep)) throw Error("invalid_storage");
    const stat = await fs.stat(file); if (stat.size > max) throw Error("too_large");
    return fs.readFile(file);
  }
  const signed = await storageGetSignedUrl(fileKey);
  if (!signed.startsWith("https://")) throw Error("invalid_storage");
  const response = await fetch(signed,{ redirect:"error",signal:AbortSignal.timeout(20000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > max) throw Error("unavailable");
  const reader=response.body.getReader(), chunks: Buffer[]=[]; let size=0;
  try { for (;;) { const { value,done }=await reader.read(); if(done) break; size+=value.length; if(size>max) throw Error("too_large"); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks,size);
}
export function siteVideoRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw Error("invalid_range");
  const start=match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2])), end=match[1] ? (match[2] ? Math.min(size-1,Number(match[2])) : size-1) : size-1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || start>=size || end<start) throw Error("invalid_range");
  return { start,end };
}
export function registerSiteOperationsVideo(app: Express) {
  app.get("/api/site-operations/videos/:projectId/:reference",async(req,res)=>{
    res.set({ "Cache-Control":"no-store", "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff" });
    try {
      const ctx=await createContext({req,res,info:{} as Parameters<typeof createContext>[0]["info"]}); await assertSuperAdmin(ctx);
      const projectId=Number(req.params.projectId), reference=Number(req.params.reference);
      if(!Number.isSafeInteger(projectId)||projectId<=0||!Number.isSafeInteger(reference)||reference<=0) throw Error("invalid_id");
      const db=await requireSiteDb(); await requireSiteProject(db,projectId);
      const configuration=await readSiteSetting(db,siteConfigurationKey(projectId));
      if (!configuration || !parseSiteConfiguration(configuration.valueJson).videos.some(v=>v.enabled&&v.storageReference===reference)) throw new TRPCError({code:"FORBIDDEN",message:"视频未在本项目启用"});
      const record=await requireSiteVideoReference(db,projectId,reference), stored=await readSiteVideoStorage(record.fileKey);
      const bytes=decodeSiteVideo(decryptSecret(stored.toString("utf8")),record.mimeType as "video/mp4"|"video/webm");
      if(bytes.length!==record.contentBytes||createHash("sha256").update(bytes).digest("hex")!==record.contentSha256) throw Error("integrity");
      let range: ReturnType<typeof siteVideoRange>;
      try { range=siteVideoRange(req.headers.range,bytes.length); }
      catch { res.status(416).set("Content-Range",`bytes */${bytes.length}`).end();return; }
      res.set({"Content-Type":record.mimeType!,"Accept-Ranges":"bytes"});
      if(range) res.status(206).set({"Content-Range":`bytes ${range.start}-${range.end}/${bytes.length}`,"Content-Length":String(range.end-range.start+1)}).send(bytes.subarray(range.start,range.end+1));
      else res.set("Content-Length",String(bytes.length)).send(bytes);
    } catch(error) { res.status(error instanceof TRPCError && ["UNAUTHORIZED","FORBIDDEN"].includes(error.code) ? 403 : 404).send("视频不可用，请重新登录或联系管理员"); }
  });
}
