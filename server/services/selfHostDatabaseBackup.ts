import { existsSync, promises as fs } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const DEFAULT_BROWSER_DOWNLOAD_MAX_BYTES = 4 * 1024 * 1024 * 1024;

type BackupManifest = {
  createdAt: string;
  database: string;
  backupFile: string;
  manifestFile?: string;
  tableCount: number;
  compressedBytes: number;
  sha256: string;
  verification: { gzipIntegrity: string; allTableDefinitionsPresent: boolean };
  retention: { keepDays: number; removedFiles: string[] };
};

type BackupFailure = { failedAt: string; code?: string; error?: string };

type SafeBackupManifest = {
  backupId: string;
  createdAt: string;
  tableCount: number;
  compressedBytes: number;
  sha256: string;
  verification: { gzipIntegrity: "passed" | "failed"; allTableDefinitionsPresent: boolean };
  retention: { keepDays: number; removedFiles: string[] };
};

export type VerifiedFullDatabaseBackupArtifact = {
  sha256: string;
  createdAt: string;
  tableCount: number;
  compressedBytes: number;
  filePath: string;
  downloadFileName: string;
};

function backupDirectory() {
  return process.env.YX_DB_BACKUP_DIR?.trim() || "/var/backups/yx-cloud-management/mysql";
}

function backupServiceName() {
  const configured = process.env.YX_DB_BACKUP_SYSTEMD_SERVICE?.trim();
  return configured && /^[A-Za-z0-9@_.-]+\.service$/.test(configured) ? configured : "yx-db-backup.service";
}

function backupServiceInstalled() {
  const service = backupServiceName();
  return existsSync(`/etc/systemd/system/${service}`) || existsSync(`/lib/systemd/system/${service}`);
}

async function backupDirectoryReady() {
  try {
    return (await fs.stat(backupDirectory())).isDirectory();
  } catch {
    return false;
  }
}

function browserDownloadEnabled() {
  return process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_ENABLED?.trim().toLowerCase() === "true";
}

function browserDownloadMaxBytes() {
  const parsed = Number(process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_BROWSER_DOWNLOAD_MAX_BYTES;
  return Math.min(parsed, Number.MAX_SAFE_INTEGER);
}

function hasValidSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasSafeBackupFileName(value: unknown): value is string {
  return typeof value === "string"
    && basename(value) === value
    && /^yx-full-[A-Za-z0-9._-]+\.sql\.gz$/.test(value);
}

function safeManifest(value: unknown): SafeBackupManifest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<BackupManifest>;
  const tableCount = Number(item.tableCount);
  const compressedBytes = Number(item.compressedBytes);
  if (
    typeof item.createdAt !== "string"
    || !Number.isInteger(tableCount)
    || tableCount < 1
    || !Number.isSafeInteger(compressedBytes)
    || compressedBytes < 1
    || !hasValidSha256(item.sha256)
    || !item.verification
    || !item.retention
  ) return null;
  const createdAt = new Date(item.createdAt);
  if (Number.isNaN(createdAt.getTime())) return null;
  const keepDays = Number(item.retention.keepDays);
  return {
    // 使用校验和作为不透明备份标识；绝不向浏览器返回数据库名、真实文件名或服务器路径。
    backupId: item.sha256.toLowerCase(),
    createdAt: createdAt.toISOString(),
    tableCount,
    compressedBytes,
    sha256: item.sha256.toLowerCase(),
    verification: {
      gzipIntegrity: item.verification.gzipIntegrity === "passed" ? "passed" : "failed",
      allTableDefinitionsPresent: item.verification.allTableDefinitionsPresent === true,
    },
    retention: {
      keepDays: Number.isInteger(keepDays) && keepDays >= 0
        ? keepDays
        : 0,
      removedFiles: [],
    },
  };
}

function safeFailure(value: unknown): { failedAt: string; code: string; error: string } | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<BackupFailure>;
  if (typeof item.failedAt !== "string" || Number.isNaN(new Date(item.failedAt).getTime())) return null;
  const code = typeof item.code === "string" && /^[A-Z_]{3,48}$/.test(item.code)
    ? item.code
    : "BACKUP_FAILED";
  return {
    failedAt: new Date(item.failedAt).toISOString(),
    code,
    error: "最近一次完整备份未成功；请由服务器管理员通过受控服务日志排查。",
  };
}

async function readJson(path: string) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function isVerified(manifest: SafeBackupManifest | null) {
  return Boolean(
    manifest
    && manifest.verification.gzipIntegrity === "passed"
    && manifest.verification.allTableDefinitionsPresent
  );
}

