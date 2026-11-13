import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_BUSINESS_ROUTE_BY_MODULE } from "@/lib/adminBusinessRoutes";
import { getBusinessWorkspaceProjectState } from "@/lib/adminWorkspaceState";
import {
  VEHICLE_TYPE_LABELS,
  vehicleLabel,
} from "@/lib/vehicleManagementWorkspace";

const normalizeSource = (source: string) =>
  source
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\{\s+/g, "{")
    .replace(/\s+}/g, "}")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\?\s+/g, "?")
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")
    .replace(/}\s+{/g, "}{")
    .replace(/,\s*}/g, "}");

const readSource = (url: URL) => normalizeSource(readFileSync(url, "utf8"));
const ADMIN_PAGE_SOURCE = readSource(
  new URL("./AdminPage.tsx", import.meta.url)
);
const CONSTRUCTION_SOURCE = readSource(
  new URL("../components/ConstructionWorkspace.tsx", import.meta.url)
);
const MACHINERY_SOURCE = readSource(
  new URL("../components/MachineryWorkspace.tsx", import.meta.url)
);
const PURCHASING_SOURCE = readSource(
  new URL("../components/PurchasingWorkspace.tsx", import.meta.url)
);
const PURCHASING_OUTPUT_SOURCE = readSource(
  new URL("../lib/purchasingWorkspace.ts", import.meta.url)
);
const VEHICLE_WORKSPACE_SOURCE = readSource(
  new URL("../components/VehicleManagementWorkspace.tsx", import.meta.url)
);
const VEHICLE_DETAIL_SOURCE = readSource(
  new URL("../components/VehicleManagementDetail.tsx", import.meta.url)
);
const VEHICLE_FORMS_SOURCE = readSource(
  new URL("../components/VehicleManagementForms.tsx", import.meta.url)
);
const VEHICLE_LIFECYCLE_SOURCE = readSource(
  new URL("../components/VehicleManagementFormsLifecycle.tsx", import.meta.url)
);
const VEHICLE_REPORT_SOURCE = readSource(
  new URL("../components/VehicleManagementReport.tsx", import.meta.url)
);
const normalizeLayout = (value: string) =>
  value.replace(/\s+/g, "").replace(/,([})\]])/g, "$1");
const expectSourceToContain = (source: string, expected: string) =>
  expect(normalizeLayout(source)).toContain(normalizeLayout(expected));
const expectSourceNotToContain = (source: string, expected: string) =>
  expect(normalizeLayout(source)).not.toContain(normalizeLayout(expected));

