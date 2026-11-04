import type { DashboardMenuItem } from "@/components/DashboardLayout";
import { getIndustryRoleTemplate } from "@shared/industryRoleTemplates";
import {
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  Camera,
  FileText,
  FolderKanban,
  Fuel,
  LayoutDashboard,
  Settings2,
  ShoppingCart,
  Truck,
  UsersRound,
} from "lucide-react";

export type ScopedAdministratorMenu = { code: string };

/** 与现有工具知识页的管理岗位规则保持一致；菜单授权不会代替岗位校验。 */
const TOOL_MANAGEMENT_ROLES = new Set([
  "SUPER_ADMIN",
  "PROJECT_MANAGER",
  "CONSTRUCTION_MANAGER",
  "SAFETY_MANAGER",
  "LABOR_MANAGER",
  "ACCOUNTANT",
  "FINANCE_MANAGER",
  "MACHINERY_MANAGER",
  "PURCHASER",
  "WAREHOUSE_MANAGER",
  "LOGISTICS_MANAGER",
  "MEASUREMENT_MANAGER",
  "CASHIER",
  "AUDIT_VIEWER",
]);

/**
 * 只复制超级后台的业务菜单形态，绝不复制其全局治理能力。
 * 顺序、图标、名称与分区对应 ADMIN_MENU；取证和个人消息为已有受控业务补充。
 * 路径采用固定白名单，绝不信任服务器菜单附带的 title/path。
 */
const SCOPED_BUSINESS_MENU: Array<DashboardMenuItem & { code: string }> = [
  {
    code: "CONSTRUCTION",
    icon: FolderKanban,
    label: "施工管理",
    path: "/admin/construction",
    section: "经营业务",
  },
  {
    code: "MACHINERY",
    icon: Settings2,
    label: "机械管理",
    path: "/admin/machinery",
    section: "资源与现场",
  },
  {
    code: "TRANSPORT",
    icon: Truck,
    label: "运输管理",
    path: "/admin/transport",
    section: "资源与现场",
  },
  {
    code: "LABOR",
    icon: UsersRound,
    label: "劳务工资",
    path: "/admin/labor",
    section: "资源与现场",
  },
  {
    code: "DIESEL",
    icon: Fuel,
    label: "柴油管理",
    path: "/admin/diesel",
    section: "资源与现场",
  },
  {
    code: "EVIDENCE",
    icon: Camera,
    label: "现场取证",
    path: "/admin/evidence",
    section: "资源与现场",
  },
  {
    code: "FINANCE",
    icon: BarChart3,
    label: "财务管理",
    path: "/admin/finance",
    section: "业财结算",
  },
  {
    code: "PURCHASING",
    icon: ShoppingCart,
    label: "采购仓储",
    path: "/admin/purchasing",
    section: "业财结算",
  },
  {
    code: "TOOL_KNOWLEDGE",
    icon: Calculator,
    label: "工具知识",
    path: "/tools",
    section: "业财结算",
  },
  {
    code: "MEASUREMENT",
    icon: FolderKanban,
    label: "结算分包",
    path: "/admin/subcontract",
    section: "业财结算",
  },
  {
    code: "CONTRACT",
    icon: FileText,
    label: "合同管理",
    path: "/admin/contracts",
    section: "业财结算",
  },
];

export function buildScopedAdministratorNavigation(
  menus: readonly ScopedAdministratorMenu[],
  roleCodes: readonly string[] = []
): DashboardMenuItem[] {
  const authorizedCodes = new Set(menus.map(menu => menu.code));
  const canUseTools =
    roleCodes.includes("ALL") ||
    roleCodes.some(code => TOOL_MANAGEMENT_ROLES.has(code));
  const businessItems = SCOPED_BUSINESS_MENU.filter(
    item =>
      authorizedCodes.has(item.code) &&
      (item.code !== "TOOL_KNOWLEDGE" || canUseTools)
  ).map(({ code: _code, ...item }) => item);
  return [
    // 工作台和教程不读取全局治理数据，加载失败时也保留安全返回入口。
    {
      icon: LayoutDashboard,
      label: "运营概览",
      path: "/admin",
      section: "决策总览",
    },
    ...businessItems,
    ...(authorizedCodes.has("MESSAGES")
      ? [
          {
            icon: Bell,
            label: "消息中心",
            path: "/mobile/messages",
            section: "风险与通知",
          },
        ]
      : []),
    { icon: BookOpen, label: "使用教程", path: "/help", section: "平台治理" },
  ];
}

/** 岗位和数据范围仅用于中文展示，不作为前端扩大授权的依据。 */
export function getScopedAdministratorRoleLabels(
  roleCodes: readonly string[]
): string[] {
  return Array.from(
    new Set(
      roleCodes
        .filter(code => code !== "ALL")
        .map(code => getIndustryRoleTemplate(code)?.name ?? "已授权岗位")
    )
  );
}

export function getScopedAdministratorScopeLabel(scope: {
  hasAllProjects: boolean;
  projectIds: readonly number[];
  organizationIds: readonly number[];
}): string {
  if (scope.hasAllProjects) return "已授权全部项目范围";
  const parts: string[] = [];
  if (scope.projectIds.length)
    parts.push(`${scope.projectIds.length} 个指定项目`);
  if (scope.organizationIds.length)
    parts.push(`${scope.organizationIds.length} 个组织范围内的项目`);
  return parts.length ? `已授权 ${parts.join("、")}` : "暂未授予项目范围";
}

/** 仅去掉复用业务页的手机返回/底栏，不隐藏业务主区、能力按钮、打印或弹窗。 */
export const SCOPED_EMBEDDED_BUSINESS_CSS = `
.scoped-pc-business .mobile-bottom-navigation { display: none !important; }
.scoped-pc-business .mobile-viewport-shell {
  max-width: none !important;
  min-height: 0 !important;
  padding-bottom: 0 !important;
  box-shadow: none !important;
}
.scoped-pc-business > div { min-height: 0 !important; }
.scoped-pc-business .mobile-viewport-shell > header button:first-child { display: none !important; }
.scoped-pc-business .mobile-viewport-shell > header { border-radius: 0.75rem 0.75rem 0 0; }
`;
