/**
 * 部门业务模块目录。
 *
 * 统一身份认证只回答“是谁登录了系统”；本目录用于回答“该人员所属部门可办理什么业务”。
 * 所有服务端业务接口、后台配置页和移动端菜单都必须引用同一模块编码，禁止各自维护
 * 不一致的中文名称或字符串常量。
 */
export const DEPARTMENT_BUSINESS_MODULES = [
  { code: "CONSTRUCTION", name: "施工现场", description: "施工生产、安全与现场管理" },
  { code: "LABOR", name: "劳务工资", description: "人员、考勤、工资与发放审核" },
  { code: "MACHINERY", name: "机械管理", description: "机械台账、租赁、成本与结算" },
  { code: "TRANSPORT", name: "运输管理", description: "车辆、运价、趟次与运输结算" },
  { code: "PURCHASING", name: "采购仓储", description: "采购申请、订单、收货、库存与结算" },
  { code: "MEASUREMENT", name: "计量结算", description: "计量申报、审核、结算与付款" },
  { code: "FINANCE", name: "财务成本", description: "资金收支、凭证、成本与财务汇总" },
  { code: "EVIDENCE", name: "水印取证", description: "现场影像、水印与 OCR 取证" },
] as const;

export type DepartmentBusinessModule = (typeof DEPARTMENT_BUSINESS_MODULES)[number]["code"];

export const DEPARTMENT_BUSINESS_MODULE_CODES = DEPARTMENT_BUSINESS_MODULES.map(item => item.code) as DepartmentBusinessModule[];

/** 返回业务模块中文名；未知编码仅用于服务端容错日志，绝不作为授权依据。 */
export function getDepartmentBusinessModuleName(code: DepartmentBusinessModule) {
  return DEPARTMENT_BUSINESS_MODULES.find(item => item.code === code)?.name ?? code;
}

/** 移动端中的个人资料与消息中心属于所有已登录人员的基础入口，不计入部门业务模块。 */
export const DEPARTMENT_AGNOSTIC_MOBILE_MENUS = ["WORKBENCH", "MESSAGES"] as const;
