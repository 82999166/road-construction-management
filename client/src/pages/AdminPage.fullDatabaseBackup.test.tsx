import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("超级管理后台完整数据库备份面板", () => {
  it("提供服务器端手工备份、真实校验状态和仅已验证工件可见的受控下载确认，不提供在线恢复", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("完整数据库灾备（服务器端）");
    expect(source).toContain("trpc.admin.backup.fullStatus.useQuery");
    expect(source).toContain("trpc.admin.backup.createFull.useMutation");
    expect(source).toContain("执行完整备份");
    expect(source).toContain("fullDatabaseBackup.data.browserDownload.available");
    expect(source).toContain("下载已验证完整备份");
    expect(source).toContain("确认下载并记录审计");
    expect(source).toContain("/api/admin/backups/full/${encodeURIComponent(fullBackupDownloadTarget.backupId)}/download");
    expect(source).toContain("系统始终不提供在线恢复");
    expect(source).not.toContain("不开放浏览器直接下载或在线恢复");
  });
});
