/**
 * 将自建服务器运行时需要的受控脚本随生产包一起发布。
 * 不复制任何数据库凭据、备份文件或环境变量；凭据仍由服务器受限配置文件提供。
 */
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const runtimeDir = resolve(process.cwd(), "dist", "scripts");
await mkdir(runtimeDir, { recursive: true, mode: 0o750 });
await copyFile(resolve(process.cwd(), "scripts", "self-host-db-backup.mjs"), resolve(runtimeDir, "self-host-db-backup.mjs"));
console.log("自建服务器运行时脚本已随生产包归档：完整数据库备份");
