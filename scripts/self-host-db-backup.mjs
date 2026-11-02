#!/usr/bin/env node
/**
 * 自有服务器 MySQL 全库备份。
 * 仅通过只读元数据查询与 mysqldump 导出工作，不向业务库写入任何测试数据。
 * 不输出数据库名、备份路径、凭据、命令行或 mysqldump 原始诊断。
 */
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream, existsSync, promises as fs } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";

// 备份目录使用 setgid 的专用只读组；MySQL defaults 文件仍为 root:yxbackup，不给应用账户读取。
process.umask(0o027);

const execFileAsync = promisify(execFile);
const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const database = process.env.YX_DB_BACKUP_DATABASE?.trim();
const defaultsFile = process.env.YX_DB_BACKUP_MYSQL_DEFAULTS_FILE?.trim();
const backupDir = process.env.YX_DB_BACKUP_DIR?.trim() || "/var/backups/yx-cloud-management/mysql";
const keepDays = Number(process.env.YX_DB_BACKUP_KEEP_DAYS || 30);
const mysqlHost = process.env.YX_DB_BACKUP_HOST?.trim();
const mysqlPort = process.env.YX_DB_BACKUP_PORT?.trim();
const mysqlUser = process.env.YX_DB_BACKUP_USER?.trim();
const MAX_STDERR_BYTES = 16 * 1024;

function backupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function errorCode(error) {
  const candidate = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof candidate === "string" && /^[A-Z_]{3,48}$/.test(candidate) ? candidate : "BACKUP_FAILED";
}

if (!database || !/^[A-Za-z0-9_]+$/.test(database)) throw backupError("CONFIG_INVALID");
if (!defaultsFile || !existsSync(defaultsFile)) throw backupError("CONFIG_INVALID");
if (!Number.isInteger(keepDays) || keepDays < 7 || keepDays > 3650) throw backupError("CONFIG_INVALID");

const run = async (file, args) => execFileAsync(file, args, { maxBuffer: 1024 * 1024 * 8 });
const mysqlClientArgs = [`--defaults-extra-file=${defaultsFile}`];
if (mysqlHost) mysqlClientArgs.push(`--host=${mysqlHost}`);
if (mysqlPort) mysqlClientArgs.push(`--port=${mysqlPort}`);
if (mysqlUser) mysqlClientArgs.push(`--user=${mysqlUser}`);

async function listDatabaseTables() {
  try {
    const result = await run("mysql", [...mysqlClientArgs, "--batch", "--skip-column-names", "--execute", `SELECT table_name FROM information_schema.tables WHERE table_schema = '${database}' AND table_type = 'BASE TABLE' ORDER BY table_name`]);
    const tables = result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!tables.length) throw backupError("NO_TABLES");
    return tables;
  } catch (error) {
    if (errorCode(error) === "NO_TABLES") throw error;
    throw backupError("METADATA_QUERY_FAILED");
  }
}

async function verifyDumpContainsAllTables(filePath, tables) {
  try {
    await run("gzip", ["-t", filePath]);
  } catch {
    throw backupError("GZIP_VERIFY_FAILED");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const found = new Set();
  let carry = "";
  try {
    const readable = createReadStream(filePath).pipe(createGunzip());
    readable.setEncoding("utf8");
    for await (const chunk of readable) {
      const text = carry + chunk;
      for (const table of tables) {
        if (!found.has(table) && text.includes(`CREATE TABLE \`${table}\``)) found.add(table);
      }
      carry = text.slice(-512);
    }
  } catch {
    throw backupError("SCHEMA_VERIFY_FAILED");
  }
  if (tables.some(table => !found.has(table))) throw backupError("TABLE_DEFINITION_MISSING");
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < 1) throw backupError("EMPTY_DUMP");
  return { bytes: stat.size, sha256: hash.digest("hex") };
}

async function writeJsonAtomic(path, payload) {
  const temporaryPath = `${path}.${process.pid}.partial`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(temporaryPath, path);
}

async function removeExpiredBackups() {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const deleted = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^yx-full-.*\.(sql\.gz|manifest\.json)(?:\..+\.partial)?$/.test(entry.name)) continue;
    const target = join(backupDir, entry.name);
    const stat = await fs.stat(target);
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(target);
      deleted.push(entry.name);
    }
  }
  return deleted;
}

