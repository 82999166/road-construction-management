import { describe, expect, it, vi } from "vitest";
import {
  buildVehicleReport,
  confirmVehicleDiscard,
  dateTimeEpoch,
  filterVehicleRows,
  INITIAL_VEHICLE_FILTER,
  optionalNumber,
  requiredNumber,
  requireVehicleChoice,
  VEHICLE_DETAIL_TABS,
  VEHICLE_MANAGEMENT_TABS,
  vehicleDateReminder,
  vehicleLabel,
  vehicleMileageReminder,
  vehicleMoney,
  type FilterableVehicle,
  type VehicleFilter,
} from "./vehicleManagementWorkspace";

const profile = {
  purpose: "general",
  propertyType: "company_owned",
  technicalStatus: "normal",
  dispatchStatus: "standby",
  projectStatus: "on_site",
};
const rows: FilterableVehicle[] = [
  {
    id: 1,
    projectId: 2,
    plateNo: "湘A10001",
    ownerName: "出租甲",
    driverName: "司机张",
    vehicleType: "pickup",
    status: "active",
    profile,
  },
  {
    id: 2,
    projectId: 3,
    plateNo: "湘A10002",
    ownerName: "出租乙",
    driverName: "司机李",
    vehicleType: "suv",
    status: "suspended",
    profile: {
      ...profile,
      propertyType: "rented",
      technicalStatus: "repair",
      dispatchStatus: "paused",
      projectStatus: "exited",
    },
  },
  {
    id: 3,
    projectId: 2,
    plateNo: "湘B10003",
    vehicleType: "other",
    status: "disabled",
    profile: {
      ...profile,
      purpose: "trailer",
      propertyType: "partner",
      technicalStatus: "safety_hold",
      dispatchStatus: "working",
      projectStatus: "pending",
    },
  },
  {
    id: 4,
    projectId: 2,
    plateNo: "湘B10004",
    vehicleType: "dump_truck",
    status: "active",
    profile: null,
  },
];
const filteredIds = (patch: Partial<VehicleFilter>) =>
  filterVehicleRows(rows, { ...INITIAL_VEHICLE_FILTER, ...patch }).map(
    row => row.id
  );

describe("车辆工作区筛选与真实输出 helper", () => {
  it("六工作区与八详情栏目保持独立、完整且键值不重复", () => {
    expect(VEHICLE_MANAGEMENT_TABS.map(tab => tab.value)).toEqual([
      "overview",
      "registry",
      "assignments",
      "maintenance",
      "compliance",
      "finance",
    ]);
    expect(VEHICLE_DETAIL_TABS.map(tab => tab.value)).toEqual([
      "base",
      "assignments",
      "operations",
      "costs",
      "maintenance",
      "documents",
      "settlements",
      "history",
    ]);
    expect(new Set(VEHICLE_DETAIL_TABS.map(tab => tab.value)).size).toBe(8);
  });
  it("默认不隐藏历史档案，筛选不改写输入记录或初始状态", () => {
    const original = JSON.stringify(rows);
    expect(filteredIds({})).toEqual([1, 2, 3, 4]);
    expect(filteredIds({ projectId: "2" })).toEqual([1, 3, 4]);
    expect(JSON.stringify(rows)).toBe(original);
    expect(INITIAL_VEHICLE_FILTER).toEqual({
      projectId: "all",
      search: "",
      type: "all",
      status: "all",
      property: "all",
      technical: "all",
      dispatch: "all",
      projectStatus: "all",
    });
  });
  it.each([
    [{ search: "  湘a10001  " }, [1]],
    [{ search: "出租乙" }, [2]],
    [{ search: "司机张" }, [1]],
    [{ type: "pickup" }, [1]],
    [{ type: "suv" }, [2]],
    [{ type: "trailer" }, [3]],
    [{ status: "active" }, [1, 4]],
    [{ status: "disabled" }, [3]],
    [{ property: "rented" }, [2]],
    [{ technical: "safety_hold" }, [3]],
    [{ dispatch: "paused" }, [2]],
    [{ projectStatus: "exited" }, [2]],
    [{ property: "unconfigured" }, [4]],
    [
      {
        technical: "unconfigured",
        dispatch: "unconfigured",
        projectStatus: "unconfigured",
      },
      [4],
    ],
  ] satisfies Array<[Partial<VehicleFilter>, number[]]>)(
    "按%s筛选仅返回相符记录",
    (patch, ids) => {
      expect(filteredIds(patch)).toEqual(ids);
    }
  );
  it("全部八项筛选同时按交集生效，不因某项匹配就泄漏其他项目", () => {
    const filters: VehicleFilter = {
      projectId: "3",
      search: "出租乙",
      type: "suv",
      status: "suspended",
      property: "rented",
      technical: "repair",
      dispatch: "paused",
      projectStatus: "exited",
    };
    expect(filterVehicleRows(rows, filters).map(row => row.id)).toEqual([2]);
    const mismatches: VehicleFilter = {
      projectId: "2",
      search: "不存在",
      type: "pickup",
      status: "active",
      property: "partner",
      technical: "normal",
      dispatch: "working",
      projectStatus: "pending",
    };
    for (const key of Object.keys(filters) as Array<keyof VehicleFilter>)
      expect(
        filterVehicleRows(rows, { ...filters, [key]: mismatches[key] })
      ).toEqual([]);
  });
  it("挂车依据独立用途而非旧车型枚举识别，并使用中文标签", () => {
    expect(filteredIds({ type: "trailer" })).toEqual([3]);
    expect(vehicleLabel("pickup")).toBe("皮卡");
    expect(vehicleLabel("suv")).toBe("越野车");
    expect(vehicleLabel("trailer")).toBe("挂车");
    expect(vehicleLabel("unexpected_internal_enum")).toBe("其他状态（请核实）");
    expect(vehicleLabel(null)).toBe("未配置");
  });
  it("报告包含全量结果、范围与真实金额，安全转义而不混入对象上的附件密钥", () => {
    const report = {
      title: '<script>alert("标题")</script>',
      scope: "项目2 & 仅启用",
      headers: ["车牌", "费用"],
      rows: Array.from({ length: 55 }, (_, i) => [
        `车${i}<img onerror='x'>`,
        i === 0 ? 0 : i + 0.25,
      ]),
      summary: "已覆盖成本 < 非公司净利润",
      fileKey: "PRIVATE-STORAGE-KEY",
      url: "https://private.example/preview",
    };
    const html = buildVehicleReport(report);
    expect(
      html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g)
    ).toHaveLength(55);
    expect(html).toContain("全部筛选结果 55 条");
    expect(html).toContain("车54&lt;img");
    expect(html).toContain("54.25");
    expect(html).toContain("<td>0</td>");
    expect(html).toContain("项目2 &amp; 仅启用");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("PRIVATE-STORAGE-KEY");
    expect(html).not.toContain("https://private.example/preview");
    expect(html).toContain("已覆盖成本 &lt; 非公司净利润");
  });
  it("空筛选仍输出完整表头和空状态，不伪造零金额记录", () => {
    const html = buildVehicleReport({
      title: "车辆费用",
      scope: "项目2",
      headers: ["车牌", "费用"],
      rows: [],
    });
    expect(html).toContain("全部筛选结果 0 条");
    expect(html).toContain('colspan="2"');
    expect(html).toContain("暂无符合当前筛选条件的记录");
    expect(html).not.toContain("<td>0</td>");
    expect(html).toContain("不等同监管平台联单或完整利润报表");
  });
  it("金额区分真实零值与缺失，统一保留两位小数", () => {
    expect(vehicleMoney(0)).toBe("0.00");
    expect(vehicleMoney("1234.5")).toBe("1,234.50");
    expect(vehicleMoney(-2.5)).toBe("-2.50");
    expect(vehicleMoney(null)).toBe("未提供");
    expect(vehicleMoney(undefined)).toBe("未提供");
  });
});

