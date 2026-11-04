export type TransportSafetyDraft = {
  minimumTransitMinutes: string;
  minimumTransitEnabled: boolean;
  unloadGeofenceMeters: string;
  unloadGeofenceEnabled: boolean;
};

export function validateTransportSafetyDraft(draft: TransportSafetyDraft) {
  const minutes = Number(draft.minimumTransitMinutes);
  const meters = Number(draft.unloadGeofenceMeters);
  const minimumTransitError =
    !draft.minimumTransitMinutes.trim() ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 1440
      ? "最短运输时间请输入1～1440的整数，单位：分钟。"
      : null;
  const unloadGeofenceError =
    !draft.unloadGeofenceMeters.trim() ||
    !Number.isInteger(meters) ||
    meters < 30 ||
    meters > 5000
      ? "定位允许偏差请输入30～5000的整数，单位：米；超出范围不会保存。"
      : null;
  return {
    minimumTransitError,
    unloadGeofenceError,
    valid: !minimumTransitError && !unloadGeofenceError,
    minutes,
    meters,
  };
}

export function transportSafetySummary(safety: {
  minimumTransitMinutes: number;
  minimumTransitEnabled: boolean;
  unloadGeofenceMeters: number;
  unloadGeofenceEnabled: boolean;
}) {
  return `最短${safety.minimumTransitMinutes}分钟（${safety.minimumTransitEnabled ? "硬拦截" : "仅提示、不拦截"}）；定位允许偏差${safety.unloadGeofenceMeters}米（${safety.unloadGeofenceEnabled ? "硬拦截" : "仅提示、不拦截"}）`;
}
