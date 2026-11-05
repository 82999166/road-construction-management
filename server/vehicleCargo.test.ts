import { describe, expect, it } from "vitest";
import { calculateTheoreticalVolume } from "../shared/domain";
import {
  calculateVehicleRegistryVolume,
  requiresVehicleCargoBox,
} from "../shared/vehicleCargo";

describe("车辆档案按车型计算货厢方量", () => {
  it.each(["suv", "tractor", "mixer", "pickup", "other"])(
    "%s无需货厢尺寸也能投影档案",
    type => {
      expect(requiresVehicleCargoBox(type)).toBe(false);
      expect(calculateVehicleRegistryVolume(type, 0, 0, 0)).toBe(0);
      // 历史虚填尺寸不成为无货厢车型的可计费方量。
      expect(calculateVehicleRegistryVolume(type, 6, 2, 1.5, 0.9)).toBe(0);
    }
  );
  it.each(["dump_truck", "flatbed", "trailer", undefined, null])(
    "%s货运或旧车型仍校验真实正尺寸",
    type => {
      expect(requiresVehicleCargoBox(type)).toBe(true);
      expect(calculateVehicleRegistryVolume(type, 6, 2, 1.5, 0.9)).toBe(16.2);
      expect(() => calculateVehicleRegistryVolume(type, 0, 2, 1.5)).toThrow(
        "货厢长、宽、高必须大于 0"
      );
      expect(() => calculateVehicleRegistryVolume(type, 6, 2, 1.5, 0)).toThrow(
        "装载系数"
      );
    }
  );
  it("真正运输运单计算没有被放宽", () => {
    expect(() => calculateTheoreticalVolume(0, 2, 1)).toThrow(
      "货厢长、宽、高必须大于 0"
    );
  });
});
