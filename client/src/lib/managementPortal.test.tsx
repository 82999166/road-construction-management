import { describe, expect, it } from "vitest";
import {
  getAuthorizedManagementModules,
  getManagementModulePath,
  resolveManagementAccessMode,
} from "./managementPortal";

describe("统一管理入口权限投影", () => {
  it("让未登录、权限核验中、超级管理员和普通管理人员进入不同的安全状态", () => {
    expect(resolveManagementAccessMode({ isAuthenticated: false, authLoading: false, accessLoading: false, accessError: false, isSuperAdmin: false })).toBe("login");
    expect(resolveManagementAccessMode({ isAuthenticated: true, authLoading: false, accessLoading: true, accessError: false, isSuperAdmin: false })).toBe("checking");
    expect(resolveManagementAccessMode({ isAuthenticated: true, authLoading: false, accessLoading: false, accessError: false, isSuperAdmin: true })).toBe("super-admin");
    expect(resolveManagementAccessMode({ isAuthenticated: true, authLoading: false, accessLoading: false, accessError: false, isSuperAdmin: false })).toBe("scoped-manager");
    expect(resolveManagementAccessMode({ isAuthenticated: true, authLoading: false, accessLoading: false, accessError: true, isSuperAdmin: false })).toBe("unavailable");
  });

  it("只把服务端授权的业务模块映射到受控业务路径，不展示基础入口或未知模块", () => {
    const modules = getAuthorizedManagementModules([
      { code: "WORKBENCH", title: "工作台" },
      { code: "MESSAGES", title: "消息" },
      { code: "CONSTRUCTION", title: "施工现场" },
      { code: "FINANCE", title: "财务成本" },
      { code: "UNRECOGNIZED", title: "未知模块" },
    ]);

    expect(modules.map(module => module.code)).toEqual(["CONSTRUCTION", "FINANCE"]);
    expect(getManagementModulePath("CONSTRUCTION")).toBe("/mobile/construction");
    expect(getManagementModulePath("UNRECOGNIZED")).toBeNull();
  });
});
