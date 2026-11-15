import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "desktop-bridge");
const packerPath = join(
  projectRoot,
  "scripts/package-utrust-first-install.mjs"
);
const installer = readFileSync(
  join(sourceRoot, "install-utrust-bridge.ps1"),
  "utf8"
);
const upgrader = readFileSync(
  join(sourceRoot, "upgrade_utrust_bridge.ps1"),
  "utf8"
);
const packer = readFileSync(packerPath, "utf8");
const eraseFiles = [
  "run_utrust_erase_initial.ps1",
  "UTrustNtag216EraseInitial.cs",
];
const runtimeFiles = [
  "utrust_local_bridge.ps1",
  "run_utrust_rfid_write.ps1",
  "UTrustNtag216RfidWrite.cs",
  "UTrustVehicleCardDiagnostic.cs",
  "run_utrust_vehicle_card_diagnostic.ps1",
  "UTrustReadVehicleEntry.cs",
  "run_utrust_read_vehicle_entry.ps1",
  "UTrustBridgeSupport.cs",
  "run_utrust_read_uid.ps1",
  "utrust_probe.ps1",
  ...eraseFiles,
];
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const deployedBytes = (name: string) => {
  const bytes = readFileSync(join(sourceRoot, name));
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return name.endsWith(".ps1") && !bytes.subarray(0, 3).equals(bom)
    ? Buffer.concat([bom, bytes])
    : bytes;
};
const hashBlock =
  upgrader.match(/\$expectedHashes\s*=\s*@\{([\s\S]*?)\n\}/)?.[1] || "";
