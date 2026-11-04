export type UnloadLocation = { latitude: number; longitude: number };

/** 仅采集真实坐标，失败不伪造定位；NFC按服务端最新地点规则决定是否可闭环。 */
export async function collectUnloadLocation(
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined,
  maximumAge = 60_000
): Promise<UnloadLocation | null> {
  try {
    if (!geolocation) return null;
    const position = await new Promise<GeolocationPosition>(
      (resolve, reject) => {
        geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12_000,
          maximumAge,
        });
      }
    );
    const { latitude, longitude } = position.coords;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

/** 拍照仅在地点明确关闭硬拦截时允许无坐标归档；未知规则仍按严格模式处理。 */
export async function resolvePhotoUnloadLocation(
  geofenceEnabled: boolean | undefined,
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined
): Promise<UnloadLocation | null> {
  const location = await collectUnloadLocation(geolocation);
  if (location || geofenceEnabled === false) return location;
  throw new Error(
    "卸土点定位硬拦截已开启或规则尚未读取，请允许定位权限后重试；不会确认卸土。"
  );
}
