import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("自有服务器全库备份脚本", () => {
  it("导出全部数据库对象并验证 gzip、哈希和每一张表定义", () => {
    const source = readFileSync(new URL("../scripts/self-host-db-backup.mjs", import.meta.url), "utf8");
    expect(source).toContain('"--single-transaction"');
    expect(source).toContain('"--routines"');
    expect(source).toContain('"--events"');
    expect(source).toContain('"--triggers"');
    expect(source).toContain('"--databases"');
    expect(source).toContain('gzip", ["-t", filePath]');
    expect(source).toContain("CREATE TABLE \\`${table}\\`");
    expect(source).toContain("latest-success.json");
    expect(source).toContain("latest-failure.json");
  });

  it("离线校验按清单定位备份文件并重新校验压缩、哈希和所有表定义", () => {
    const source = readFileSync(new URL("../scripts/verify-self-host-db-backup.mjs", import.meta.url), "utf8");
    expect(source).toContain("resolve(dirname(manifestPath), manifest.backupFile)");
    expect(source).toContain('gzip", ["-t", dumpPath]');
    expect(source).toContain("备份 SHA-256 校验失败");
    expect(source).toContain("备份缺少表定义");
  });
});