describe("车辆表单校验与草稿丢弃保护 helper", () => {
  it("数字字段不能将空白、负值和无穷等异常值伪装成已登记数值", () => {
    expect(optionalNumber(" ")).toBeNull();
    expect(optionalNumber("0")).toBe(0);
    expect(optionalNumber(" 2.5 ")).toBe(2.5);
    for (const input of ["-1", "NaN", "Infinity", "非法"])
      expect(() => optionalNumber(input)).toThrow("数字必须为非负有效数值");
    expect(() => requiredNumber("", "项目")).toThrow("请填写项目");
    expect(requiredNumber("2", "项目")).toBe(2);
  });
  it("枚举只能取合法车型与结算方式，不静默接受未知内部值", () => {
    expect(
      requireVehicleChoice(
        "trip",
        ["trip", "ton", "volume"] as const,
        "结算方式"
      )
    ).toBe("trip");
    expect(() =>
      requireVehicleChoice(
        "monthly",
        ["trip", "ton", "volume"] as const,
        "结算方式"
      )
    ).toThrow("请选择有效结算方式");
    expect(() =>
      requireVehicleChoice("", ["pickup", "suv"] as const, "车型")
    ).toThrow("请选择有效车型");
  });
  it("发生时间提交UTC时间戳，非法日期拒绝而不伪造当前日期", () => {
    expect(dateTimeEpoch("2026-08-02T08:00:00+08:00")).toBe(
      Date.parse("2026-08-02T00:00:00Z")
    );
    expect(() => dateTimeEpoch("not-a-date")).toThrow("请填写有效发生时间");
  });
  it("拒绝放弃保留草稿，只有确认后才清理，干净状态直接关闭且不是保存", () => {
    const discard = vi.fn(),
      confirm = vi.fn(() => false);
    expect(confirmVehicleDiscard(true, discard, confirm)).toBe(false);
    expect(discard).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("此操作不是保存")
    );
    confirm.mockReturnValue(true);
    expect(confirmVehicleDiscard(true, discard, confirm)).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
    confirm.mockClear();
    expect(confirmVehicleDiscard(false, discard, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledTimes(2);
  });
  it("证照到期和保养里程分别核验，不把缺失里程当作已达标", () => {
    expect(vehicleDateReminder(null, "2026-08-02")).toBe("日期未配置");
    expect(vehicleDateReminder("2026-08-01", "2026-08-02")).toBe("已到期");
    expect(vehicleDateReminder("2026-08-02", "2026-08-02")).toBe("距到期0天");
    expect(vehicleDateReminder("2026-09-01", "2026-08-02")).toBe("距到期30天");
    expect(vehicleDateReminder("2026-09-02", "2026-08-02")).toBe(
      "未到日期条件"
    );
    expect(vehicleMileageReminder(null, 100)).toBe("里程条件未配置");
    expect(vehicleMileageReminder(100, null)).toBe("当前里程未知");
    expect(vehicleMileageReminder(100, "NaN")).toBe("当前里程未知");
    expect(vehicleMileageReminder(100, 100)).toBe("已到里程条件");
    expect(vehicleMileageReminder(100, 80)).toBe("剩余20公里");
  });
});
