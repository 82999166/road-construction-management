import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_BUSINESS_ROUTE_BY_MODULE } from "@/lib/adminBusinessRoutes";
import { getBusinessWorkspaceProjectState } from "@/lib/adminWorkspaceState";

describe("统一后台业务工作区范围保护", () => {
  it("仅接受正整数项目号作为真实业务台账查询范围", () => {
    expect(getBusinessWorkspaceProjectState("27")).toEqual({ projectId: 27, hasProject: true });
    expect(getBusinessWorkspaceProjectState("")).toEqual({ projectId: 0, hasProject: false });
    expect(getBusinessWorkspaceProjectState("0")).toEqual({ projectId: 0, hasProject: false });
    expect(getBusinessWorkspaceProjectState("2.5")).toEqual({ projectId: 0, hasProject: false });
    expect(getBusinessWorkspaceProjectState("abc")).toEqual({ projectId: 0, hasProject: false });
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
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('label: "施工管理", path: "/admin/construction"');
    expect(source).toContain('label: "车辆管理", path: "/admin/vehicles"');
    expect(source).toContain('label: "机械管理", path: "/admin/machinery"');
    expect(source).toContain('label: "运输管理", path: "/admin/transport"');
    expect(source).toContain('label: "权限管理", path: "/admin/permission"');
  });

  it("禁止 PC 台账的查看、编辑和维护操作直接跳转到移动端", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/setLocation\(["'`]\/mobile/);
    expect(source).toContain("施工日报查看与编辑");
    expect(source).toContain("劳务人员档案");
    expect(source).toContain("<TransportTripLedger");
  });

  it("将受控表单字段包装组件定义在模块作用域，避免状态更新重挂载输入框并导致失焦", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const fieldDefinition = source.indexOf("function Field({ label, children }");
    const pageDefinition = source.indexOf("export default function AdminPage");

    expect(fieldDefinition).toBeGreaterThan(-1);
    expect(pageDefinition).toBeGreaterThan(fieldDefinition);
    expect(source).not.toContain("const Field = ({ label, children }");
  });

  it("向普通管理员复用核心 PC 台账时只展示当前业务和工作台导航", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("scopedSection?: ScopedPcAdminSection");
    expect(source).toContain("const scopedMenuItems: DashboardMenuItem[] = scopedSection");
    expect(source).toContain('label: "业务工作台", path: "/admin", section: "我的工作台"');
    expect(source).toContain("menuItems={scopedMenuItems}");
    expect(source).toContain("!scopedSection ? <Tabs");
  });

  it("在 PC 超级管理后台承载员工、车辆与机械的关键维护闭环", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("普通管理人员账号");
    expect(source).toContain("管理人员角色授权");
    expect(source).toContain("车辆统一台账");
    expect(source).toContain("RFID 写卡");
    expect(source).toContain("机械资源、维修与会计计价台账");
    expect(source).toContain("新建机械档案");
    expect(source).toContain("机械业务详情");
    expect(source).toContain("录入成本");
    expect(source).toContain("会计产值计价规则");
    expect(source).toContain("外租车辆");
    expect(source).toContain("起租日期");
    expect(source).toContain("截止日期");
    expect(source).toContain('Field label="驾驶员姓名"');
    expect(source).toContain('Field label="驾驶员手机"');
    expect(source).toContain("driverName: machineForm.driverName.trim() || null");
    expect(source).toContain("driverPhone: machineForm.driverPhone.trim() || null");
    expect(source).toContain("saveMachine.mutate");
    expect(source).toContain("saveMachineCost.mutate");
  });

  it("单车收益支出分析使用宽屏分区弹窗，完整承载统计卡和月度、按日明细", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('w-[calc(100vw-2rem)] max-w-[1320px]');
    expect(source).toContain('md:col-span-3 xl:col-span-4');
    expect(source).toContain('field.label === "按月汇总" || field.label === "按日明细"');
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto px-6 py-5');
    expect(source).not.toContain('max-w-[min(96vw,1320px)]');
  });

  it("车辆射频卡绑定窗口展示完整车辆信息，并可在窗口内直接读取卡 ID", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('Field label="车牌号（车辆表单预填）"');
    expect(source).toContain('Field label="驾驶员姓名（车辆表单预填）"');
    expect(source).toContain('Field label="驾驶员联系电话（车辆表单预填）"');
    expect(source).toContain('Field label="卡 ID / UID（芯片固定标识）"');
    expect(source).toContain('Field label="签名版本"');
    expect(source).toContain("读取卡 ID");
    expect(source).toContain('"http://127.0.0.1:47601/api/read-uid"');
  });

  it("车辆射频卡解除绑定保留受控业务拒绝原因，不将未闭环运输误报为通用失败", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("function getVehicleRfidCardManagementErrorMessage");
    expect(source).toContain("当前车辆存在未闭环运输趟次，请完成或作废该趟次后再解除绑定");
    expect(source).toContain("该车辆卡当前未绑定车辆，无需重复解除");
    expect(source).toContain("未找到当前项目下的车辆射频卡，请刷新台账后重试");
    expect(source).toContain('getVehicleRfidCardManagementErrorMessage("unbind", error.message)');
    expect(source).toContain('getVehicleRfidCardManagementErrorMessage("revoke", error.message)');
  });

  it("本机读卡桥接失败时提示 Windows 桥接启动和浏览器设备授权，不回显原始异常", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("无法访问本机读卡桥接程序：请确认 Windows 桥接程序已启动，并允许浏览器访问本机设备。");
    expect(source).toContain("浏览器无法访问正式写卡接口：请保持 Windows 桥接程序运行，并允许当前网站访问本机 127.0.0.1 设备后重试。");
    expect(source).toContain("当前 Windows 桥接程序未安装正式车辆卡写入接口：测试写卡可用，但请更新桥接程序后再办理正式车辆卡。");
    expect(source).toContain("本次写卡任务授权已失效或被拒绝：请关闭窗口后重新生成 PC 写卡任务，再立即写入。");
    expect(source).toContain("当前卡片 UID 或回读载荷与写卡任务不一致：请确认仍为刚绑定的车辆卡，不要更换卡片后重试。");
    expect(source).toContain("当前卡片可用 NDEF 容量不足以写入正式车辆卡");
    expect(source).toContain("读取卡片 NDEF 用户区失败");
    expect(source).toContain("卡片写入后逐字节回读不一致");
    expect(source).toContain("回读摘要与本次受控任务不一致");
    expect(source).toContain("服务端确认暂未返回");
    expect(source).toContain("只点击“仅回传确认（不写卡）”，不得再次写入");
    expect(source).toContain("仅回传确认（不写卡）");
    expect(source).toContain("本机 DPAPI 加密短时收据");
    expect(source).toContain('"http://127.0.0.1:47601/api/confirm-vehicle-card"');
    expect(source).toContain('"http://127.0.0.1:47601/api/verify-and-confirm-vehicle-card"');
    expect(source).toContain("只读复核并启用");
    expect(source).toContain('"http://127.0.0.1:47601/api/read-vehicle-entry"');
    expect(source).toContain('"bridge_write_server_claim_failed"');
    expect(source).toContain("服务器未返回本次正式写卡载荷");
    expect(source).toContain("本次写卡授权已过期、已处理，或服务器暂时无法读取任务");
    expect(source).toContain("当前感应卡与所选车辆卡不匹配，或该任务载荷不可用");
    expect(source).toContain("本次 PC 写卡授权未被桥接正确提交");
    expect(source).toContain("本机读取的卡 UID 未能生成有效指纹");
    expect(source).toContain("开始刷车辆卡");
    expect(source).toContain('target.hostname !== "yx.maomaoyx.com"');
    expect(source).toContain('target.pathname !== "/mobile/transport"');
    expect(source).toContain("正式写卡时读卡器连接中断");
    expect(source).toContain("更换电脑后需重新安装/启动桥接程序");
    expect(source).toContain("手机不能连接此 Windows 本机桥接");
    const readBridge = source.slice(source.indexOf("const readRfidBindingUid"), source.indexOf("const prepareRfidCardWrite"));
    const writeBridge = source.slice(source.indexOf("const writeRfidCardWithBridge"), source.indexOf("const confirmRfidCardWrite"));
    expect(readBridge).not.toContain("error instanceof Error ? error.message");
    expect(writeBridge).not.toContain("error instanceof Error ? error.message");
  });

  it("车辆卡绑定窗口必须明确区分车辆表单预填、芯片 UID 与已清空的 NDEF 用户区", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("并非从实体卡读取");
    expect(source).toContain("UID 是芯片出厂标识，不会因恢复初卡而改变");
    expect(source).toContain("NDEF 用户区已经清空");
  });

  it("新车辆卡在实体写入与回读确认前显示待写入，并允许执行首次 PC 写卡而不是提前启用", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('EMPTY_RFID_CARD_FORM: RfidCardForm = { vehicleId: "", writerDeviceId: "", managementCode: "", cardUid: "", driverPhone: "", status: "suspended", reuseRevokedUnboundCard: false }');
    expect(source).toContain("待写入（写入并回读确认后启用）");
    expect(source).toContain("车辆射频卡绑定已保存为待写入；写入并回读确认成功后才会启用");
    expect(source).toContain('card.status === "suspended" && isInitialIssue');
    expect(source).toContain('action: isInitialIssue ? "issue" : "rewrite"');
    expect(source).toContain('isInitialIssue ? "PC 写入车辆卡" : "PC 补写车辆卡"');
    expect(source).toContain('const canRebind = card.status === "revoked" && !card.vehicleId;');
    expect(source).toContain("重新绑定已解绑车辆卡");
    expect(source).toContain("reuseRevokedUnboundCard: true");
    expect(source).toContain("车辆卡管理编号（后台完整显示）");
    expect(source).toContain("管理编号完整显示；芯片 UID 仅显示受控尾号");
    expect(source).toContain('className="min-w-[1120px]"');
  });

  it("车辆卡写卡任务会在管理员确认后替换未完成任务，并明确关闭即作废", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("replacePreparedPcBridgeJob");
    expect(source).toContain("确认结束原任务并生成新的单次写卡任务吗？");
    expect(source).toContain("关闭并作废任务");
    expect(source).toContain("原写卡任务状态已变化，请刷新列表后重新操作。");
  });

  it("持续提供员工保险到期筛选、资源条件筛选、CSV 导出和车辆机械维修保养费用汇总", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("员工档案、薪资与保险");
    expect(source).toContain("30 天内到期");
    expect(source).toContain("employeeInsurance");
    expect(source).toContain("downloadCsvFile");
    expect(source).toContain("车辆维修保养费");
    expect(source).toContain("车辆/机械费用汇总");
    expect(source).toContain("登记维修保养");
    expect(source).toContain("saveAssetMaintenance.mutate");
  });

  it("在权限管理中提供公司管理人员薪资标准的明确入口，并复用受控人员类型筛选", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("公司管理人员薪资标准");
    expect(source).toContain("进入公司人员薪资设置");
    expect(source).toContain('type: "management"');
    expect(source).toContain("不会覆盖已审核或已付款工资");
  });

  it("将所有 CSV 导出统一写入当前筛选范围、导出记录数和生成时间", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("__roadConstructionExportScope");
    expect(source).toContain('["导出模块", scope.module]');
    expect(source).toContain('`筛选条件 · ${label}`');
    expect(source).toContain('["导出记录数", rows.length]');
    expect(source).toContain('["生成时间", formatChinaDateTime(new Date())]');
    expect(source).not.toContain('["生成时间", new Date().toLocaleString("zh-CN", { hour12: false })]');
    expect(source).toContain("车辆资源台账");
    expect(source).toContain("机械综合台账");
    expect(source).toContain("劳务考勤与工资台账");
    expect(source).toContain("柴油管理台账");
    expect(source).toContain("员工档案台账");
    expect(source).toContain("filteredRows.map");
    expect(source).toContain("const machines = allMachines.filter");
    expect(source).toContain("visiblePayrolls.map");
  });

  it("将会计日结打印限定为当前封存快照的独立 A4 文档", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("const printDailyAccountingSnapshot = () => {");
    expect(source).toContain('title: `会计日结装订页-${financeClosingDate}`');
    expect(source).toContain("getBusinessStatusLabel(closure.status)");
    expect(source).toContain('button?.textContent?.trim() !== "打印日结装订页"');
    expect(source).toContain("printDailyAccountingSnapshot();");
    expect(source).toContain("生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}");
    expect(source).toContain("onClick={printDailyAccountingSnapshot}");
    const dailySection = source.slice(source.indexOf("后勤每日开支会计日结与打印"), source.indexOf("后勤每日开支会计日结与打印") + 1800);
    expect(dailySection).not.toContain("window.print()");
  });

  it("将新建员工档案固定放在人员主数据页头，并复用既有员工档案弹窗", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const personnelStart = source.indexOf("人员与授权");
    const filterHeader = source.slice(source.indexOf("人员主数据 · 人事与用工台账"), source.indexOf("employeeProfiles.isLoading"));

    expect(source).toContain("titleActions?: ReactNode");
    expect(personnelStart).toBeGreaterThan(-1);
    expect(source.slice(personnelStart, personnelStart + 900)).toContain("新建员工档案");
    expect(source.slice(personnelStart, personnelStart + 900)).toContain("setEmployeeProfileDialogOpen(true)");
    expect(filterHeader).not.toContain(">新建员工档案</Button>");
  });

  it("在手机宽度将新增台账的动作区与筛选控件分区换行，保留完整文案和足够触控高度", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("min-h-10 w-full bg-[#203c48] text-white hover:bg-[#17313b] sm:w-auto");
    expect(source).toContain("grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4");
    expect(source).toContain("min-h-11 w-full text-sm sm:min-h-8 sm:w-auto");
    expect(source).toContain("grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_180px_auto]");
    expect(source).toContain("min-h-11 w-full self-end text-sm xl:w-auto");
  });

  it("在手机宽度将超级后台业务菜单保留为完整可横向滚动的标签条，禁止压缩成裁切单字", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('aria-label="超级管理后台业务菜单"');
    expect(source).toContain("justify-start gap-1 overflow-x-auto");
    expect(source).toContain("h-10 shrink-0 whitespace-nowrap px-3 text-xs");
    expect(source).toContain(">微信登录</TabsTrigger>");
    expect(source).toContain(">业务治理</TabsTrigger>");
  });

  it("将高频业务台账统一提供响应式表格式总览，保留详情入口和既有状态操作", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const payrollSource = readFileSync(new URL("../components/PayrollStatementLedger.tsx", import.meta.url), "utf8");

    expect(source).toContain("function LedgerTable");
    expect(source).toContain("台账列表 · 可筛选 / 可导出");
    expect(source).toContain("手机端可左右滑动查看完整字段");
    expect(source).toContain("员工档案、薪资与保险");
    expect(source).toContain("车辆统一台账");
    expect(source).toContain("施工日报、现场影像与审核台账");
    expect(source).toContain('lazy(() => import("@/components/PayrollStatementLedger"))');
    expect(source).toContain("<PayrollStatementLedger");
    expect(payrollSource).toContain("工资条详细台账");
    expect(source).toContain("机械资源、维修与会计计价台账");
    expect(source).toContain("<TransportTripLedger");
    expect(source).toContain("发票、成本与审计台账");
    expect(source).toContain("站内通知、投递与确认台账");
  });

  it("将车辆资源改为全宽表格台账，并把新增车辆档案放在台账上方的受控档案区", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("车辆资源 · 全宽台账");
    expect(source).toContain("新增车辆档案");
    expect(source).toContain("vehicleEditorOpen ? <Card");
    expect(source).toContain("车牌 / 类型");
    expect(source).toContain("批量受控删除（{selectedVehicleRows.length}）");
    expect(source).toContain("详情、编辑、删除和状态变更仍由服务端逐条校验项目范围");
    expect(source).toContain('className="flex flex-col gap-6"');
    expect(source).not.toContain('activeSection === "vehicles" ? <LedgerTable');
    expect(source).not.toContain("点击一辆车即可在右侧编辑");
    expect(source).not.toContain("请使用右侧表单录入已授权项目的真实车辆资料");
  });

  it("在车辆档案中提供皮卡车和越野车类型，并在统一台账中保留中文标签", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('value="pickup">皮卡车');
    expect(source).toContain('value="suv">越野车');
    expect(source).toContain('pickup: "皮卡车"');
    expect(source).toContain('suv: "越野车"');
  });

  it("柴油登记默认当前时间、提供防重复录入提醒，并在权限管理中拆出柴油细分权限", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const foundationSource = readFileSync(new URL("../../../server/services/foundationData.ts", import.meta.url), "utf8");

    expect(source).toContain("function DuplicateEntryNotice");
    expect(source).toContain("防重复录入提醒");
    expect(source).toContain("dieselDuplicateCandidates");
    expect(source).toContain("请确认不是重复录入后再继续保存");
    expect(source).toContain("refueledAt: toLocalDateTimeInput(new Date())");
    expect(source).toContain('diesel: "柴油管理"');
    expect(source).toContain("柴油管理已独立拆分为台账查看、领用登记、指导价、预警、扣油结算、作废、导出和打印");
    expect(foundationSource).toContain('["diesel:read", "柴油台账查看", "diesel", "read"]');
    expect(foundationSource).toContain('["diesel:refuel:create", "柴油领用登记", "diesel", "create"]');
    expect(foundationSource).toContain('["diesel:guideline:manage", "柴油指导价维护", "diesel", "manage"]');
    expect(foundationSource).toContain('["diesel:deduction:settle", "运输扣油结算", "diesel", "settle"]');
  });

  it("在车辆主表汇总柴油、收益与净收益，并从运输调度提供受控车辆档案入口", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("加油升数 / 金额");
    expect(source).toContain("本月收益 / 净收益");
    expect(source).toContain("导出详细 CSV");
    expect(source).toContain("单车收益支出分析");
    expect(source).toContain("录入车辆档案");
    expect(source).toContain("单车柴油分析");
    expect(source).toContain("车辆分析期间");
    expect(source).toContain("本期 / 累计总趟数");
    expect(source).toContain("柴油占比 / 每趟油费");
    expect(source).toContain('w-[calc(100vw-2rem)] max-w-[1320px]');
    expect(source).toContain('md:col-span-3 xl:col-span-4');
  });

  it("将机械档案、维修保养、会计月度快照收敛为单条主台账，并提供单机日月收益支出分析", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.machinery.listCostSummaries.useQuery");
    expect(source).toContain("trpc.machinery.listMonthlyStatements.useQuery");
    expect(source).toContain("trpc.machinery.previewMonthlyStatement.useQuery");
    expect(source).toContain("trpc.machinery.getMachineAnalysis.useQuery");
    expect(source).toContain("机械资源 · 综合台账");
    expect(source).toContain("机械资源、维修与会计计价台账");
    expect(source).toContain("本月收益 / 净收益");
    expect(source).toContain("本月支出");
    expect(source).toContain("油耗 / 维修");
    expect(source).toContain("产值计价 / 有效日期");
    expect(source).toContain("单机收益与成本分析");
    expect(source).toContain("日收益");
    expect(source).toContain("仅有费用凭证");
    expect(source).toContain("生成会计明细草稿");
    expect(source).toContain("机械业务详情");
    const machineMetricIndex = source.indexOf('title="机械总数"');
    const machineProjectFilterIndex = source.indexOf('renderWorkspaceProjectFilter("机械项目范围"');
    expect(machineMetricIndex).toBeGreaterThan(-1);
    expect(machineMetricIndex).toBeLessThan(machineProjectFilterIndex);
    expect(source.match(/title="机械总数"/g)).toHaveLength(1);
    expect(source).not.toContain("会计机械明细 · 月度结算快照");
    expect(source).not.toContain('activeSection === "machinery" ? <LedgerTable');
  });

  it("提供独立柴油管理入口，并按每次加油的升数与当天单价自动形成油费快照", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('label: "柴油管理"');
    expect(source).toContain('path: "/admin/diesel"');
    expect(source).toContain('const isDiesel = activeSection === "diesel"');
    expect(source).toContain('activeSection === "finance" || activeSection === "diesel"');
    expect(source).toContain("适用单价");
    expect(source).toContain("柴油管理与加油台账");
    expect(source).toContain("项目部供油（当天指导价）");
    expect(source).toContain("加油站现金加油（当天实际价）");
    expect(source).toContain("当天现金单价（元/升）");
    expect(source).toContain("现金油费预览");
  });

  it("将加油表工程水印、组合筛选、油价异常预警和供应商采购对账纳入柴油审计闭环", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("sourceType: \"diesel_receipt\"");
    expect(source).toContain("加油表现场照片（必拍）");
    expect(source).toContain("打开后置相机拍摄加油表");
    expect(source).toContain("facingMode: { ideal: \"environment\" }");
    expect(source).not.toContain('accept="image/jpeg,image/png" onChange={event => setDieselReceiptFile');
    expect(source).toContain("维护指导价");
    expect(source).toContain("无需选择某一趟");
    expect(source).toContain("自动写入项目、加油时间、详细地点、操作人与防伪编号");
    expect(source).toContain("captureWatermarkLocation");
    expect(source).toContain("createWatermarkedImage");
    expect(source).toContain("柴油组合筛选");
    expect(source).toContain("柴油筛选车牌");
    expect(source).toContain("柴油加油开始日期");
    expect(source).toContain("柴油加油结束日期");
    expect(source).toContain("柴油加油月份");
    expect(source).toContain("柴油筛选供应商");
    expect(source).toContain("导出当前筛选明细");
    expect(source).toContain("dieselRefuelRecordsInput");
    expect(source).toContain("查看受控小票影像");
    expect(source).toContain("现金油价异常预警");
    expect(source).toContain("trpc.admin.diesel.getPriceAlertRule.useQuery");
    expect(source).toContain("供应商柴油采购对账");
    expect(source).toContain("trpc.admin.diesel.supplierReconciliation.useQuery");
    expect(source).toContain("柴油供应商对账-");
  });

  it("将柴油指导价项目选择独占整行，避免与指导单价在窄屏弹窗重叠", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('data-testid="diesel-guideline-project-field"');
    expect(source).toContain('className="w-full min-w-0"');
    expect(source).toContain('grid grid-cols-1 gap-3 sm:grid-cols-2');
  });

  it("在 PC 施工日报台账中显示关联照片数量并提供受控预览入口", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.construction.reportEvidence.useQuery");
    expect(source).toContain("constructionEvidenceByReport");
    expect(source).toContain("照片 {constructionEvidenceByReport");
    expect(source).toContain("施工日报、现场影像与审核台账");
    expect(source).toContain("施工日报关联影像");
  });

  it("移除各业务页顶部重复台账，仅保留工作区中的统一主表格和行内详情流程", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('activeSection === "labor" ? <LedgerTable');
    expect(source).not.toContain('activeSection === "transport" ? <LedgerTable');
    expect(source).not.toContain('activeSection === "finance" ? <LedgerTable');
    expect(source).not.toContain('activeSection === "broadcast" ? <LedgerTable');
    expect(source).not.toContain('activeSection === "permission" ? <LedgerTable');
    expect(source).toContain("投递明细与确认状态");
    expect(source).toContain("机械业务详情");
    expect(source).toContain("施工日报查看与编辑");
  });

  it("仅保留统计卡下方的一套施工日报工作区，避免同一日报在页面顶部和底部重复展示", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('activeSection === "construction" ? <LedgerTable');
    expect(source).toContain("施工日报、现场影像与审核台账");
    expect(source).toContain("每份日报行内汇总作业面、天气、累计进度、影像数量、安全问题和审核状态");
    expect((source.match(/施工日报、现场影像与审核台账/g) ?? []).length).toBe(1);
  });

  it("对可维护主数据提供行内编辑与受控批量处理，同时不将历史业务单据误作物理删除", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("onEdit?: () => void");
    expect(source).toContain("onRemove?: () => void");
    expect(source).toContain("批量受控删除");
    expect(source).toContain("batchRemoveVehicles");
    expect(source).toContain("车辆批量受控删除结果");
    expect(source).toContain("batchSuspendEmployees");
    expect(source).toContain("员工批量停用结果");
    expect(source).toContain("batchRetireMachines");
    expect(source).toContain("机械批量退役结果");
    expect(source).toContain("工资、考勤、保险和授权历史均被保留");
    expect(source).toContain("机械记录及其成本、租赁、维修历史均被保留");
    expect(source).toContain("isEditableConstructionReport");
  });

  it("将服务号全部五项参数集中为一次保存并校验的单一表单，不再以分项预设按钮引导配置", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("saveOfficialAccountConfiguration");
    expect(source).toContain("保存并校验服务号配置");
    expect(source).toContain("微信 API 固定出口网关地址");
    expect(source).toContain("固定出口网关签名密钥");
    expect(source).toContain("域名与消息推送配置");
    expect(source).toContain("getOfficialAccountMessagePushConfiguration");
    expect(source).toContain("saveOfficialAccountMessagePushConfiguration");
    expect(source).toContain("testOfficialAccountMessagePushConfiguration");
    expect(source).toContain("微信后台 URL");
    expect(source).toContain("EncodingAESKey");
    expect(source).toContain("保存三项参数");
    expect(source).toContain("明文模式");
    expect(source).toContain("XML");
    expect(source).toContain("校验回调 200");
    expect(source).toContain("其它系统参数");
    expect(source).not.toContain("OFFICIAL_ACCOUNT_SETTING_PRESETS");
  });

  it("在系统设置提供外部 AI API 的受控配置、连接校验与摘要降级说明", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("AI 模型 API 接入");
    expect(source).toContain("AI API 基础地址");
    expect(source).toContain("AI API Key");
    expect(source).toContain("启用外部 AI 摘要");
    expect(source).toContain("保存 AI API 配置");
    expect(source).toContain("校验 API 连接");
    expect(source).toContain("trpc.admin.settings.getExternalAiConfiguration.useQuery");
    expect(source).toContain("trpc.admin.settings.saveExternalAiConfiguration.useMutation");
    expect(source).toContain("trpc.admin.settings.testExternalAiConfiguration.useMutation");
    expect(source).toContain("外部 AI 辅助摘要");
    expect(source).toContain("系统内置 AI 辅助摘要");
  });

  it("允许私有模板按业务模块绑定并自动映射字段，不再要求用户手填内部占位符", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("bindOfficialAccountModuleTemplate");
    expect(source).toContain("绑定并自动映射");
    expect(source).toContain("运输刷卡与趟次");
    expect(source).toContain("机械/车辆维保审核");
    expect(source).toContain("待绑定对应模板");
    expect(source).toContain("系统按模板 `.DATA` 字段自动映射");
  });

  it("提供角色级详细操作权限矩阵，支持按模块设置动作并批量全选或清空", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("角色详细操作权限");
    expect(source).toContain("查看、新增、编辑、提交、审核、结算、作废、导出或打印");
    expect(source).toContain("permissionActionLabels");
    expect(source).toContain("全选本模块");
    expect(source).toContain("清空</Button>");
    expect(source).toContain("角色一旦配置某业务域的详细权限");
  });

  it("将权限管理清晰解释为菜单、页面、操作三级，并保留项目范围的服务端共同边界", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("第一级 · 菜单");
    expect(source).toContain("第二级 · 页面");
    expect(source).toContain("第三级 · 操作");
    expect(source).toContain("用户专属权限仅覆盖本模块操作，不扩大项目范围");
    expect(source).toContain("跨项目查询会被服务端拒绝");
  });

  it("在每位普通管理人员卡片中提供用户专属操作权限入口，并用独立对话框保存到具体用户", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain(">操作权限</Button>");
    expect(source).toContain("分配用户专属操作权限");
    expect(source).toContain("正在为“{userPermissionTarget?.name}”设置具体业务动作");
    expect(source).toContain("setUserPermissions.mutate");
    expect(source).toContain("保存该用户权限");
    expect(source).toContain("留空则沿用角色权限");
  });

  it("提供可解释的 AI 项目风险扫描、处置与财务分类分析，并要求维护设备核定油箱容量", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('label: "智能风控", path: "/admin/risk"');
    expect(source).toContain('const isRisk = activeSection === "risk"');
    expect(source).toContain("AI 项目风险预警中心");
    expect(source).toContain("立即扫描并提醒");
    expect(source).toContain("风险预警台账与管理提醒");
    expect(source).toContain("生成 AI 管理摘要");
    expect(source).toContain("按成本类别分析汇总");
    expect(source).toContain("生活开支、柴油、月度/临时工资、机械、车辆运输、采购及其他开支");
    expect(source).toContain("核定油箱容量（L）");
    expect(source).toContain("trpc.projectRisk.financeCategoryAnalysis.useQuery");
  });

  it("在治理概览提供施工项目经营 KPI 作业指引，并明确真实数据来源、管理频率、责任角色与工作区入口", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("施工项目经营 KPI 作业指引");
    expect(source).toContain("施工日报有效率");
    expect(source).toContain("资源成本归集");
    expect(source).toContain("采购实耗闭环");
    expect(source).toContain("计量与分包对账");
    expect(source).toContain("财务确认与资金计划");
    expect(source).toContain("服务号通知送达率");
    expect(source).toContain("业务暂估、未审核成本或未确认收入必须与财务确认口径分开查看");
  });

  it("在财务管理显示小类目成本占比，并支持导出当前项目和期间的真实汇总", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("小类目成本占比与导出");
    expect(source).toContain("生活开支占项目开支");
    expect(source).toContain("工资劳务占项目开支");
    expect(source).toContain("导出小类目汇总");
    expect(source).toContain("riskFinanceAnalysis.data?.subcategories");
    expect(source).toContain("采购订单应付与实际现金结算继续分开处理");
  });

  it("在财务工作区提供封存日期锁定、授权反结账原因与版本快照显示", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("日结封存、授权反结账与版本快照");
    expect(source).toContain("trpc.finance.reopenDailyAccount.useMutation");
    expect(source).toContain("financeReopenReason");
    expect(source).toContain("授权反结账");
    expect(source).toContain("旧快照与反结账原因永久保留");
    expect(source).toContain("第 {dailyAccountingReport.data.closure.revision ?? 1} 版");
  });

  it("提供项目容量完备度、整改责任人期限和逾期升级验收闭环", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("设备容量、整改期限与逾期升级");
    expect(source).toContain("车辆容量已配置");
    expect(source).toContain("机械容量已配置");
    expect(source).toContain("启用每日整改逾期升级");
    expect(source).toContain("检查时间（中国标准时间）");
    expect(source).toContain("执行逾期升级验收");
    expect(source).toContain("整改派单");
    expect(source).toContain("整改责任人");
    expect(source).toContain("整改期限");
    expect(source).toContain("trpc.projectRisk.capacityReadiness.useQuery");
    expect(source).toContain("trpc.projectRisk.listAssignees.useQuery");
    expect(source).toContain("trpc.projectRisk.assignRectification.useMutation");
    expect(source).toContain("trpc.projectRisk.runOverdueEscalation.useMutation");
  });

  it("将历史整改期限回填为设备本地 datetime-local 值，并在保存时继续提交 UTC 时间戳", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('toDeviceDateTimeInput(`${next.dueAt}:00Z`)');
    expect(source).toContain('dueAt: new Date(riskRectificationTarget.dueAt).toISOString()');
    expect(source).toContain('dueAt: item.dueAt ? new Date(item.dueAt).toISOString().slice(0, 16) : ""');
    expect(source).toContain('return next?.dueAt ? { ...next, dueAt: toDeviceDateTimeInput(`${next.dueAt}:00Z`) } : next;');
  });
});


