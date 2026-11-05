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
  verification: {
    gzipIntegrity: "passed" | "failed";
    allTableDefinitionsPresent: boolean;
  };
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
  return (
    process.env.YX_DB_BACKUP_DIR?.trim() ||
    "/var/backups/yx-cloud-management/mysql"
  );
}

function backupServiceName() {
  // 与 root 所有的 unit 和窄 polkit 规则保持同一个固定名称，不能借环境配置启动其他服务。
  return "yx-db-backup.service";
}

function backupServiceConfigurationMatches() {
  const configured = process.env.YX_DB_BACKUP_SYSTEMD_SERVICE?.trim();
  return !configured || configured === backupServiceName();
}

function backupServiceInstalled() {
  const service = backupServiceName();
  return (
    backupServiceConfigurationMatches() &&
    (existsSync(`/etc/systemd/system/${service}`) ||
      existsSync(`/lib/systemd/system/${service}`))
  );
}

async function backupDirectoryReady() {
  try {
    return (await fs.stat(backupDirectory())).isDirectory();
  } catch {
    return false;
  }
}

function browserDownloadEnabled() {
  return (
    process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}

function browserDownloadMaxBytes() {
  const parsed = Number(process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    return DEFAULT_BROWSER_DOWNLOAD_MAX_BYTES;
  return Math.min(parsed, Number.MAX_SAFE_INTEGER);
}

function hasValidSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasSafeBackupFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    basename(value) === value &&
    /^yx-full-[A-Za-z0-9._-]+\.sql\.gz$/.test(value)
  );
}

function safeManifest(value: unknown): SafeBackupManifest | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<BackupManifest>;
  const tableCount = Number(item.tableCount);
  const compressedBytes = Number(item.compressedBytes);
  if (
    typeof item.createdAt !== "string" ||
    !Number.isInteger(tableCount) ||
    tableCount < 1 ||
    !Number.isSafeInteger(compressedBytes) ||
    compressedBytes < 1 ||
    !hasValidSha256(item.sha256) ||
    !item.verification ||
    !item.retention
  )
    return null;
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
      gzipIntegrity:
        item.verification.gzipIntegrity === "passed" ? "passed" : "failed",
      allTableDefinitionsPresent:
        item.verification.allTableDefinitionsPresent === true,
    },
    retention: {
      keepDays: Number.isInteger(keepDays) && keepDays >= 0 ? keepDays : 0,
      removedFiles: [],
    },
  };
}

