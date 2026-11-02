import { createReadStream } from "node:fs";
import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { auditLogs } from "../drizzle/schema";
import { assertSuperAdmin } from "./access";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { getVerifiedSelfHostDatabaseBackupArtifact } from "./services/selfHostDatabaseBackup";

type ByteRange = { start: number; end: number };

type RangeParseResult =
  | { type: "none" }
  | { type: "range"; range: ByteRange }
  | { type: "invalid" };

export function parseSingleRange(rangeHeader: string | undefined, size: number): RangeParseResult {
  if (!rangeHeader) return { type: "none" };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return { type: "invalid" };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { type: "invalid" };

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { type: "invalid" };
    return { type: "range", range: { start: Math.max(0, size - suffixLength), end: size - 1 } };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) {
    return { type: "invalid" };
  }
  return { type: "range", range: { start, end: Math.min(requestedEnd, size - 1) } };
}

function setDownloadHeaders(res: Response, fileName: string) {
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

async function auditDownloadStarted(userId: number, sha256: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    userId,
    module: "backup",
    action: "download_started",
    targetType: "full_database_backup",
    targetId: sha256.slice(0, 16),
    summary: "开始下载已验证的完整数据库备份",
  });
}

function safeError(res: Response, status: number, code: string) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: code });
}

async function createNativeAuthenticatedContext(req: Request, res: Response): Promise<TrpcContext> {
  let user = null;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    user = null;
  }
  return {
    req: req as TrpcContext["req"],
    res: res as TrpcContext["res"],
    user,
  };
}

async function serveVerifiedBackup(req: Request, res: Response) {
  try {
    // 完整备份只能由后台同源页面的用户动作触发；拒绝跨站导航、嵌入和脚本借用会话下载。
    if (req.headers["sec-fetch-site"] !== "same-origin") {
      safeError(res, 403, "SAME_ORIGIN_REQUIRED");
      return;
    }
    const context = await createNativeAuthenticatedContext(req, res);
    const admin = await assertSuperAdmin(context);
    const sha256 = typeof req.params.sha256 === "string" ? req.params.sha256 : "";
    const artifact = await getVerifiedSelfHostDatabaseBackupArtifact(sha256);
    const parsedRange = parseSingleRange(
      typeof req.headers.range === "string" ? req.headers.range : undefined,
      artifact.compressedBytes
    );
    if (parsedRange.type === "invalid") {
      res.setHeader("Content-Range", `bytes */${artifact.compressedBytes}`);
      safeError(res, 416, "RANGE_NOT_SATISFIABLE");
      return;
    }

    if (req.method !== "HEAD") await auditDownloadStarted(admin.id, artifact.sha256);
    setDownloadHeaders(res, artifact.downloadFileName);
    const range = parsedRange.type === "range" ? parsedRange.range : null;
    const contentLength = range
      ? range.end - range.start + 1
      : artifact.compressedBytes;
    res.setHeader("Content-Length", String(contentLength));
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${artifact.compressedBytes}`);
    } else {
      res.status(200);
    }

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = range
      ? createReadStream(artifact.filePath, { start: range.start, end: range.end })
      : createReadStream(artifact.filePath);
    const closeStream = () => stream.destroy();
    res.once("close", closeStream);
    stream.once("error", () => {
      if (!res.headersSent) safeError(res, 404, "BACKUP_NOT_AVAILABLE");
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof TRPCError) {
      safeError(res, error.code === "UNAUTHORIZED" ? 401 : 403, error.code);
      return;
    }
    const code = error instanceof Error ? error.message : "BACKUP_NOT_AVAILABLE";
    if (code === "BACKUP_TOO_LARGE") {
      safeError(res, 413, "BACKUP_TOO_LARGE");
      return;
    }
    // 不向浏览器回传路径、文件名、数据库名、系统服务或 MySQL 诊断信息。
    safeError(res, 404, "BACKUP_NOT_AVAILABLE");
  }
}

/**
 * 同源、仅超级管理员的完整数据库备份下载入口。
 * 输入仅允许备份 SHA-256；实际文件始终由最新已验证清单在服务器端解析。
 */
export function registerFullDatabaseBackupDownloadRoute(app: Express) {
  app.head("/api/admin/backups/full/:sha256/download", serveVerifiedBackup);
  app.get("/api/admin/backups/full/:sha256/download", serveVerifiedBackup);
}
