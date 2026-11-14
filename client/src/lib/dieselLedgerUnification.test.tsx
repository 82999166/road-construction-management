import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  changeDieselLedgerFilter,
  resetDieselProjectResourceFilter,
  isDieselLedgerDataReady,
  type DieselLedgerFilter,
} from "./dieselLedgerFilter";
import { getDieselRecordSourceLabel } from "./dieselLedgerSource";
import { DieselLedgerDataState } from "../components/DieselLedgerDataState";
const initial: DieselLedgerFilter = {
  plateNo: "湘A合成",
  machineName: "",
  dateFrom: "2026-11-14",
  dateTo: "2026-11-14",
  month: "",
  supplyMethod: "all",
  assetType: "vehicle",
  supplierName: "",
};
describe("机械柴油归集前端", () => {
  it("月份筛选清除原日期条件，日期筛选清除月份", () => {
    const month = changeDieselLedgerFilter(initial, "month", "2026-11");
    expect(month).toMatchObject({ month: "2026-11", dateFrom: "", dateTo: "" });
    expect(
      changeDieselLedgerFilter(month, "dateFrom", "2026-11-01")
    ).toMatchObject({ month: "", dateFrom: "2026-11-01" });
  });
  it("机械名称、车牌和资源类型互斥，禁用字段不残留", () => {
    const machine = changeDieselLedgerFilter(initial, "machineName", "挖机");
    expect(machine).toMatchObject({
      plateNo: "",
      machineName: "挖机",
      assetType: "machine",
    });
    expect(
      changeDieselLedgerFilter(machine, "plateNo", "湘B合成")
    ).toMatchObject({
      machineName: "",
      plateNo: "湘B合成",
      assetType: "vehicle",
    });
    expect(
      changeDieselLedgerFilter(machine, "assetType", "vehicle").machineName
    ).toBe("");
  });
  it("切项目只清理旧资源和供应商，保留日期和供油方式", () => {
    expect(
      resetDieselProjectResourceFilter({ ...initial, supplierName: "旧供应商" })
    ).toEqual({ ...initial, plateNo: "", assetType: "all", supplierName: "" });
  });
  it("只有已完成当前请求才能显示汇总和打印，错误不显示零记录", () => {
    const ready = {
      isLoading: false,
      isFetching: false,
      isError: false,
      data: [],
    };
    expect(isDieselLedgerDataReady(ready)).toBe(true);
    for (const state of [
      { ...ready, isLoading: true },
      { ...ready, isFetching: true },
      { ...ready, isError: true },
      { ...ready, data: undefined },
    ])
      expect(isDieselLedgerDataReady(state)).toBe(false);
    expect(isDieselLedgerDataReady(ready, false)).toBe(false);
  });
  it("加载和失败不挂载旧汇总，成功含零笔数据可正常显示", () => {
    const old = <div>旧金额999</div>;
    expect(
      renderToStaticMarkup(
        <DieselLedgerDataState loading error={false}>
          {old}
        </DieselLedgerDataState>
      )
    ).not.toContain("旧金额999");
    const error = renderToStaticMarkup(
      <DieselLedgerDataState loading={false} error>
        {old}
      </DieselLedgerDataState>
    );
    expect(error).toContain("读取失败");
    expect(error).not.toContain("旧金额999");
    expect(
      renderToStaticMarkup(
        <DieselLedgerDataState loading={false} error={false}>
          {old}
        </DieselLedgerDataState>
      )
    ).toContain("旧金额999");
  });
  it("台账和打印采用同一机械录入来源，标准十二列不新增错位列", () => {
    expect(getDieselRecordSourceLabel("DS-MC-23")).toBe("机械录入");
    expect(getDieselRecordSourceLabel("DS-23")).toBe("柴油登记");
    const source = readFileSync(
      new URL("../components/DieselRefuelPrintDialog.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("getDieselRecordSourceLabel(item.recordNo)");
    expect(source).toContain("DIESEL_REFUEL_COLUMN_WIDTHS");
  });
});
