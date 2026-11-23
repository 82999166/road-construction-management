import { describe, it, expect } from "vitest";
import { aggregateSiteFacts, aggregateSiteTransportDetails, siteDatePredicate, siteChinaDayRange, safeSiteText, type SiteFacts } from "./siteOperationsDashboard";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { eq } from "drizzle-orm";
import { format } from "mysql2";
import { constructionDailyReports, projectRiskAlerts } from "../../drizzle/schema";
import { detectTransportRisk, detectTransportIntegrityRisks } from "../routers/projectRisk";
const at = (s: string) => new Date(s);
const load = at("2026-11-22T23:50:00+08:00"), unload = at("2026-11-23T00:15:00+08:00");
function fixture(): SiteFacts {
  const trip: any = { id: 1, tripNo: "T1", projectId: 2, vehicleId: 3, invoiceMode: "nfc_card", startAt: load, endAt: unload, loadConfirmedAt: load, unloadConfirmedAt: unload, loadConfirmedBy: 1, unloadConfirmedBy: 2, loadEventId: 10, unloadEventId: 11, exceptionStatus: "none", status: "verified", updatedAt: unload, routeSnapshot: { loadSiteName: "装土点", unloadSiteName: "卸土点", safetyPolicy: { minimumTransitMinutes: 10, minimumTransitEnabled: true }, price: 789123, token: "DO_NOT_EXPOSE" }, calculatedAmount: "SECRET_MONEY", actualDistanceKm: 300 };
  return { project: { id: 2, name: "真实项目", status: "active" }, businessDate: "2026-11-23", trips: [trip], events: [ { id: 10, tripId: 1, vehicleId: 3, projectId: 2, eventType: "load", occurredAt: load, validationStatus: "accepted", reviewedAt: null }, { id: 11, tripId: 1, vehicleId: 3, projectId: 2, eventType: "unload", occurredAt: unload, validationStatus: "accepted", reviewedAt: null } ], evidence: [], vehicles: [{ id:3, plateNo:"粤A12345",fuelTankCapacityLiters:"200" }], fuel: [], reports: [], now: at("2026-11-23T10:00:00+08:00") };
}
describe("siteOperations all-record fact aggregation",()=>{
  it("北京时间零点且跨日完成不重复计发车",()=>{ const f=fixture(),r=aggregateSiteFacts(f); expect(siteChinaDayRange(f.businessDate).start.toISOString()).toBe("2026-11-22T16:00:00.000Z");expect(r.transport.departures).toBe(0);expect(r.transport.normalCompletions).toBe(1);expect(r.scope.endExclusive).toBe("2026-11-23T16:00:00.000Z"); });
  it("当日末界不包括下一日，前界包括北京时间零点",()=>{const f=fixture(); f.trips[0].startAt=at("2026-11-23T00:00:00+08:00");expect(aggregateSiteFacts(f).transport.departures).toBe(1);f.trips[0].startAt=at("2026-11-24T00:00:00+08:00");expect(aggregateSiteFacts(f).transport.departures).toBe(0);});
  it.each(["draft","void"])("%s不进入发车完成和风险",status=>{const f=fixture();f.trips[0].status=status as any; const r=aggregateSiteFacts(f);expect(r.transport.normalCompletions).toBe(0);expect(r.transport.eventTotal).toBe(0);expect(r.risks.total).toBe(0);});
  it("verified不能替代有效卸土事件",()=>{const f=fixture();f.events=[];expect(aggregateSiteFacts(f).transport.normalCompletions).toBe(0);expect(aggregateSiteFacts(f).transport.pendingReview).toBe(1);});
  it.each(["needs_review","rejected"])("%s卸土不冒充正常完成",validationStatus=>{const f=fixture();f.events[1].validationStatus=validationStatus as any;const r=aggregateSiteFacts(f);expect(r.transport.normalCompletions).toBe(0);expect(r.transport.pendingReview).toBe(1);});
  it("错项目或错车辆事件不获完成资格",()=>{const f=fixture();f.events[1].vehicleId=99;expect(aggregateSiteFacts(f).transport.normalCompletions).toBe(0);f.events[1].vehicleId=3;f.events[1].projectId=99;expect(aggregateSiteFacts(f).transport.normalCompletions).toBe(0);});
  it.each(["nfcSingleScanClosed","unloadOnlyCardClose"])("特殊%s不能冒充正常完成或过短周期",flag=>{const f=fixture();f.trips[0].routeSnapshot={ [flag]: true, nfcSingleScanClosedAt: load.toISOString(),nfcSingleScanClosedBy:1,unloadOnlyCardClosedAt:unload.toISOString(),loadCardRecorded:false };const r=aggregateSiteFacts(f);expect(r.transport.normalCompletions).toBe(0);expect(r.transport.specialClosures).toBe(1);expect(r.risks.items.some(x=>["TRANSPORT_CYCLE_SHORT","TRANSPORT_TIME_ORDER"].includes(x.ruleCode))).toBe(false);});
  it("板牌直拍必须正确归属装卸凭据",()=>{const f=fixture();f.trips[0].invoiceMode="plate_photo";f.trips[0].evidenceId=30;f.trips[0].routeSnapshot={unloadConfirmationMode:"photo",unloadPhotoEvidenceId:31};f.evidence=[{id:30,sourceId:"transport-trip-T1"},{id:31,sourceId:"transport-unload-T1"}];expect(aggregateSiteFacts(f).transport.normalCompletions).toBe(1);f.evidence[1].sourceId="another-trip";expect(aggregateSiteFacts(f).transport.normalCompletions).toBe(0);});
  it("全部COUNT不受事件limit截断",()=>{const f=fixture();const base=f.trips[0];f.events=[];f.trips=Array.from({length:1020},(_,i)=>({...base,id:i+1,startAt:unload,status:"submitted",endAt:null,loadConfirmedAt:null,unloadConfirmedAt:null,loadEventId:null,unloadEventId:null}));const r=aggregateSiteFacts(f);expect(r.transport.departures).toBe(1020);expect(r.transport.eventTotal).toBe(1020);expect(r.transport.events).toHaveLength(50);expect(r.transport.eventsTruncated).toBe(true);});
  it("当前在途明确快照且普通等待卸土不算待核验",()=>{const f=fixture();f.trips[0]={...f.trips[0],status:"submitted",endAt:null,unloadConfirmedAt:null,unloadConfirmedBy:null,unloadEventId:null};f.events.pop();const r=aggregateSiteFacts(f);expect(r.transport.currentInTransitVehicles).toBe(1);expect(r.transport.inTransitBasis).toBe("current_snapshot");expect(r.transport.pendingReview).toBe(0);expect(r.risks.items.some(x=>x.ruleCode==="TRANSPORT_IN_TRANSIT_TIMEOUT"&&x.basis==="current_snapshot")).toBe(true);});
  it("并行在途单仅提示核验，不认定偷油",()=>{const f=fixture();f.trips[0]={...f.trips[0],status:"submitted",endAt:null,unloadConfirmedAt:null};f.trips.push({...f.trips[0],id:2,loadEventId:12});f.events.pop();f.events.push({...f.events[0],id:12,tripId:2});expect(aggregateSiteFacts(f).risks.items.map(x=>x.ruleCode)).toContain("TRANSPORT_PARALLEL_OPEN_TRIPS");});
  it("登记升数÷趟数永不触发真实油耗判断；无容量不是风险",()=>{const f=fixture();f.vehicles[0].fuelTankCapacityLiters=null;f.fuel=[{id:40,vehicleId:3,liters:"9999",refueledAt:unload,evidenceId:null,status:"approved"}];const r=aggregateSiteFacts(f);expect(r.risks.total).toBe(0);expect(r.vehicles[0].registeredFuelLiters).toBe(9999);expect(r.vehicles[0].capacityStatus).toBe("data_insufficient");expect(r.vehicles[0].fuelConsumptionStatus).toBe("data_insufficient");expect(r.vehicles[0].tripEfficiencyStatus).toBe("data_insufficient");});
  it("核定容量阈值及每项目风险启停有效",()=>{const f=fixture();f.fuel=[{id:40,vehicleId:3,liters:"250",refueledAt:unload,evidenceId:null,status:"approved"}];expect(aggregateSiteFacts(f).risks.items[0].ruleCode).toBe("FUEL_FILL_OVER_CAPACITY");f.rule={enabled:true,maxFuelFillRatio:1.5,maxTransportDurationMinutes:360};expect(aggregateSiteFacts(f).risks.total).toBe(0);f.rule.enabled=false;expect(aggregateSiteFacts(f).risks.status).toBe("disabled");});
  it("只复算有效风险再复用闭环状态，历史描述金额永不回显",()=>{const f=fixture();f.alerts=[{id:1,ruleCode:"TRANSPORT_SPEED_HIGH",sourceType:"transport_trip",sourceId:"1",status:"open",summary:"欠款88888元"} as any];expect(aggregateSiteFacts(f).risks.total).toBe(0);f.fuel=[{id:40,vehicleId:3,liters:"250",refueledAt:unload,evidenceId:null,status:"approved"}];f.alerts.push({id:2,ruleCode:"FUEL_FILL_OVER_CAPACITY",sourceType:"diesel_refuel",sourceId:"40",status:"resolved"});expect(aggregateSiteFacts(f).risks.total).toBe(0);});
  it("历史snapshot优先，无路线最短阈值仅显示资料待补",()=>{const f=fixture();f.trips[0].routeSnapshot={safetyPolicy:{minimumTransitMinutes:30,minimumTransitEnabled:true}};expect(aggregateSiteFacts(f).risks.items[0].ruleCode).toBe("TRANSPORT_CYCLE_SHORT");f.trips[0].routeSnapshot={};expect(aggregateSiteFacts(f).risks.items[0].ruleCode).toBe("TRANSPORT_BASELINE_MISSING");});
  it("白名单JSON不包含金额字段、raw snapshot、PII或密钥",()=>{const f=fixture();f.reports=[{id:9,workArea:"K1",workContent:"施工摊铺；运费300元；手机号13812345678；token=ABC",constructionPlan:"明日碾压",issueNotes:"雨后湿滑",issuePriority:null,status:"submitted",updatedAt:unload}];const r=aggregateSiteFacts(f),json=JSON.stringify(r);expect(json).not.toMatch(/calculatedAmount|actualDistanceKm|routeSnapshot|SECRET_MONEY|DO_NOT_EXPOSE|789123|13812345678|300元|token=ABC/);expect(r.construction.reports[0].issuePriority).toBe("ungraded");expect(r.construction.reports[0].issueResolution).toBe("not_tracked");expect(safeSiteText("金额:8888元")).not.toContain("8888");});
});
describe("legacy risk special-closure regression",()=>{
  it.each(["nfcSingleScanClosed","unloadOnlyCardClose"])("%s不会误报周期/并行/夜间",flag=>{const t:any={...fixture().trips[0],routeSnapshot:{[flag]:true},startAt:load,endAt:load};const rule:any={enabled:true,maxTransportSpeedKmh:80,maxTransportDurationMinutes:360};expect(detectTransportRisk(t,rule)).toEqual([]);expect(detectTransportIntegrityRisks([t,{...t,id:2}])).toEqual([]);});
  it("draft/void不扫描",()=>{const t:any=fixture().trips[0];expect(detectTransportIntegrityRisks([{...t,status:"draft"},{...t,status:"void"}])).toEqual([]);});
});
describe("integrated natural dates and money-free metric details", () => {
  it.each([constructionDailyReports.reportDate, projectRiskAlerts.businessDate])("DATE绑定字符串不被mysql2 +08序列化成08点", column => {
    const dialect = new MySqlDialect(), date = "2026-11-23";
    const old = dialect.sqlToQuery(eq(column, new Date(`${date}T00:00:00Z`)));
    expect(format(old.sql, old.params, false, "+08:00")).toContain("2026-11-23 08:00:00");
    const fixed = dialect.sqlToQuery(siteDatePredicate(column, date));
    expect(fixed.params).toEqual([date]);
    expect(format(fixed.sql, fixed.params, false, "+08:00")).toContain("'2026-11-23'");
    expect(() => siteDatePredicate(column, "2026-11-31")).toThrow();
  });
  it.each(["load", "unload"])("rejected %s投影为核验事件，不能冒充卸土", eventType => {
    const f = fixture(); f.events.push({ ...f.events[1], id: 98, eventType: eventType as any, validationStatus: "rejected" });
    expect(aggregateSiteFacts(f).transport.events.find(e => e.eventId === 98)).toMatchObject({ type: "review", status: "rejected", normalCompletion: false });
  });
  it.each(["departures", "normalCompletions", "currentInTransitVehicles", "pendingReview", "specialClosures"] as const)("%s明细与统计共用同一事实，不含金额且不受50条限制", metric => {
    const f = fixture(), d = aggregateSiteFacts(f), details = aggregateSiteTransportDetails(f, metric);
    expect(metric === "currentInTransitVehicles" ? details.vehicleCount : details.count).toBe(d.transport[metric]);
    expect(JSON.stringify(details)).not.toMatch(/calculatedAmount|routeSnapshot|SECRET_MONEY|DO_NOT_EXPOSE|789123/);
    const base = f.trips[0]; f.events = [];
    f.trips = Array.from({ length: 1020 }, (_, i) => ({ ...base, id: i+1, startAt: unload, endAt: null, status: "submitted", loadConfirmedAt: null, unloadConfirmedAt: null, loadEventId: null, unloadEventId: null }));
    expect(aggregateSiteTransportDetails(f, "departures").count).toBe(1020);
  });
});