describe("后台服务号绑定状态映射", () => {
  it("使用官方账号绑定状态而不是员工档案状态显示绑定结果", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("officialAccountBindingStatus");
    expect(source).toContain("user.officialAccountBindingStatus === \"active\" ? \"已绑定\"");
    expect(source).not.toContain("user.profileStatus === \"active\" ? \"已完成关注绑定\"");
  });
});

describe("后台全员上下班考勤定位展示", () => {
  it("分别展示上班和下班中文地址并纳入 CSV 导出，默认不再呈现原始坐标", () => {
    const source = readFileSync(new URL("../components/LaborCheckInLedger.tsx", import.meta.url), "utf8");
    const adminSource = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(adminSource).toContain('lazy(() => import("@/components/LaborCheckInLedger"))');
    expect(adminSource).toContain("<LaborCheckInLedger");
    expect(source).toContain("上班打卡位置");
    expect(source).toContain("下班打卡位置");
    expect(source).toContain("上班位置");
    expect(source).toContain("下班位置");
    expect(source).toContain("item.checkInAddress");
    expect(source).toContain("item.checkoutAddress");
    expect(source).toContain("中文地址");
    expect(source).not.toContain("formatAttendanceLocation(item.checkoutLongitude");
  });

  it("后台上下班打卡台账默认使用中国业务日期，与服务端打卡日期裁切保持一致", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('timeZone: "Asia/Shanghai"');
    expect(source).toContain("function toChinaBusinessDateInput");
    expect(source).toContain("initialAttendanceDate={toChinaBusinessDateInput()}");
    expect(source).toContain("fallbackBusinessDate={toChinaBusinessDateInput()}");
  });
});

