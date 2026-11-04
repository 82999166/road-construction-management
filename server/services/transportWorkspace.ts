type Row = Record<string, any>;
export const transportSnapshot = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};

/** Only explicitly safe business facts; never emit coordinates, tokens, fingerprints or storage keys. */
export function projectTransportSafetySnapshot(
  value: unknown,
  invoiceMode = "nfc_card"
) {
  const snapshot = transportSnapshot(value);
  return {
    routePresetId: Number(snapshot.routePresetId ?? 0) || null,
    settlementUnit: ["trip", "ton", "cubic_meter"].includes(
      snapshot.settlementUnit
    )
      ? snapshot.settlementUnit
      : null,
    invoiceMode: invoiceMode === "plate_photo" ? "plate_photo" : "nfc_card",
    nfcSingleScanClosed:
      invoiceMode === "nfc_card" && snapshot.nfcSingleScanClosed === true,
    nfcSingleScanClosedAt:
      typeof snapshot.nfcSingleScanClosedAt === "string"
        ? snapshot.nfcSingleScanClosedAt
        : null,
    unloadOnlyCardClose:
      invoiceMode === "nfc_card" && snapshot.unloadOnlyCardClose === true,
    unloadOnlyCardClosedAt:
      typeof snapshot.unloadOnlyCardClosedAt === "string"
        ? snapshot.unloadOnlyCardClosedAt
        : null,
    loadCardRecorded: snapshot.loadCardRecorded === true,
    unloadConfirmationMode: ["photo", "nfc_card"].includes(
      snapshot.unloadConfirmationMode
    )
      ? snapshot.unloadConfirmationMode
      : null,
    safetyPolicy:
      snapshot.safetyPolicy && typeof snapshot.safetyPolicy === "object"
        ? {
            minimumTransitMinutes: Number(
              snapshot.safetyPolicy.minimumTransitMinutes
            ),
            minimumTransitEnabled:
              snapshot.safetyPolicy.minimumTransitEnabled === true,
            unloadGeofenceMeters: Number(
              snapshot.safetyPolicy.unloadGeofenceMeters
            ),
            unloadGeofenceEnabled:
              snapshot.safetyPolicy.unloadGeofenceEnabled === true,
            source: "unload_site",
          }
        : null,
  };
}

/** Evaluate persisted evidence, not client flags or merely an endAt timestamp. */
export function getTransportReviewEligibility(
  trip: Row,
  events: readonly Row[],
  evidence: { load: boolean; unload: boolean }
) {
  const snapshot = transportSnapshot(trip.routeSnapshot);
  const accepted = (id: unknown, type: string) =>
    Boolean(
      id &&
        events.some(
          event =>
            event.id === id &&
            event.tripId === trip.id &&
            event.eventType === type &&
            event.validationStatus === "accepted"
        )
    );
  const load = Boolean(
    trip.loadConfirmedAt &&
      trip.loadConfirmedBy &&
      (trip.invoiceMode === "plate_photo"
        ? evidence.load
        : accepted(trip.loadEventId, "load"))
  );
  const unload = Boolean(
    trip.unloadConfirmedAt &&
      trip.endAt &&
      trip.unloadConfirmedBy &&
      accepted(trip.unloadEventId, "unload") &&
      (snapshot.unloadConfirmationMode !== "photo" || evidence.unload)
  );
  const single =
    trip.invoiceMode === "nfc_card" && snapshot.nfcSingleScanClosed === true;
  const unloadOnly =
    trip.invoiceMode === "nfc_card" && snapshot.unloadOnlyCardClose === true;
  const reasons: string[] = [];
  if (single && unloadOnly) reasons.push("特殊闭环标识冲突，请核对原始记录");
  if (single) {
    if (
      !load ||
      !trip.endAt ||
      !snapshot.nfcSingleScanClosedAt ||
      !snapshot.nfcSingleScanClosedBy
    )
      reasons.push("单次刷卡闭环缺少服务端闭环依据或有效装土刷卡");
  } else if (unloadOnly) {
    if (
      !unload ||
      !snapshot.unloadOnlyCardClosedAt ||
      snapshot.loadCardRecorded !== false
    )
      reasons.push("卸土补刷卡缺少有效卸土事件或特殊闭环依据");
  } else {
    if (!load)
      reasons.push(
        trip.invoiceMode === "plate_photo"
          ? "装土直拍影像或确认不完整"
          : "装土有效刷卡确认不完整"
      );
    if (!unload) reasons.push("尚未完成有效卸土刷卡或拍照闭环");
    if (
      trip.loadConfirmedAt &&
      trip.unloadConfirmedAt &&
      new Date(trip.unloadConfirmedAt).getTime() <
        new Date(trip.loadConfirmedAt).getTime()
    )
      reasons.push("卸土时间早于装土确认");
  }
  if (["draft", "void"].includes(trip.status))
    reasons.push("当前状态不允许核验");
  return {
    eligible: reasons.length === 0,
    requiresExceptionReview: trip.exceptionStatus === "open",
    closureKind: single ? "single_scan" : unloadOnly ? "unload_only" : "normal",
    reasons,
  };
}

/** Existing site values are authoritative; legacy routes are fallback only when the site lacks fields. */
export function effectiveTransportSafety(
  site: Row | null | undefined,
  route: Row
) {
  return {
    minimumTransitMinutes:
      site?.minimumTransitMinutes ?? route.minimumTransitMinutes ?? 10,
    minimumTransitEnabled:
      site?.minimumTransitEnabled ?? route.minimumTransitEnabled ?? true,
    unloadGeofenceMeters:
      site?.unloadGeofenceMeters ?? route.unloadGeofenceMeters ?? 300,
    unloadGeofenceEnabled:
      site?.unloadGeofenceEnabled ?? route.unloadGeofenceEnabled ?? true,
  };
}

export function classifyTransportSettlement(
  trip: Row,
  settlement: Row | null | undefined,
  ownership?: string
) {
  const linked = Boolean(settlement && settlement.status !== "void");
  return {
    settlementId: linked ? settlement!.id : null,
    settlementNo: linked ? settlement!.settlementNo : null,
    settlementStatus: linked ? settlement!.status : null,
    legacyUnlinkedSettled:
      trip.status === "settled" && !linked && ownership === "trip_settlement",
    canCreateSettlement:
      ownership === "trip_settlement" && !linked && trip.status === "verified",
    paymentConfirmed: linked && settlement!.status === "paid",
  };
}
