export type DieselLedgerFilter = {
  plateNo: string;
  machineName: string;
  dateFrom: string;
  dateTo: string;
  month: string;
  supplyMethod: "all" | "project_supply" | "external_station";
  assetType: "all" | "vehicle" | "machine";
  supplierName: string;
};

/** 所有筛选入口共用原子转换，隐藏/禁用的控件不会留下互斥条件。 */
export function changeDieselLedgerFilter<K extends keyof DieselLedgerFilter>(
  current: DieselLedgerFilter,
  field: K,
  value: DieselLedgerFilter[K]
): DieselLedgerFilter {
  const next = { ...current, [field]: value };
  if (field === "month") {
    next.dateFrom = "";
    next.dateTo = "";
  } else if (field === "dateFrom" || field === "dateTo") {
    next.month = "";
  }
  if (field === "plateNo" && next.plateNo.trim()) {
    next.assetType = "vehicle";
    next.machineName = "";
  } else if (field === "machineName" && next.machineName.trim()) {
    next.assetType = "machine";
    next.plateNo = "";
  } else if (field === "assetType") {
    if (next.assetType === "machine") next.plateNo = "";
    if (next.assetType === "vehicle") next.machineName = "";
  }
  return next;
}

/** 项目变化仅清除原项目的资源/供应商限定，保留用户明确选择的日期和供油方式。 */
export function resetDieselProjectResourceFilter(
  current: DieselLedgerFilter
): DieselLedgerFilter {
  return {
    ...current,
    plateNo: "",
    machineName: "",
    assetType: "all",
    supplierName: "",
  };
}

export function isDieselLedgerDataReady(
  query: {
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    data: unknown;
  },
  enabled = true
) {
  return (
    enabled &&
    !query.isLoading &&
    !query.isFetching &&
    !query.isError &&
    query.data !== undefined
  );
}
