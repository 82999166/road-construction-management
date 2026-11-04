import { describe, expect, it } from "vitest";
import {
  BarChart3,
  Calculator,
  FileText,
  FolderKanban,
  Fuel,
  Settings2,
  ShoppingCart,
  Truck,
  UsersRound,
} from "lucide-react";
import {
  buildScopedAdministratorNavigation,
  getScopedAdministratorRoleLabels,
  getScopedAdministratorScopeLabel,
  SCOPED_EMBEDDED_BUSINESS_CSS,
} from "./scopedAdministratorNavigation";

describe("普通 PC 管理员侧栏安全投影", () => {
  it("按超级后台的业务分区、顺序、名称与图标排序，不信任输入 title/path", () => {
    const codes = [
      "CONTRACT",
      "MEASUREMENT",
      "TOOL_KNOWLEDGE",
      "PURCHASING",
      "FINANCE",
      "DIESEL",
      "LABOR",
      "TRANSPORT",
      "MACHINERY",
      "CONSTRUCTION",
    ];
    const items = buildScopedAdministratorNavigation(
      codes.map(code => ({ code, title: "系统设置", path: "/admin/settings" })),
      ["PROJECT_MANAGER"]
    );
    expect(items.slice(1, -1)).toEqual([
      {
        icon: FolderKanban,
        label: "施工管理",
        path: "/admin/construction",
        section: "经营业务",
      },
      {
        icon: Settings2,
        label: "机械管理",
        path: "/admin/machinery",
        section: "资源与现场",
      },
      {
        icon: Truck,
        label: "运输管理",
        path: "/admin/transport",
        section: "资源与现场",
      },
      {
        icon: UsersRound,
        label: "劳务工资",
        path: "/admin/labor",
        section: "资源与现场",
      },
      {
        icon: Fuel,
        label: "柴油管理",
        path: "/admin/diesel",
        section: "资源与现场",
      },
      {
        icon: BarChart3,
        label: "财务管理",
        path: "/admin/finance",
        section: "业财结算",
      },
      {
        icon: ShoppingCart,
        label: "采购仓储",
        path: "/admin/purchasing",
        section: "业财结算",
      },
      {
        icon: Calculator,
        label: "工具知识",
        path: "/tools",
        section: "业财结算",
      },
      {
        icon: FolderKanban,
        label: "结算分包",
        path: "/admin/subcontract",
        section: "业财结算",
      },
      {
        icon: FileText,
        label: "合同管理",
        path: "/admin/contracts",
        section: "业财结算",
      },
    ]);
  });

  it("即使错误投影治理代码或 ALL 标记也不生成治理路径、全局统计或未知路径", () => {
    const codes = [
      "SETTINGS",
      "PERMISSION",
      "ADMINISTRATORS",
      "BACKUP",
      "AUDIT",
      "ORGANIZATION",
      "VEHICLES",
      "RISK",
      "BROADCAST",
      "BUSINESS",
      "WECHAT_LOGIN",
      "SUPER_ADMIN",
      "constructor",
      "__proto__",
      "UNRECOGNIZED",
    ];
    const result = buildScopedAdministratorNavigation(
      codes.map(code => ({ code })),
      ["ALL"]
    );
    expect(result.map(item => item.path)).toEqual(["/admin", "/help"]);
  });

  it("只生成已授权业务、去重且消息只按 catalog 允许", () => {
    expect(
      buildScopedAdministratorNavigation([
        { code: "CONSTRUCTION" },
        { code: "CONSTRUCTION" },
      ]).map(item => item.path)
    ).toEqual(["/admin", "/admin/construction", "/help"]);
    expect(
      buildScopedAdministratorNavigation([{ code: "MESSAGES" }]).map(
        item => item.path
      )
    ).toEqual(["/admin", "/mobile/messages", "/help"]);
  });

  it("工具知识须 catalog 和现行管理岗位条件同时通过，司机/未知岗位不回退", () => {
    for (const roles of [[], ["DRIVER"], ["UNKNOWN"], ["TRANSPORT_MANAGER"]]) {
      expect(
        buildScopedAdministratorNavigation(
          [{ code: "TOOL_KNOWLEDGE" }],
          roles
        ).map(item => item.path)
      ).not.toContain("/tools");
    }
    expect(
      buildScopedAdministratorNavigation(
        [{ code: "TOOL_KNOWLEDGE" }],
        ["PROJECT_MANAGER"]
      ).map(item => item.path)
    ).toContain("/tools");
    expect(
      buildScopedAdministratorNavigation([], ["PROJECT_MANAGER"]).map(
        item => item.path
      )
    ).not.toContain("/tools");
  });

  it("岗位标签和数据范围为中文，空范围不假装全量且组织范围不遗漏", () => {
    expect(
      getScopedAdministratorRoleLabels([
        "PROJECT_MANAGER",
        "CONSTRUCTION_MANAGER",
        "UNKNOWN_CODE",
        "ALL",
        "UNKNOWN_CODE",
      ])
    ).toEqual(["项目经理", "施工管理员", "已授权岗位"]);
    expect(
      getScopedAdministratorScopeLabel({
        hasAllProjects: false,
        projectIds: [],
        organizationIds: [],
      })
    ).toBe("暂未授予项目范围");
    expect(
      getScopedAdministratorScopeLabel({
        hasAllProjects: false,
        projectIds: [1],
        organizationIds: [2],
      })
    ).toBe("已授权 1 个指定项目、1 个组织范围内的项目");
    expect(
      getScopedAdministratorScopeLabel({
        hasAllProjects: true,
        projectIds: [],
        organizationIds: [],
      })
    ).toBe("已授权全部项目范围");
  });

  it("复用业务只隐藏手机导航/返回 chrome，不隐藏业务主区和实际按钮", () => {
    expect(SCOPED_EMBEDDED_BUSINESS_CSS).toContain(
      ".scoped-pc-business .mobile-bottom-navigation { display: none !important; }"
    );
    expect(SCOPED_EMBEDDED_BUSINESS_CSS).toContain("header button:first-child");
    expect(SCOPED_EMBEDDED_BUSINESS_CSS).not.toMatch(
      /main\s*\{|button\s*\{\s*display: none/
    );
    expect(SCOPED_EMBEDDED_BUSINESS_CSS).not.toContain("::after");
  });
});
