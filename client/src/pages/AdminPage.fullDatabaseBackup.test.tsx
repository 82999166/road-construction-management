import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("超级管理后台完整数据库备份面板", () => {
  it("提供服务器端手工备份和逐表校验状态，但不提供浏览器直接恢复入口", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("完整数据库灾备（服务器端）");
    expect(source).toContain("trpc.admin.backup.fullStatus.useQuery");
    expect(source).toContain("trpc.admin.backup.createFull.useMutation");
    expect(source).toContain("执行完整备份");
    expect(source).toContain("逐表校验通过");
    expect(source).toContain("不开放浏览器直接下载或在线恢复");
  });
});