const controlledHashes = Object.fromEntries(
  [...hashBlock.matchAll(/"([^"]+)"\s*=\s*"([a-f0-9]{64})"/g)].map(match => [
    match[1],
    match[2],
  ])
);
const tempRoots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "utrust-erase-installer-test-"));
  tempRoots.push(root);
  mkdirSync(join(root, "scripts"));
  cpSync(packerPath, join(root, "scripts/package-utrust-first-install.mjs"));
  cpSync(sourceRoot, join(root, "desktop-bridge"), { recursive: true });
  mkdirSync(join(root, "output"));
  return root;
}
const zipName = "utrust-bridge-first-install-v18-20261115.zip";
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe("Windows 恢复未绑定卡依赖安装契约", () => {
  it("首装v18、桥接/升级器v15和20261115构建一致，不升级底层writerVersion", () => {
    const bridge = readFileSync(
      join(sourceRoot, "utrust_local_bridge.ps1"),
      "utf8"
    );
    for (const source of [installer, upgrader, bridge]) {
      expect(source).toContain(
        '$bridgeVersion = "utrust-bridge-installer-v15"'
      );
      expect(source).toContain(
        '$bridgeBuildId = "utrust-rfid-installer-20261115-getversion-v15"'
      );
    }
    expect(installer).toContain(
      '$installerVersion = "utrust-first-install-v18"'
    );
    expect(upgrader).toContain(
      '$installerVersion = "utrust-upgrader-installer-v15"'
    );
    expect(upgrader).toContain('$writerVersion = "ntag216-atomic-v2"');
    expect(bridge).toContain('$requiredWriterVersion = "ntag216-atomic-v2"');
    expect(packer).toContain(zipName);
    expect(sha256(readFileSync(join(sourceRoot, "UTrustNtag216RfidWrite.cs")))).toBe(
      "b602906ad5c982c0e2a5d6945409f77c379f16ff32996094f4b8a243ebb4bd78"
    );
    for (const source of [installer, upgrader, bridge])
      expect(source).toContain('"ntag216-initial-erase-v2"');
    expect(packer).toContain('const initialEraseVersion = "ntag216-initial-erase-v2"');
  });

  it("两项擦除依赖同时进入首装、升级部署与受控SHA-256清单", () => {
    expect(Object.keys(controlledHashes).sort()).toEqual(
      [...runtimeFiles].sort()
    );
    for (const name of runtimeFiles) {
      expect(controlledHashes[name]).toBe(sha256(deployedBytes(name)));
      expect(packer).toContain(`"${name}"`);
    }
    for (const name of eraseFiles) expect(installer).toContain(`"${name}"`);
    expect(upgrader).toContain(
      `$bridgeContentSha256 = "${sha256(readFileSync(join(sourceRoot, "utrust_local_bridge.ps1")))}"`
    );
    expect(upgrader).toContain("foreach ($name in $expectedHashes.Keys)");
    expect(upgrader).toContain(
      "Get-FileHash -LiteralPath $targetPath -Algorithm SHA256"
    );
  });

  it("升级器内嵌桥接解码必须逐字节等于最终BOM原文，预检验证后原字节部署", () => {
    const encoded = upgrader.match(/\$embeddedBridgeBase64 = "([A-Za-z0-9+/=]+)"/)?.[1];
    expect(encoded).toBeTruthy();
    const embeddedBytes = Buffer.from(encoded!, "base64");
    expect([...embeddedBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(embeddedBytes.equals(deployedBytes("utrust_local_bridge.ps1"))).toBe(true);
    expect(sha256(embeddedBytes)).toBe(controlledHashes["utrust_local_bridge.ps1"]);
    expect(upgrader).toContain('throw "embedded_bridge_checksum_mismatch"');
    expect(upgrader).toContain('throw "embedded_bridge_bom_missing"');
    const preflight = upgrader.indexOf("$verifiedBridgeBytes = Get-VerifiedEmbeddedBridgeBytes");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(upgrader.indexOf('$stage = "stop_previous_bridge"'));
    expect(upgrader).toContain("[System.IO.File]::WriteAllBytes($tempPath, $verifiedBridgeBytes)");
    expect(upgrader).not.toContain("WriteAllText($tempPath");
    expect(upgrader).not.toContain("rfid_confirm_receipt.dpapi");
  });

  it("缺件、清单和PS1语法验证在改配置与停止旧桥接之前，失败分支不能报成功", () => {
    const packageCheck = installer.indexOf("\n  Test-InstallerPackage\n");
    const configuration = installer.indexOf(
      '$stage = "write_local_configuration"'
    );
    expect(packageCheck).toBeGreaterThan(-1);
    expect(configuration).toBeGreaterThan(packageCheck);
    expect(installer).toContain(
      'throw ("installer_package_file_missing:" + $name)'
    );
    expect(installer).toContain('throw "installer_package_manifest_missing"');
    expect(installer).toContain(
      'throw ("installer_package_checksum_mismatch:" + $name)'
    );
    expect(installer).toContain('throw "installer_package_build_identity_mismatch"');
    expect(installer).toContain('[string]$manifest.initialEraseVersion -ne "ntag216-initial-erase-v2"');
    expect(installer).toContain('[string]$ready.requiredWriterVersion -eq "ntag216-atomic-v2"');
    expect(installer).toContain(
      '$name.EndsWith(".ps1") -and -not (Test-PowerShellScriptSyntax $sourcePath)'
    );
    expect(installer).toContain("if (-not [bool]$upgrade.success) { throw");
    expect(installer).toContain(
      "Write-InstallResult $false $stage $targetRoot\n  exit 1"
    );
    const verify = upgrader.indexOf('$stage = "verify_upgrade_files"');
    const syntax = upgrader.indexOf('$name.EndsWith(".ps1")');
    const stop = upgrader.indexOf('$stage = "stop_previous_bridge"');
    expect(stop).toBeGreaterThan(verify);
    expect(stop).toBeGreaterThan(syntax);
    expect(upgrader).toContain('throw ("upgrade_file_missing:" + $name)');
    expect(upgrader).toContain('throw "upgrade_file_checksum_mismatch"');
    expect(installer).toContain("$ready.initialEraseReady -eq $true");
    expect(installer).toContain(
      '[string]$ready.initialEraseVersion -eq "ntag216-initial-erase-v2"'
    );
    expect(upgrader).toContain(
      'Reason = "bridge_erase_dependencies_not_ready"'
    );
    expect(upgrader).toContain(
      'if (-not (Stop-UTrustBridge)) { throw "previous_bridge_stop_failed" }'
    );
    const catchBody = upgrader.slice(
      upgrader.indexOf("  $failureStage = $stage")
    );
    expect(catchBody.indexOf("Stop-UTrustBridge")).toBeGreaterThan(
      catchBody.indexOf("if ($bridgeStopped -or $deploymentStarted)")
    );
    expect(catchBody).not.toContain("success = $true");
    expect(catchBody).toContain("success = $false");
    expect(catchBody).toContain(
      'throw ("bridge_upgrade_failed:" + $failureStage)'
    );
  });

  it("统一User环境路径、D盘默认/无D盘fallback与config，保留5阶段、轻量ready和安全回滚", () => {
    for (const source of [installer, upgrader]) {
      expect(source).toContain(
        'GetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", "User")'
      );
      expect(source).toContain('"D:\\manus"');
      expect(source).toContain('Join-Path $env:ProgramData "YuexinRfidBridge"');
      expect(
        [
          ...source.matchAll(/Write-(?:Install|Upgrade)Progress "([1-5])\/5 /g),
        ].map(match => match[1])
      ).toEqual(["1", "2", "3", "4", "5"]);
      expect(source).toContain('Uri "http://127.0.0.1:47601/ready"');
      expect(source).not.toContain('Uri "http://127.0.0.1:47601/health"');
    }
    expect(installer).toContain(
      'SetEnvironmentVariable("YUEXIN_RFID_BRIDGE_ROOT", $targetRoot, "User")'
    );
    expect(installer).toContain('Join-Path $targetRoot "bridge.config.json"');
    expect(installer).toContain("tokenPersisted = $false");
    expect(upgrader).toContain("backup-installer-v15-");
    expect(upgrader).toContain(
      "$previousFiles[$name] = Test-Path -LiteralPath $targetPath -PathType Leaf"
    );
    expect(upgrader).toContain(
      "if ($previousFiles[$name]) { Copy-Item -LiteralPath $backupPath"
    );
    expect(upgrader).toContain("else { Remove-Item -LiteralPath $targetPath");
    expect(upgrader).toContain('$targetPath + ".getversion-v15.tmp"');
    expect(upgrader).toContain("previousVersionRestored = $rollbackHealthy");
  });
});

describe("v18首装ZIP实际打包回归", () => {
  let archive: string;
  let entries: string[];
  let manifest: {
    packageVersion: string;
    bridgeVersion: string;
    bridgeBuildId: string;
    writerVersion: string;
    initialEraseVersion: string;
    tokenPersisted: boolean;
    bridgeContentSha256: string;
    files: Record<string, string>;
  };
  const zipBytes = (name: string) =>
    execFileSync("unzip", ["-p", archive, name]);

  beforeAll(() => {
    const root = fixture();
    execFileSync(
      process.execPath,
      [join(root, "scripts/package-utrust-first-install.mjs")],
      {
        env: {
          ...process.env,
          UTRUST_PACKAGE_OUTPUT_DIR: join(root, "output"),
        },
        timeout: 30_000,
      }
    );
    archive = join(root, "output", zipName);
    entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/);
    manifest = JSON.parse(zipBytes("manifest.json").toString("utf8"));
  });

  it("平铺ZIP包含全部16受控文件、擦除PS1/C#、manifest和README且逐项hash正确", () => {
    expect(entries).toHaveLength(18);
    expect(
      entries.every(name => !name.includes("/") && !name.includes("\\"))
    ).toBe(true);
    expect(entries).toContain("Install-Yuexin-RFID-Bridge.cmd");
    expect(entries).toContain("README-First-Install.txt");
    expect(entries).not.toContain("安装写卡桥接.cmd");
    expect(Object.keys(manifest.files)).toHaveLength(16);
    for (const name of eraseFiles) expect(entries).toContain(name);
    for (const [name, hash] of Object.entries(manifest.files))
      expect(sha256(zipBytes(name))).toBe(hash);
    for (const name of runtimeFiles)
      expect(manifest.files[name]).toBe(controlledHashes[name]);
    expect(manifest.packageVersion).toBe("utrust-first-install-v18");
    expect(manifest.bridgeVersion).toBe("utrust-bridge-installer-v15");
    expect(manifest.bridgeBuildId).toBe(
      "utrust-rfid-installer-20261115-getversion-v15"
    );
    expect(manifest.writerVersion).toBe("ntag216-atomic-v2");
    expect(manifest.initialEraseVersion).toBe("ntag216-initial-erase-v2");
    expect(manifest.files["UTrustNtag216RfidWrite.cs"]).toBe("b602906ad5c982c0e2a5d6945409f77c379f16ff32996094f4b8a243ebb4bd78");
    const embedded = zipBytes("upgrade_utrust_bridge.ps1").toString("utf8").match(/\$embeddedBridgeBase64 = "([A-Za-z0-9+/=]+)"/)?.[1];
    expect(Buffer.from(embedded!, "base64").equals(zipBytes("utrust_local_bridge.ps1"))).toBe(true);
    expect(manifest.bridgeContentSha256).toBe(
      sha256(zipBytes("utrust_local_bridge.ps1"))
    );
    expect(manifest.tokenPersisted).toBe(false);
  });

  it("全部归档PS1和新增/修改的源PS1保留UTF8 BOM，CMD只有ASCII和CRLF，README说明恢复依赖与缺件失败", () => {
    for (const name of entries.filter(name => name.endsWith(".ps1"))) {
      expect([...zipBytes(name).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    }
    for (const name of [
      "install-utrust-bridge.ps1",
      "upgrade_utrust_bridge.ps1",
      "utrust_local_bridge.ps1",
      "run_utrust_erase_initial.ps1",
    ]) {
      expect([...readFileSync(join(sourceRoot, name)).subarray(0, 3)]).toEqual([
        0xef, 0xbb, 0xbf,
      ]);
    }
    const launcher = zipBytes("Install-Yuexin-RFID-Bridge.cmd");
    expect(
      [...launcher].every(
        byte =>
          byte === 9 ||
          byte === 10 ||
          byte === 13 ||
          (byte >= 32 && byte <= 126)
      )
    ).toBe(true);
    expect(launcher.toString("ascii").replace(/\r\n/g, "")).not.toContain("\n");
    for (const name of eraseFiles)
      expect(zipBytes("README-First-Install.txt").toString("utf8")).toContain(
        name
      );
    expect(zipBytes("README-First-Install.txt").toString("utf8")).toContain(
      "不会显示安装成功"
    );
  });

  for (const missingFile of eraseFiles) {
    it(`缺失${missingFile}时打包失败且不覆盖已有ZIP`, () => {
      const root = fixture();
      rmSync(join(root, "desktop-bridge", missingFile));
      const output = join(root, "output", zipName);
      writeFileSync(output, "previous-package-do-not-overwrite\n");
      const result = spawnSync(
        process.execPath,
        [join(root, "scripts/package-utrust-first-install.mjs")],
        {
          env: {
            ...process.env,
            UTRUST_PACKAGE_OUTPUT_DIR: join(root, "output"),
          },
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`首次安装包缺少受控文件：${missingFile}`);
      expect(readFileSync(output, "utf8")).toBe(
        "previous-package-do-not-overwrite\n"
      );
    });
  }

  it("擦除文件被篡改时打包失败且不生成ZIP", () => {
    const root = fixture();
    writeFileSync(
      join(root, "desktop-bridge", "UTrustNtag216EraseInitial.cs"),
      "// corrupted erase program\n"
    );
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/package-utrust-first-install.mjs")],
      {
        env: {
          ...process.env,
          UTRUST_PACKAGE_OUTPUT_DIR: join(root, "output"),
        },
        encoding: "utf8",
        timeout: 30_000,
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "升级器受控文件校验和不匹配：UTrustNtag216EraseInitial.cs"
    );
    expect(existsSync(join(root, "output", zipName))).toBe(false);
  });

  it.each([
    ["embedded", "升级器内嵌桥接与最终 UTF-8 BOM 原文不一致"],
    ["erase-version", "初卡恢复程序版本不匹配"],
    ["writer-baseline", "正式写卡器原文 SHA-256 与基线不一致"],
    ["installer-version", "首次安装器版本不匹配"],
  ])("%s异常拒绝打包且保留之前的ZIP", (mode, expectedError) => {
    const root = fixture();
    const fixtureSource = join(root, "desktop-bridge");
    const upgradePath = join(fixtureSource, "upgrade_utrust_bridge.ps1");
    let upgrade = readFileSync(upgradePath, "utf8");
    if (mode === "embedded") {
      const encoded = upgrade.match(/\$embeddedBridgeBase64 = "([A-Za-z0-9+/=]+)"/)![1];
      const corrupted = Buffer.from(encoded, "base64");
      corrupted[3] ^= 1;
      upgrade = upgrade.replace(encoded, corrupted.toString("base64"));
    } else if (mode === "installer-version") {
      const path = join(fixtureSource, "install-utrust-bridge.ps1");
      writeFileSync(path, readFileSync(path, "utf8").replace("utrust-first-install-v18", "utrust-first-install-v17"));
    } else {
      const name = mode === "erase-version" ? "UTrustNtag216EraseInitial.cs" : "UTrustNtag216RfidWrite.cs";
      const path = join(fixtureSource, name);
      const text = readFileSync(path, "utf8");
      const bytes = Buffer.from(mode === "erase-version" ? text.replace("ntag216-initial-erase-v2", "ntag216-initial-erase-v1") : text + "\n// unauthorized writer change\n");
      writeFileSync(path, bytes);
      // Even a refreshed source hash must not permit old erase behavior or any formal-writer change.
      upgrade = upgrade.replace(`"${name}" = "${controlledHashes[name]}"`, `"${name}" = "${sha256(bytes)}"`);
    }
    writeFileSync(upgradePath, upgrade);
    const output = join(root, "output", zipName);
    writeFileSync(output, "previous-package-do-not-overwrite\n");
    const result = spawnSync(process.execPath, [join(root, "scripts/package-utrust-first-install.mjs")], {
      env: { ...process.env, UTRUST_PACKAGE_OUTPUT_DIR: join(root, "output") },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
    expect(readFileSync(output, "utf8")).toBe("previous-package-do-not-overwrite\n");
  });
});
