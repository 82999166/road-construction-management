#!/usr/bin/env node
/** 对已有备份进行离线 gzip、SHA-256 与全表 CREATE TABLE 定义校验，不连接业务库。 */
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const manifestPath = process.argv[2] ? resolve(process.argv[2]) : "";
if (!manifestPath || !manifestPath.endsWith(".manifest.json") || !existsSync(manifestPath)) throw new Error("请提供存在的 .manifest.json 备份清单路径");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.format !== "yx-self-host-full-mysql-backup-v1" || !Array.isArray(manifest.tables) || !manifest.tables.length) throw new Error("备份清单格式无效或未记录表清单");
const dumpPath = resolve(dirname(manifestPath), manifest.backupFile);
if (!existsSync(dumpPath)) throw new Error(`找不到备份文件：${manifest.backupFile}`);
await execFileAsync("gzip", ["-t", dumpPath]);
const buffer = await fs.readFile(dumpPath);
const sha256 = createHash("sha256").update(buffer).digest("hex");
if (sha256 !== manifest.sha256) throw new Error("备份 SHA-256 校验失败");
const { stdout } = await execFileAsync("gzip", ["-cd", dumpPath], { maxBuffer: 1024 * 1024 * 256 });
const missing = manifest.tables.filter(table => !stdout.includes(`CREATE TABLE \`${table}\``));
if (missing.length) throw new Error(`备份缺少表定义：${missing.join(", ")}`);
console.log(JSON.stringify({ success: true, backupFile: basename(dumpPath), tableCount: manifest.tableCount, sha256, gzipIntegrity: "passed", allTableDefinitionsPresent: true }));