async function assertSecureBackupDirectory() {
  try {
    const directoryStat = await fs.stat(backupDir);
    if (!directoryStat.isDirectory()) throw backupError("BACKUP_DIRECTORY_NOT_READY");
    // 目录属主、组与setgid权限仅由受控root部署步骤设置；低权限备份账户绝不自行chmod/chown生产目录。
    await fs.access(backupDir, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    if (errorCode(error) === "BACKUP_DIRECTORY_NOT_READY") throw error;
    throw backupError("BACKUP_DIRECTORY_NOT_READY");
  }
  try {
    const defaultsStat = await fs.stat(defaultsFile);
    if (!defaultsStat.isFile() || (defaultsStat.mode & 0o007) !== 0) throw backupError("CREDENTIAL_FILE_PERMISSION_INVALID");
  } catch (error) {
    if (errorCode(error) === "CREDENTIAL_FILE_PERMISSION_INVALID") throw error;
    throw backupError("CREDENTIAL_FILE_PERMISSION_INVALID");
  }
}

async function main() {
  await assertSecureBackupDirectory();
  const lockPath = join(backupDir, ".yx-full-backup.lock");
  let lockHandle;
  let partialDumpPath = "";
  let partialManifestPath = "";
  try {
    lockHandle = await fs.open(lockPath, "wx", 0o640);
  } catch {
    throw backupError("LOCKED");
  }
  try {
    const tablesBefore = await listDatabaseTables();
    const dumpPath = join(backupDir, `yx-full-${database}-${stamp}.sql.gz`);
    const manifestPath = `${dumpPath}.manifest.json`;
    partialDumpPath = `${dumpPath}.${process.pid}.partial`;
    partialManifestPath = `${manifestPath}.${process.pid}.partial`;
    const dumpArgs = [
      ...mysqlClientArgs,
      "--single-transaction",
      "--routines",
      "--events",
      "--triggers",
      "--no-tablespaces",
      "--hex-blob",
      "--default-character-set=utf8mb4",
      "--add-drop-table",
      "--databases",
      database,
    ];
    const child = spawn("mysqldump", dumpArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrBytes = 0;
    child.stderr.on("data", chunk => {
      // 仅限定读取以防异常输出耗尽内存；原文绝不进入状态文件、应用日志或浏览器。
      stderrBytes = Math.min(MAX_STDERR_BYTES, stderrBytes + Buffer.byteLength(chunk));
    });
    const exitCodePromise = new Promise(resolve => child.once("close", resolve));
    try {
      await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(partialDumpPath, { mode: 0o640 }));
    } catch {
      throw backupError("EXPORT_FAILED");
    }
    const exitCode = await exitCodePromise;
    if (exitCode !== 0) throw backupError("EXPORT_FAILED");
    const verification = await verifyDumpContainsAllTables(partialDumpPath, tablesBefore);
    const removedFiles = await removeExpiredBackups();
    const manifest = {
      format: "yx-self-host-full-mysql-backup-v2",
      createdAt: now.toISOString(),
      database,
      backupFile: basename(dumpPath),
      tableCount: tablesBefore.length,
      tables: tablesBefore,
      compressedBytes: verification.bytes,
      sha256: verification.sha256,
      verification: { gzipIntegrity: "passed", allTableDefinitionsPresent: true },
      retention: { keepDays, removedFiles },
    };
    // 仅在压缩和逐表结构校验成功后将转储公开为完整文件，再以原子清单宣布其可用。
    await fs.rename(partialDumpPath, dumpPath);
    partialDumpPath = "";
    await fs.writeFile(partialManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });
    await fs.rename(partialManifestPath, manifestPath);
    partialManifestPath = "";
    await writeJsonAtomic(join(backupDir, "latest-success.json"), { ...manifest, manifestFile: basename(manifestPath) });
    await fs.unlink(join(backupDir, "latest-failure.json")).catch(() => undefined);
    console.log(JSON.stringify({ event: "backup_verified", tableCount: tablesBefore.length, sha256Prefix: verification.sha256.slice(0, 12), removedCount: removedFiles.length, stderrBytes }));
  } finally {
    await fs.unlink(partialDumpPath).catch(() => undefined);
    await fs.unlink(partialManifestPath).catch(() => undefined);
    await lockHandle?.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

main().catch(async error => {
  const nativeCode = errorCode(error);
  const code = nativeCode === "EPERM" || nativeCode === "EACCES" ? "BACKUP_DIRECTORY_NOT_READY" : nativeCode;
  await fs.writeFile(join(backupDir, "latest-failure.json"), `${JSON.stringify({ failedAt: new Date().toISOString(), code }, null, 2)}\n`, { mode: 0o640 }).catch(() => undefined);
  console.error(JSON.stringify({ event: "backup_failed", code }));
  process.exit(1);
});