describe("后台导出性能", () => {
  it("仅在生成Excel时按需加载维护中的 XLSX 包，不将其作为首屏静态依赖", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain('const XLSX = await import("@e965/xlsx")');
    expect(source).not.toContain('import * as XLSX from "@e965/xlsx"');
  });
});

describe("后台劳务台账独立懒加载", () => {
  it("将上下班打卡、人员档案和考勤记录交给独立组件，父页面继续保留受控详情和导出回调", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('lazy(() => import("@/components/LaborCheckInLedger"))');
    expect(source).toContain('lazy(() => import("@/components/LaborWorkerRoster"))');
    expect(source).toContain('lazy(() => import("@/components/LaborAttendanceLedger"))');
    expect(source).toContain("<LaborCheckInLedger");
    expect(source).toContain("<LaborWorkerRoster");
    expect(source).toContain("<LaborAttendanceLedger");
    expect(source).toContain('module: "劳务考勤高级筛选导出"');
    expect(source).toContain("setDesktopRecordDetail");
  });
});


describe("采购订单详情与附件收敛", () => {
  it("移除独立缩略图影像板块，并仅在订单详情中提供受控文件入口", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("订单单据与发票影像");
    expect(source).toContain("查看/下载文件：{item.documentAttachment.fileName}");
    expect(source).toContain("查看/下载文件：{item.invoiceAttachment.fileName}");
    expect(source).not.toContain("alt={`采购单据 ${item.orderNo}`}");
    expect(source).toContain("pending_approval: \"待审核\"");
    expect(source).toContain("closed: \"已结算\"");
  });
});