describe("统一后台业务工作区范围保护", () => {
  it("仅接受正整数项目号作为真实业务台账查询范围", () => {
    expect(getBusinessWorkspaceProjectState("27")).toEqual({
      projectId: 27,
      hasProject: true,
    });
    expect(getBusinessWorkspaceProjectState("")).toEqual({
      projectId: 0,
      hasProject: false,
    });
    expect(getBusinessWorkspaceProjectState("0")).toEqual({
      projectId: 0,
      hasProject: false,
    });
    expect(getBusinessWorkspaceProjectState("2.5")).toEqual({
      projectId: 0,
      hasProject: false,
    });
    expect(getBusinessWorkspaceProjectState("abc")).toEqual({
      projectId: 0,
      hasProject: false,
    });
  });

  it("将施工、劳务、机械和运输治理入口定向到受控 PC 台账", () => {
    expect(ADMIN_BUSINESS_ROUTE_BY_MODULE).toMatchObject({
      CONSTRUCTION: "/admin/construction",
      LABOR: "/admin/labor",
      MACHINERY: "/admin/machinery",
      TRANSPORT: "/admin/transport",
    });
  });

  it("按后台侧栏分类显示施工、车辆、机械、运输和权限管理名称，且不改变业务路由", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'label: "施工管理", path: "/admin/construction"'
    );
    expectSourceToContain(source, 'label: "车辆管理", path: "/admin/vehicles"');
    expectSourceToContain(
      source,
      'label: "机械管理", path: "/admin/machinery"'
    );
    expectSourceToContain(
      source,
      'label: "运输管理", path: "/admin/transport"'
    );
    expectSourceToContain(
      source,
      'label: "权限管理", path: "/admin/permission"'
    );
  });

  it("禁止 PC 台账的查看、编辑和维护操作直接跳转到移动端", () => {
    const source = ADMIN_PAGE_SOURCE;

    expect(source).not.toMatch(/setLocation\(["'`]\/mobile/);
    expectSourceToContain(source, "施工日报查看与编辑");
    expectSourceToContain(source, "<LaborWorkerRoster");
    expectSourceToContain(source, "<TransportTripLedger");
  });

  it("将受控表单字段包装组件定义在模块作用域，避免状态更新重挂载输入框并导致失焦", () => {
    const source = ADMIN_PAGE_SOURCE;
    const fieldDefinition = source.indexOf(
      normalizeSource("function Field({ label, children }")
    );
    const pageDefinition = source.indexOf("export default function AdminPage");

    expect(fieldDefinition).toBeGreaterThan(-1);
    expect(pageDefinition).toBeGreaterThan(fieldDefinition);
    expectSourceNotToContain(source, "const Field = ({ label, children }");
  });

  it("向普通管理员复用核心 PC 台账时只展示当前业务和工作台导航", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "scopedSection?: ScopedPcAdminSection");
    expectSourceToContain(
      source,
      "const scopedMenuItems: DashboardMenuItem[] = scopedSection"
    );
    expectSourceToContain(
      source,
      'label: "业务工作台", path: "/admin", section: "我的工作台"'
    );
    expectSourceToContain(source, "menuItems={scopedMenuItems}");
    expectSourceToContain(source, "!scopedSection ? (");
  });

  it("在 PC 超级管理后台承载员工、车辆与机械的关键维护闭环", () => {
    expectSourceToContain(ADMIN_PAGE_SOURCE, "普通管理人员账号");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "为人员分配岗位与数据范围");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<VehicleManagementWorkspace");
    expectSourceToContain(VEHICLE_WORKSPACE_SOURCE, 'title:"车辆档案台账"');
    expectSourceToContain(VEHICLE_WORKSPACE_SOURCE, "<VehicleRegistryForm");
    expectSourceToContain(VEHICLE_WORKSPACE_SOURCE, "<VehicleManagementDetail");
    expectSourceToContain(
      VEHICLE_FORMS_SOURCE,
      "trpc.admin.vehicle.save.useMutation()"
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, "PC 写入车辆卡");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "renderRfidManagement()");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "新建机械档案");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "会计产值计价规则");
    expectSourceToContain(VEHICLE_FORMS_SOURCE, '["leased", "租入"]');
    expectSourceToContain(VEHICLE_FORMS_SOURCE, 'label="合同起租日期"');
    expectSourceToContain(VEHICLE_FORMS_SOURCE, 'label="合同截止日期"');
    expectSourceToContain(ADMIN_PAGE_SOURCE, 'Field label="驾驶员姓名"');
    expectSourceToContain(ADMIN_PAGE_SOURCE, 'Field label="驾驶员手机"');
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "driverName: machineForm.driverName.trim() || null"
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "driverPhone: machineForm.driverPhone.trim() || null"
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, "saveMachine.mutate");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "saveMachineCost.mutate");
    expectSourceToContain(ADMIN_PAGE_SOURCE, 'Field label="费用名称（必填）"');
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "costName: machineCostForm.costName.trim()"
    );
    expectSourceToContain(MACHINERY_SOURCE, "机械档案");
    expectSourceToContain(MACHINERY_SOURCE, "机械业务详情");
    expectSourceToContain(MACHINERY_SOURCE, "props.onCost");
    expectSourceToContain(MACHINERY_SOURCE, "登记维修保养");
  });

  it("在 PC 运输管理中提供独立的阶梯运价设置入口，避免只显示路线而无法维护合同价格", () => {
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "const TransportFreightRuleManager = lazy("
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<TransportFreightRuleManager");
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      'active={transportWorkspaceTab === "rates"}'
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "<TransportRouteConfigurationEditor"
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      'active={transportWorkspaceTab === "terminals"}'
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "canManage={rights?.canManageResources ?? false}"
    );
  });

  it("超级管理后台登记加班时移除台班字段并自动关联机械驾驶员", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "登记机械加班");
    expectSourceToContain(source, "驾驶员（按机械档案自动关联）");
    expectSourceToContain(
      source,
      'value={selectedMachineForDialog?.driverName || "按机械档案 / 未登记"}'
    );
    expectSourceNotToContain(source, "台班数");
    expectSourceNotToContain(source, "台班单价");
    expectSourceNotToContain(source, "预计台班金额");
    expectSourceNotToContain(source, "保存台班草稿");
    expectSourceToContain(source, "shiftCount: 0");
    expectSourceToContain(source, "shiftRate: 0");
  });

  it("单车费用分析使用可滚动宽屏分区详情，完整承载统计卡和月度、按日明细", () => {
    const source = VEHICLE_DETAIL_SOURCE;

    expectSourceToContain(
      source,
      "w-[calc(100vw-1rem)] max-w-[min(96vw,1480px)]"
    );
    expectSourceToContain(source, "grid grid-cols-2 gap-2 lg:grid-cols-4");
    expectSourceToContain(source, 'active={tab==="costs"}');
    expectSourceToContain(source, 'view==="daily"?a.daily:a.monthly');
    expectSourceToContain(source, "min-h-0 flex-1 space-y-4 overflow-y-auto");
    expectSourceToContain(source, "<VehicleManagementReport");
    expectSourceToContain(
      VEHICLE_REPORT_SOURCE,
      "min-h-0 flex-1 overflow-auto"
    );
  });

  it("其他后台业务详情也使用宽屏且可滚动的 PC 工作区", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      "max-h-[88vh] w-[calc(100vw-3rem)] max-w-5xl overflow-y-auto xl:max-w-6xl"
    );
    expectSourceNotToContain(source, ': "max-w-2xl"}');
  });

  it("高频费用录入窗口在 PC 端提供足够宽的两列或三列工作区", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'DialogContent className="w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl"'
    );
    expectSourceToContain(
      source,
      'DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-4xl overflow-y-auto xl:max-w-5xl"'
    );
    expectSourceToContain(source, "录入机械成本");
    expectSourceToContain(
      source,
      '登记 {assetMaintenanceForm.assetType === "vehicle" ? "车辆" : "机械"} 维修保养费用'
    );
    expectSourceToContain(source, "维护柴油指导价");
  });

  it("车辆射频卡绑定窗口展示完整车辆信息，并可在窗口内直接读取卡 ID", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, 'Field label="车牌号（车辆表单预填）"');
    expectSourceToContain(source, 'Field label="驾驶员姓名（车辆表单预填）"');
    expectSourceToContain(
      source,
      'Field label="驾驶员联系电话（车辆表单预填）"'
    );
    expectSourceToContain(source, 'Field label="卡 ID / UID（芯片固定标识）"');
    expectSourceToContain(source, 'Field label="签名版本"');
    expectSourceToContain(source, "读取卡 ID");
    expectSourceToContain(source, '"http://127.0.0.1:47601/api/read-uid"');
  });

  it("车辆射频卡解除绑定保留受控业务拒绝原因，不将未闭环运输误报为通用失败", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      "function getVehicleRfidCardManagementErrorMessage"
    );
    expectSourceToContain(
      source,
      "当前车辆存在未闭环运输趟次，请完成或作废该趟次后再解除绑定"
    );
    expectSourceToContain(source, "该车辆卡当前未绑定车辆，无需重复解除");
    expectSourceToContain(
      source,
      "未找到当前项目下的车辆射频卡，请刷新台账后重试"
    );
    expectSourceToContain(
      source,
      'getVehicleRfidCardManagementErrorMessage("unbind", error.message)'
    );
    expectSourceToContain(
      source,
      'getVehicleRfidCardManagementErrorMessage("revoke", error.message)'
    );
  });

  it("本机读卡桥接失败时提示 Windows 桥接启动和浏览器设备授权，不回显原始异常", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      "无法访问本机读卡桥接程序：请确认 Windows 桥接程序已启动，并允许浏览器访问本机设备。"
    );
    expectSourceToContain(
      source,
      "浏览器无法访问正式写卡接口：请保持 Windows 桥接程序运行，并允许当前网站访问本机 127.0.0.1 设备后重试。"
    );
    expectSourceToContain(
      source,
      "当前 Windows 桥接程序未安装正式车辆卡写入接口：测试写卡可用，但请更新桥接程序后再办理正式车辆卡。"
    );
    expectSourceToContain(
      source,
      "本次写卡任务授权已失效或被拒绝：请关闭窗口后重新生成 PC 写卡任务，再立即写入。"
    );
    expectSourceToContain(
      source,
      "当前卡片 UID 或回读载荷与写卡任务不一致：请确认仍为刚绑定的车辆卡，不要更换卡片后重试。"
    );
    expectSourceToContain(source, "当前卡片可用 NDEF 容量不足以写入正式车辆卡");
    expectSourceToContain(source, "读取卡片 NDEF 用户区失败");
    expectSourceToContain(source, "卡片写入后逐字节回读不一致");
    expectSourceToContain(source, "回读摘要与本次受控任务不一致");
    expectSourceToContain(source, "服务端确认暂未返回");
    expectSourceToContain(source, "只点击“仅回传确认（不写卡）”，不得再次写入");
    expectSourceToContain(source, "仅回传确认（不写卡）");
    expectSourceToContain(source, "本机 DPAPI 加密短时收据");
    expectSourceToContain(
      source,
      '"http://127.0.0.1:47601/api/confirm-vehicle-card"'
    );
    expectSourceToContain(
      source,
      '"http://127.0.0.1:47601/api/verify-and-confirm-vehicle-card"'
    );
    expectSourceToContain(source, "只读复核并启用");
    expectSourceToContain(
      source,
      '"http://127.0.0.1:47601/api/read-vehicle-entry"'
    );
    expectSourceToContain(source, '"bridge_write_server_claim_failed"');
    expectSourceToContain(source, "服务器未返回本次正式写卡载荷");
    expectSourceToContain(
      source,
      "本次写卡授权已过期、已处理，或服务器暂时无法读取任务"
    );
    expectSourceToContain(
      source,
      "当前感应卡与所选车辆卡不匹配，或该任务载荷不可用"
    );
    expectSourceToContain(source, "本次 PC 写卡授权未被桥接正确提交");
    expectSourceToContain(source, "本机读取的卡 UID 未能生成有效指纹");
    expectSourceToContain(source, "开始刷车辆卡");
    expectSourceToContain(source, 'target.hostname !== "yx.maomaoyx.com"');
    expectSourceToContain(source, 'target.pathname !== "/mobile/transport"');
    expectSourceToContain(source, "正式写卡时读卡器连接中断");
    expectSourceToContain(source, "更换电脑后需重新安装/启动桥接程序");
    expectSourceToContain(source, "手机不能连接此 Windows 本机桥接");
    const readBridge = source.slice(
      source.indexOf("const readRfidBindingUid"),
      source.indexOf("const prepareRfidCardWrite")
    );
    const writeBridge = source.slice(
      source.indexOf("const writeRfidCardWithBridge"),
      source.indexOf("const confirmRfidCardWrite")
    );
    expect(readBridge).not.toContain("error instanceof Error ? error.message");
    expect(writeBridge).not.toContain("error instanceof Error ? error.message");
  });

  it("车辆卡绑定窗口必须明确区分车辆表单预填、芯片 UID 与已清空的 NDEF 用户区", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "并非从实体卡读取");
    expectSourceToContain(source, "UID 是芯片出厂标识，不会因恢复初卡而改变");
    expectSourceToContain(source, "NDEF 用户区已经清空");
  });

  it("新车辆卡在实体写入与回读确认前显示待写入，并允许执行首次 PC 写卡而不是提前启用", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'EMPTY_RFID_CARD_FORM: RfidCardForm = { vehicleId: "", writerDeviceId: "", managementCode: "", cardUid: "", driverPhone: "", status: "suspended", reuseRevokedUnboundCard: false }'
    );
    expectSourceToContain(source, "待写入（写入并回读确认后启用）");
    expectSourceToContain(
      source,
      "车辆射频卡绑定已保存为待写入；写入并回读确认成功后才会启用"
    );
    expectSourceToContain(
      source,
      'card.status === "suspended" && isInitialIssue'
    );
    expectSourceToContain(
      source,
      'action: isInitialIssue ? "issue" : "rewrite"'
    );
    expectSourceToContain(
      source,
      'isInitialIssue ? "PC 写入车辆卡" : "PC 补写车辆卡"'
    );
    expectSourceToContain(
      source,
      'const canRebind = card.status === "revoked" && !card.vehicleId;'
    );
    expectSourceToContain(source, "重新绑定已解绑车辆卡");
    expectSourceToContain(source, "reuseRevokedUnboundCard: true");
    expectSourceToContain(source, "车辆卡管理编号（后台完整显示）");
    expectSourceToContain(source, "管理编号完整显示；芯片 UID 仅显示受控尾号");
    expectSourceToContain(source, 'className="min-w-[1120px]"');
  });

  it("车辆卡写卡任务会在管理员确认后替换未完成任务，并明确关闭即作废", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "replacePreparedPcBridgeJob");
    expectSourceToContain(source, "确认结束原任务并生成新的单次写卡任务吗？");
    expectSourceToContain(source, "关闭并作废任务");
    expectSourceToContain(
      source,
      "原写卡任务状态已变化，请刷新列表后重新操作。"
    );
  });

  it("统一人员入口保留保险到期、历史档案数与筛选导出，资源成本仍独立", () => {
    const personnelSource = readSource(
      new URL("../components/UnifiedPersonnelDirectory.tsx", import.meta.url)
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<UnifiedPersonnelDirectory");
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      'title:"车辆故障与维修工单"'
    );
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, 'label="车辆维修与保养"');
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      'field("maintenanceRecordId", "关联原维修费用记录ID", "number")'
    );
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      "仅关联真实凭证，不在此新增费用或付款"
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, "saveAssetMaintenance.mutate");
    expectSourceToContain(personnelSource, "historicalDuplicateProfileCount");
    expectSourceToContain(personnelSource, "insuranceStatus");
    expectSourceToContain(personnelSource, "30天内到期");
    expectSourceToContain(personnelSource, "personnelCsv");
    expectSourceToContain(MACHINERY_SOURCE, "累计机械成本台账");
    expectSourceToContain(MACHINERY_SOURCE, "登记维修保养");
    expectSourceToContain(MACHINERY_SOURCE, "维修保养明细");
  });

  it("账号页与劳务页复用同一人员档案组件，账号授权保持独立", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, '<TabsContent value="accounts"');
    expectSourceToContain(source, "<UnifiedPersonnelDirectory");
    expectSourceToContain(source, "普通管理人员账号");
    expectSourceToContain(source, "创建账号后请到“人员授权”分配岗位与范围");
  });

  it("劳务默认统一人员档案不受项目业务查询限制，考勤与结算仍独立", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'lazy(() => import("@/components/UnifiedPersonnelDirectory"))'
    );
    expectSourceToContain(source, "admin.employee.listCompanyRoster");
    expectSourceToContain(
      source,
      "enabled: canQuery && isLabor && !scopedSection"
    );
    expectSourceToContain(
      source,
      'get("tab") === "operations" ? "operations" : "personnel"'
    );
    expectSourceToContain(source, '<TabsContent value="personnel"');
    expectSourceToContain(source, '<TabsContent value="operations"');
    expectSourceToContain(source, "考勤与工资结算");
    expectSourceNotToContain(source, "<CompanyPersonnelRoster");
  });

  it("将所有 CSV 导出统一写入当前筛选范围、导出记录数和生成时间", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "__roadConstructionExportScope");
    expectSourceToContain(source, '["导出模块", scope.module]');
    expectSourceToContain(source, "`筛选条件 · ${label}`");
    expectSourceToContain(source, '["导出记录数", rows.length]');
    expectSourceToContain(
      source,
      '["生成时间", formatChinaDateTime(new Date())]'
    );
    expectSourceNotToContain(
      source,
      '["生成时间", new Date().toLocaleString("zh-CN", { hour12: false })]'
    );
    expectSourceToContain(source, "车辆资源台账");
    expectSourceToContain(source, "机械综合台账");
    expectSourceToContain(source, "劳务考勤与工资台账");
    expectSourceToContain(source, "柴油管理台账");
    expectSourceToContain(source, "员工档案台账");
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      "filterVehicleRows(list.data?.items??[],filters)"
    );
    expectSourceToContain(VEHICLE_WORKSPACE_SOURCE, "rows:filtered.map(v=>");
    expectSourceToContain(VEHICLE_REPORT_SOURCE, "downloadCurrentFilteredCsv");
    expectSourceToContain(
      VEHICLE_REPORT_SOURCE,
      'report.rows.map(row=>row.map(cell=>cell??""))'
    );
    expectSourceToContain(
      VEHICLE_REPORT_SOURCE,
      "全部筛选 {report.rows.length} 条"
    );
    expectSourceToContain(source, "const machines = allMachines.filter");
    expectSourceToContain(source, "visiblePayrolls.map");
  });

  it("将会计日结打印限定为当前封存快照的独立 A4 文档", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      "const printDailyAccountingSnapshot = () => {"
    );
    expectSourceToContain(
      source,
      "title: `会计日结装订页-${financeClosingDate}`"
    );
    expectSourceToContain(source, "getBusinessStatusLabel(closure.status)");
    expectSourceToContain(
      source,
      'button?.textContent?.trim() !== "打印日结装订页"'
    );
    expectSourceToContain(source, "printDailyAccountingSnapshot();");
    expectSourceToContain(
      source,
      "生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}"
    );
    expectSourceToContain(source, "onClick={printDailyAccountingSnapshot}");
    const dailySection = source.slice(
      source.indexOf("后勤每日开支会计日结与打印"),
      source.indexOf("后勤每日开支会计日结与打印") + 1800
    );
    expect(dailySection).not.toContain("window.print()");
  });

  it("账号页与劳务页的新建统一走同一人员录入，保留独立账号授权", () => {
    const source = ADMIN_PAGE_SOURCE;
    const accountsStart = source.indexOf('TabsContent value="accounts"');
    expect(accountsStart).toBeGreaterThan(-1);
    expect(source.slice(accountsStart, accountsStart + 1400)).toContain(
      "<UnifiedPersonnelDirectory"
    );
    expect(source.slice(accountsStart, accountsStart + 1400)).not.toContain(
      "setEmployeeProfileDialogOpen(true)"
    );
    expectSourceToContain(source, 'setLaborWorkspaceTab("personnel")');
    expectSourceToContain(
      source,
      "setPersonnelCreateSignal(current => current + 1)"
    );
    expectSourceToContain(source, 'setPermissionWorkspaceTab("accounts")');
  });
  it("统一人员筛选与录入表单保持手机自适应，操作文字不裁切", () => {
    const source = ADMIN_PAGE_SOURCE;
    const personnelSource = readSource(
      new URL("../components/UnifiedPersonnelDirectory.tsx", import.meta.url)
    );
    expectSourceToContain(
      source,
      "grid h-auto w-full grid-cols-2 gap-1 rounded-xl"
    );
    expectSourceToContain(source, "min-h-10 px-3 text-sm");
    expectSourceToContain(personnelSource, "min-w-0");
    expectSourceToContain(personnelSource, "sm:grid-cols-2");
    expectSourceToContain(personnelSource, "max-h-[94dvh]");
    expectSourceToContain(personnelSource, "sm:max-w-6xl");
  });
  it("在手机宽度将超级后台业务菜单保留为完整可横向滚动的标签条，禁止压缩成裁切单字", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, 'aria-label="超级管理后台业务菜单"');
    expectSourceToContain(source, "justify-start gap-1 overflow-x-auto");
    expectSourceToContain(
      source,
      "h-10 shrink-0 whitespace-nowrap px-3 text-xs"
    );
    expectSourceToContain(source, ">微信登录</TabsTrigger>");
    expectSourceToContain(source, ">业务治理</TabsTrigger>");
  });

  it("将高频业务台账统一提供响应式表格式总览，保留详情入口和既有状态操作", () => {
    expectSourceToContain(ADMIN_PAGE_SOURCE, "function LedgerTable");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "台账列表 · 可筛选 / 可导出");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "手机端可左右滑动查看完整字段");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<UnifiedPersonnelDirectory");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<VehicleManagementWorkspace");
    expectSourceToContain(VEHICLE_REPORT_SOURCE, "max-w-full overflow-x-auto");
    expectSourceToContain(VEHICLE_WORKSPACE_SOURCE, "统一车辆详情");
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, "关联检查与删除保护");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<ConstructionWorkspace");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<MachineryWorkspace");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<TransportTripLedger");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<PurchasingWorkspace");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<PayrollStatementLedger");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "发票、成本与审计台账");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "站内通知、投递与确认台账");
    expectSourceToContain(CONSTRUCTION_SOURCE, "施工日报、现场影像与审核台账");
    expectSourceToContain(CONSTRUCTION_SOURCE, "查看详情 / 照片");
    expectSourceToContain(MACHINERY_SOURCE, "机械详情分区");
  });

  it("将车辆资源交给唯一全宽工作区，以独立受控表单新增、编辑和关联检查归档", () => {
    const source = ADMIN_PAGE_SOURCE;

    expect((source.match(/<VehicleManagementWorkspace /g) ?? []).length).toBe(
      1
    );
    expectSourceToContain(source, "projects={projects.data ?? []}");
    expectSourceToContain(source, "createRequest={vehicleCreateRequest}");
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      'data-vehicle-management-workspace="six-columns"'
    );
    expectSourceToContain(VEHICLE_WORKSPACE_SOURCE, "新建车辆");
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      "create&&(<VehicleRegistryForm"
    );
    expectSourceToContain(
      VEHICLE_FORMS_SOURCE,
      'title={vehicle ? `编辑车辆 · ${vehicle.plateNo}` : "新建车辆档案"}'
    );
    expectSourceToContain(
      VEHICLE_REPORT_SOURCE,
      'table className="w-full text-left text-xs"'
    );
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, 'setTarget({kind:"remove"})');
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      "有运单、维修、采购、卡片、合同、使用依据、授权或结算关联的车辆不能直接删除"
    );
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      "projectId: detail.vehicle.projectId, version: detail.version"
    );
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      "remove.mutateAsync({ ...base, reason: form.reason })"
    );
    expectSourceToContain(source, "batchRemoveVehicles");
    expectSourceToContain(source, "车辆批量受控删除结果");
    expectSourceNotToContain(
      source,
      'activeSection === "vehicles" ? <LedgerTable'
    );
    expectSourceNotToContain(source, "点击一辆车即可在右侧编辑");
    expectSourceNotToContain(
      source,
      "请使用右侧表单录入已授权项目的真实车辆资料"
    );
  });

  it("在车辆档案中提供皮卡和越野车，并按独立用途保留挂车中文标签", () => {
    expect(VEHICLE_TYPE_LABELS.pickup).toBe("皮卡");
    expect(vehicleLabel("pickup")).toBe("皮卡");
    expect(vehicleLabel("suv")).toBe("越野车");
    expect(vehicleLabel("trailer")).toBe("挂车");
    expectSourceToContain(
      VEHICLE_FORMS_SOURCE,
      'options={Object.entries(VEHICLE_TYPE_LABELS).filter(([key])=>key!=="trailer")}'
    );
    expectSourceToContain(
      VEHICLE_FORMS_SOURCE,
      '["dump_truck","tractor","mixer","flatbed","pickup","suv","other"] as const'
    );
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      '["trailer","挂车（独立建档）"]'
    );
    expectSourceToContain(
      VEHICLE_LIFECYCLE_SOURCE,
      'purpose:requireVehicleChoice(form.purpose,["general","trailer"] as const'
    );
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      'v.profile?.purpose==="trailer"?"挂车":vehicleLabel(v.vehicleType)'
    );
    expectSourceToContain(
      VEHICLE_DETAIL_SOURCE,
      'd.profile?.purpose==="trailer"?"挂车":vehicleLabel(d.vehicle.vehicleType)'
    );
  });

  it("柴油登记默认当前时间、提供防重复录入提醒，并在权限管理中拆出柴油细分权限", () => {
    const source = ADMIN_PAGE_SOURCE;
    const foundationSource = readSource(
      new URL("../../../server/services/foundationData.ts", import.meta.url)
    );

    expectSourceToContain(source, "function DuplicateEntryNotice");
    expectSourceToContain(source, "防重复录入提醒");
    expectSourceToContain(source, "dieselDuplicateCandidates");
    expectSourceToContain(source, "请确认不是重复录入后再继续保存");
    expectSourceToContain(
      source,
      "refueledAt: toLocalDateTimeInput(new Date())"
    );
    expectSourceToContain(source, 'diesel: "柴油管理"');
    expectSourceToContain(
      foundationSource,
      '["diesel:read", "柴油台账查看", "diesel", "read"]'
    );
    expectSourceToContain(
      foundationSource,
      '["diesel:refuel:create", "柴油领用登记", "diesel", "create"]'
    );
    expectSourceToContain(
      foundationSource,
      '["diesel:guideline:manage", "柴油指导价维护", "diesel", "manage"]'
    );
    expectSourceToContain(
      foundationSource,
      '["diesel:deduction:settle", "运输扣油结算", "diesel", "settle"]'
    );
  });

  it("在真实车辆费用栏目汇总油料与收支，单车日月分析和运输录入共用档案入口", () => {
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      "trpc.transport.listVehicleSummaries.useQuery({projectId,period}"
    );
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      '"油料","维修保养","配件","已核定租赁","未核定租赁估算","本期实付"'
    );
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      "r.confirmedTransportAmount,r.pendingTransportAmount,r.fuelAmount"
    );
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      "r.cumulative.remainingPayableAmount,r.cumulative.remainingReceivableAmount"
    );
    expectSourceToContain(
      VEHICLE_WORKSPACE_SOURCE,
      "自有经营、租入成本和外协车主应付不混称公司净利润"
    );
    expectSourceToContain(
      VEHICLE_DETAIL_SOURCE,
      "trpc.transport.getVehicleAnalysis.useQuery({vehicleId:d.vehicle.id,projectId,period}"
    );
    expectSourceToContain(
      VEHICLE_DETAIL_SOURCE,
      'view==="daily"?a.daily:a.monthly'
    );
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, "a.summary.costCoverageNote");
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, "a.summary.fuelMetricNote");
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, "a.partsPurchases.map");
    expectSourceToContain(VEHICLE_REPORT_SOURCE, "导出全部筛选");
    expectSourceToContain(VEHICLE_REPORT_SOURCE, "打印全部筛选");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "录入车辆档案");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "共用车辆档案 / 柴油分析");
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "setVehicleCreateRequest({ projectId: workspaceProjectId, requestId: Date.now()"
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, 'setLocation("/admin/vehicles")');
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, 'aria-label="单车费用月份"');
    expectSourceToContain(VEHICLE_DETAIL_SOURCE, "d.historyProjectIds.map");
    expectSourceToContain(
      VEHICLE_DETAIL_SOURCE,
      "min-h-0 flex-1 space-y-4 overflow-y-auto"
    );
  });

  it("将机械档案、维修保养、会计月度快照收敛为单条主台账，并提供单机日月收益支出分析", () => {
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<MachineryWorkspace");
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "trpc.machinery.previewMonthlyStatement.useQuery"
    );
    expectSourceToContain(ADMIN_PAGE_SOURCE, "生成会计明细草稿");
    expectSourceToContain(
      MACHINERY_SOURCE,
      "trpc.machinery.listMonthlyStatements.useQuery"
    );
    expectSourceToContain(
      MACHINERY_SOURCE,
      "trpc.machinery.getMachineAnalysis.useQuery"
    );
    expectSourceToContain(MACHINERY_SOURCE, "机械档案");
    expectSourceToContain(MACHINERY_SOURCE, "机械业务详情");
    expectSourceToContain(MACHINERY_SOURCE, "合同月租");
    expectSourceToContain(MACHINERY_SOURCE, "日租费用");
    expectSourceToContain(MACHINERY_SOURCE, "原日净额");
    expectSourceToContain(MACHINERY_SOURCE, "维修保养明细");
    expect(
      (ADMIN_PAGE_SOURCE.match(/<MachineryWorkspace /g) ?? []).length
    ).toBe(1);
    expectSourceNotToContain(
      ADMIN_PAGE_SOURCE,
      'activeSection === "machinery" ? <LedgerTable'
    );
  });

  it("提供独立柴油管理入口，并按每次加油的升数与当天单价自动形成油费快照", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, 'label: "柴油管理"');
    expectSourceToContain(source, 'path: "/admin/diesel"');
    expectSourceToContain(
      source,
      'const isDiesel = activeSection === "diesel"'
    );
    expectSourceToContain(
      source,
      'activeSection === "finance" || activeSection === "diesel"'
    );
    expectSourceToContain(source, "适用单价");
    expectSourceToContain(source, "柴油管理与加油台账");
    expectSourceToContain(source, "项目部供油（当天指导价）");
    expectSourceToContain(source, "加油站现金加油（当天实际价）");
    expectSourceToContain(source, "当天现金单价（元/升）");
    expectSourceToContain(source, "现金油费预览");
  });

  it("将加油表工程水印、组合筛选、油价异常预警和供应商采购对账纳入柴油审计闭环", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, 'sourceType: "diesel_receipt"');
    expectSourceToContain(source, "加油表现场照片（必拍）");
    expectSourceToContain(source, "打开后置相机拍摄加油表");
    expectSourceToContain(source, 'facingMode: { ideal: "environment" }');
    expectSourceNotToContain(
      source,
      'accept="image/jpeg,image/png" onChange={event => setDieselReceiptFile'
    );
    expectSourceToContain(source, "维护指导价");
    expectSourceToContain(source, "无需选择某一趟");
    expectSourceToContain(
      source,
      "自动写入项目、加油时间、详细地点、操作人与防伪编号"
    );
    expectSourceToContain(source, "captureWatermarkLocation");
    expectSourceToContain(source, "createWatermarkedImage");
    expectSourceToContain(source, "柴油组合筛选");
    expectSourceToContain(source, "柴油筛选车牌");
    expectSourceToContain(source, "柴油加油开始日期");
    expectSourceToContain(source, "柴油加油结束日期");
    expectSourceToContain(source, "柴油加油月份");
    expectSourceToContain(source, "柴油筛选供应商");
    expectSourceToContain(source, "导出当前筛选明细");
    expectSourceToContain(source, "dieselRefuelRecordsInput");
    expectSourceToContain(source, "查看受控小票影像");
    expectSourceToContain(source, "现金油价异常预警");
    expectSourceToContain(
      source,
      "trpc.admin.diesel.getPriceAlertRule.useQuery"
    );
    expectSourceToContain(source, "<DieselSupplierReport");
    const supplierReport = readSource(
      new URL("../components/DieselSupportingReports.tsx", import.meta.url)
    );
    expectSourceToContain(supplierReport, "供应商");
    expectSourceToContain(supplierReport, "downloadCurrentFilteredCsv");
    expectSourceToContain(
      source,
      "trpc.admin.diesel.supplierReconciliation.useQuery"
    );
    expectSourceToContain(supplierReport, "柴油供应商汇总-");
  });

  it("将柴油指导价项目选择独占整行，避免与指导单价在窄屏弹窗重叠", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'data-testid="diesel-guideline-project-field"'
    );
    expectSourceToContain(source, 'className="w-full min-w-0"');
    expectSourceToContain(source, "grid grid-cols-1 gap-3 sm:grid-cols-2");
  });

  it("在 PC 施工日报台账中提供按单条读取的受控照片预览入口", () => {
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<ConstructionWorkspace");
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "trpc.construction.reportEvidence.useQuery"
    );
    expectSourceToContain(CONSTRUCTION_SOURCE, "reportIds: [report.id]");
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "enabled: active && report.projectId > 0 && report.id > 0"
    );
    expectSourceToContain(CONSTRUCTION_SOURCE, "查看详情 / 照片");
    expectSourceToContain(CONSTRUCTION_SOURCE, "关联现场照片");
    expectSourceToContain(CONSTRUCTION_SOURCE, "<ProtectedImagePreview");
    expectSourceToContain(CONSTRUCTION_SOURCE, "<ConstructionReportSheet");
    expectSourceToContain(
      readSource(new URL("../lib/constructionOutput.ts", import.meta.url)),
      "审核结果与回复"
    );
  });

  it("在 PC 施工日报台账中按日期、提交管理员和关键字服务端筛选，并按当前筛选批量打印", () => {
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "constructionFilterInput(projectId, tab, filter)"
    );
    expectSourceToContain(CONSTRUCTION_SOURCE, "日报开始日期");
    expectSourceToContain(CONSTRUCTION_SOURCE, "日报结束日期");
    expectSourceToContain(CONSTRUCTION_SOURCE, "提交管理员");
    expectSourceToContain(CONSTRUCTION_SOURCE, "关键字查询");
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "trpc.construction.reportSubmitterOptions.useQuery"
    );
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "utils.construction.outputManifest.fetch"
    );
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "utils.construction.printReports.fetch"
    );
    expectSourceToContain(CONSTRUCTION_SOURCE, "批量打印当前筛选日报");
    expectSourceToContain(CONSTRUCTION_SOURCE, "施工日志批量打印");
    expectSourceToContain(CONSTRUCTION_SOURCE, "openA4PrintDocument");
    expectSourceToContain(CONSTRUCTION_SOURCE, 'orientation: "portrait"');
    expectSourceToContain(CONSTRUCTION_SOURCE, "reportIds: batch.ids");
  });

  it("移除各业务页顶部重复台账，仅保留工作区中的统一主表格和行内详情流程", () => {
    expectSourceToContain(ADMIN_PAGE_SOURCE, "投递明细与确认状态");
    expectSourceToContain(ADMIN_PAGE_SOURCE, "施工日报查看与编辑");
    expectSourceToContain(MACHINERY_SOURCE, "机械业务详情");
    for (const module of [
      "labor",
      "transport",
      "finance",
      "broadcast",
      "permission",
    ])
      expectSourceNotToContain(
        ADMIN_PAGE_SOURCE,
        'activeSection === "' + module + '" ? <LedgerTable'
      );
  });

  it("仅保留统计卡下方的一套施工日报工作区，避免同一日报在页面顶部和底部重复展示", () => {
    expect(
      (ADMIN_PAGE_SOURCE.match(/<ConstructionWorkspace /g) ?? []).length
    ).toBe(1);
    expectSourceNotToContain(
      ADMIN_PAGE_SOURCE,
      'activeSection === "construction" ? <LedgerTable'
    );
    expectSourceToContain(CONSTRUCTION_SOURCE, "施工日报、现场影像与审核台账");
    expectSourceToContain(
      CONSTRUCTION_SOURCE,
      "pagination.pageRows.map(report"
    );
    expectSourceToContain(CONSTRUCTION_SOURCE, "FinancePagination");
    expectSourceToContain(CONSTRUCTION_SOURCE, "CONSTRUCTION_WORKSPACE_TABS");
  });

  it("对可维护主数据提供行内编辑与受控批量处理，同时不将历史业务单据误作物理删除", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "onEdit?: () => void");
    expectSourceToContain(source, "onRemove?: () => void");
    expectSourceToContain(source, "批量受控删除");
    expectSourceToContain(source, "batchRemoveVehicles");
    expectSourceToContain(source, "车辆批量受控删除结果");
    expectSourceToContain(source, "batchSuspendEmployees");
    expectSourceToContain(source, "员工批量停用结果");
    expectSourceToContain(source, "batchRetireMachines");
    expectSourceToContain(source, "机械批量退役结果");
    expectSourceToContain(source, "工资、考勤、保险和授权历史均被保留");
    expectSourceToContain(source, "机械记录及其成本、租赁、维修历史均被保留");
    expectSourceToContain(source, "isEditableConstructionReport");
  });

  it("将服务号全部五项参数集中为一次保存并校验的单一表单，不再以分项预设按钮引导配置", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "saveOfficialAccountConfiguration");
    expectSourceToContain(source, "保存并校验服务号配置");
    expectSourceToContain(source, "微信 API 固定出口网关地址");
    expectSourceToContain(source, "固定出口网关签名密钥");
    expectSourceToContain(source, "域名与消息推送配置");
    expectSourceToContain(source, "getOfficialAccountMessagePushConfiguration");
    expectSourceToContain(
      source,
      "saveOfficialAccountMessagePushConfiguration"
    );
    expectSourceToContain(
      source,
      "testOfficialAccountMessagePushConfiguration"
    );
    expectSourceToContain(source, "微信后台 URL");
    expectSourceToContain(source, "EncodingAESKey");
    expectSourceToContain(source, "保存三项参数");
    expectSourceToContain(source, "明文模式");
    expectSourceToContain(source, "XML");
    expectSourceToContain(source, "校验回调 200");
    expectSourceToContain(source, "其它系统参数");
    expectSourceNotToContain(source, "OFFICIAL_ACCOUNT_SETTING_PRESETS");
  });

  it("在系统设置提供外部 AI API 的受控配置、连接校验与摘要降级说明", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "AI 模型 API 接入");
    expectSourceToContain(source, "AI API 基础地址");
    expectSourceToContain(source, "AI API Key");
    expectSourceToContain(source, "启用外部 AI 摘要");
    expectSourceToContain(source, "保存 AI API 配置");
    expectSourceToContain(source, "校验 API 连接");
    expectSourceToContain(
      source,
      "trpc.admin.settings.getExternalAiConfiguration.useQuery"
    );
    expectSourceToContain(
      source,
      "trpc.admin.settings.saveExternalAiConfiguration.useMutation"
    );
    expectSourceToContain(
      source,
      "trpc.admin.settings.testExternalAiConfiguration.useMutation"
    );
    expectSourceToContain(source, "外部 AI 辅助摘要");
    expectSourceToContain(source, "系统内置 AI 辅助摘要");
  });

  it("允许私有模板按业务模块绑定并自动映射字段，不再要求用户手填内部占位符", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "bindOfficialAccountModuleTemplate");
    expectSourceToContain(source, "绑定并自动映射");
    expectSourceToContain(source, "运输刷卡与趟次");
    expectSourceToContain(source, "机械/车辆维保审核");
    expectSourceToContain(source, "待绑定对应模板");
    expectSourceToContain(source, "系统按模板 `.DATA` 字段自动映射");
  });

  it("提供角色级详细操作权限矩阵，支持按模块设置动作并批量全选或清空", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "角色详细操作权限");
    expectSourceToContain(source, "permissionActionLabels");
    expectSourceToContain(source, "全选本模块");
    expectSourceToContain(source, "清空</Button>");
    expectSourceToContain(source, "未选动作会被服务端拒绝");
    expectSourceToContain(source, "setRolePermissionModule");
  });

  it("将权限管理分为账号、授权、角色操作和部门菜单四个紧凑分类", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "type PermissionWorkspaceTab =");
    expectSourceToContain(source, 'value="authorization"');
    expectSourceToContain(source, 'value="accounts"');
    expectSourceToContain(source, 'value="roles"');
    expectSourceToContain(source, 'value="department"');
    expectSourceToContain(source, "页面调整不会放宽现有权限边界");
    expectSourceToContain(source, "专属权限只覆盖该用户在对应模块的具体操作");
  });

  it("在每位普通管理人员卡片中提供用户专属操作权限入口，并用独立对话框保存到具体用户", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, ">专属权限</Button>");
    expectSourceToContain(source, "分配用户专属操作权限");
    expectSourceToContain(source, "setUserPermissions.mutate");
    expectSourceToContain(source, "保存该用户权限");
    expectSourceToContain(source, "未勾选时沿用角色权限");
  });

  it("提供可解释的 AI 项目风险扫描、处置与财务分类分析，并要求维护设备核定油箱容量", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, 'label: "智能风控", path: "/admin/risk"');
    expectSourceToContain(source, 'const isRisk = activeSection === "risk"');
    expectSourceToContain(source, "AI 项目风险预警中心");
    expectSourceToContain(source, "立即扫描并提醒");
    expectSourceToContain(source, "风险预警台账与管理提醒");
    expectSourceToContain(source, "生成 AI 管理摘要");
    expectSourceToContain(source, "按成本类别分析汇总");
    expectSourceToContain(
      source,
      "完整展示生活开支、柴油油料、工资劳务、机械成本、车辆与运输、采购材料及其他开支"
    );
    expectSourceToContain(source, "核定油箱容量（L）");
    expectSourceToContain(
      source,
      "trpc.projectRisk.financeCategoryAnalysis.useQuery"
    );
  });

  it("在治理概览提供施工项目经营 KPI 作业指引，并明确真实数据来源、管理频率、责任角色与工作区入口", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "施工项目经营 KPI 作业指引");
    expectSourceToContain(source, "施工日报有效率");
    expectSourceToContain(source, "资源成本归集");
    expectSourceToContain(source, "采购实耗闭环");
    expectSourceToContain(source, "计量与分包对账");
    expectSourceToContain(source, "财务确认与资金计划");
    expectSourceToContain(source, "服务号通知送达率");
    expectSourceToContain(
      source,
      "业务暂估、未审核成本或未确认收入必须与财务确认口径分开查看"
    );
  });

  it("在财务管理显示小类目成本占比，并支持导出当前项目和期间的真实汇总", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "小类目成本占比与导出");
    expectSourceToContain(source, "生活开支占项目开支");
    expectSourceToContain(source, "工资劳务占项目开支");
    expectSourceToContain(source, "导出小类目汇总");
    expectSourceToContain(source, "riskFinanceAnalysis.data?.subcategories");
    expectSourceToContain(source, "采购订单应付与实际现金结算继续分开处理");
  });

  it("完整展示支出分类，并支持点击分类后按来源、状态、日期和关键词下钻真实明细", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      "完整展示生活开支、柴油油料、工资劳务、机械成本、车辆与运输、采购材料及其他开支"
    );
    expectSourceToContain(
      source,
      "trpc.projectRisk.financeCategoryDetails.useQuery"
    );
    expectSourceToContain(source, "项目支出分类明细");
    expectSourceToContain(source, "查看全部明细");
    expectSourceToContain(
      source,
      "dateFrom: toLocalDateInput(), dateTo: toLocalDateInput()"
    );
    expectSourceToContain(source, "开始日期（默认当天）");
    expectSourceToContain(source, "结束日期（默认当天）");
    expectSourceNotToContain(source, "开始日期（留空为当前会计期间）");
    expectSourceToContain(source, "导出当前明细");
  });

  it("在财务工作区提供封存日期锁定、授权反结账原因与版本快照显示", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "日结封存、授权反结账与版本快照");
    expectSourceToContain(
      source,
      "trpc.finance.reopenDailyAccount.useMutation"
    );
    expectSourceToContain(source, "financeReopenReason");
    expectSourceToContain(source, "授权反结账");
    expectSourceToContain(source, "旧快照与反结账原因永久保留");
    expectSourceToContain(
      source,
      "dailyAccountingReport.data.closure.revision ?? 1"
    );
  });

  it("提供项目容量完备度、整改责任人期限和逾期升级验收闭环", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "设备容量、整改期限与逾期升级");
    expectSourceToContain(source, "车辆容量已配置");
    expectSourceToContain(source, "机械容量已配置");
    expectSourceToContain(source, "启用每日整改逾期升级");
    expectSourceToContain(source, "检查时间（中国标准时间）");
    expectSourceToContain(source, "执行逾期升级验收");
    expectSourceToContain(source, "整改派单");
    expectSourceToContain(source, "整改责任人");
    expectSourceToContain(source, "整改期限");
    expectSourceToContain(
      source,
      "trpc.projectRisk.capacityReadiness.useQuery"
    );
    expectSourceToContain(source, "trpc.projectRisk.listAssignees.useQuery");
    expectSourceToContain(
      source,
      "trpc.projectRisk.assignRectification.useMutation"
    );
    expectSourceToContain(
      source,
      "trpc.projectRisk.runOverdueEscalation.useMutation"
    );
  });

  it("将历史整改期限回填为设备本地 datetime-local 值，并在保存时继续提交 UTC 时间戳", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "toDeviceDateTimeInput(`${next.dueAt}:00Z`)");
    expectSourceToContain(
      source,
      "dueAt: new Date(riskRectificationTarget.dueAt).toISOString()"
    );
    expectSourceToContain(
      source,
      'dueAt: item.dueAt ? new Date(item.dueAt).toISOString().slice(0, 16) : ""'
    );
    expectSourceToContain(
      source,
      "return next?.dueAt ? { ...next, dueAt: toDeviceDateTimeInput(`${next.dueAt}:00Z`) } : next;"
    );
  });
});

