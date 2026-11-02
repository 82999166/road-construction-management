import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("自有服务器全库备份脚本", () => {
  it("导出全部数据库对象，并在临时文件校验后原子发布成功清单", () => {
    const source = readFileSync(new URL("../scripts/self-host-db-backup.mjs", import.meta.url), "utf8");
    expect(source).toContain('"--single-transaction"');
    expect(source).toContain('"--routines"');
    expect(source).toContain('"--events"');
    expect(source).toContain('"--triggers"');
    expect(source).toContain('"--databases"');
    expect(source).toContain('gzip", ["-t", filePath]');
    expect(source).toContain("CREATE TABLE \\`${table}\\`");
    expect(source).toContain('const result = await run("mysql"');
    expect(source).toContain('const exitCodePromise = new Promise(resolve => child.once("close", resolve));');
    expect(source).toContain("partialDumpPath");
    expect(source).toContain("await fs.rename(partialDumpPath, dumpPath)");
    expect(source).toContain("writeJsonAtomic(join(backupDir, \"latest-success.json\")");
    expect(source).toContain("await fs.unlink(join(backupDir, \"latest-failure.json\"))");
    expect(source).toContain("process.umask(0o027)");
    expect(source).toContain("backup_verified");
    expect(source).toContain("backup_failed");
    expect(source).not.toContain("backupFile: dumpPath");
    expect(source).not.toContain("manifestFile: manifestPath");
  });

  it("离线校验流式定位备份文件并重新校验压缩、哈希和所有表定义", () => {
    const source = readFileSync(new URL("../scripts/verify-self-host-db-backup.mjs", import.meta.url), "utf8");
    expect(source).toContain("resolve(manifestDirectory, manifest.backupFile)");
    expect(source).toContain('gzip", ["-t", dumpPath]');
    expect(source).toContain("createReadStream(dumpPath)");
    expect(source).toContain("createGunzip()");
    expect(source).toContain("备份 SHA-256 校验失败");
    expect(source).toContain("备份缺少");
    expect(source).not.toContain("await fs.readFile(dumpPath)");
    expect(source).not.toContain('gzip", ["-cd", dumpPath]');
  });
});
