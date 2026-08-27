export type DieselLedgerSummaryRecord = {
  id: number;
  assetType: "vehicle" | "machine";
  supplyMethod: "project_supply" | "external_station";
  liters: number | string;
  amount: number | string;
  deductFromFreight: boolean;
  status: string;
};

/**
 * 页面指标和打印末行共用的柴油汇总口径。
 * 当前筛选的作废记录可在明细中追溯，但不得计入油量、金额和待扣运费。
 */
export function summarizeDieselLedgerRecords(records: readonly DieselLedgerSummaryRecord[]) {
  const effectiveRecords = records.filter(record => record.status !== "void");
  const sum = (predicate: (record: DieselLedgerSummaryRecord) => boolean, field: "liters" | "amount") => effectiveRecords
    .filter(predicate)
    .reduce((total, record) => total + Number(record[field] || 0), 0);

  return {
    displayedRecordCount: records.length,
    effectiveRecordCount: effectiveRecords.length,
    totalLiters: sum(() => true, "liters"),
    totalAmount: sum(() => true, "amount"),
    projectSupplyLiters: sum(record => record.supplyMethod === "project_supply", "liters"),
    stationLiters: sum(record => record.supplyMethod === "external_station", "liters"),
    vehicleLiters: sum(record => record.assetType === "vehicle", "liters"),
    machineLiters: sum(record => record.assetType === "machine", "liters"),
    deductibleAmount: sum(record => record.deductFromFreight, "amount"),
  };
}