describe("后台服务号绑定状态映射", () => {
  it("使用官方账号绑定状态而不是员工档案状态显示绑定结果", () => {
    const source = ADMIN_PAGE_SOURCE;
    expectSourceToContain(source, "officialAccountBindingStatus");
    expectSourceToContain(
      source,
      'user.officialAccountBindingStatus === "active" ? "已绑定"'
    );
    expectSourceNotToContain(
      source,
      'user.profileStatus === "active" ? "已完成关注绑定"'
    );
  });
});

describe("后台全员上下班考勤定位展示", () => {
  it("分别展示上班和下班中文地址并纳入 CSV 导出，默认不再呈现原始坐标", () => {
    const source = readSource(
      new URL("../components/LaborCheckInLedger.tsx", import.meta.url)
    );
    const adminSource = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      adminSource,
      'lazy(() => import("@/components/LaborCheckInLedger"))'
    );
    expectSourceToContain(adminSource, "<LaborCheckInLedger");
    expectSourceToContain(source, "上班打卡位置");
    expectSourceToContain(source, "下班打卡位置");
    expectSourceToContain(source, "上班位置");
    expectSourceToContain(source, "下班位置");
    expectSourceToContain(source, "item.checkInAddress");
    expectSourceToContain(source, "item.checkoutAddress");
    expectSourceToContain(source, "中文地址");
    expectSourceNotToContain(
      source,
      "formatAttendanceLocation(item.checkoutLongitude"
    );
  });

  it("后台上下班打卡台账默认使用中国业务日期，与服务端打卡日期裁切保持一致", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, 'timeZone: "Asia/Shanghai"');
    expectSourceToContain(source, "function toChinaBusinessDateInput");
    expectSourceToContain(
      source,
      "initialAttendanceDate={toChinaBusinessDateInput()}"
    );
    expectSourceToContain(
      source,
      "fallbackBusinessDate={toChinaBusinessDateInput()}"
    );
  });
});

