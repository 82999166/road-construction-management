import { calculateTheoreticalVolume } from "./domain";

/** 与车辆登记的尺寸字段一致；旧记录缺少车型时仍按货运车型严格校验。 */
export function requiresVehicleCargoBox(vehicleType?: string | null): boolean {
  return ["dump_truck", "flatbed", "trailer"].includes(
    vehicleType ?? "dump_truck"
  );
}

/**
 * 车辆档案不等于运输运单。无货厢尺寸的车型没有可计算的货厢理论方量，
 * 返回兼容旧DTO的0，而不是虚填尺寸或放宽真正运输运单的方量校验。
 */
export function calculateVehicleRegistryVolume(
  vehicleType: string | null | undefined,
  lengthMeters: number,
  widthMeters: number,
  heightMeters: number,
  loadFactor = 1
): number {
  if (!requiresVehicleCargoBox(vehicleType)) return 0;
  return calculateTheoreticalVolume(
    lengthMeters,
    widthMeters,
    heightMeters,
    loadFactor
  );
}
