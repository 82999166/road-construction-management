import { PC_MANAGEMENT_MODULE_PATH_BY_CODE } from "./managementPortal";

/** 超级后台与分权PC工作台共用固定业务白名单，不使用统计接口的移动端 route。 */
export const ADMIN_BUSINESS_ROUTE_BY_MODULE = PC_MANAGEMENT_MODULE_PATH_BY_CODE;

/** 未登记的模块关闭维护入口，不能通过接口路径或原型属性绕过PC白名单。 */
export function getAdminBusinessRoute(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(
    ADMIN_BUSINESS_ROUTE_BY_MODULE,
    code
  )
    ? ADMIN_BUSINESS_ROUTE_BY_MODULE[code]
    : null;
}
