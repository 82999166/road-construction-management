import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPage.tsx"), "utf8");

describe("系统设置通知通道入口", () => {
  it("将短信与服务号通知通道配置放在系统设置顶部", () => {
    const heading = source.indexOf("系统设置中心");
    const channels = source.indexOf("<NotificationChannelSettings />");
    const dailyDigest = source.indexOf("每日项目站内汇总");
    expect(heading).toBeGreaterThan(-1);
    expect(channels).toBeGreaterThan(heading);
    expect(channels).toBeLessThan(dailyDigest);
  });
});
