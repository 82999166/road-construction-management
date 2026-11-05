import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  exists: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
}));
vi.mock("node:fs", () => ({
  existsSync: mocks.exists,
  promises: { readFile: mocks.read, stat: mocks.stat, lstat: mocks.lstat },
}));
vi.mock("node:util", async importOriginal => ({
  ...(await importOriginal<object>()),
  promisify: () => mocks.exec,
}));
import { createSelfHostDatabaseBackup } from "./services/selfHostDatabaseBackup";

const old = () => ({
  database: "SECRET_DATABASE",
  backupFile: "yx-full-old.sql.gz",
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  tableCount: 116,
  compressedBytes: 42,
  sha256: "a".repeat(64),
  verification: { gzipIntegrity: "passed", allTableDefinitionsPresent: true },
  retention: { keepDays: 30, removedFiles: ["SECRET_PATH"] },
});
let latest: ReturnType<typeof old>;
let onStart: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.YX_DB_BACKUP_SYSTEMD_SERVICE;
  delete process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES;
  latest = old();
  mocks.exists.mockReturnValue(true);
  mocks.stat.mockResolvedValue({ isDirectory: () => true });
  mocks.lstat.mockResolvedValue({
    isFile: () => true,
    isSymbolicLink: () => false,
    size: 42,
  });
  mocks.read.mockImplementation(async () => JSON.stringify(latest));
  onStart = () => {
    latest = {
      ...latest,
      backupFile: "yx-full-new.sql.gz",
      createdAt: new Date().toISOString(),
    };
  };
  mocks.exec.mockImplementation(async (_command, args) => {
    if (args.includes("show")) return { stdout: "inactive\n", stderr: "" };
    onStart();
    return { stdout: "", stderr: "" };
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.YX_DB_BACKUP_SYSTEMD_SERVICE;
  delete process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES;
  vi.restoreAllMocks();
});

describe("完整备份受控启动真实函数", () => {
  it("只调用固定systemctl单元，无sudo或shell，SHA相同但新文件与新时间仍可成功", async () => {
    const result = await createSelfHostDatabaseBackup();
    expect(mocks.exec).toHaveBeenNthCalledWith(
      2,
      "/usr/bin/systemctl",
      ["--no-ask-password", "start", "yx-db-backup.service"],
      expect.objectContaining({ timeout: 900000 })
    );
    expect(result.sha256).toBe("a".repeat(64));
    expect(result.tableCount).toBe(116);
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET_DATABASE|SECRET_PATH|backupFile|database/
    );
  });

  it("不把旧成功清单当成本次成功", async () => {
    onStart = () => undefined;
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "本次未生成新的已验证备份"
    );
  });

  it("新文件仍旧时间也不能宣告本次成功", async () => {
    onStart = () => {
      latest.backupFile = "yx-full-new.sql.gz";
    };
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "本次未生成新的已验证备份"
    );
  });

  it("异常未来时间拒绝", async () => {
    onStart = () => {
      latest = {
        ...latest,
        backupFile: "yx-full-new.sql.gz",
        createdAt: new Date(Date.now() + 60000).toISOString(),
      };
    };
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "本次未生成新的已验证备份"
    );
  });

  it("校验未通过拒绝", async () => {
    onStart = () => {
      latest = {
        ...latest,
        backupFile: "yx-full-new.sql.gz",
        createdAt: new Date().toISOString(),
        verification: {
          gzipIntegrity: "failed",
          allTableDefinitionsPresent: true,
        },
      };
    };
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "本次未生成新的已验证备份"
    );
  });

  it("启动授权失败给出中文提示且不泄露stderr", async () => {
    mocks.exec.mockImplementation(async (_command, args) => {
      if (args.includes("show")) return { stdout: "inactive", stderr: "" };
      throw Object.assign(new Error("SECRET_PATH"), {
        stderr:
          "Interactive authentication required SECRET_PASSWORD /etc/private",
      });
    });
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "备份启动授权未通过"
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
      /SECRET|\/etc/
    );
  });

  it("超时提示任务可能还在执行而非假定已经停止", async () => {
    mocks.exec.mockImplementation(async (_command, args) => {
      if (args.includes("show")) return { stdout: "inactive" };
      throw { killed: true, stderr: "SECRET" };
    });
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "服务可能仍在执行"
    );
  });

  it.each(["active", "activating", "deactivating"])(
    "服务%s拒绝重复启动",
    async state => {
      mocks.exec.mockResolvedValue({ stdout: state });
      await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
        "已有完整备份任务正在执行"
      );
      expect(mocks.exec).toHaveBeenCalledTimes(1);
    }
  );

  it("未知服务状态不启动", async () => {
    mocks.exec.mockResolvedValue({ stdout: "unknown" });
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "完整数据库备份未成功"
    );
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });

  it("并发申请不会再次启动，完成后可正常再次申请", async () => {
    let unblock!: (value: object) => void;
    const gate = new Promise(resolve => {
      unblock = resolve;
    });
    mocks.exec.mockImplementationOnce(() => gate);
    const first = createSelfHostDatabaseBackup();
    await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "已有完整备份请求正在执行"
    );
    unblock({ stdout: "inactive", stderr: "" });
    await first;
    onStart = () => {
      latest = {
        ...latest,
        backupFile: "yx-full-newer.sql.gz",
        createdAt: new Date(Date.now() + 1).toISOString(),
      };
    };
    await expect(createSelfHostDatabaseBackup()).resolves.toMatchObject({
      tableCount: 116,
    });
  });

  it("不允许配置启动其他服务", async () => {
    process.env.YX_DB_BACKUP_SYSTEMD_SERVICE = "yx-cloud-management.service";
    await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
      "完整备份服务配置不一致"
    );
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it.each(["missing", "symlink", "wrong-size"])(
    "新工件%s不成功且不泄露真实文件路径",
    async kind => {
      if (kind === "missing")
        mocks.lstat.mockRejectedValue(new Error("ENOENT SECRET_PATH"));
      else
        mocks.lstat.mockResolvedValue({
          isFile: () => true,
          isSymbolicLink: () => kind === "symlink",
          size: kind === "wrong-size" ? 40 : 42,
        });
      await expect(createSelfHostDatabaseBackup()).rejects.toThrow(
        "本次备份文件完整性核验未通过"
      );
    }
  );

  it("完整备份大小不受浏览器受控下载大小上限影响", async () => {
    process.env.YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES = "1";
    await expect(createSelfHostDatabaseBackup()).resolves.toMatchObject({
      compressedBytes: 42,
    });
  });
});