describe("采购费用票据报销详单打印", () => {
  it("使用正式报销单表格、顶部居中标题、人员字段、备注和较小票据图片", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("采购费用票据报销详单");
    expect(source).toContain("提交上传管理员");
    expect(source).toContain("现场管理员");
    expect(source).toContain("报销人");
    expect(source).toContain("备注");
    expect(source).toContain("receipt-title");
    expect(source).toContain("height:62mm");
    expect(source).toContain("expense-table");
    expect(source).toContain("报销凭证图片");
    expect(source).toContain("原始票据");
    expect(source).toContain("voucher-panel");
    expect(source).toContain("height:62mm");
  });
});

describe("运输台账展示收敛", () => {
  it("运输页面仅保留完整全台账作为运单筛选、导出与操作入口", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("车辆趟次、异常与结算台账");
    expect(source).toContain("<TransportTripLedger");
    expect(source).toContain("transport-trip-ledger-upgrade");
    expect(source).toContain("简版车辆趟次卡已移除");
  });
});


  it("劳务工资将筛选与查询下沉到仅在劳务菜单挂载的懒加载容器", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const loader = readFileSync(new URL("../components/LaborWorkspaceLoader.tsx", import.meta.url), "utf8");
    expect(source).toContain("const LaborWorkspaceLoader = lazy");
    expect(source).toContain("const renderLabor = () => <LaborWorkspaceLoader");
    expect(source).not.toContain("useLaborWorkspaceQueries({ enabled: canQuery && isLabor");
    expect(loader).toContain("useLaborWorkspaceFilters(initialAttendanceDate)");
    expect(loader).toContain("useLaborWorkspaceQueries({ enabled");
  });
