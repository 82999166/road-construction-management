import React, { useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VehicleSettlementSelection, {
  type VehicleSettlementSelectionProps,
} from "./VehicleSettlementSelection";
import {
  addInclusiveSettlementDays,
  inclusiveSettlementDayCount,
  settlementPositiveInteger,
  type VehicleSettlementPreview,
} from "../lib/vehicleSettlementSelection";

const output = vi.hoisted(() => ({ print: vi.fn(), csv: vi.fn() }));
vi.mock("@/lib/a4Print", async importOriginal => ({
  ...(await importOriginal<typeof import("../lib/a4Print")>()),
  openA4PrintDocument: output.print,
  downloadCurrentFilteredCsv: output.csv,
}));

let view: TestRenderer.ReactTestRenderer | undefined;
let props: VehicleSettlementSelectionProps;
const preview = (count = 1): VehicleSettlementPreview => ({
  tripIds: Array.from({ length: count }, (_, index) => index + 1),
  rows: Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    tripNo: `TRIP-${String(index + 1).padStart(3, "0")}`,
    startAt: "2024-02-29T16:01:00Z",
    quantity: "10",
    unitPrice: "20",
    grossAmount: 200,
  })),
  availableCount: count,
  selectedCount: count,
  grossFreightAmount: count * 200,
  eligible: count > 0,
  reason: count ? null : "本期间没有符合条件的运单",
  dailyGroups: count
    ? [
        {
          date: "2024-03-01",
          tripCount: count,
          grossFreightAmount: count * 200,
        },
      ]
    : [],
  selectionMode: "day",
});
const text = () => JSON.stringify(view!.toJSON());
const input = (label: string) =>
  view!.root
    .findAllByType("input")
    .find(item => item.props["aria-label"] === label)!;
const button = (label: string) =>
  view!.root
    .findAllByType("button")
    .find(item => item.props.children === label)!;
