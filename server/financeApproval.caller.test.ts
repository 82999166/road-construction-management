import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import * as schema from "../drizzle/schema";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mock = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
vi.mock("./services/businessNotifier", () => ({ notifyOfficialAccountBusinessEventSafely: async () => {} }));
vi.mock("./services/officialAccountDriverBinding", () => ({ sendOfficialAccountDriverNotification: async () => {} }));
vi.mock("./services/transportRisk", () => ({ triggerTransportRiskScan: async () => {} }));
vi.mock("./storage", () => ({ storageGetSignedUrl: async () => { throw new Error("禁止存储网络访问"); }, storagePut: async () => { throw new Error("禁止存储网络访问"); } }));
import { router } from "./_core/trpc";
import { settlementPaymentRouter } from "./routers/settlementPayments";
const api = router({ settlementPayment: settlementPaymentRouter });
const time = new Date("2026-11-01T00:00:00Z");
const normalize = (v: any): any => v instanceof Date ? v.toISOString().slice(0,23).replace("T"," ") : typeof v === "boolean" ? Number(v) : v && typeof v === "object" ? JSON.stringify(v) : v ?? null;
/** Real access.ts + protectedProcedure + original routers; SQL JOIN/WHERE/CAS evaluated by SQLite. No production DB/network. */
class Fixture {
  rows: Record<string, any[]> = {};
  reads: string[] = [];
  writes: string[] = [];
  zeroWriteTable?: string;
  private gate = Promise.resolve();
  select(projection?: any) { return { from: (table: any) => this.query(table,projection) }; }
  private evaluate(table: any, joins: Array<{table:any;on:SQL;kind:string}>, condition?: SQL) {
    const tables = [table,...joins.map(j=>j.table)];
    const sqlDb = new DatabaseSync(":memory:");
    const dialect = new MySqlDialect();
    try {
      for (const t of tables) {
        const name = getTableName(t), rows = this.rows[name] ?? [];
        const columns = [...new Set([...Object.values(getTableColumns(t)).map((c:any)=>c.name),...rows.flatMap(row=>Object.keys(row))])];
        sqlDb.exec(`CREATE TABLE \`${name}\` (__idx INTEGER, ${columns.map(c=>`\`${c}\``).join(",")})`);
        const insert = sqlDb.prepare(`INSERT INTO \`${name}\` VALUES (${[0,...columns].map(()=>"?").join(",")})`);
        rows.forEach((row,i)=>insert.run(i,...columns.map(c=>normalize(row[c]))));
      }
      const params:any[] = [];
      let text = `SELECT ${tables.map((t,i)=>`\`${getTableName(t)}\`.__idx AS i${i}`).join(",")} FROM \`${getTableName(table)}\``;
      for (const join of joins) { const q = dialect.sqlToQuery(join.on); text += ` ${join.kind} JOIN \`${getTableName(join.table)}\` ON ${q.sql}`; params.push(...q.params); }
      if (condition) { const q = dialect.sqlToQuery(condition); text += ` WHERE ${q.sql}`; params.push(...q.params); }
      return sqlDb.prepare(text).all(...params.map(normalize)).map((record:any)=>({record,tables}));
    } finally { sqlDb.close(); }
  }
  private query(table:any,projection?:any) {
    let condition:SQL|undefined, limit:number|undefined;
    const joins:Array<{table:any;on:SQL;kind:string}> = [];
    const chain:any = {
      where:(q:SQL)=>{condition=q;return chain;},
      innerJoin:(t:any,on:SQL)=>{joins.push({table:t,on,kind:"INNER"});return chain;},
      leftJoin:(t:any,on:SQL)=>{joins.push({table:t,on,kind:"LEFT"});return chain;},
      orderBy:()=>chain,
      limit:(n:number)=>{limit=n;return chain;},
      for:()=>chain,
      then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
        this.reads.push(getTableName(table));
        const matches=this.evaluate(table,joins,condition);
        return (limit ? matches.slice(0,limit) : matches).map(({record,tables})=> {
          if (!projection) return structuredClone(this.rows[getTableName(table)]?.[record.i0]);
          return Object.fromEntries(Object.entries(projection).map(([key,c]:any)=>{
            const index=tables.findIndex(t=>getTableName(t)===getTableName(c.table));
            return [key,structuredClone(this.rows[getTableName(c.table)]?.[record[`i${index}`]]?.[c.name] ?? null)];
          }));
        });
      }).then(resolve,reject),
    };
    return chain;
  }
  update(table:any) { return {set:(values:any)=>({where:async(q:SQL)=>{
    const name=getTableName(table);
    this.writes.push(name);
    const matches=this.zeroWriteTable === name ? [] : this.evaluate(table,[],q);
    for (const {record} of matches) Object.assign(this.rows[name][record.i0],values);
    return [{affectedRows:matches.length}];
  }})}; }
  insert(table:any) {return {values:async(data:any)=>{
    const name=getTableName(table);this.writes.push(name);
    const rows=this.rows[name]??=[];
    for (const v of Array.isArray(data)?data:[data]) rows.push({id:rows.length+1,...v});
    return [{insertId:rows.length}];
  }};}
  async transaction<T>(fn:(tx:Fixture)=>Promise<T>) {
    const previous=this.gate;let release!:()=>void;this.gate=new Promise(resolve=>{release=resolve;});await previous;
    const before=structuredClone(this.rows);
    try {return await fn(this);} catch(error){this.rows=before;throw error;} finally {release();}
  }
}
function ctx(role:"admin"|"user"="user",extra={}) {return {user:{id:7,openId:"finance-test",name:"财务测试",role,loginMethod:"manus",createdAt:time,updatedAt:time,lastSignedIn:time,...extra},req:{headers:{"user-agent":"Mozilla/5.0"}},res:{}} as TrpcContext;}
function grant(db:Fixture,roleCode="ACCOUNTANT",actions=["manage"],projectId:number|null=1,organizationId:number|null=null) {
  db.rows.system_roles=[{id:1,code:roleCode,status:"active"}];
  db.rows.user_role_assignments=[{id:1,userId:7,roleId:1,projectId,organizationId,status:"active",validFrom:null,validTo:null}];
  db.rows.system_permissions=[];db.rows.role_permissions=[];db.rows.user_permissions=[];
  for (const module of ["finance","transport","machinery","labor","measurement"]) for (const action of actions) {
    const id=db.rows.system_permissions.length+1;
    db.rows.system_permissions.push({id,module,action});db.rows.role_permissions.push({roleId:1,permissionId:id});
    if(module === "machinery") db.rows.user_permissions.push({userId:7,permissionId:id});
  }
}
function seed(db:Fixture) {
  db.rows.projects=[{id:1,status:"active",organizationId:10},{id:2,status:"active",organizationId:10},{id:3,status:"active",organizationId:20}];
  db.rows.organizations=[{id:10,name:"财务部",type:"department",status:"active"},{id:20,name:"其他部门",type:"department",status:"active"}];
  db.rows.department_business_scopes=[];
  db.rows.transport_vehicles=[{id:1,projectId:1,plateNo:"测试车"}];
  db.rows.labor_workers=[{id:1,projectId:1,realName:"测试人员",bankAccountEncrypted:"SECRET_CIPHER",identityNoEncrypted:"SECRET_ID"}];
  const base={id:1,projectId:1,submittedBy:8,submittedAt:time,createdAt:time,updatedAt:time,payeeName:"测试收款人",payeeAccount:"SECRET_BANK",paymentReference:"SECRET_PAYMENT",invoiceEvidenceId:999};
  db.rows.transport_vehicle_settlements=[{...base,vehicleId:1,settlementNo:"V-1",status:"submitted",periodStart:time,periodEnd:time,tripCount:0,totalVolumeCubicMeters:"0",grossFreightAmount:"100",fuelDeductionAmount:"0",assetDeductionAmount:"0",carryForwardDeductionAmount:"0",netPayableAmount:"100",settlementKind:"adjustment",basisDescription:null}];
  db.rows.machine_payment_settlements=[{...base,machineId:1,monthlyStatementId:1,settlementNo:"M-1",status:"submitted",period:"2026-11",grossPayableAmount:"100",manualDeductionAmount:"0",netPayableAmount:"100",fuelCostAmount:"30",repairCostAmount:"20"}];
  db.rows.payroll_statements=[{...base,workerId:1,status:"reviewing",period:"2026-11",payableAmount:"100",deductionAmount:"0",actualAmount:"100"}];
  db.rows.temporary_daily_wage_settlements=[{...base,workerId:1,status:"reviewing",settlementDate:time,payableAmount:"100",deductionAmount:"0",actualAmount:"100"}];
  db.rows.subcontract_payment_settlements=[{...base,settlementNo:"S-1",status:"submitted",packageNoSnapshot:"PKG-1",workItemSnapshot:"路基",quantitySnapshot:"1",unitSnapshot:"项",grossPayableAmount:"100",manualDeductionAmount:"0",netPayableAmount:"100",invoiceStatus:"missing"}];
  grant(db);
}
let db:Fixture;
beforeEach(()=>{db=new Fixture();seed(db);mock.db=db;});
const caller=(context=ctx())=>api.createCaller(context).settlementPayment;
const pending=()=>caller().approvalQueue({projectId:1});
const payload=(row:any)=>({projectId:1,settlementType:row.sourceType,settlementId:row.settlementId,expectedFingerprint:row.fingerprint});
const tableByType:Record<string,string>={transport_vehicle:"transport_vehicle_settlements",machine:"machine_payment_settlements",payroll:"payroll_statements",daily_wage:"temporary_daily_wage_settlements",subcontract:"subcontract_payment_settlements"};
describe("财务审核中心真实caller（真实access/原业务状态机）",()=>{
  it("匿名、司机和禁用/删除本地账号不能读取，禁用账户在DB读取前拒绝",async()=>{
    for(const context of [{...ctx(),user:null},ctx("user",{loginMethod:"local_driver",localAccountStatus:"active"}),ctx("user",{loginMethod:"local_manager",localAccountStatus:"disabled"}),ctx("user",{loginMethod:"deleted_local_manager"})]) {
      db.reads=[];await expect(caller(context).approvalSummary({})).rejects.toMatchObject({code:context.user?"FORBIDDEN":"UNAUTHORIZED"});expect(db.reads).toEqual([]);
    }
  });
  it("普通管理员无财务岗位拒绝；财务read撤权即拒绝summary/queue",async()=>{
    grant(db,"PROJECT_MANAGER");await expect(caller().approvalQueue({projectId:1})).rejects.toMatchObject({code:"FORBIDDEN"});
    grant(db,"ACCOUNTANT",["review","settle"]);await expect(caller().approvalSummary({})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("空input仅聚合独立财务项目，不混用其他部门项目，范围外queue拒绝",async()=>{
    db.rows.payroll_statements.push({...db.rows.payroll_statements[0],id:2,projectId:2});
    db.rows.user_role_assignments.push({id:2,userId:7,roleId:2,projectId:2,organizationId:null,status:"active",validFrom:null,validTo:null});
    db.rows.system_roles.push({id:2,code:"LABOR_MANAGER",status:"active"});
    const s=await caller().approvalSummary({});expect(s).toMatchObject({scope:"all_accessible_finance_projects",count:5,pendingCount:5,approvableCount:5});expect(Object.keys(s).sort()).toEqual(["approvableCount","byType","count","pendingCount","scope"].sort());
    await expect(caller().approvalQueue({projectId:2})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("组织财务范围只包含直属项目，项目撤权立即生效",async()=>{
    grant(db,"ACCOUNTANT",["manage"],null,10);
    for(const module of ["FINANCE","LABOR","TRANSPORT","MACHINERY","MEASUREMENT"])db.rows.department_business_scopes.push({organizationId:10,projectId:null,module,status:"active"});
    db.rows.payroll_statements.push({...db.rows.payroll_statements[0],id:2,projectId:2},{...db.rows.payroll_statements[0],id:3,projectId:3});
    expect((await caller().approvalSummary({})).pendingCount).toBe(6);
    await expect(caller().approvalQueue({projectId:3})).rejects.toMatchObject({code:"FORBIDDEN"});
    db.rows.user_role_assignments[0].status="revoked";await expect(caller().approvalSummary({})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("草稿不入队；五类零/负净额依然计数；DTO不返回账户凭证密文和路径",async()=>{
    for(const [type,table] of Object.entries(tableByType)) {
      const row=db.rows[table][0];db.rows[table].push({...row,id:2,status:"draft"});
      if(type === "transport_vehicle"){row.netPayableAmount="-100";row.fuelDeductionAmount="200";}else if(type === "payroll"||type === "daily_wage"){row.actualAmount="0";row.deductionAmount="100";}else {row.netPayableAmount="0";row.manualDeductionAmount="100";}
    }
    const q=await pending();expect(q.rows).toHaveLength(5);expect(q.rows.find(r=>r.sourceType === "transport_vehicle")?.netAmount).toBe(-100);
    const serialized=JSON.stringify(q);for(const secret of ["SECRET_BANK","SECRET_CIPHER","SECRET_ID","SECRET_PAYMENT","invoiceEvidenceId","payeeAccount","bankAccount","paymentReference","fileKey","evidenceUrl"])expect(serialized).not.toContain(secret);
    expect((await caller().approvalSummary({})).pendingCount).toBe(5);
    expect((await caller().approvalQueue({projectId:1,sourceTypes:["machine"],keyword:"M-1"})).rows).toHaveLength(1);
  });
  it("无原运输/机械部门权限可只读且canApprove=false，不借财务菜单增加权限",async()=>{
    db.rows.role_permissions=db.rows.role_permissions.filter(p=>db.rows.system_permissions.find(x=>x.id===p.permissionId)?.module === "finance");db.rows.user_permissions=[];
    const q=await pending();expect(q.rows).toHaveLength(5);expect(q.rows.filter(r=>["transport_vehicle","machine"].includes(r.sourceType)).every(r=>!r.canApprove)).toBe(true);
    expect((await caller().approvalSummary({})).approvableCount).toBe(0);
    await expect(caller().approve(payload(q.rows[0]))).rejects.toMatchObject({code:"FORBIDDEN"});expect(db.writes).toEqual([]);
  });
  it("工资FINANCE_MANAGER不能审核；原分包提交人职责分离保持",async()=>{
    grant(db,"FINANCE_MANAGER");db.rows.subcontract_payment_settlements[0].submittedBy=7;
    const q=await pending();expect(q.rows.find(r=>r.sourceType === "payroll")?.canApprove).toBe(false);expect(q.rows.find(r=>r.sourceType === "subcontract")?.canApprove).toBe(false);
  });
  it.each(Object.keys(tableByType))("%s审核通过由原动作迁移，重复拒绝，不自动付款",async type=>{
    const row=(await pending()).rows.find(r=>r.sourceType===type)!;expect(row.canApprove).toBe(true);
    await expect(caller().approve(payload(row))).resolves.toEqual({success:true});
    expect(db.rows[tableByType[type]][0].status).toBe("approved");
    expect(db.rows.audit_logs?.some(r=>r.module !== "finance" || r.action.includes("approve"))).toBe(true);
    await expect(caller().approve(payload(row))).rejects.toMatchObject({code:"CONFLICT"});
    expect(db.rows.settlement_payment_records ?? []).toEqual([]);expect(db.rows.financial_records ?? []).toEqual([]);
  });
  it.each([[-100,"receivable"],[0,"offset"]])("车辆净额%s严格由原状态机变为%s",async(net,next)=>{
    const raw=db.rows.transport_vehicle_settlements[0];raw.netPayableAmount=String(net);raw.fuelDeductionAmount=String(100-net);
    const row=(await pending()).rows.find(r=>r.sourceType === "transport_vehicle")!;await caller().approve(payload(row));expect(raw.status).toBe(next);
  });
  it.each(Object.keys(tableByType))("%s展示后的金额变更拒绝，未发生写入",async type=>{
    const row=(await pending()).rows.find(r=>r.sourceType===type)!;const raw=db.rows[tableByType[type]][0];
    if(type === "payroll"||type === "daily_wage")raw.actualAmount="99";else raw.netPayableAmount="99";
    await expect(caller().approve(payload(row))).rejects.toMatchObject({code:"CONFLICT"});expect(db.writes).toEqual([]);
  });
  it("原工资与机械CAS失败传播为CONFLICT，不误报成功；运输闭环验证未被绕过",async()=>{
    let row=(await pending()).rows.find(r=>r.sourceType === "payroll")!;db.zeroWriteTable="payroll_statements";await expect(caller().approve(payload(row))).rejects.toMatchObject({code:"CONFLICT"});
    row=(await pending()).rows.find(r=>r.sourceType === "machine")!;db.zeroWriteTable="machine_payment_settlements";await expect(caller().approve(payload(row))).rejects.toMatchObject({code:"CONFLICT"});
    db.zeroWriteTable=undefined;db.rows.transport_vehicle_settlement_items=[{id:1,settlementId:1,tripId:99,netPayableAmount:"100",fuelDeductionAmount:"0"}];row=(await pending()).rows.find(r=>r.sourceType === "transport_vehicle")!;
    await expect(caller().approve(payload(row))).rejects.toMatchObject({code:"CONFLICT"});expect(db.rows.transport_vehicle_settlements[0].status).toBe("submitted");
  });
  it("只授read/review没有原通用守卫settle时canApprove准确为false；无详细授权不放行高影响动作",async()=>{
    grant(db,"ACCOUNTANT",["read","review"]);expect((await pending()).rows.every(r=>!r.canApprove)).toBe(true);
    grant(db,"ACCOUNTANT",[]);expect((await pending()).rows.every(r=>!r.canApprove)).toBe(true);
  });
  it("数据库不可用或权限查询故障明确抛错，不返回假0",async()=>{
    mock.db=null;await expect(caller(ctx("admin")).approvalSummary({})).rejects.toMatchObject({code:"INTERNAL_SERVER_ERROR"});await expect(caller().approvalSummary({})).rejects.toMatchObject({code:"INTERNAL_SERVER_ERROR"});
  });
});