describe("后台导出性能", () => {
  it("仅在生成Excel时按需加载维护中的 XLSX 包，不将其作为首屏静态依赖", () => {
    const source = ADMIN_PAGE_SOURCE;
    expectSourceToContain(source, 'const XLSX = await import("@e965/xlsx")');
    expectSourceNotToContain(source, 'import * as XLSX from "@e965/xlsx"');
  });
});

describe("后台劳务台账独立懒加载", () => {
  it("将上下班打卡、人员档案和考勤记录交给独立组件，父页面继续保留受控详情和导出回调", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'lazy(() => import("@/components/LaborCheckInLedger"))'
    );
    expectSourceToContain(
      source,
      'lazy(() => import("@/components/LaborWorkerRoster"))'
    );
    expectSourceToContain(
      source,
      'lazy(() => import("@/components/LaborAttendanceLedger"))'
    );
    expectSourceToContain(source, "<LaborCheckInLedger");
    expectSourceToContain(source, "<LaborWorkerRoster");
    expectSourceToContain(source, "<LaborAttendanceLedger");
    expectSourceToContain(source, 'module: "劳务考勤高级筛选导出"');
    expectSourceToContain(source, "setDesktopRecordDetail");
    expectSourceNotToContain(
      source,
      "旧版内联台账保留为本次拆分的受控回退参照"
    );
    expectSourceNotToContain(source, "{false && <>");
    expectSourceNotToContain(source, "· {item.source} ·");
  });
});

