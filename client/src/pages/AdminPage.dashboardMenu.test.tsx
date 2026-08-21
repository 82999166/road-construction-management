import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台数据大屏菜单入口", () => {
  it("将首页交通施工指挥大屏入口置于运营概览之前", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const dashboardMenuIndex = source.indexOf('{ icon: Monitor, label: "数据大屏", path: "/", section: "决策总览" }');
    const overviewMenuIndex = source.indexOf('{ icon: LayoutDashboard, label: "运营概览", path: "/admin", section: "决策总览" }');
    expect(dashboardMenuIndex).toBeGreaterThan(-1);
    expect(overviewMenuIndex).toBeGreaterThan(-1);
    expect(dashboardMenuIndex).toBeLessThan(overviewMenuIndex);
  });
});
