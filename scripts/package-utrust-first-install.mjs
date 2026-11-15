import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** fileURLToPath 在 Windows 正确移除 file:///D:/ 前缀，避免首装包漏掉中文文件名。 */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "desktop-bridge");
const packageVersion = "utrust-first-install-v18";
const bridgeVersion = "utrust-bridge-installer-v15";
const bridgeBuildId = "utrust-rfid-installer-20261115-getversion-v15";
const writerVersion = "ntag216-atomic-v2";
const initialEraseVersion = "ntag216-initial-erase-v2";
const writerBaselineSha256 = "b602906ad5c982c0e2a5d6945409f77c379f16ff32996094f4b8a243ebb4bd78";
const outputRoot = process.env.UTRUST_PACKAGE_OUTPUT_DIR || join(projectRoot, "artifacts", "utrust-first-install");
const outputFile = join(outputRoot, "utrust-bridge-first-install-v18-20261115.zip");
const files = [
  "安装写卡桥接.cmd",
  "elevate-utrust-installer.ps1",
  "install-utrust-bridge.ps1",
  "upgrade_utrust_bridge.ps1",
  "utrust_local_bridge.ps1",
  "run_utrust_rfid_write.ps1",
  "run_utrust_read_uid.ps1",
  "utrust_probe.ps1",
  "run_utrust_read_vehicle_entry.ps1",
  "run_utrust_vehicle_card_diagnostic.ps1",
  "run_utrust_erase_initial.ps1",
  "UTrustNtag216RfidWrite.cs",
  "UTrustBridgeSupport.cs",
  "UTrustReadVehicleEntry.cs",
  "UTrustVehicleCardDiagnostic.cs",
  "UTrustNtag216EraseInitial.cs",
];
const archiveFileName = sourceName => (sourceName === "安装写卡桥接.cmd" ? "Install-Yuexin-RFID-Bridge.cmd" : sourceName);
const packagedFiles = files.map(sourceName => ({ sourceName, archiveName: archiveFileName(sourceName) }));
const readmeFileName = "README-First-Install.txt";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