async function mount(overrides: Partial<VehicleSettlementSelectionProps> = {}) {
  props = { ...props, ...overrides };
  await act(async () => {
    view = TestRenderer.create(<VehicleSettlementSelection {...props} />);
  });
}
async function update(overrides: Partial<VehicleSettlementSelectionProps>) {
  props = { ...props, ...overrides };
  await act(async () => {
    view!.update(<VehicleSettlementSelection {...props} />);
  });
}
async function change(label: string, value: string) {
  await act(async () => {
    input(label).props.onChange({ target: { value } });
  });
}
async function click(label: string) {
  await act(async () => {
    button(label).props.onClick();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  props = {
    mode: "day",
    tripCount: "1",
    periodStart: "2024-02-29",
    periodEnd: "2024-02-29",
    onModeChange: vi.fn(),
    onTripCountChange: vi.fn(),
    onPeriodChange: vi.fn(),
    preview: preview(),
    loading: false,
    onRefresh: vi.fn(),
    plateNo: "粤A12345",
  };
});
afterEach(async () => {
  if (view)
    await act(async () => {
      view!.unmount();
    });
  view = undefined;
  vi.unstubAllGlobals();
});

describe("VehicleSettlementSelection 真实组件行为", () => {
  it("day 默认只显示一个日期，变化同时提交同日，不在模式变化中偷偷修改日期", async () => {
    await mount();
    expect(input("按天结算（默认）").props.checked).toBe(true);
    expect(
      view!.root
        .findAllByType("input")
        .filter(item => item.props.type === "date")
    ).toHaveLength(1);
    await change("结算日期", "2024-03-01");
    expect(props.onPeriodChange).toHaveBeenCalledWith(
      "2024-03-01",
      "2024-03-01"
    );
    vi.mocked(props.onPeriodChange).mockClear();
    await act(async () => {
      input("日期范围").props.onChange();
    });
    expect(props.onModeChange).toHaveBeenCalledWith("period");
    expect(props.onPeriodChange).not.toHaveBeenCalled();
    await update({ mode: "period" });
    expect(input("结算结束日期")).toBeTruthy();
    expect(text()).toContain("结束日期由父页面同步");
    await act(async () => {
      input("指定趟数").props.onChange();
    });
    expect(props.onModeChange).toHaveBeenCalledWith("trip_count");
  });

  it("受控父组件连续7天从2月29到3月6，只有明确应用才更新实际日期", async () => {
    const callback = vi.fn();
    function Harness() {
      const [range, setRange] = useState(["2024-02-29", "2024-02-29"]);
      return (
        <VehicleSettlementSelection
          {...props}
          mode="period"
          periodStart={range[0]}
          periodEnd={range[1]}
          onPeriodChange={(start, end) => {
            callback(start, end);
            setRange([start, end]);
          }}
        />
      );
    }
    await act(async () => {
      view = TestRenderer.create(<Harness />);
    });
    await change("连续结算天数", "7");
    expect(callback).not.toHaveBeenCalled();
    expect(input("结算结束日期").props.value).toBe("2024-02-29");
    expect(text()).toContain("应用后：2024-02-29 至 2024-03-06");
    await click("应用连续天数");
    expect(callback).toHaveBeenCalledWith("2024-02-29", "2024-03-06");
    expect(input("结算结束日期").props.value).toBe("2024-03-06");
    expect(text()).toContain("共 7 天");
  });

  it("手动日期保持原值，连续天数输入非法不会缩短或扩大实际日期", async () => {
    await mount({ mode: "period", periodEnd: "2024-03-06" });
    expect(input("连续结算天数").props.value).toBe("7");
    await change("结算结束日期", "2024-03-10");
    expect(props.onPeriodChange).toHaveBeenCalledWith(
      "2024-02-29",
      "2024-03-10"
    );
    await update({ periodEnd: "2024-03-10" });
    expect(input("连续结算天数").props.value).toBe("11");
    vi.mocked(props.onPeriodChange).mockClear();
    await change("连续结算天数", "3651");
    expect(button("应用连续天数").props.disabled).toBe(true);
    expect(input("结算结束日期").props.value).toBe("2024-03-10");
    expect(props.onPeriodChange).not.toHaveBeenCalled();
  });

  it("N不足只显示服务端原因，不推断已生成或已结算", async () => {
    const data = {
      ...preview(2),
      eligible: false,
      reason: "可结算趟数不足：要求 5 趟，实际 2 趟",
      selectionMode: "trip_count",
    };
    await mount({ mode: "trip_count", tripCount: "5", preview: data });
    expect(text()).toContain(data.reason);
    expect(text()).toContain("本次选取趟数");
    expect(text()).toContain("最早 N 趟");
    expect(text()).toContain("不可随意跳过较早运单");
    expect(text()).not.toContain("已付款");
    expect(text()).not.toContain("余额");
    expect(text()).not.toContain("已生成");
    await update({ preview: { ...data, reason: null } });
    expect(text()).not.toContain("实际 2 趟");
  });

  it.each(["", "0", "-1", "1.5", "1e2", "1001", "NaN", " 2"])(
    "指定趟数 %j 非法，禁用刷新且保留输入原值",
    async value => {
      await mount({ mode: "trip_count", tripCount: value });
      expect(input("指定结算趟数").props["aria-invalid"]).toBe(true);
      expect(input("指定结算趟数").props.value).toBe(value);
      expect(button("刷新预览").props.disabled).toBe(true);
      expect(text()).toContain("1–1000");
    }
  );
  it.each(["1", "1000"])(
    "指定趟数边界 %s 有效，change传原字符串",
    async value => {
      await mount({ mode: "trip_count", tripCount: value });
      expect(input("指定结算趟数").props["aria-invalid"]).toBe(false);
      expect(button("刷新预览").props.disabled).toBe(false);
      await change("指定结算趟数", "10");
      expect(props.onTripCountChange).toHaveBeenCalledWith("10");
    }
  );

  it("51条分页20/50/100与末页，只打印全部51条及所有日汇总", async () => {
    const data = preview(51);
    data.dailyGroups.push({
      date: "2024-03-02",
      tripCount: 0,
      grossFreightAmount: 0,
    });
    await mount({ preview: data });
    const tableRows = () =>
      view!.root
        .findByProps({ "aria-label": "结算预览逐趟明细" })
        .findByType("tbody")
        .findAllByType("tr");
    expect(tableRows()).toHaveLength(20);
    const size = view!.root.findByProps({ "aria-label": "预览趟次每页条数" });
    expect(
      size.findAllByType("option").map(option => option.props.value)
    ).toEqual([20, 50, 100]);
    await act(async () => {
      size.props.onChange({ target: { value: "50" } });
    });
    expect(tableRows()).toHaveLength(50);
    await click("末页");
    expect(tableRows()).toHaveLength(1);
    expect(text()).toContain("TRIP-051");
    expect(text()).not.toContain("TRIP-001");
    await click("打印完整预览");
    const document = output.print.mock.calls[0][0];
    expect(document.orientation).toBe("portrait");
    for (const row of data.rows)
      expect(document.bodyHtml).toContain(row.tripNo);
    for (const group of data.dailyGroups)
      expect(document.bodyHtml).toContain(group.date);
    expect(document.bodyHtml).toContain("完整逐趟明细（51 条）");
    expect(document.bodyHtml).toContain("生成前预览");
    await click("导出完整预览 CSV");
    const csv = output.csv.mock.calls[0][2] as unknown[][];
    expect(csv.filter(row => row[0] === "逐趟明细")).toHaveLength(51);
    expect(csv.filter(row => row[0] === "逐日汇总")).toHaveLength(2);
    await act(async () => {
      size.props.onChange({ target: { value: "100" } });
    });
    expect(tableRows()).toHaveLength(51);
  });

  it("输出仅白名单基础字段，HTML转义且CSV阻止含空白的公式注入", async () => {
    const data = preview();
    data.rows[0].tripNo = '  =HYPERLINK("x")<script>';
    Object.assign(data.rows[0], {
      account: "PRIVATE_ACCOUNT",
      latitude: "PRIVATE_GPS",
      url: "PRIVATE_LINK",
      credential: "PRIVATE_TOKEN",
    });
    await mount({ preview: data, plateNo: "+危险车牌" });
    await click("打印完整预览");
    const html = output.print.mock.calls[0][0].bodyHtml as string;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    for (const secret of [
      "PRIVATE_ACCOUNT",
      "PRIVATE_GPS",
      "PRIVATE_LINK",
      "PRIVATE_TOKEN",
    ])
      expect(html).not.toContain(secret);
    await click("导出完整预览 CSV");
    const rows = output.csv.mock.calls[0][2] as unknown[][];
    expect(rows.find(row => row[0] === "逐趟明细")?.[3]).toBe(
      '\'  =HYPERLINK("x")<script>'
    );
    expect(rows[0][1]).toBe("'+危险车牌");
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_");
  });

  it("empty/未读取/error/loading状态不显示缓存数字、不暗示写入", async () => {
    await mount({ preview: undefined });
    expect(text()).toContain("尚无预览");
    await click("刷新预览");
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onPeriodChange).not.toHaveBeenCalled();
    await update({ preview: preview(0) });
    expect(text()).toContain("暂无可预览的逐趟明细");
    expect(button("打印完整预览").props.disabled).toBe(true);
    await update({ preview: preview(51), error: "测试网络失败" });
    expect(text()).toContain("测试网络失败");
    expect(text()).not.toContain("TRIP-001");
    expect(text()).not.toContain("本次选取趟数");
    await update({ error: undefined, loading: true });
    expect(text()).toContain("正在读取生成前预览");
    expect(button("刷新预览").props.disabled).toBe(true);
    expect(input("结算日期").props.disabled).toBe(true);
    expect(text()).not.toContain("TRIP-001");
  });

  it.each([
    ["", "2024-03-01"],
    ["2024-02-30", "2024-03-01"],
    ["2024-03-02", "2024-03-01"],
  ])("非法日期 %s 至 %s 有提示且禁止刷新", async (start, end) => {
    await mount({ mode: "period", periodStart: start, periodEnd: end });
    expect(text()).toContain("请填写有效的开始和结束日期");
    expect(button("刷新预览").props.disabled).toBe(true);
    expect(text()).not.toContain("NaN");
  });

  it("disabled用于生成期间禁止改变模式/日期/N与刷新打印", async () => {
    await mount({ mode: "trip_count", disabled: true });
    for (const element of view!.root.findAllByType("input"))
      expect(element.props.disabled).toBe(true);
    expect(button("刷新预览").props.disabled).toBe(true);
    expect(button("应用连续天数").props.disabled).toBe(true);
    expect(button("打印完整预览").props.disabled).toBe(true);
  });
});

