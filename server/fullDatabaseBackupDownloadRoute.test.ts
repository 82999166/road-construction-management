import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSelfHostDatabaseBackupStatus,
  getVerifiedSelfHostDatabaseBackupArtifact,
} from "./services/selfHostDatabaseBackup";
import { parseSingleRange } from "./fullDatabaseBackupDownloadRoute";

const originalEnvironment = {
  YX_DB_BACKUP_DIR: process.env.YX_DB_BACKUP_DIR,
  YX_DB_BACKUP_BROWSER_DOWNLOAD_ENABLED: process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_ENABLED,
  YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES: process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES,
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createVerifiedFixture(options: { symlinkLikeName?: boolean; bytes?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "yx-full-backup-download-"));
  temporaryDirectories.push(directory);
  const contents = Buffer.alloc(options.bytes ?? 32, 7);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const backupFile = options.symlinkLikeName ? "../outside.sql.gz" : "yx-full-verified-fixture.sql.gz";
  if (!options.symlinkLikeName) await writeFile(join(directory, backupFile), contents);
  await writeFile(join(directory, "latest-success.json"), JSON.stringify({
    format: "yx-self-host-full-mysql-backup-v2",
    createdAt: "2026-11-02T00:00:00.000Z",
    database: "production_database_must_not_reach_browser",
    backupFile,
    tableCount: 3,
    compressedBytes: contents.length,
    sha256,
    verification: { gzipIntegrity: "passed", allTableDefinitionsPresent: true },
    retention: { keepDays: 30, removedFiles: ["internal-name.sql.gz"] },
  }));
  process.env.YX_DB_BACKUP_DIR = directory;
  process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_ENABLED = "true";
  process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES = "1048576";
  return { directory, sha256, contents };
}

describe("完整数据库备份受控下载", () => {
  it("仅接受单一且未越界的HTTP Range，支持从末尾续传", () => {
    expect(parseSingleRange(undefined, 100)).toEqual({ type: "none" });
    expect(parseSingleRange("bytes=10-29", 100)).toEqual({ type: "range", range: { start: 10, end: 29 } });
    expect(parseSingleRange("bytes=90-", 100)).toEqual({ type: "range", range: { start: 90, end: 99 } });
    expect(parseSingleRange("bytes=-15", 100)).toEqual({ type: "range", range: { start: 85, end: 99 } });
    expect(parseSingleRange("bytes=100-101", 100)).toEqual({ type: "invalid" });
    expect(parseSingleRange("bytes=0-5,10-15", 100)).toEqual({ type: "invalid" });
  });

  it("浏览器状态DTO不返回数据库名、真实文件名、路径或轮换文件名", async () => {
    await createVerifiedFixture();
    const status = await getSelfHostDatabaseBackupStatus();
    const payload = JSON.stringify(status);

    expect(status.browserDownload).toEqual({ enabled: true, available: true });
    expect(status.latestSuccess?.backupId).toMatch(/^[a-f0-9]{64}$/);
    expect(payload).not.toContain("production_database_must_not_reach_browser");
    expect(payload).not.toContain("yx-full-verified-fixture.sql.gz");
    expect(payload).not.toContain("internal-name.sql.gz");
    expect(payload).not.toContain(temporaryDirectories[0]!);
  });

  it("只根据已验证清单和SHA解析常规文件，拒绝目录穿越和非可用工件", async () => {
    const fixture = await createVerifiedFixture();
    const artifact = await getVerifiedSelfHostDatabaseBackupArtifact(fixture.sha256);
    expect(artifact.filePath).toBe(join(fixture.directory, "yx-full-verified-fixture.sql.gz"));
    expect(artifact.downloadFileName).toMatch(/^yx-full-database-backup-\d{14}\.sql\.gz$/);
    await expect(getVerifiedSelfHostDatabaseBackupArtifact("0".repeat(64))).rejects.toThrow("BACKUP_NOT_AVAILABLE");

    await createVerifiedFixture({ symlinkLikeName: true });
    await expect(getSelfHostDatabaseBackupStatus()).resolves.toMatchObject({
      browserDownload: { enabled: true, available: false },
    });
  });

  it("原生下载路由重新认证、限流、单Range续传和禁止缓存，且不接入tRPC或对象存储代理", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./fullDatabaseBackupDownloadRoute.ts", import.meta.url), "utf8"));
    const index = await import("node:fs/promises").then(fs => fs.readFile(new URL("./_core/index.ts", import.meta.url), "utf8"));
    expect(source).toContain("assertSuperAdmin(context)");
    expect(source).toContain("getVerifiedSelfHostDatabaseBackupArtifact");
    expect(source).toContain('req.headers["sec-fetch-site"] !== "same-origin"');
    expect(source).toContain("Accept-Ranges");
    expect(source).toContain("Content-Range");
    expect(source).toContain("Cache-Control\", \"private, no-store");
    expect(source).toContain("download_started");
    expect(source).not.toContain("storageGetSignedUrl");
    expect(index).toContain("registerFullDatabaseBackupDownloadRoute(app)");
    expect(index).toContain('app.use("/api/admin/backups/full", createMemoryRateLimiter');
    expect(index.indexOf("registerFullDatabaseBackupDownloadRoute(app)")).toBeLessThan(index.indexOf("serveStatic(app)"));
  });
});