function safeDownloadName(createdAt: string) {
  const stamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "verified";
  return `yx-full-database-backup-${stamp}.sql.gz`;
}

/**
 * 仅解析 latest-success 对应的一个经过校验的转储文件。
 * 不接受浏览器传入文件名或目录；真实路径永不返回给调用方之外的服务器代码。
 */
export async function getVerifiedSelfHostDatabaseBackupArtifact(sha256: string): Promise<VerifiedFullDatabaseBackupArtifact> {
  if (!hasValidSha256(sha256)) throw new Error("INVALID_BACKUP_ID");
  const directory = resolve(backupDirectory());
  const raw = await readJson(join(directory, "latest-success.json"));
  const safe = safeManifest(raw);
  const original = raw && typeof raw === "object" ? raw as Partial<BackupManifest> : null;
  if (!safe || !original || !isVerified(safe) || safe.sha256 !== sha256.toLowerCase()) {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  if (!hasSafeBackupFileName(original.backupFile)) throw new Error("BACKUP_NOT_AVAILABLE");
  if (safe.compressedBytes > browserDownloadMaxBytes()) throw new Error("BACKUP_TOO_LARGE");

  const candidate = resolve(directory, original.backupFile);
  const relativePath = relative(directory, candidate);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("\0")) {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(candidate);
  } catch {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== safe.compressedBytes) {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  return {
    sha256: safe.sha256,
    createdAt: safe.createdAt,
    tableCount: safe.tableCount,
    compressedBytes: safe.compressedBytes,
    filePath: candidate,
    downloadFileName: safeDownloadName(safe.createdAt),
  };
}

/** 仅返回浏览器可安全展示的全库备份元数据，不暴露数据库名、真实文件名、凭据或服务器绝对路径。 */
export async function getSelfHostDatabaseBackupStatus() {
  const directory = backupDirectory();
  const [directoryReady, serviceInstalled] = await Promise.all([
    backupDirectoryReady(),
    Promise.resolve(backupServiceInstalled()),
  ]);
  const [latestSuccessRaw, latestFailureRaw] = await Promise.all([
    readJson(join(directory, "latest-success.json")),
    readJson(join(directory, "latest-failure.json")),
  ]);
  const latestSuccess = safeManifest(latestSuccessRaw);
  const downloadEnabled = browserDownloadEnabled();
  let downloadAvailable = false;
  if (downloadEnabled && latestSuccess && isVerified(latestSuccess)) {
    try {
      await getVerifiedSelfHostDatabaseBackupArtifact(latestSuccess.sha256);
      downloadAvailable = true;
    } catch {
      downloadAvailable = false;
    }
  }
  return {
    // 应用账户只读取无凭据的受控产物目录；MySQL defaults 文件和数据库名始终只属于 yxbackup 服务账户。
    configured: directoryReady && serviceInstalled,
    executable: serviceInstalled,
    latestSuccess,
    latestFailure: safeFailure(latestFailureRaw),
    browserDownload: {
      enabled: downloadEnabled,
      available: downloadAvailable,
    },
  };
}

/** 由超级管理员手工发起服务器端完整备份；导出仅由低权限 systemd 服务读取受限 MySQL 配置文件。 */
export async function createSelfHostDatabaseBackup() {
  if (!backupServiceInstalled()) throw new Error("服务器尚未安装完整数据库备份服务，请先由服务器管理员安装并启用 systemd 服务");
  if (!await backupDirectoryReady()) throw new Error("服务器完整备份产物目录尚未就绪，请由服务器管理员完成受控部署");
  try {
    // 生产 sudoers 仅允许应用服务账户执行这一条固定的 unit start 命令；不授予 shell、任意 systemctl 或数据库凭据读取权。
    await execFileAsync("sudo", ["-n", "/usr/bin/systemctl", "start", backupServiceName()], { cwd: process.cwd(), timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 * 2 });
    const status = await getSelfHostDatabaseBackupStatus();
    if (!status.latestSuccess || !isVerified(status.latestSuccess)) throw new Error("备份已结束，但未读取到可验证清单");
    return status.latestSuccess;
  } catch {
    // 不把 systemd、路径、数据库或 mysqldump 诊断写入应用日志。
    console.error("[full-database-backup] BACKUP_SERVICE_START_FAILED");
    throw new Error("完整数据库备份未成功，请由服务器管理员查看备份服务日志");
  }
}
