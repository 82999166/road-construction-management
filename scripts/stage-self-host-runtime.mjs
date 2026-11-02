/**
 * 将自建服务器运行时需要的受控脚本随生产包一起发布。
 * 不复制任何数据库凭据、备份文件或环境变量；凭据仍由服务器受限配置文件提供。
 */
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const runtimeDir = resolve(process.cwd(), "dist", "scripts");
const deployDir = resolve(process.cwd(), "dist", "deploy");
await mkdir(runtimeDir, { recursive: true, mode: 0o750 });
await mkdir(deployDir, { recursive: true, mode: 0o755 });
await copyFile(resolve(process.cwd(), "scripts", "self-host-db-backup.mjs"), resolve(runtimeDir, "self-host-db-backup.mjs"));
await copyFile(resolve(process.cwd(), "scripts", "verify-self-host-db-backup.mjs"), resolve(runtimeDir, "verify-self-host-db-backup.mjs"));
await copyFile(resolve(process.cwd(), "deploy", "yx-db-backup.service"), resolve(deployDir, "yx-db-backup.service"));
await copyFile(resolve(process.cwd(), "deploy", "yx-db-backup.timer"), resolve(deployDir, "yx-db-backup.timer"));
console.log("自建服务器运行时脚本与备份单元模板已随生产包归档；不含数据库凭据、环境文件或历史转储");
