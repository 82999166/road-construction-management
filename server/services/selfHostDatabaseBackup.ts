import { existsSync, promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

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

type BackupFailure = { failedAt: string; error: string };

function backupDirectory() {
  return process.env.YX_DB_BACKUP_DIR?.trim() || "/var/backups/yx-cloud-management/mysql";
}

function backupScriptPath() {
  const configured = process.env.YX_DB_BACKUP_SCRIPT_PATH?.trim();
  if (configured) return configured;
  const managedRuntime = "/usr/local/lib/yx-cloud-management/backup/self-host-db-backup.mjs";
  if (existsSync(managedRuntime)) return managedRuntime;
  const packaged = resolve(process.cwd(), "dist/scripts/self-host-db-backup.mjs");
  return existsSync(packaged) ? packaged : resolve(process.cwd(), "scripts/self-host-db-backup.mjs");
}

function backupServiceName() {
  const configured = process.env.YX_DB_BACKUP_SYSTEMD_SERVICE?.trim();
  return configured && /^[A-Za-z0-9@_.-]+\.service$/.test(configured) ? configured : "yx-db-backup.service";
}

function backupServiceInstalled() {
  const service = backupServiceName();
  return existsSync(`/etc/systemd/system/${service}`) || existsSync(`/lib/systemd/system/${service}`);
}

function hasRequiredConfiguration() {
  return Boolean(process.env.YX_DB_BACKUP_DATABASE?.trim() && process.env.YX_DB_BACKUP_MYSQL_DEFAULTS_FILE?.trim());
}

function safeManifest(value: unknown): BackupManifest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<BackupManifest>;
  if (typeof item.createdAt !== "string" || typeof item.tableCount !== "number" || typeof item.sha256 !== "string" || !item.verification) return null;
  return {
    createdAt: item.createdAt,
    database: "已配置",
    backupFile: typeof item.backupFile === "string" ? basename(item.backupFile) : "已生成",
    manifestFile: typeof item.manifestFile === "string" ? basename(item.manifestFile) : undefined,
    tableCount: item.tableCount,
    compressedBytes: Number(item.compressedBytes ?? 0),
    sha256: item.sha256,
    verification: { gzipIntegrity: item.verification.gzipIntegrity === "passed" ? "passed" : "failed", allTableDefinitionsPresent: item.verification.allTableDefinitionsPresent === true },
    retention: { keepDays: Number(item.retention?.keepDays ?? 0), removedFiles: [] },
  };
}

function safeFailure(value: unknown): BackupFailure | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<BackupFailure>;
  if (typeof item.failedAt !== "string") return null;
  return { failedAt: item.failedAt, error: "最近一次完整备份未成功；请由服务器管理员通过服务日志排查。" };
}

async function readJson(path: string) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** 仅返回浏览器可安全展示的全库备份元数据，不暴露数据库名、凭据或服务器绝对路径。 */
export async function getSelfHostDatabaseBackupStatus() {
  const directory = backupDirectory();
  const scriptPath = backupScriptPath();
  const [latestSuccess, latestFailure] = await Promise.all([
    readJson(join(directory, "latest-success.json")),
    readJson(join(directory, "latest-failure.json")),
  ]);
  return {
    configured: hasRequiredConfiguration(),
    executable: existsSync(scriptPath) && backupServiceInstalled(),
    latestSuccess: safeManifest(latestSuccess),
    latestFailure: safeFailure(latestFailure),
  };
}

/** 由超级管理员手工发起服务器端完整备份；导出仅由低权限 systemd 服务读取受限 MySQL 配置文件。 */
export async function createSelfHostDatabaseBackup() {
  if (!hasRequiredConfiguration()) throw new Error("服务器尚未配置完整数据库备份参数，请先由服务器管理员完成 backup.env 配置");
  const scriptPath = backupScriptPath();
  if (!existsSync(scriptPath)) throw new Error("服务器未部署完整数据库备份脚本，请完成应用发布后再试");
  if (!backupServiceInstalled()) throw new Error("服务器尚未安装完整数据库备份服务，请先由服务器管理员安装并启用 systemd 服务");
  try {
    await execFileAsync("systemctl", ["start", backupServiceName()], { cwd: process.cwd(), timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 * 2 });
    const status = await getSelfHostDatabaseBackupStatus();
    if (!status.latestSuccess) throw new Error("备份已结束，但未读取到可验证清单");
    return status.latestSuccess;
  } catch (error) {
    console.error("[full-database-backup] server-side backup failed", error instanceof Error ? error.message : error);
    throw new Error("完整数据库备份未成功，请由服务器管理员查看备份服务日志");
  }
}
