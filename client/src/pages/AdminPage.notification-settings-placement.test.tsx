import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPage.tsx"), "utf8");

describe("系统设置通知通道入口", () => {
  it("将短信与服务号通知通道配置收纳到通知与接入分类", () => {
    const heading = source.indexOf("平台治理 / 系统设置");
    const channels = source.indexOf("<NotificationChannelSettings />");
    const dailyDigest = source.indexOf("每日项目站内汇总");
    expect(heading).toBeGreaterThan(-1);
    expect(channels).toBeGreaterThan(heading);
    expect(channels).toBeLessThan(dailyDigest);
    expect(source).toContain('settingsCategory === "integrations" ? <Suspense');
  });
});
