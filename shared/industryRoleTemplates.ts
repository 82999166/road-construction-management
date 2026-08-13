/**
 * 道路施工承包项目的标准岗位模板。
 * 此目录用于后台的“选岗位—选范围”授权体验和可读职责摘要；真正的访问控制仍由服务端
 * 角色、部门业务范围、项目范围、有效期及各业务状态机共同裁决，前端不得据此自行放行。
 */
export type IndustryRoleTemplate = {
  code: string;
  name: string;
  group: "项目管理" | "现场生产" | "供应链" | "经营计量" | "财务审计" | "系统治理";
  summary: string;
  moduleLabels: string[];
  allowedActions: string[];
  restrictedActions: string[];
  scopeHint: string;
};

export const INDUSTRY_ROLE_TEMPLATES: readonly IndustryRoleTemplate[] = [
  { code: "SUPER_ADMIN", name: "超级管理员", group: "系统治理", summary: "负责系统级配置、组织、岗位和权限治理。", moduleLabels: ["全模块"], allowedActions: ["全局治理", "系统配置", "权限授权", "审计查看"], restrictedActions: ["普通本地管理账号不得授予"], scopeHint: "全局范围，仅企业系统管理员使用。" },
  { code: "PROJECT_MANAGER", name: "项目经理", group: "项目管理", summary: "负责项目经营统筹、采购审批与现场关键事项复核。", moduleLabels: ["施工", "采购", "计量", "财务", "运输"], allowedActions: ["项目数据查看", "施工审核", "采购审批", "计量复核"], restrictedActions: ["不执行出纳付款", "不维护系统权限"], scopeHint: "按具体项目授权，建议设置有效期。" },
  { code: "CONSTRUCTION_MANAGER", name: "施工管理员", group: "现场生产", summary: "负责施工日报、现场日志、收方提交与水印取证。", moduleLabels: ["施工", "计量", "水印取证"], allowedActions: ["录入施工日报", "提交收方", "现场取证"], restrictedActions: ["不审核计量", "不处理资金"], scopeHint: "按项目部或具体项目授权。" },
  { code: "SAFETY_MANAGER", name: "安全管理员", group: "现场生产", summary: "负责现场安全记录、隐患取证与闭环跟踪。", moduleLabels: ["施工", "水印取证"], allowedActions: ["查看施工现场", "安全取证", "风险记录"], restrictedActions: ["不审批采购", "不处理计量和资金"], scopeHint: "按项目部或具体项目授权。" },
  { code: "LABOR_MANAGER", name: "劳资管理员", group: "现场生产", summary: "负责实名制、考勤、班组和工资资料录入。", moduleLabels: ["劳务工资"], allowedActions: ["人员维护", "考勤登记", "工资资料提交"], restrictedActions: ["不审核工资", "不执行发放"], scopeHint: "按项目部或具体项目授权。" },
  { code: "MACHINERY_MANAGER", name: "机械管理员", group: "现场生产", summary: "负责机械台账、作业记录、租赁与成本资料。", moduleLabels: ["机械管理"], allowedActions: ["机械台账", "作业记录", "结算资料录入"], restrictedActions: ["不确认资金支付", "不维护人员权限"], scopeHint: "按项目范围授权。" },
  { code: "TRANSPORT_MANAGER", name: "运输管理员", group: "现场生产", summary: "负责运输车辆、装卸刷卡、异常处置与运费核验。", moduleLabels: ["运输管理", "水印取证"], allowedActions: ["车辆台账", "刷卡核验", "运输异常处理"], restrictedActions: ["不进行财务付款", "不维护系统配置"], scopeHint: "按项目范围授权。" },
  { code: "DRIVER", name: "司机", group: "现场生产", summary: "接收装卸提醒并办理本人已授权车辆的运输业务。", moduleLabels: ["运输管理", "水印取证"], allowedActions: ["本人趟次查看", "现场取证", "接收运输通知"], restrictedActions: ["不查看其他车辆数据", "不审核运费"], scopeHint: "按具体项目和车辆责任绑定。" },
  { code: "PURCHASER", name: "采购员", group: "供应链", summary: "负责采购申请、订单执行与小额物资资料录入。", moduleLabels: ["采购仓储", "水印取证"], allowedActions: ["采购申请", "订单资料", "小额物资录入"], restrictedActions: ["不审批自身申请", "不执行付款"], scopeHint: "按项目部或具体项目授权。" },
  { code: "WAREHOUSE_MANAGER", name: "仓管员", group: "供应链", summary: "负责收货、入库、领用与库存流水。", moduleLabels: ["采购仓储"], allowedActions: ["收货确认", "入库登记", "库存流水"], restrictedActions: ["不审批采购", "不执行付款"], scopeHint: "按仓储所属项目范围授权。" },
  { code: "LOGISTICS_MANAGER", name: "后勤管理员", group: "供应链", summary: "负责后勤物资、营地保障与库存协同。", moduleLabels: ["采购仓储"], allowedActions: ["后勤采购资料", "物资协同", "入库确认"], restrictedActions: ["不审批资金", "不维护财务凭证"], scopeHint: "按后勤部门或项目范围授权。" },
  { code: "MEASUREMENT_MANAGER", name: "计量管理员", group: "经营计量", summary: "负责收方复核、计量申报与工程量台账。", moduleLabels: ["计量结算", "水印取证"], allowedActions: ["收方复核", "计量申报", "工程量查询"], restrictedActions: ["不执行回款", "不处理财务冲销"], scopeHint: "按项目范围授权。" },
  { code: "FINANCE_MANAGER", name: "财务负责人", group: "财务审计", summary: "负责财务审批、成本分析、授权项目的日结复核及凭证冲销。", moduleLabels: ["财务成本", "采购仓储", "计量结算"], allowedActions: ["财务审核", "成本利润分析", "采购审批", "凭证冲销"], restrictedActions: ["不代替出纳执行付款", "不维护系统权限"], scopeHint: "按财务部门或项目范围授权。" },
  { code: "ACCOUNTANT", name: "会计", group: "财务审计", summary: "可查看并审查授权范围内的支付、收入、成本、利润、资金流水、发票、工资和日结。", moduleLabels: ["财务成本", "劳务工资", "计量结算"], allowedActions: ["会计审核", "发票认证", "日结封存", "财务资料查看"], restrictedActions: ["不执行付款", "不冲销已支付凭证", "不维护人员与系统配置"], scopeHint: "按财务部门或具体项目授权；审查与付款执行分离。" },
  { code: "CASHIER", name: "出纳", group: "财务审计", summary: "负责已批准业务的资金收付登记与现金流执行。", moduleLabels: ["财务成本"], allowedActions: ["回款登记", "采购结算", "资金流水登记"], restrictedActions: ["不审核自己执行的支付", "不冲销凭证", "不维护发票认证"], scopeHint: "按财务部门或具体项目授权。" },
  { code: "AUDIT_VIEWER", name: "审计只读", group: "财务审计", summary: "独立查看项目财务、利润、日结、发票和审计留痕，不产生或修改业务数据。", moduleLabels: ["财务成本"], allowedActions: ["只读查看", "打印审计报表", "查看发票与日结"], restrictedActions: ["不录入", "不审核", "不支付", "不冲销", "不授权"], scopeHint: "必须按部门或项目范围授权，默认只读。" },
];

export function getIndustryRoleTemplate(code: string) {
  return INDUSTRY_ROLE_TEMPLATES.find(template => template.code === code) ?? null;
}
