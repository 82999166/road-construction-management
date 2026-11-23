import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./AdminPage.tsx", import.meta.url),
  "utf8"
);
const menuSource =
  source.match(
    /const ADMIN_MENU: DashboardMenuItem\[\] = \[([\s\S]*?)\n\];/
  )?.[1] ?? "";
const items = Array.from(
  menuSource.matchAll(
    /\{\s*icon:\s*(\w+),\s*label:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*section:\s*"([^"]+)"\s*,?\s*\}/g
  )
).map(([, icon, label, path, section]) => ({ icon, label, path, section }));

const expectedGroups = [
  ["总览工作台", ["数据大屏", "运营概览"]],
  ["项目与人员", ["组织与项目", "施工管理", "现场取证", "劳务工资"]],
  ["设备与运输", ["车辆管理", "机械管理", "运输管理", "柴油管理"]],
  ["采购与结算", ["采购仓储", "财务管理", "结算分包", "合同管理"]],
  [
    "系统与工具",
    [
      "工具知识",
      "智能风控",
      "范围通知",
      "管理员管理",
      "权限管理",
      "微信登录管理",
      "业务治理与备份",
      "系统设置",
      "使用教程",
      "发布与审计",
    ],
  ],
] as const;

describe("后台完整菜单与业务分类", () => {
  it("大屏在运营概览之前，按五类业务连续排列而非混合资源、业财与工具", () => {
    expect(items.map(item => [item.section, item.label])).toEqual(
      expectedGroups.flatMap(([section, labels]) =>
        labels.map(label => [section, label])
      )
    );
    expect(items.slice(0, 2).map(item => item.path)).toEqual(["/", "/admin"]);
  });

  it("原有 24 个入口路径、图标及名称全部保留且每个路径只出现一次", () => {
    const originalEntries = [
      ["Monitor", "数据大屏", "/"],
      ["LayoutDashboard", "运营概览", "/admin"],
      ["Building2", "组织与项目", "/admin/organization"],
      ["FolderKanban", "施工管理", "/admin/construction"],
      ["Truck", "车辆管理", "/admin/vehicles"],
      ["Settings2", "机械管理", "/admin/machinery"],
      ["Truck", "运输管理", "/admin/transport"],
      ["UsersRound", "劳务工资", "/admin/labor"],
      ["Fuel", "柴油管理", "/admin/diesel"],
      ["Camera", "现场取证", "/admin/evidence"],
      ["BarChart3", "财务管理", "/admin/finance"],
      ["ShoppingCart", "采购仓储", "/admin/purchasing"],
      ["Calculator", "工具知识", "/admin/measurement-tools"],
      ["FolderKanban", "结算分包", "/admin/subcontract"],
      ["FileText", "合同管理", "/admin/contracts"],
      ["ShieldCheck", "智能风控", "/admin/risk"],
      ["Megaphone", "范围通知", "/admin/broadcast"],
      ["UsersRound", "管理员管理", "/admin/administrators"],
      ["UsersRound", "权限管理", "/admin/permission"],
      ["KeyRound", "微信登录管理", "/admin/wechat-login"],
      ["BarChart3", "业务治理与备份", "/admin/business"],
      ["Settings2", "系统设置", "/admin/settings"],
      ["BookOpen", "使用教程", "/help"],
      ["ScrollText", "发布与审计", "/admin/audit"],
    ];
    expect(items).toHaveLength(24);
    expect(new Set(items.map(item => item.path)).size).toBe(24);
    expect(
      items.map(({ icon, label, path }) => [icon, label, path]).sort()
    ).toEqual(originalEntries.sort());
  });
});
