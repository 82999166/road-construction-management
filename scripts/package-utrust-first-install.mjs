import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** fileURLToPath 在 Windows 正确移除 file:///D:/ 前缀，避免首装包漏掉中文文件名。 */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "desktop-bridge");
const stagingRoot = join("/tmp", "utrust-first-install-v13");
const outputRoot = process.env.UTRUST_PACKAGE_OUTPUT_DIR || "/home/ubuntu/webdev-static-assets";
const outputFile = join(outputRoot, "utrust-bridge-first-install-v13-20261016.zip");
const files = [
  "安装写卡桥接.cmd",
  "install-utrust-bridge.ps1",
  "upgrade_utrust_bridge.ps1",
  "utrust_local_bridge.ps1",
  "run_utrust_rfid_write.ps1",
  "run_utrust_read_uid.ps1",
  "utrust_probe.ps1",
  "run_utrust_read_vehicle_entry.ps1",
  "run_utrust_vehicle_card_diagnostic.ps1",
  "UTrustNtag216RfidWrite.cs",
  "UTrustBridgeSupport.cs",
  "UTrustReadVehicleEntry.cs",
  "UTrustVehicleCardDiagnostic.cs",
];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
for (const name of files) {
  const sourcePath = join(sourceRoot, name);
  if (!existsSync(sourcePath)) throw new Error(`首次安装包缺少受控文件：${name}`);
  const destinationPath = join(stagingRoot, name);
  let bytes = readFileSync(sourcePath);
  if (name.endsWith(".ps1")) {
    if (bytes.subarray(0, 3).equals(utf8Bom)) bytes = bytes.subarray(3);
    bytes = Buffer.concat([utf8Bom, bytes]);
  }
  writeFileSync(destinationPath, bytes);
}
const manifest = Object.fromEntries(files.map(name => [name, sha256(readFileSync(join(stagingRoot, name)))]));
writeFileSync(join(stagingRoot, "manifest.json"), `${JSON.stringify({ packageVersion: "utrust-first-install-v13", tokenPersisted: false, files: manifest }, null, 2)}\n`, "utf8");
writeFileSync(join(stagingRoot, "README-首次安装.txt"), "推荐：双击“安装写卡桥接.cmd”，并在系统权限窗口选择“是”。如需使用 PowerShell，请以管理员身份打开后运行：.\\install-utrust-bridge.ps1。安装脚本不会保存服务器令牌；写卡令牌由后台按次短时下发。\r\n", "utf8");
mkdirSync(outputRoot, { recursive: true });
rmSync(outputFile, { force: true });
/**
 * 显式平铺列出归档文件，而不打包目录根 "."：Windows PowerShell 5.1 的
 * Expand-Archive 会将部分 tar.exe 生成的根目录条目视作非法路径。
 */
const archiveFiles = [...files, "manifest.json", "README-首次安装.txt"];
if (process.platform === "win32") {
  execFileSync("tar.exe", ["-a", "-c", "-f", outputFile, ...archiveFiles], { cwd: stagingRoot, stdio: "inherit" });
} else {
  execFileSync("zip", ["-q", "-r", outputFile, ...archiveFiles], { cwd: stagingRoot, stdio: "inherit" });
}
console.log(JSON.stringify({ outputFile, files: files.length, ps1Utf8Bom: files.filter(name => name.endsWith(".ps1")).length, manifest }, null, 2));