describe("采购订单详情与附件收敛", () => {
  it("移除独立缩略图影像板块，并仅在订单详情中提供受控文件入口", () => {
    expectSourceToContain(PURCHASING_SOURCE, "PurchasingEvidencePreview");
    expectSourceToContain(PURCHASING_SOURCE, "documentAttachment");
    expectSourceToContain(PURCHASING_SOURCE, "invoiceAttachment");
    expectSourceToContain(PURCHASING_SOURCE, "业务详情、附件和操作");
    expectSourceToContain(
      PURCHASING_OUTPUT_SOURCE,
      'closed: "已关闭（不代表历史付清）"'
    );
    expectSourceNotToContain(ADMIN_PAGE_SOURCE, "订单单据与发票影像");
  });
});

describe("采购费用票据报销详单打印", () => {
  it("使用正式报销单表格、顶部居中标题、人员字段、备注和较小票据图片", () => {
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "采购费用票据报销详单");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "提交上传管理员");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "现场管理员");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "报销人");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "备注");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "receipt-title");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "height:62mm");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "expense-table");
    expectSourceToContain(PURCHASING_OUTPUT_SOURCE, "voucher-panel");
    expectSourceToContain(
      PURCHASING_OUTPUT_SOURCE,
      "toChinaDateInput(order.orderedAt)"
    );
    expectSourceToContain(
      PURCHASING_OUTPUT_SOURCE,
      "amountToChineseUppercase(order.amount)"
    );
    expectSourceToContain(
      PURCHASING_OUTPUT_SOURCE,
      "width:210mm;height:148.5mm"
    );
    expectSourceNotToContain(PURCHASING_OUTPUT_SOURCE, "伍拾元");
  });
});

