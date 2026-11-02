#!/usr/bin/env node
/** 对已有备份进行离线 gzip、SHA-256 与全表 CREATE TABLE 定义流式校验，不连接业务库。 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { createGunzip } from "node:zlib";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const manifestPath = process.argv[2] ? resolve(process.argv[2]) : "";
if (!manifestPath || !manifestPath.endsWith(".manifest.json") || !existsSync(manifestPath)) throw new Error("请提供存在的 .manifest.json 备份清单路径");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!["yx-self-host-full-mysql-backup-v1", "yx-self-host-full-mysql-backup-v2"].includes(manifest.format) || !Array.isArray(manifest.tables) || !manifest.tables.length) {
  throw new Error("备份清单格式无效或未记录表清单");
}
if (typeof manifest.backupFile !== "string" || basename(manifest.backupFile) !== manifest.backupFile || !/^yx-full-[A-Za-z0-9._-]+\.sql\.gz$/.test(manifest.backupFile)) {
  throw new Error("备份清单中的文件标识无效");
}
const manifestDirectory = dirname(manifestPath);
const dumpPath = resolve(manifestDirectory, manifest.backupFile);
if (relative(manifestDirectory, dumpPath).startsWith("..") || !existsSync(dumpPath)) throw new Error("找不到对应的备份文件");
await execFileAsync("gzip", ["-t", dumpPath]);

const sha = createHash("sha256");
for await (const chunk of createReadStream(dumpPath)) sha.update(chunk);
const sha256 = sha.digest("hex");
if (sha256 !== manifest.sha256) throw new Error("备份 SHA-256 校验失败");

const found = new Set();
let carry = "";
const stream = createReadStream(dumpPath).pipe(createGunzip());
stream.setEncoding("utf8");
for await (const chunk of stream) {
  const text = carry + chunk;
  for (const table of manifest.tables) {
    if (!found.has(table) && text.includes(`CREATE TABLE \`${table}\``)) found.add(table);
  }
  carry = text.slice(-512);
}
const missing = manifest.tables.filter(table => !found.has(table));
if (missing.length) throw new Error(`备份缺少 ${missing.length} 张表定义`);
console.log(JSON.stringify({ success: true, tableCount: manifest.tableCount, sha256Prefix: sha256.slice(0, 12), gzipIntegrity: "passed", allTableDefinitionsPresent: true }));
