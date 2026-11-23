/** 仅格式化采集到的合法坐标；显示保留六位，上传元数据的原始精度不变。 */
export function formatWatermarkCoordinates(value: { longitude: number; latitude: number } | null | undefined) {
  if (!value || !Number.isFinite(value.longitude) || !Number.isFinite(value.latitude)
    || Math.abs(value.longitude) > 180 || Math.abs(value.latitude) > 90) return "经纬度：未取得";
  return `经纬度：${value.longitude.toFixed(6)}, ${value.latitude.toFixed(6)}`;
}
