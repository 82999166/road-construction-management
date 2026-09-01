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
  { code: "CONTRACT", name: "合同管理", description: "外包合同台账、合同草案、预览与签署管理" },
  { code: "FINANCE", name: "财务成本", description: "资金收支、凭证、成本与财务汇总" },
  { code: "DIESEL", name: "柴油管理", description: "柴油领用、指导价、预警、扣油与供油台账" },
  { code: "EVIDENCE", name: "水印取证", description: "现场影像、水印与 OCR 取证" },
] as const;

export type DepartmentBusinessModule = (typeof DEPARTMENT_BUSINESS_MODULES)[number]["code"];

export const DEPARTMENT_BUSINESS_MODULE_CODES = DEPARTMENT_BUSINESS_MODULES.map(item => item.code) as DepartmentBusinessModule[];

/** 返回业务模块中文名；未知编码仅用于服务端容错日志，绝不作为授权依据。 */
export function getDepartmentBusinessModuleName(code: DepartmentBusinessModule) {
  return DEPARTMENT_BUSINESS_MODULES.find(item => item.code === code)?.name ?? code;
}

/** 工作台、工具知识与消息中心不读取部门业务数据；工具知识仍由前端仅向管理人员呈现。 */
export const DEPARTMENT_AGNOSTIC_MOBILE_MENUS = ["WORKBENCH", "TOOL_KNOWLEDGE", "MESSAGES"] as const;