describe("运输台账展示收敛", () => {
  it("运输页面仅保留完整全台账作为运单筛选、导出与操作入口", () => {
    expectSourceToContain(ADMIN_PAGE_SOURCE, "<TransportTripLedger");
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "onCreateSettlement={openTripSettlement}"
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "TransportRetainedPanel active={ledgerActive}"
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      'transportWorkspaceTab === "terminals" ? renderRfidManagement() : null'
    );
    expect(
      (ADMIN_PAGE_SOURCE.match(/<TransportTripLedger /g) ?? []).length
    ).toBe(1);
  });
});

describe("柴油台账状态中文化", () => {
  it("导出与详情使用共享状态中文投影，不直接回显内部枚举", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      "displayDate(item.refueledAt), getBusinessStatusLabel(item.status)"
    );
    expectSourceToContain(
      source,
      '{ label: "状态", value: getBusinessStatusLabel(item.status) }'
    );
    expectSourceNotToContain(
      source,
      "displayDate(item.refueledAt), item.status]))}>导出当前筛选明细"
    );
    expectSourceNotToContain(
      source,
      '{ label: "状态", value: item.status }] }) }))} />'
    );
  });
});

describe("劳务与机械导出中文化", () => {
  it("不直接回显考勤来源、状态或租赁计费枚举", () => {
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      'import { getAttendanceSourceLabel, getInvoiceTypeLabel } from "@shared/domain";'
    );
    expectSourceToContain(
      ADMIN_PAGE_SOURCE,
      "getAttendanceSourceLabel(item.source), getBusinessStatusLabel(item.status)"
    );
    expectSourceToContain(MACHINERY_SOURCE, "leaseLabel(machine)");
    expectSourceToContain(MACHINERY_SOURCE, "machineStatus(machine.status)");
    expectSourceToContain(MACHINERY_SOURCE, "历史台班合同");
    expectSourceNotToContain(
      ADMIN_PAGE_SOURCE,
      "item.workHours, item.overtimeHours, item.source, item.status"
    );
  });
});

