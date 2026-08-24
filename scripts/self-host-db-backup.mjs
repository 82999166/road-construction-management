#!/usr/bin/env node
/**
 * 自有服务器 MySQL 全库备份。
 * 仅通过只读元数据查询与 mysqldump 导出工作，不向业务库写入任何测试数据。
 * 需由服务器环境提供 YX_DB_BACKUP_DATABASE 与 YX_DB_BACKUP_MYSQL_DEFAULTS_FILE。
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, promises as fs } from "node:fs";
import { createGzip } from "node:zlib";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import mysql from "mysql2/promise";

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

if (!database || !/^[A-Za-z0-9_]+$/.test(database)) throw new Error("必须设置安全的 YX_DB_BACKUP_DATABASE（仅允许字母、数字与下划线）");
if (!defaultsFile || !existsSync(defaultsFile)) throw new Error("必须设置存在且受限权限保护的 YX_DB_BACKUP_MYSQL_DEFAULTS_FILE");
if (!Number.isInteger(keepDays) || keepDays < 7 || keepDays > 3650) throw new Error("YX_DB_BACKUP_KEEP_DAYS 必须为 7–3650 的整数");

const run = async (file, args) => execFileAsync(file, args, { maxBuffer: 1024 * 1024 * 8 });
const mysqlClientArgs = [`--defaults-extra-file=${defaultsFile}`];
if (mysqlHost) mysqlClientArgs.push(`--host=${mysqlHost}`);
if (mysqlPort) mysqlClientArgs.push(`--port=${mysqlPort}`);
if (mysqlUser) mysqlClientArgs.push(`--user=${mysqlUser}`);

async function listDatabaseTables() {
  const query = `SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const [result] = await run("mysql", [...mysqlClientArgs, "--batch", "--skip-column-names", "--execute", `SELECT table_name FROM information_schema.tables WHERE table_schema = '${database}' AND table_type = 'BASE TABLE' ORDER BY table_name`]);
  const tables = result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!tables.length) throw new Error(`数据库 ${database} 没有可备份的基础表`);
  return tables;
}

async function verifyDumpContainsAllTables(filePath, tables) {
  await run("gzip", ["-t", filePath]);
  const buffer = await fs.readFile(filePath);
  const { stdout } = await run("gzip", ["-cd", filePath]);
  const missing = tables.filter(table => !stdout.includes(`CREATE TABLE \`${table}\``));
  if (missing.length) throw new Error(`备份文件缺少 ${missing.length} 张表定义：${missing.slice(0, 10).join(", ")}`);
  return { bytes: buffer.byteLength, sha256: createHash("sha256").update(buffer).digest("hex") };
}

async function removeExpiredBackups() {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const deleted = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^yx-full-.*\.(sql\.gz|manifest\.json)$/.test(entry.name)) continue;
    const target = join(backupDir, entry.name);
    const stat = await fs.stat(target);
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(target);
      deleted.push(entry.name);
    }
  }
  return deleted;
}

async function main() {
  await fs.mkdir(backupDir, { recursive: true, mode: 0o750 });
  const tablesBefore = await listDatabaseTables();
  const dumpPath = join(backupDir, `yx-full-${database}-${stamp}.sql.gz`);
  const manifestPath = `${dumpPath}.manifest.json`;
  const dumpArgs = [
    ...mysqlClientArgs,
    "--single-transaction",
    "--routines",
    "--events",
    "--triggers",
    "--hex-blob",
    "--default-character-set=utf8mb4",
    "--add-drop-table",
    "--databases",
    database,
  ];
  const child = (await import("node:child_process")).spawn("mysqldump", dumpArgs, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(dumpPath, { mode: 0o640 }));
  const exitCode = await new Promise(resolve => child.once("close", resolve));
  if (exitCode !== 0) {
    await fs.unlink(dumpPath).catch(() => undefined);
    throw new Error(`mysqldump 导出失败（退出码 ${exitCode}）：${stderr.slice(0, 600)}`);
  }
  const verification = await verifyDumpContainsAllTables(dumpPath, tablesBefore);
  const removedFiles = await removeExpiredBackups();
  const manifest = {
    format: "yx-self-host-full-mysql-backup-v1",
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
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });
  await fs.writeFile(join(backupDir, "latest-success.json"), `${JSON.stringify({ ...manifest, manifestFile: basename(manifestPath) }, null, 2)}\n`, { mode: 0o640 });
  console.log(JSON.stringify({ success: true, backupFile: dumpPath, manifestFile: manifestPath, tableCount: tablesBefore.length, sha256: verification.sha256, removedCount: removedFiles.length }));
}

main().catch(async error => {
  await fs.mkdir(backupDir, { recursive: true }).catch(() => undefined);
  await fs.writeFile(join(backupDir, "latest-failure.json"), `${JSON.stringify({ failedAt: new Date().toISOString(), database, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`).catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
