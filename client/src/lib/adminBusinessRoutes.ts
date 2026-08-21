/** 超级管理员从业务治理页进入时，优先落在 PC 端受控台账；其他模块仍使用已部署的既有工作台。 */
export const ADMIN_BUSINESS_ROUTE_BY_MODULE: Record<string, string> = {
  CONSTRUCTION: "/admin/construction",
  LABOR: "/admin/labor",
  MACHINERY: "/admin/machinery",
  TRANSPORT: "/admin/transport",
};
