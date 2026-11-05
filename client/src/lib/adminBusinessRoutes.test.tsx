import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_BUSINESS_ROUTE_BY_MODULE,
  getAdminBusinessRoute,
} from "./adminBusinessRoutes";
import {
  getAuthorizedManagementModules,
  getManagementModulePath,
} from "./managementPortal";
import { requestDashboardNavigation } from "./dashboardNavigation";

const expectedRoutes = {
  CONSTRUCTION: "/admin/construction",
  LABOR: "/admin/labor",
  MACHINERY: "/admin/machinery",
  TRANSPORT: "/admin/transport",
  PURCHASING: "/admin/purchasing",
  MEASUREMENT: "/admin/subcontract",
  CONTRACT: "/admin/contracts",
  FINANCE: "/admin/finance",
  DIESEL: "/admin/diesel",
  EVIDENCE: "/admin/evidence",
};

describe("全业务PC维护入口", () => {
  it.each(Object.entries(expectedRoutes))(
    "%s在两个PC入口中使用同一真实工作区",
    (code, path) => {
      expect(getAdminBusinessRoute(code)).toBe(path);
      expect(getManagementModulePath(code)).toBe(path);
      expect(path).toMatch(/^\/admin\//);
      expect(path).not.toContain("/mobile/");
    }
  );

  it.each([
    "UNKNOWN",
    "",
    "constructor",
    "__proto__",
    "toString",
    "valueOf",
    "MESSAGES",
    "WORKBENCH",
    "TOOL_KNOWLEDGE",
    "/mobile/purchasing",
  ])("未知或非PC业务代码%s关闭维护入口", code => {
    expect(getAdminBusinessRoute(code)).toBeNull();
  });

  it("白名单不可改写且服务端授权菜单不因PC映射而扩权", () => {
    expect(Object.isFrozen(ADMIN_BUSINESS_ROUTE_BY_MODULE)).toBe(true);
    const authorized = [
      { code: "PURCHASING", title: "采购", route: "/mobile/purchasing" },
      { code: "__proto__", title: "未知", route: "/admin/permission" },
    ];
    expect(getAuthorizedManagementModules(authorized)).toEqual([authorized[0]]);
    expect(getManagementModulePath("__proto__")).toBeNull();
    expect(getManagementModulePath("MESSAGES")).toBe("/mobile/messages");
  });

  it("真实卡片不采用统计接口的移动路径且未登记入口禁用", () => {
    const source = readFileSync(
      new URL("../pages/AdminPage.tsx", import.meta.url),
      "utf8"
    );
    const card = source.slice(
      source.indexOf("全业务管理入口"),
      source.indexOf("业务数据逻辑备份", source.indexOf("全业务管理入口"))
    );
    expect(card).toContain("getAdminBusinessRoute(module.code)");
    expect(card).toContain("disabled={!pcRoute}");
    expect(card).toContain("暂无 PC 维护入口");
    expect(card).toContain("requestDashboardNavigation");
    expect(card).not.toContain("module.route");
    expect(card).not.toContain("/mobile/");
    expect(source).toContain('activeSection === "evidence"');
    expect(source).toContain('<EvidenceWorkspace mode="pc"');
  });

  it("取消未保存提示不改写PC维护地址，确认后才导航", () => {
    const navigate = vi.fn();
    expect(
      requestDashboardNavigation(
        "/admin/business",
        getAdminBusinessRoute("PURCHASING")!,
        navigate,
        () => false
      )
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(
      requestDashboardNavigation(
        "/admin/business",
        getAdminBusinessRoute("PURCHASING")!,
        navigate,
        () => true
      )
    ).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/admin/purchasing");
  });
});