describe("中国纯日期 inclusive helper", () => {
  it.each([
    ["2024-01-29", "7", "2024-02-04"],
    ["2024-02-28", "3", "2024-03-01"],
    ["2023-02-28", "2", "2023-03-01"],
    ["2000-02-28", "3", "2000-03-01"],
    ["1900-02-28", "2", "1900-03-01"],
    ["2024-12-31", "2", "2025-01-01"],
    ["0001-01-01", "1", "0001-01-01"],
    ["2024-02-29", "1", "2024-02-29"],
  ])("%s 加含当天 %s 天得 %s", (start, days, end) => {
    expect(addInclusiveSettlementDays(start, days)).toBe(end);
    expect(inclusiveSettlementDayCount(start, end)).toBe(Number(days));
  });
  it.each(["", "0", "-1", "1.1", "1e3", "3651", "NaN", "Infinity", " 7"])(
    "拒绝连续天数 %j 返回空串",
    days => {
      expect(addInclusiveSettlementDays("2024-01-01", days)).toBe("");
    }
  );
  it.each([
    "",
    "not-a-date",
    "2023-02-29",
    "2024-02-30",
    "2024-13-01",
    "2024-1-01",
    "2024-01-00",
    "0000-01-01",
  ])("无效日期 %j 无NaN或日期自动滚动", date => {
    expect(addInclusiveSettlementDays(date, "7")).toBe("");
    expect(inclusiveSettlementDayCount(date, "2024-12-31")).toBeUndefined();
    expect(inclusiveSettlementDayCount("2024-01-01", date)).toBeUndefined();
  });
  it("连续天数最大3650有效，反向日期undefined，越过9999年返回空", () => {
    const end = addInclusiveSettlementDays("2024-01-01", "3650");
    expect(inclusiveSettlementDayCount("2024-01-01", end)).toBe(3650);
    expect(
      inclusiveSettlementDayCount("2024-03-01", "2024-02-29")
    ).toBeUndefined();
    expect(addInclusiveSettlementDays("9999-12-31", "2")).toBe("");
    expect(settlementPositiveInteger("1000", 1000)).toBe(1000);
    expect(settlementPositiveInteger("1001", 1000)).toBeUndefined();
  });
  it("设备时区变化不影响中国纯日期运算", () => {
    const original = process.env.TZ;
    try {
      for (const zone of [
        "UTC",
        "Asia/Shanghai",
        "America/Los_Angeles",
        "Pacific/Kiritimati",
      ]) {
        process.env.TZ = zone;
        expect(addInclusiveSettlementDays("2024-02-29", "7")).toBe(
          "2024-03-06"
        );
        expect(inclusiveSettlementDayCount("2024-02-29", "2024-03-06")).toBe(7);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
