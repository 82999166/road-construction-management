/** 机械成本自动归集的稳定单号；来源只依赖单号，不猜测名称、备注或资源类型。 */
export function getDieselRecordSourceLabel(
  recordNo: string | null | undefined
): "机械录入" | "柴油登记" {
  return /^DS-MC-\d+$/.test(recordNo ?? "") ? "机械录入" : "柴油登记";
}

export const MACHINE_DIESEL_LEDGER_NOTE =
  "机械录入的柴油（含历史记录和已结算记录）自动归入柴油管理，来源标为“机械录入”，无需重复登记；供油方式为项目部供油，请选择“全部供油方式”或“项目部供油”查看，仍遵循当前项目、日期及资源筛选。";
