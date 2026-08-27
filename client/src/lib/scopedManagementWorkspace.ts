/**
 * 普通管理员在桌面端可复用的统一 PC 业务工作区。
 * 映射只决定前端入口；每一条读取、导出、打印与状态操作仍由服务端按模块和项目范围二次校验。
 */
export const SCOPED_PC_ADMIN_SECTION_BY_MODULE = {
  CONSTRUCTION: "construction",
  LABOR: "labor",
  MACHINERY: "machinery",
  TRANSPORT: "transport",
  PURCHASING: "purchasing",
  MEASUREMENT: "subcontract",
  CONTRACT: "contracts",
} as const;

export type ScopedPcAdminSection = (typeof SCOPED_PC_ADMIN_SECTION_BY_MODULE)[keyof typeof SCOPED_PC_ADMIN_SECTION_BY_MODULE];

/** 未列入该表的模块继续使用其既有受控页面，不能被错误映射到全局治理后台。 */
export function getScopedPcAdminSection(code: string): ScopedPcAdminSection | null {
  return SCOPED_PC_ADMIN_SECTION_BY_MODULE[code as keyof typeof SCOPED_PC_ADMIN_SECTION_BY_MODULE] ?? null;
}
