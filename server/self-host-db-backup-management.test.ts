import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("完整数据库备份后台管理", () => {
  it("仅在服务器端读取完整备份工件，浏览器DTO不携带数据库名、真实文件名、路径或凭据", () => {
    const service = readFileSync(new URL("./services/selfHostDatabaseBackup.ts", import.meta.url), "utf8");
    const router = readFileSync(new URL("./routers/admin.ts", import.meta.url), "utf8");
    expect(service).toContain("getSelfHostDatabaseBackupStatus");
    expect(service).toContain("getVerifiedSelfHostDatabaseBackupArtifact");
    expect(service).toContain("backupId: item.sha256.toLowerCase()");
    expect(service).toContain("browserDownloadEnabled");
    expect(service).toContain("yx-db-backup.service");
    expect(service).toContain('execFileAsync("sudo", ["-n", "/usr/bin/systemctl", "start", backupServiceName()]');
    expect(service).toContain("应用账户只读取无凭据的受控产物目录");
    expect(service).not.toContain("database: \"已配置\"");
    expect(service).not.toContain("defaultsFile:");
    expect(service).not.toContain("YX_DB_BACKUP_MYSQL_DEFAULTS_FILE");
    expect(router).toContain("fullStatus:");
    expect(router).toContain("createFull:");
    expect(router).toContain("await assertSuperAdmin(ctx)");
    expect(router).toContain("full_database_backup");
  });

  it("将服务器端备份脚本随自建生产包归档，不复制数据库凭据，并以低权限服务账户安全运行", () => {
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const staging = readFileSync(new URL("../scripts/stage-self-host-runtime.mjs", import.meta.url), "utf8");
    const serviceUnit = readFileSync(new URL("../deploy/yx-db-backup.service", import.meta.url), "utf8");
    expect(packageJson).toContain("stage-self-host-runtime.mjs");
    expect(staging).toContain("self-host-db-backup.mjs");
    expect(staging).toContain("verify-self-host-db-backup.mjs");
    expect(staging).toContain("yx-db-backup.service");
    expect(staging).toContain("yx-db-backup.timer");
    expect(staging).not.toContain("YX_DB_BACKUP_MYSQL_DEFAULTS_FILE");
    expect(serviceUnit).toContain("User=yxbackup");
    expect(serviceUnit).toContain("Group=yxbackup");
    expect(serviceUnit).toContain("EnvironmentFile=/etc/yx-cloud-management/backup.env");
    expect(serviceUnit).toContain("/usr/local/lib/yx-cloud-management/backup/self-host-db-backup.mjs");
    expect(serviceUnit).toContain("WorkingDirectory=/var/backups/yx-cloud-management/mysql");
    expect(serviceUnit).toContain("UMask=0027");
    expect(serviceUnit).toContain("TimeoutStartSec=2h");
    expect(serviceUnit).toContain("ProtectKernelTunables=true");
  });
});
