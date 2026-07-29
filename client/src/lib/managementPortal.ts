/**
 * 统一管理入口的前端路由投影。
 * 此处仅决定已由服务端下发的菜单如何展示；任何数据读取和业务写入仍由服务端二次校验。
 */
export type ManagementAccessMode = "login" | "checking" | "super-admin" | "scoped-manager" | "unavailable";

export function resolveManagementAccessMode(input: {
  isAuthenticated: boolean;
  authLoading: boolean;
  accessLoading: boolean;
  accessError: boolean;
  isSuperAdmin: boolean;
}): ManagementAccessMode {
  if (input.authLoading || (input.isAuthenticated && input.accessLoading)) return "checking";
  if (!input.isAuthenticated) return "login";
  if (input.accessError) return "unavailable";
  return input.isSuperAdmin ? "super-admin" : "scoped-manager";
}

/** 业务模块路径由服务端菜单代码映射，未知代码不生成可点击入口。 */
export function getManagementModulePath(code: string) {
  if (code === "WORKBENCH") return "/admin";
  if (code === "MESSAGES") return "/mobile/messages";
  const supportedCodes = new Set([
    "CONSTRUCTION",
    "LABOR",
    "MACHINERY",
    "TRANSPORT",
    "PURCHASING",
    "MEASUREMENT",
    "FINANCE",
    "EVIDENCE",
  ]);
  return supportedCodes.has(code) ? `/mobile/${code.toLowerCase()}` : null;
}

/** 工作台与消息中心不重复呈现为“业务管理版块”。 */
export function getAuthorizedManagementModules<T extends { code: string }>(menus: readonly T[]) {
  return menus.filter(menu => menu.code !== "WORKBENCH" && menu.code !== "MESSAGES" && getManagementModulePath(menu.code));
}