describe("财务发票类型中文化", () => {
  it("台账、详情和打印均使用受控中文标签", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'import { getAttendanceSourceLabel, getInvoiceTypeLabel } from "@shared/domain";'
    );
    expectSourceToContain(source, "getInvoiceTypeLabel(invoice.invoiceType)");
    expectSourceNotToContain(source, ">{invoice.invoiceType}</TableCell>");
    expectSourceNotToContain(
      source,
      '{ label: "发票类型", value: invoice.invoiceType }'
    );
  });
});

describe("风险预警标签中文化", () => {
  it("表格与导出对未知类别、等级和状态采用中文安全回退", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(
      source,
      'const displayRiskAlertCategory = (category: string) => categoryLabel[category] ?? "其他风险"'
    );
    expectSourceToContain(
      source,
      'const displayRiskAlertSeverity = (severity: string) => severityLabel[severity] ?? "提示"'
    );
    expectSourceToContain(
      source,
      'const displayRiskAlertStatus = (status: string) => riskAlertStatusLabel[status] ?? "待处置"'
    );
    expectSourceToContain(
      source,
      "displayRiskAlertCategory(item.category), displayRiskAlertSeverity(item.severity)"
    );
    expectSourceToContain(
      source,
      '<Badge variant="outline">{displayRiskAlertStatus(item.status)}</Badge>'
    );
    expectSourceNotToContain(source, "item.summary, item.status]))}>导出");
  });
});

