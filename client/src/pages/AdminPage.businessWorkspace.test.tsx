import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_BUSINESS_ROUTE_BY_MODULE, getBusinessWorkspaceProjectState } from "./AdminPage";

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

  it("禁止 PC 台账的查看、编辑和维护操作直接跳转到移动端", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/setLocation\(["'`]\/mobile/);
    expect(source).toContain("施工日报查看与编辑");
    expect(source).toContain("劳务人员档案");
    expect(source).toContain("运输趟次明细");
  });

  it("在 PC 超级管理后台承载员工、车辆与机械的关键维护闭环", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("普通管理人员账号");
    expect(source).toContain("管理人员角色授权");
    expect(source).toContain("车辆统一台账");
    expect(source).toContain("RFID 写卡");
    expect(source).toContain("机械资源、维修与租赁台账");
    expect(source).toContain("新建机械档案");
    expect(source).toContain("机械业务详情");
    expect(source).toContain("录入成本");
    expect(source).toContain("外租合同与租金");
    expect(source).toContain("外租车辆");
    expect(source).toContain("起租日期");
    expect(source).toContain("截止日期");
    expect(source).toContain("saveMachine.mutate");
    expect(source).toContain("saveMachineCost.mutate");
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

    expect(source).toContain("function LedgerTable");
    expect(source).toContain("台账列表 · 可筛选 / 可导出");
    expect(source).toContain("手机端可左右滑动查看完整字段");
    expect(source).toContain("员工档案、薪资与保险");
    expect(source).toContain("车辆统一台账");
    expect(source).toContain("施工日报、现场影像与审核台账");
    expect(source).toContain("工资条详细台账");
    expect(source).toContain("机械资源、维修与租赁台账");
    expect(source).toContain("车辆趟次、异常与结算台账");
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

  it("将机械档案、维修保养、成本与外租规则合并为全宽综合台账，并提供单机详情", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.machinery.listCostSummaries.useQuery");
    expect(source).toContain("机械资源 · 综合台账");
    expect(source).toContain("机械资源、维修与租赁台账");
    expect(source).toContain("维修成本");
    expect(source).toContain("租金 / 租赁日期");
    expect(source).toContain("机械业务详情");
    expect(source).not.toContain('activeSection === "machinery" ? <LedgerTable');
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
    expect(source).toContain("其它系统参数");
    expect(source).not.toContain("OFFICIAL_ACCOUNT_SETTING_PRESETS");
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

  it("在每位普通管理人员卡片中提供用户专属操作权限入口，并用独立对话框保存到具体用户", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain(">操作权限</Button>");
    expect(source).toContain("分配用户专属操作权限");
    expect(source).toContain("正在为“{userPermissionTarget?.name}”设置具体业务动作");
    expect(source).toContain("setUserPermissions.mutate");
    expect(source).toContain("保存该用户权限");
    expect(source).toContain("留空则沿用角色权限");
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
  it("分别展示上班和下班的精确定位，并将两段坐标纳入 CSV 导出", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("function formatAttendanceLocation");
    expect(source).toContain("上班打卡位置");
    expect(source).toContain("下班打卡位置");
    expect(source).toContain("上班位置");
    expect(source).toContain("下班位置");
    expect(source).toContain("item.checkoutLongitude");
    expect(source).toContain("item.checkoutLocationAccuracyMeters");
  });
});