// Preflight everything before touching a previous archive or staging directory.
const preparedFiles = packagedFiles.map(({ sourceName, archiveName }) => {
  const sourcePath = join(sourceRoot, sourceName);
  if (!existsSync(sourcePath)) throw new Error(`首次安装包缺少受控文件：${sourceName}`);
  let bytes = readFileSync(sourcePath);
  if (sourceName.endsWith(".cmd")) {
    const text = bytes.toString("utf8");
    if (!/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text)) {
      throw new Error("Windows CMD 启动器只能包含 ASCII 字符，避免旧版 cmd.exe 编码解析失败");
    }
    bytes = Buffer.from(text.replace(/\r?\n/g, "\r\n"), "ascii");
  } else if (sourceName.endsWith(".ps1")) {
    if (bytes.subarray(0, 3).equals(utf8Bom)) bytes = bytes.subarray(3);
    bytes = Buffer.concat([utf8Bom, bytes]);
  }
  return { sourceName, archiveName, bytes };
});
const bytesFor = name => preparedFiles.find(file => file.sourceName === name).bytes;
const textFor = name => bytesFor(name).toString("utf8");
const upgradeSource = textFor("upgrade_utrust_bridge.ps1");
const expectedHashesBlock = upgradeSource.match(/\$expectedHashes\s*=\s*@\{([\s\S]*?)\n\}/)?.[1];
if (!expectedHashesBlock) throw new Error("升级器缺少受控 SHA-256 清单");
const expectedHashes = Object.fromEntries([...expectedHashesBlock.matchAll(/"([^"]+)"\s*=\s*"([a-f0-9]{64})"/g)].map(match => [match[1], match[2]]));
const runtimeFiles = preparedFiles.filter(file => !["安装写卡桥接.cmd", "elevate-utrust-installer.ps1", "install-utrust-bridge.ps1", "upgrade_utrust_bridge.ps1"].includes(file.sourceName));
for (const { sourceName, bytes } of runtimeFiles) {
  if (expectedHashes[sourceName] !== sha256(bytes)) throw new Error(`升级器受控文件校验和不匹配：${sourceName}`);
}
if (Object.keys(expectedHashes).length !== runtimeFiles.length) throw new Error("升级器与首装运行文件清单不一致");
if (sha256(bytesFor("UTrustNtag216RfidWrite.cs")) !== writerBaselineSha256) throw new Error("正式写卡器原文 SHA-256 与基线不一致");
const bridgeBytes = bytesFor("utrust_local_bridge.ps1");
const bridgeContentSha256 = sha256(bridgeBytes);
if (!upgradeSource.includes(`$bridgeContentSha256 = "${bridgeContentSha256}"`)) throw new Error("升级器桥接构建校验和不匹配");
const embeddedBridgeBase64 = upgradeSource.match(/\$embeddedBridgeBase64 = "([A-Za-z0-9+/=]+)"/)?.[1];
if (!embeddedBridgeBase64 || !Buffer.from(embeddedBridgeBase64, "base64").equals(bridgeBytes)) throw new Error("升级器内嵌桥接与最终 UTF-8 BOM 原文不一致");
for (const name of ["utrust_local_bridge.ps1", "install-utrust-bridge.ps1", "upgrade_utrust_bridge.ps1"]) {
  const text = textFor(name);
  if (!text.includes(`$bridgeVersion = "${bridgeVersion}"`) || !text.includes(`$bridgeBuildId = "${bridgeBuildId}"`)) throw new Error(`桥接构建版本不匹配：${name}`);
  if (!text.includes(`"${initialEraseVersion}"`)) throw new Error(`初卡恢复版本不匹配：${name}`);
}
if (!textFor("install-utrust-bridge.ps1").includes(`$installerVersion = "${packageVersion}"`)) throw new Error("首次安装器版本不匹配");
if (!upgradeSource.includes('$installerVersion = "utrust-upgrader-installer-v15"')) throw new Error("升级安装器版本不匹配");
if (!textFor("UTrustNtag216EraseInitial.cs").includes(`WriterVersion = "${initialEraseVersion}"`)) throw new Error("初卡恢复程序版本不匹配");
if (!textFor("UTrustNtag216RfidWrite.cs").includes(`WriterVersion = "${writerVersion}"`) || !textFor("utrust_local_bridge.ps1").includes(`$requiredWriterVersion = "${writerVersion}"`) || !upgradeSource.includes(`$writerVersion = "${writerVersion}"`)) throw new Error("正式写卡器版本链不匹配");

const stagingRoot = mkdtempSync(join(tmpdir(), "utrust-first-install-v18-"));
try {
  for (const { archiveName, bytes } of preparedFiles) writeFileSync(join(stagingRoot, archiveName), bytes);
  const manifest = Object.fromEntries(preparedFiles.map(({ archiveName, bytes }) => [archiveName, sha256(bytes)]));
  writeFileSync(join(stagingRoot, "manifest.json"), `${JSON.stringify({ packageVersion, bridgeVersion, bridgeBuildId, bridgeContentSha256, writerVersion, initialEraseVersion, tokenPersisted: false, files: manifest }, null, 2)}\n`, "utf8");
  writeFileSync(join(stagingRoot, readmeFileName), "推荐：解压后双击“Install-Yuexin-RFID-Bridge.cmd”，并在系统权限窗口选择“是”。v18（20261115）修复 NTAG216 GET_VERSION 回包兼容：恢复程序 ntag216-initial-erase-v2 严格校验 CRC 和型号，支持原始10字节与追加9000的12字节响应。读卡器识别/CRC/长度异常不等同卡型号错误；未知动态锁 RFUI 保护配置仍拒绝恢复。包含恢复未绑定卡所需的 run_utrust_erase_initial.ps1 和 UTrustNtag216EraseInitial.cs；缺少任一受控文件或校验和不符时安装会失败，不会显示安装成功。桥接版本 utrust-bridge-installer-v15，构建 utrust-rfid-installer-20261115-getversion-v15；正式写卡器 ntag216-atomic-v2 原文保持不变。升级器内嵌桥接与最终 UTF-8 BOM 原文逐字节一致。路径优先使用当前用户 YUEXIN_RFID_BRIDGE_ROOT；默认 D:\\manus，无 D 盘时使用 ProgramData\\YuexinRfidBridge，配置文件为同目录 bridge.config.json。本版本会在管理员 PowerShell 窗口实时显示5个安装阶段；桥接启动验证不会调用读卡器探测。CMD 启动器为 ASCII 和 Windows CRLF，并以绝对路径调用 PowerShell，兼容中文、空格或括号下载目录。安装与升级仅复制受控文件，不复制令牌或待确认收据；写卡令牌由后台按次短时下发。恢复前必须明确确认，并保持来源白名单和 UID 指纹绑定。\r\n", "utf8");
  mkdirSync(outputRoot, { recursive: true });
  rmSync(outputFile, { force: true });
  /**
   * 显式平铺列出归档文件，而不打包目录根 "."：Windows PowerShell 5.1 的
   * Expand-Archive 会将部分 tar.exe 生成的根目录条目视作非法路径。
   */
  const archiveFiles = [...packagedFiles.map(({ archiveName }) => archiveName), "manifest.json", readmeFileName];
  if (process.platform === "win32") {
    execFileSync("tar.exe", ["-a", "-c", "-f", outputFile, ...archiveFiles], { cwd: stagingRoot, stdio: "inherit" });
  } else {
    execFileSync("zip", ["-q", "-r", outputFile, ...archiveFiles], { cwd: stagingRoot, stdio: "inherit" });
  }
  console.log(JSON.stringify({ outputFile, zipSha256: sha256(readFileSync(outputFile)), packageVersion, bridgeVersion, bridgeBuildId, writerVersion, initialEraseVersion, bridgeContentSha256, writerSha256: writerBaselineSha256, files: files.length, ps1Utf8Bom: files.filter(name => name.endsWith(".ps1")).length, manifest }, null, 2));
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