describe("范围通知投递审计脱敏", () => {
  it("前端不展示供应商失败码，投递原因由服务端中文化投影", () => {
    const source = ADMIN_PAGE_SOURCE;

    expectSourceToContain(source, "原因：${delivery.deliveryReason}");
    expectSourceToContain(source, "处理建议： {delivery.failureGuidance}");
    expectSourceNotToContain(source, "delivery.failureCode");
    expectSourceNotToContain(source, "微信码 ${delivery.failureCode}");
  });
});

it("劳务工资将筛选与查询下沉到仅在劳务菜单挂载的懒加载容器", () => {
  const source = ADMIN_PAGE_SOURCE;
  const loader = readSource(
    new URL("../components/LaborWorkspaceLoader.tsx", import.meta.url)
  );
  expectSourceToContain(source, "const LaborWorkspaceLoader = lazy");
  expectSourceToContain(source, "const renderLabor = () =>");
  expectSourceToContain(source, "<LaborWorkspaceLoader");
  expectSourceNotToContain(
    source,
    "useLaborWorkspaceQueries({ enabled: canQuery && isLabor"
  );
  expectSourceToContain(
    loader,
    "useLaborWorkspaceFilters(initialAttendanceDate)"
  );
  expectSourceToContain(loader, "useLaborWorkspaceQueries({ enabled");
});

it("后台操作与查询异常仅显示中文安全提示，不直接回显技术错误信息", () => {
  const source = ADMIN_PAGE_SOURCE;

  expectSourceToContain(
    source,
    'import { getUserFacingErrorMessage } from "@/lib/userFacingError";'
  );
  expectSourceToContain(
    source,
    "getUserFacingErrorMessage(broadcastAudiencePreview.error"
  );
  expectSourceToContain(
    source,
    "getUserFacingErrorMessage(machineMonthlyPreview.error"
  );
  expectSourceNotToContain(source, "toast.error(error.message)");
  expectSourceNotToContain(source, "error instanceof Error ? error.message");
});