function safeFailure(
  value: unknown
): { failedAt: string; code: string; error: string } | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<BackupFailure>;
  if (
    typeof item.failedAt !== "string" ||
    Number.isNaN(new Date(item.failedAt).getTime())
  )
    return null;
  const code =
    typeof item.code === "string" && /^[A-Z_]{3,48}$/.test(item.code)
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
    manifest &&
      manifest.verification.gzipIntegrity === "passed" &&
      manifest.verification.allTableDefinitionsPresent
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
export async function getVerifiedSelfHostDatabaseBackupArtifact(
  sha256: string
): Promise<VerifiedFullDatabaseBackupArtifact> {
  if (!hasValidSha256(sha256)) throw new Error("INVALID_BACKUP_ID");
  const directory = resolve(backupDirectory());
  const raw = await readJson(join(directory, "latest-success.json"));
  const safe = safeManifest(raw);
  const original =
    raw && typeof raw === "object" ? (raw as Partial<BackupManifest>) : null;
  if (
    !safe ||
    !original ||
    !isVerified(safe) ||
    safe.sha256 !== sha256.toLowerCase()
  ) {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  if (!hasSafeBackupFileName(original.backupFile))
    throw new Error("BACKUP_NOT_AVAILABLE");
  if (safe.compressedBytes > browserDownloadMaxBytes())
    throw new Error("BACKUP_TOO_LARGE");

  const candidate = resolve(directory, original.backupFile);
  const relativePath = relative(directory, candidate);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    relativePath.includes("\0")
  ) {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(candidate);
  } catch {
    throw new Error("BACKUP_NOT_AVAILABLE");
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== safe.compressedBytes
  ) {
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

let backupCreationInFlight = false;

/** 由超级管理员发起；systemd 在服务端授权固定 unit，应用保持 NoNewPrivileges 且不读取 MySQL 凭据。 */
export async function createSelfHostDatabaseBackup() {
  if (!backupServiceConfigurationMatches())
    throw new Error("完整备份服务配置不一致，请由服务器管理员核对统一配置");
  if (!backupServiceInstalled())
    throw new Error(
      "服务器尚未安装完整数据库备份服务，请先由服务器管理员安装并启用 systemd 服务"
    );
  if (!(await backupDirectoryReady()))
    throw new Error(
      "服务器完整备份产物目录尚未就绪，请由服务器管理员完成受控部署"
    );
  if (backupCreationInFlight)
    throw new Error(
      "已有完整备份请求正在执行，请等待完成后刷新状态，勿重复提交"
    );
  backupCreationInFlight = true;
  let stage = "BACKUP_SERVICE_STATE_FAILED";
  try {
    const state = await execFileAsync(
      "/usr/bin/systemctl",
      [
        "--no-ask-password",
        "show",
        "--property=ActiveState",
        "--value",
        backupServiceName(),
      ],
      { timeout: 10_000, maxBuffer: 16_384 }
    );
    if (
      ["active", "activating", "deactivating"].includes(state.stdout.trim())
    ) {
      stage = "BACKUP_ALREADY_RUNNING";
      throw new Error(
        "已有完整备份任务正在执行，请刷新状态等待结果，勿重复提交"
      );
    }
    if (!["inactive", "failed"].includes(state.stdout.trim())) {
      throw new Error("备份服务状态暂时无法确认，请稍后刷新状态");
    }
    const previousRaw = await readJson(
      join(backupDirectory(), "latest-success.json")
    );
    const previous =
      previousRaw && typeof previousRaw === "object"
        ? (previousRaw as Partial<BackupManifest>)
        : null;
    const startedAt = Date.now();
    stage = "BACKUP_SERVICE_START_FAILED";
    // 窄 polkit 规则仅允许 yxapp 对 yx-db-backup.service 执行 start；不使用 sudo 或 shell，不放宽应用 NNP。
    await execFileAsync(
      "/usr/bin/systemctl",
      ["--no-ask-password", "start", backupServiceName()],
      {
        cwd: process.cwd(),
        timeout: 15 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 2,
      }
    );
    stage = "BACKUP_NO_NEW_VERIFIED_ARTIFACT";
    const latestRaw = await readJson(
      join(backupDirectory(), "latest-success.json")
    );
    const latest =
      latestRaw && typeof latestRaw === "object"
        ? (latestRaw as Partial<BackupManifest>)
        : null;
    const manifest = safeManifest(latestRaw);
    // 用新时间和新文件身份识别本次结果，不要求 SHA 改变（数据未变时内容可以相同）。
    if (
      !manifest ||
      !latest ||
      !isVerified(manifest) ||
      !hasSafeBackupFileName(latest.backupFile) ||
      Date.parse(manifest.createdAt) < startedAt - 1000 ||
      Date.parse(manifest.createdAt) > Date.now() + 1000 ||
      latest.backupFile === previous?.backupFile ||
      manifest.createdAt === previous?.createdAt
    ) {
      throw new Error(
        "本次未生成新的已验证备份；页面保留的是上次成功备份，请查看备份操作记录后再处理"
      );
    }
    const artifact = await fs
      .lstat(join(backupDirectory(), latest.backupFile))
      .catch(() => null);
    if (
      !artifact ||
      !artifact.isFile() ||
      artifact.isSymbolicLink() ||
      artifact.size !== manifest.compressedBytes
    ) {
      throw new Error(
        "本次备份文件完整性核验未通过，请查看备份操作记录后再处理"
      );
    }
    console.info("[full-database-backup] BACKUP_REQUEST_VERIFIED");
    return manifest;
  } catch (error) {
    // 只保留脱敏阶段码，原始 stderr、路径、凭据和命令输出绝不进入应用日志或浏览器。
    console.error(`[full-database-backup] ${stage}`);
    if (
      stage === "BACKUP_ALREADY_RUNNING" ||
      stage === "BACKUP_NO_NEW_VERIFIED_ARTIFACT"
    )
      throw error;
    const diagnostic =
      error && typeof error === "object"
        ? (error as { killed?: boolean; stderr?: string })
        : {};
    if (diagnostic.killed)
      throw new Error(
        "等待完整备份结果超时，服务可能仍在执行；请刷新状态等待结果，暂勿再次提交"
      );
    if (
      /authentication|authorize|permission|access denied/i.test(
        diagnostic.stderr ?? ""
      )
    ) {
      throw new Error(
        "备份启动授权未通过，任务尚未启动；请查看备份操作记录，并由服务器管理员核对备份服务授权"
      );
    }
    throw new Error(
      "完整数据库备份未成功；请先查看本页备份操作记录，服务器管理员可再查看应用服务与备份服务日志"
    );
  } finally {
    backupCreationInFlight = false;
  }
}
