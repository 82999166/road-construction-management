import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("完整数据库备份后台管理", () => {
  it("服务器端受控备份和下载不向浏览器返回路径与凭据，固定启动不用sudo", () => {
    const service = readFileSync(
      new URL("./services/selfHostDatabaseBackup.ts", import.meta.url),
      "utf8"
    );
    const router = readFileSync(
      new URL("./routers/admin.ts", import.meta.url),
      "utf8"
    );
    expect(service).toContain("getSelfHostDatabaseBackupStatus");
    expect(service).toContain("getVerifiedSelfHostDatabaseBackupArtifact");
    expect(service).toContain("backupId: item.sha256.toLowerCase()");
    expect(service).toContain("browserDownloadEnabled");
    expect(service).toContain(
      '"--no-ask-password", "start", backupServiceName()'
    );
    expect(service).not.toContain('execFileAsync("sudo"');
    expect(service).toContain("应用账户只读取无凭据的受控产物目录");
    expect(service).not.toContain("defaultsFile:");
    expect(service).not.toContain("YX_DB_BACKUP_MYSQL_DEFAULTS_FILE");
    expect(router).toContain("fullStatus:");
    expect(router).toContain("fullHistory:");
    expect(router).toContain("createFull:");
    expect(router).toContain("await assertSuperAdmin(ctx)");
    expect(router).toContain("create_requested");
    expect(router).toContain("full_database_backup");
  });

  it("备份脚本、unit和root所有的窄授权随版本打包，不复制凭据、不解除安全策略", () => {
    const staging = readFileSync(
      new URL("../scripts/stage-self-host-runtime.mjs", import.meta.url),
      "utf8"
    );
    const serviceUnit = readFileSync(
      new URL("../deploy/yx-db-backup.service", import.meta.url),
      "utf8"
    );
    const publish = readFileSync(
      new URL("../scripts/publish-self-host-release.sh", import.meta.url),
      "utf8"
    );
    expect(staging).toContain("self-host-db-backup.mjs");
    expect(staging).toContain("verify-self-host-db-backup.mjs");
    expect(staging).toContain("yx-db-backup.service");
    expect(staging).toContain("yx-db-backup.timer");
    expect(staging).toContain("50-yx-db-backup.rules");
    expect(staging).not.toContain("YX_DB_BACKUP_MYSQL_DEFAULTS_FILE");
    expect(publish).toContain(
      'install -o root -g root -m 0644 "$new_release/dist/deploy/50-yx-db-backup.rules"'
    );
    expect(publish).not.toContain("NoNewPrivileges=no");
    expect(serviceUnit).toContain("User=yxbackup");
    expect(serviceUnit).toContain("Group=yxbackup");
    expect(serviceUnit).toContain("NoNewPrivileges=true");
    expect(serviceUnit).toContain(
      "EnvironmentFile=/etc/yx-cloud-management/backup.env"
    );
    expect(serviceUnit).toContain("UMask=0027");
    expect(serviceUnit).toContain("TimeoutStartSec=2h");
    expect(serviceUnit).toContain("ProtectKernelTunables=true");
  });

  it("运行窄polkit规则：仅yxapp+固定备份unit+start授权，其他用户/服务/动作均无新增授权", () => {
    let rule!: (action: object, subject: object) => unknown;
    const source = readFileSync(
      new URL("../deploy/50-yx-db-backup.rules", import.meta.url),
      "utf8"
    );
    runInNewContext(source, {
      polkit: {
        addRule: (fn: typeof rule) => {
          rule = fn;
        },
        Result: { YES: "YES" },
      },
    });
    const check = (
      user: string,
      unit: string,
      verb: string,
      id = "org.freedesktop.systemd1.manage-units"
    ) =>
      rule(
        {
          id,
          lookup: (key: string) => ({ unit, verb })[key as "unit" | "verb"],
        },
        { user }
      );
    expect(check("yxapp", "yx-db-backup.service", "start")).toBe("YES");
    for (const user of ["nobody", "yxbackup", "ordinary-user"])
      expect(check(user, "yx-db-backup.service", "start")).toBeUndefined();
    for (const unit of [
      "yx-cloud-management.service",
      "ssh.service",
      "yx-db-backup-other.service",
      "yx-db-backup@other.service",
    ])
      expect(check("yxapp", unit, "start")).toBeUndefined();
    for (const verb of ["stop", "restart", "reload", "enable", "set-property"])
      expect(check("yxapp", "yx-db-backup.service", verb)).toBeUndefined();
    expect(
      check(
        "yxapp",
        "yx-db-backup.service",
        "start",
        "org.freedesktop.systemd1.manage-unit-files"
      )
    ).toBeUndefined();
    expect(source).not.toContain("YES_KEEP");
  });
});
