import { and, eq, gte, lt, or, inArray, isNull, ne, sql, type AnyColumn } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { siteDashboardInput, type SiteTransportDetails, type SiteTransportMetric, type SiteDashboard, type SiteProject, type SiteRisk, type SiteTransportEvent } from "../../shared/siteOperations";
import { getTransportReviewEligibility, transportSnapshot } from "./transportWorkspace";
import { requireSiteDb, requireSiteProject } from "./siteOperationsConfiguration";

export function siteChinaDayRange(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}
/** MySQL DATE is a natural-day string, never a timezone-serialized Date object. */
export function siteDatePredicate(column: AnyColumn, date: string) {
  siteDashboardInput.shape.businessDate.parse(date);
  return eq(column, sql`${date}`);
}
/** Free-form historical notes may contain finance/PII; only sanitized operational text leaves this API. */
export function safeSiteText(value: unknown, max = 2000): string {
  return (typeof value === "string" ? value : "").slice(0, max)
    .replace(/(?:https?:\/\/|\/manus-storage\/)[^\s，；]+/gi, "[附件请进入业务核验查看]")
    .replace(/\b(?:api[_ -]?key|password|token|secret)\s*[:=：]\s*[^\s，；]+/gi, "[敏感内容已隐藏]")
    .replace(/\b1[3-9]\d{9}\b|\b\d{15,19}[Xx]?\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[个人资料已隐藏]")
    .replace(/(?:¥|￥|RMB|CNY)\s*[\d,.]+|[\d,.]+\s*(?:万元|元|人民币)/gi, "[金额已隐藏]")
    .replace(/(?:金额|单价|价格|运费|工资|扣款|回款|应收|应付|付款|账户|银行卡|手机号|身份证|联系人|司机姓名|密钥)[^\n，；。]*/g, "[非现场信息已隐藏]");
}
type Trip = Pick<typeof s.transportTrips.$inferSelect, "id" | "tripNo" | "vehicleId" | "projectId" | "invoiceMode" | "startAt" | "endAt" | "routeSnapshot" | "evidenceId" | "status" | "loadConfirmedAt" | "unloadConfirmedAt" | "loadConfirmedBy" | "unloadConfirmedBy" | "loadEventId" | "unloadEventId" | "exceptionStatus" | "updatedAt">;
type Event = Pick<typeof s.transportCardEvents.$inferSelect, "id" | "tripId" | "vehicleId" | "projectId" | "eventType" | "occurredAt" | "validationStatus" | "reviewedAt">;
type Vehicle = Pick<typeof s.transportVehicles.$inferSelect, "id" | "plateNo" | "fuelTankCapacityLiters">;
type Fuel = Pick<typeof s.dieselRefuelRecords.$inferSelect, "id" | "vehicleId" | "liters" | "refueledAt" | "evidenceId" | "status">;
type Evidence = Pick<typeof s.evidenceRecords.$inferSelect, "id" | "sourceId">;
type Report = Pick<typeof s.constructionDailyReports.$inferSelect, "id" | "workArea" | "workContent" | "constructionPlan" | "issueNotes" | "issuePriority" | "status" | "updatedAt">;
type Alert = Pick<typeof s.projectRiskAlerts.$inferSelect, "id" | "ruleCode" | "sourceType" | "sourceId" | "status">;
export type SiteFacts = { project: SiteProject; businessDate: string; trips: Trip[]; events: Event[]; evidence: Evidence[]; vehicles: Vehicle[]; fuel: Fuel[]; reports: Report[]; rule?: { enabled: boolean; maxFuelFillRatio: string | number; maxTransportDurationMinutes: number }; alerts?: Alert[]; now?: Date };
const EVENT_LIMIT = 50, REPORT_LIMIT = 50, RISK_LIMIT = 100;
export function aggregateSiteFacts(f: SiteFacts, details?: { metric: SiteTransportMetric; rows: SiteTransportDetails["rows"] }): SiteDashboard {
  const now = f.now ?? new Date(), { start, end } = siteChinaDayRange(f.businessDate);
  const inDay = (d: Date | null | undefined) => Boolean(d && d >= start && d < end);
  const vehicleMap = new Map(f.vehicles.map(v => [v.id, v]));
  const evidenceMap = new Map(f.evidence.map(e => [e.id, e]));
  const eventsByTrip = new Map<number, Event[]>();
  for (const e of f.events) {
    if (e.projectId !== f.project.id) continue;
    const list = eventsByTrip.get(e.tripId) ?? []; list.push(e); eventsByTrip.set(e.tripId, list);
  }
  const trips = f.trips.filter(t => t.projectId === f.project.id && !["draft", "void"].includes(t.status));
  const isEvidence = (id: number | null, sourceId: string) => Boolean(id && evidenceMap.get(id)?.sourceId === sourceId);
  const facts = new Map(trips.map(trip => {
    const snap = transportSnapshot(trip.routeSnapshot);
    const events = (eventsByTrip.get(trip.id) ?? []).filter(e => e.vehicleId === trip.vehicleId);
    const eligibility = getTransportReviewEligibility(trip, events, { load: isEvidence(trip.evidenceId, `transport-trip-${trip.tripNo}`), unload: isEvidence(Number(snap.unloadPhotoEvidenceId) || null, `transport-unload-${trip.tripNo}`) });
    const load = events.find(e => e.id === trip.loadEventId && e.eventType === "load" && e.validationStatus === "accepted");
    const unload = events.find(e => e.id === trip.unloadEventId && e.eventType === "unload" && e.validationStatus === "accepted");
    const needsReview = events.some(e => e.validationStatus === "needs_review");
    const photoLoad = trip.invoiceMode === "plate_photo" && isEvidence(trip.evidenceId, `transport-trip-${trip.tripNo}`);
    const factualOrder = Boolean(unload && (load ? unload.occurredAt > load.occurredAt : photoLoad && trip.loadConfirmedAt && unload.occurredAt > trip.loadConfirmedAt));
    const normal = eligibility.closureKind === "normal" && eligibility.eligible && factualOrder && !eligibility.requiresExceptionReview && !needsReview && ["verified", "settled"].includes(trip.status);
    const relatedDay = inDay(trip.startAt) || inDay(trip.unloadConfirmedAt) || events.some(e => inDay(e.occurredAt));
    const awaitingUnload = eligibility.closureKind === "normal" && Boolean(trip.loadConfirmedAt && trip.loadConfirmedBy && (load || photoLoad)) && !trip.unloadConfirmedAt && !trip.endAt && !needsReview && trip.exceptionStatus !== "open";
    const pending = relatedDay && !awaitingUnload && (needsReview || trip.exceptionStatus === "open" || !eligibility.eligible || (eligibility.closureKind === "normal" && (!normal || !factualOrder)));
    const inTransit = eligibility.closureKind === "normal" && Boolean(trip.loadConfirmedAt && trip.loadConfirmedBy && (load || photoLoad)) && !trip.unloadConfirmedAt && !trip.endAt && trip.status !== "settled";
    const route = { load: safeSiteText(snap.loadSiteName, 100) || null, unload: safeSiteText(snap.unloadSiteName, 100) || null };
    return [trip.id, { trip, events, eligibility, load, unload, normal, pending, inTransit, relatedDay, route, factualOrder }] as const;
  }));
  const allEvents: SiteTransportEvent[] = [];
  const risks: SiteRisk[] = [];
  const rule = f.rule ?? { enabled: true, maxFuelFillRatio: 1.1, maxTransportDurationMinutes: 360 };
  const alertMap = new Map((f.alerts ?? []).map(a => [`${a.ruleCode}:${a.sourceType}:${a.sourceId}`, a]));
  const addRisk = (input: { ruleCode: string; vehicleId: number; at: Date; severity: SiteRisk["severity"]; reason: string; type: SiteRisk["evidence"]["type"]; id: number; tripId?: number; basis?: SiteRisk["basis"] }) => {
    if (!rule.enabled) return;
    const alert = alertMap.get(`${input.ruleCode}:${input.type}:${input.id}`);
    if (alert && ["resolved", "ignored"].includes(alert.status)) return;
    risks.push({ key: `${input.ruleCode}:${input.type}:${input.id}`, ruleCode: input.ruleCode, vehicleId: input.vehicleId, plate: safeSiteText(vehicleMap.get(input.vehicleId)?.plateNo, 32) || "未登记车牌", project: { id: f.project.id, name: safeSiteText(f.project.name, 200) }, route: facts.get(input.tripId ?? 0)?.route ?? { load: null, unload: null }, occurredAt: input.at.toISOString(), severity: input.severity, reason: input.reason, evidence: { type: input.type, id: input.id }, reviewStatus: alert?.status === "acknowledged" || alert?.status === "in_rectification" ? alert.status : "pending_review", alertId: alert?.id ?? null, basis: input.basis ?? "business_day", detail: { target: input.type === "diesel_refuel" ? "diesel" : "transport", projectId: f.project.id, vehicleId: input.vehicleId, tripId: input.tripId ?? null, refuelId: input.type === "diesel_refuel" ? input.id : null, eventId: input.type === "transport_card_event" ? input.id : null } });
  };
  for (const fact of Array.from(facts.values())) {
    const { trip, events, eligibility, unload, normal, relatedDay, route } = fact;
    const plate = safeSiteText(vehicleMap.get(trip.vehicleId)?.plateNo, 32) || "未登记车牌";
    if (details) {
      const matches = { departures: inDay(trip.startAt), normalCompletions: normal && inDay(unload?.occurredAt), currentInTransitVehicles: fact.inTransit, pendingReview: fact.pending, specialClosures: eligibility.closureKind !== "normal" && inDay(trip.endAt) };
      if (matches[details.metric]) details.rows.push({ tripId: trip.id, tripNo: safeSiteText(trip.tripNo, 100), vehicleId: trip.vehicleId, plate, route, occurredAt: (details.metric === "normalCompletions" ? unload!.occurredAt : details.metric === "specialClosures" ? trip.endAt! : trip.startAt).toISOString() });
    }
    if (inDay(trip.startAt)) allEvents.push({ key: `departure:${trip.id}`, type: "departure", tripId: trip.id, eventId: fact.load?.id ?? null, vehicleId: trip.vehicleId, plate, route, occurredAt: trip.startAt.toISOString(), status: "issued", closureKind: eligibility.closureKind as SiteTransportEvent["closureKind"], normalCompletion: false });
    for (const e of events.filter(e => e.validationStatus !== "duplicate" && inDay(e.occurredAt))) {
      if (e.eventType === "load" && e.validationStatus === "accepted") continue;
      allEvents.push({ key: `event:${e.id}`, type: e.validationStatus === "accepted" ? "unload" : "review", tripId: trip.id, eventId: e.id, vehicleId: trip.vehicleId, plate, route, occurredAt: e.occurredAt.toISOString(), status: e.validationStatus as "accepted" | "needs_review" | "rejected", closureKind: eligibility.closureKind as SiteTransportEvent["closureKind"], normalCompletion: normal && e.id === unload?.id });
      if (e.validationStatus === "needs_review") addRisk({ ruleCode: "TRANSPORT_EVENT_NEEDS_REVIEW", vehicleId: trip.vehicleId, at: e.occurredAt, severity: "warning", reason: "装卸事件尚待业务核验，请查看原事件与凭据；未认定违规。", type: "transport_card_event", id: e.id, tripId: trip.id });
    }
    if (relatedDay && trip.exceptionStatus === "open") addRisk({ ruleCode: "TRANSPORT_EXCEPTION_OPEN", vehicleId: trip.vehicleId, at: trip.updatedAt, severity: "warning", reason: "运单异常尚未闭环，请进入运输业务核验。", type: "transport_trip", id: trip.id, tripId: trip.id });
    if (eligibility.closureKind !== "normal") continue;
    const loadAt = fact.load?.occurredAt ?? trip.loadConfirmedAt, unloadAt = unload?.occurredAt ?? trip.unloadConfirmedAt;
    const minutes = loadAt && unloadAt ? (unloadAt.getTime() - loadAt.getTime()) / 60000 : null;
    if (relatedDay && minutes !== null && minutes <= 0) addRisk({ ruleCode: "TRANSPORT_TIME_ORDER", vehicleId: trip.vehicleId, at: unloadAt!, severity: "critical", reason: "卸土时间早于或等于装土时间，请核对原始装卸事件。", type: "transport_trip", id: trip.id, tripId: trip.id });
    if (normal && inDay(unload?.occurredAt) && minutes !== null && minutes > 0) {
      const policy = transportSnapshot(transportSnapshot(trip.routeSnapshot).safetyPolicy);
      const threshold = Number(policy.minimumTransitMinutes);
      if (policy.minimumTransitEnabled === true && Number.isFinite(threshold) && threshold > 0 && minutes < threshold) addRisk({ ruleCode: "TRANSPORT_CYCLE_SHORT", vehicleId: trip.vehicleId, at: unloadAt!, severity: "warning", reason: `有效装卸周期 ${minutes.toFixed(1)} 分钟，短于运单历史规则 ${threshold} 分钟，请核查。`, type: "transport_trip", id: trip.id, tripId: trip.id });
      if (!Object.keys(policy).length || (policy.minimumTransitEnabled === true && (!Number.isFinite(threshold) || threshold <= 0))) addRisk({ ruleCode: "TRANSPORT_BASELINE_MISSING", vehicleId: trip.vehicleId, at: unloadAt!, severity: "notice", reason: "历史路线最短周期规则缺失，资料待补；不判断周期异常。", type: "transport_trip", id: trip.id, tripId: trip.id });
    }
    if (fact.inTransit && loadAt && (now.getTime() - loadAt.getTime()) / 60000 > rule.maxTransportDurationMinutes) addRisk({ ruleCode: "TRANSPORT_IN_TRANSIT_TIMEOUT", vehicleId: trip.vehicleId, at: loadAt, severity: "warning", reason: `当前在途已超过项目 ${rule.maxTransportDurationMinutes} 分钟阈值，请核实排队、停工与装卸状态。`, type: "transport_trip", id: trip.id, tripId: trip.id, basis: "current_snapshot" });
  }
  const currentByVehicle = new Map<number, typeof trips>();
  for (const fact of Array.from(facts.values())) if (fact.inTransit) { const list = currentByVehicle.get(fact.trip.vehicleId) ?? []; list.push(fact.trip); currentByVehicle.set(fact.trip.vehicleId, list); }
  for (const [vehicleId, open] of Array.from(currentByVehicle.entries())) if (open.length > 1) addRisk({ ruleCode: "TRANSPORT_PARALLEL_OPEN_TRIPS", vehicleId, at: open.reduce((a,b) => a.startAt > b.startAt ? a : b).startAt, severity: "warning", reason: "同车存在多张当前在途运单，请核对调度与原始记录；未认定违规。", type: "transport_vehicle", id: vehicleId, basis: "current_snapshot" });
  const fuel = f.fuel.filter(x => x.status !== "void" && inDay(x.refueledAt));
  for (const r of fuel) {
    if (!r.vehicleId) continue;
    const capacity = Number(vehicleMap.get(r.vehicleId)?.fuelTankCapacityLiters ?? 0), liters = Number(r.liters);
    if (capacity > 0 && Number.isFinite(liters) && liters > capacity * Number(rule.maxFuelFillRatio)) addRisk({ ruleCode: "FUEL_FILL_OVER_CAPACITY", vehicleId: r.vehicleId, at: r.refueledAt, severity: "warning", reason: `单次登记加油 ${liters.toFixed(2)} L，超过核定容量 ${capacity.toFixed(2)} L 的项目阈值 ${Number(rule.maxFuelFillRatio).toFixed(2)} 倍；加油量待核查，不是实际油耗。`, type: "diesel_refuel", id: r.id });
  }
  const ids = new Set([...f.vehicles.map(v => v.id), ...trips.filter(t => facts.get(t.id)?.relatedDay || facts.get(t.id)?.inTransit).map(t => t.vehicleId), ...fuel.map(r => r.vehicleId).filter((x): x is number => x !== null)]);
  const vehicles = Array.from(ids).sort((a,b) => a-b).map(vehicleId => {
    const rows = fuel.filter(r => r.vehicleId === vehicleId), capacity = Number(vehicleMap.get(vehicleId)?.fuelTankCapacityLiters ?? 0);
    return { vehicleId, plate: safeSiteText(vehicleMap.get(vehicleId)?.plateNo, 32) || "未登记车牌", registeredFuelLiters: Math.round(rows.reduce((sum,r) => sum + (Number(r.liters) || 0), 0) * 1000) / 1000, refuelRecordCount: rows.length, pendingFuelRecords: rows.filter(r => r.status === "draft").length, normalCompletedTrips: Array.from(facts.values()).filter(x => x.trip.vehicleId === vehicleId && x.normal && inDay(x.unload?.occurredAt)).length, fuelTankCapacityLiters: capacity > 0 ? capacity : null, capacityStatus: capacity > 0 ? "ready" as const : "data_insufficient" as const, evidenceStatus: rows.length > 0 && rows.every(r => r.evidenceId && evidenceMap.has(r.evidenceId)) ? "ready" as const : "data_insufficient" as const, fuelConsumptionStatus: "data_insufficient" as const, tripEfficiencyStatus: "data_insufficient" as const };
  });
  const reports = f.reports.map(r => ({ id: r.id, workArea: safeSiteText(r.workArea, 200), workContent: safeSiteText(r.workContent), constructionPlan: r.constructionPlan ? safeSiteText(r.constructionPlan) : null, issueNotes: r.issueNotes ? safeSiteText(r.issueNotes, 1000) : null, issuePriority: !r.issueNotes?.trim() ? "none" as const : r.issuePriority ?? "ungraded" as const, status: r.status, updatedAt: r.updatedAt.toISOString(), issueResolution: "not_tracked" as const }));
  allEvents.sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
  const weight = { critical: 0, warning: 1, notice: 2 }; risks.sort((a,b) => weight[a.severity] - weight[b.severity] || b.occurredAt.localeCompare(a.occurredAt));
  return { scope: { projectId: f.project.id, projectName: safeSiteText(f.project.name, 200), businessDate: f.businessDate, timezone: "Asia/Shanghai", startAt: start.toISOString(), endExclusive: end.toISOString() }, updatedAt: now.toISOString(), transport: { departures: trips.filter(t => inDay(t.startAt)).length, normalCompletions: Array.from(facts.values()).filter(x => x.normal && inDay(x.unload?.occurredAt)).length, currentInTransitVehicles: currentByVehicle.size, pendingReview: Array.from(facts.values()).filter(x => x.pending).length, specialClosures: Array.from(facts.values()).filter(x => x.eligibility.closureKind !== "normal" && inDay(x.trip.endAt)).length, inTransitBasis: "current_snapshot", inTransitAsOf: now.toISOString(), pendingReviewBasis: "business_day_related_trips", countBasis: "all_matching_records", events: allEvents.slice(0, EVENT_LIMIT), eventTotal: allEvents.length, eventLimit: EVENT_LIMIT, eventsTruncated: allEvents.length > EVENT_LIMIT }, construction: { total: reports.length, limit: REPORT_LIMIT, truncated: reports.length > REPORT_LIMIT, reports: reports.slice(0, REPORT_LIMIT) }, vehicles, risks: { enabled: rule.enabled, status: rule.enabled ? "ready" : "disabled", items: risks.slice(0,RISK_LIMIT), total: risks.length, limit: RISK_LIMIT, truncated: risks.length > RISK_LIMIT, interpretation: "待核查，不认定偷油或违规；真实油耗和趟数效率缺少基线" } };
}

export async function getSiteProjects(): Promise<SiteProject[]> {
  const db = await requireSiteDb();
  const rows = await db.select({ id: s.projects.id, name: s.projects.name, status: s.projects.status }).from(s.projects).orderBy(s.projects.sortOrder, s.projects.id);
  return rows.map(r => ({ ...r, name: safeSiteText(r.name, 200) }));
}
async function loadSiteFacts(projectId: number, businessDate: string): Promise<SiteFacts> {
  const db = await requireSiteDb(), project = await requireSiteProject(db, projectId), { start, end } = siteChinaDayRange(businessDate);
  const window = (column: AnyColumn) => and(gte(column, start), lt(column, end));
  const dayEvents = db.select({ tripId: s.transportCardEvents.tripId }).from(s.transportCardEvents).where(and(eq(s.transportCardEvents.projectId, projectId), window(s.transportCardEvents.occurredAt)));
  // No limit on fact queries: counts cover all matches, including yesterday's departures unloaded today.
  const [trips, fuel, vehicles, reports, rules, alerts] = await Promise.all([
    db.select({ id: s.transportTrips.id, tripNo: s.transportTrips.tripNo, vehicleId: s.transportTrips.vehicleId, projectId: s.transportTrips.projectId, invoiceMode: s.transportTrips.invoiceMode, startAt: s.transportTrips.startAt, endAt: s.transportTrips.endAt, routeSnapshot: s.transportTrips.routeSnapshot, evidenceId: s.transportTrips.evidenceId, status: s.transportTrips.status, loadConfirmedAt: s.transportTrips.loadConfirmedAt, unloadConfirmedAt: s.transportTrips.unloadConfirmedAt, loadConfirmedBy: s.transportTrips.loadConfirmedBy, unloadConfirmedBy: s.transportTrips.unloadConfirmedBy, loadEventId: s.transportTrips.loadEventId, unloadEventId: s.transportTrips.unloadEventId, exceptionStatus: s.transportTrips.exceptionStatus, updatedAt: s.transportTrips.updatedAt }).from(s.transportTrips).where(and(eq(s.transportTrips.projectId, projectId), or(window(s.transportTrips.startAt), window(s.transportTrips.endAt), window(s.transportTrips.unloadConfirmedAt), inArray(s.transportTrips.id, dayEvents), and(isNull(s.transportTrips.endAt), ne(s.transportTrips.status, "settled"))))),
    db.select({ id: s.dieselRefuelRecords.id, vehicleId: s.dieselRefuelRecords.vehicleId, liters: s.dieselRefuelRecords.liters, refueledAt: s.dieselRefuelRecords.refueledAt, evidenceId: s.dieselRefuelRecords.evidenceId, status: s.dieselRefuelRecords.status }).from(s.dieselRefuelRecords).where(and(eq(s.dieselRefuelRecords.projectId, projectId), eq(s.dieselRefuelRecords.assetType,"vehicle"), window(s.dieselRefuelRecords.refueledAt))),
    db.select({ id: s.transportVehicles.id, plateNo: s.transportVehicles.plateNo, fuelTankCapacityLiters: s.transportVehicles.fuelTankCapacityLiters }).from(s.transportVehicles).where(eq(s.transportVehicles.projectId,projectId)),
    db.select({ id: s.constructionDailyReports.id, workArea: s.constructionDailyReports.workArea, workContent: s.constructionDailyReports.workContent, constructionPlan: s.constructionDailyReports.constructionPlan, issueNotes: s.constructionDailyReports.issueNotes, issuePriority: s.constructionDailyReports.issuePriority, status: s.constructionDailyReports.status, updatedAt: s.constructionDailyReports.updatedAt }).from(s.constructionDailyReports).where(and(eq(s.constructionDailyReports.projectId,projectId), siteDatePredicate(s.constructionDailyReports.reportDate, businessDate), ne(s.constructionDailyReports.status,"draft"))).orderBy(s.constructionDailyReports.updatedAt),
    db.select({ enabled: s.projectRiskRules.enabled, maxFuelFillRatio: s.projectRiskRules.maxFuelFillRatio, maxTransportDurationMinutes: s.projectRiskRules.maxTransportDurationMinutes }).from(s.projectRiskRules).where(eq(s.projectRiskRules.projectId,projectId)),
    db.select({ id: s.projectRiskAlerts.id, ruleCode: s.projectRiskAlerts.ruleCode, sourceType: s.projectRiskAlerts.sourceType, sourceId: s.projectRiskAlerts.sourceId, status: s.projectRiskAlerts.status }).from(s.projectRiskAlerts).where(and(eq(s.projectRiskAlerts.projectId,projectId), siteDatePredicate(s.projectRiskAlerts.businessDate, businessDate))),
  ]);
  const ids = trips.map(t => t.id);
  const events = ids.length ? await db.select({ id: s.transportCardEvents.id, tripId: s.transportCardEvents.tripId, vehicleId: s.transportCardEvents.vehicleId, projectId: s.transportCardEvents.projectId, eventType: s.transportCardEvents.eventType, occurredAt: s.transportCardEvents.occurredAt, validationStatus: s.transportCardEvents.validationStatus, reviewedAt: s.transportCardEvents.reviewedAt }).from(s.transportCardEvents).where(and(eq(s.transportCardEvents.projectId,projectId),inArray(s.transportCardEvents.tripId,ids))) : [];
  const evidenceIds = Array.from(new Set([...trips.flatMap(t => [t.evidenceId, Number(transportSnapshot(t.routeSnapshot).unloadPhotoEvidenceId) || null]), ...fuel.map(r => r.evidenceId)].filter((x): x is number => Boolean(x))));
  const evidence = evidenceIds.length ? await db.select({ id: s.evidenceRecords.id, sourceId: s.evidenceRecords.sourceId }).from(s.evidenceRecords).where(and(eq(s.evidenceRecords.projectId,projectId),eq(s.evidenceRecords.status,"active"),inArray(s.evidenceRecords.sourceType,["transport", "diesel_receipt"]),inArray(s.evidenceRecords.id,evidenceIds))) : [];
  return { project, businessDate, trips, events, evidence, vehicles, fuel, reports, rule: rules[0], alerts };
}
export async function getSiteDashboard(projectId: number, businessDate: string): Promise<SiteDashboard> {
  return aggregateSiteFacts(await loadSiteFacts(projectId, businessDate));
}
export function aggregateSiteTransportDetails(facts: SiteFacts, metric: SiteTransportMetric): SiteTransportDetails {
  const rows: SiteTransportDetails["rows"] = [];
  aggregateSiteFacts(facts, { metric, rows });
  rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.tripId - a.tripId);
  return { projectId: facts.project.id, businessDate: facts.businessDate, metric, count: rows.length, vehicleCount: new Set(rows.map(r => r.vehicleId)).size, rows };
}
export async function getSiteTransportDetails(projectId: number, businessDate: string, metric: SiteTransportMetric): Promise<SiteTransportDetails> {
  return aggregateSiteTransportDetails(await loadSiteFacts(projectId, businessDate), metric);
}
