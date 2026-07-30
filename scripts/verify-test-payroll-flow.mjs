import { readFile } from "node:fs/promises";

const credentialPath = "/home/ubuntu/.road-construction-management-test-acceptance.json";
const apiBaseUrl = "http://localhost:3000/api/trpc";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getPayloadData(payload) {
  return payload?.result?.data?.json ?? payload?.result?.data ?? null;
}

function getPayloadError(payload) {
  const error = payload?.error?.json ?? payload?.error ?? null;
  return { code: error?.data?.code ?? error?.code ?? null, message: error?.message ?? "未知 tRPC 错误" };
}

async function query(path, input, cookie) {
  const response = await fetch(`${apiBaseUrl}/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`, {
    headers: { cookie },
  });
  const payload = await response.json();
  return payload?.error
    ? { ok: false, status: response.status, error: getPayloadError(payload) }
    : { ok: true, status: response.status, data: getPayloadData(payload) };
}

async function mutation(path, input, cookie) {
  const response = await fetch(`${apiBaseUrl}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ json: input }),
  });
  const payload = await response.json();
  const setCookieHeaders = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return payload?.error
    ? { ok: false, status: response.status, error: getPayloadError(payload), setCookieHeaders }
    : { ok: true, status: response.status, data: getPayloadData(payload), setCookieHeaders };
}

async function login(actor) {
  const result = await mutation("auth.localManagerLogin", { username: actor.username, password: actor.password });
  assert(result.ok, `账号 ${actor.username} 登录失败：${result.error?.code ?? "未知错误"}`);
  const cookie = result.setCookieHeaders[0]?.split(";")[0];
  assert(cookie, `账号 ${actor.username} 未收到会话 Cookie`);
  return cookie;
}

async function ensureLaborMenu(actorName, cookie) {
  const workbench = await query("mobile.workbench", null, cookie);
  assert(workbench.ok, `${actorName} 移动工作台查询失败：${workbench.error?.code ?? "未知错误"}`);
  assert(workbench.data.menus.some(menu => menu.code === "LABOR"), `${actorName} 未获得劳务工资菜单`);
  assert(workbench.data.dataScope.projectIds.includes(credentials.authorizedProjectId), `${actorName} 未获得已授权测试项目范围`);
  assert(!workbench.data.dataScope.projectIds.includes(credentials.outsideProjectId), `${actorName} 意外获得未授权项目范围`);
  return workbench.data.menus.map(menu => menu.code);
}

const credentials = JSON.parse(await readFile(credentialPath, "utf8"));
assert(credentials.actors?.accountant && credentials.actors?.finance, "测试会计或财务负责人账号尚未生成");

const laborCookie = await login(credentials);
const accountantCookie = await login(credentials.actors.accountant);
const financeCookie = await login(credentials.actors.finance);
const laborMenus = await ensureLaborMenu("测试劳资管理员", laborCookie);
const accountantMenus = await ensureLaborMenu("测试工资会计", accountantCookie);
const financeMenus = await ensureLaborMenu("测试财务负责人", financeCookie);

const draftPayrolls = await query("labor.payroll.list", { projectId: credentials.authorizedProjectId, period: credentials.payrollPeriod }, laborCookie);
assert(draftPayrolls.ok, `工资草稿查询失败：${draftPayrolls.error?.code ?? "未知错误"}`);
assert(draftPayrolls.data.some(item => item.id === credentials.authorizedPayrollId && item.status === "draft"), "测试工资条未处于可提交草稿状态");

const laborApproval = await mutation("labor.payroll.approve", { id: credentials.authorizedPayrollId, decision: "approved" }, laborCookie);
assert(!laborApproval.ok && laborApproval.error.code === "FORBIDDEN", "劳资管理员意外获得工资审核权限");

const submit = await mutation("labor.payroll.submit", { id: credentials.authorizedPayrollId }, laborCookie);
assert(submit.ok && submit.data.status === undefined, `工资草稿提交失败：${submit.error?.code ?? "未知错误"} ${submit.error?.message ?? ""}`);

const reviewingPayrolls = await query("labor.payroll.list", { projectId: credentials.authorizedProjectId, period: credentials.payrollPeriod }, accountantCookie);
assert(reviewingPayrolls.ok, `会计工资条查询失败：${reviewingPayrolls.error?.code ?? "未知错误"}`);
assert(reviewingPayrolls.data.some(item => item.id === credentials.authorizedPayrollId && item.status === "reviewing"), "工资条提交后未进入会计审核状态");

const approve = await mutation("labor.payroll.approve", { id: credentials.authorizedPayrollId, decision: "approved" }, accountantCookie);
assert(approve.ok && approve.data.status === "approved", `会计审核失败：${approve.error?.code ?? "未知错误"}`);

const pay = await mutation("labor.payroll.pay", { id: credentials.authorizedPayrollId, paymentReference: `TEST-ACCEPT-${Date.now()}` }, financeCookie);
assert(pay.ok && pay.data.status === "paid", `财务发放确认失败：${pay.error?.code ?? "未知错误"}`);

const paidForLabor = await query("labor.payroll.list", { projectId: credentials.authorizedProjectId, period: credentials.payrollPeriod }, laborCookie);
assert(paidForLabor.ok, `劳资管理员已发放工资条查询失败：${paidForLabor.error?.code ?? "未知错误"}`);
const laborPayroll = paidForLabor.data.find(item => item.id === credentials.authorizedPayrollId);
assert(laborPayroll?.status === "paid", "劳资管理员未看到已发放状态");
assert(laborPayroll?.paymentReference === null, "劳资管理员意外读取到付款凭证");

const paidForAccountant = await query("labor.payroll.list", { projectId: credentials.authorizedProjectId, period: credentials.payrollPeriod }, accountantCookie);
assert(paidForAccountant.ok, `会计已发放工资条查询失败：${paidForAccountant.error?.code ?? "未知错误"}`);
assert(Boolean(paidForAccountant.data.find(item => item.id === credentials.authorizedPayrollId)?.paymentReference), "会计未读取到受控付款凭证引用");

const outsidePayrolls = await query("labor.payroll.list", { projectId: credentials.outsideProjectId, period: credentials.payrollPeriod }, financeCookie);
assert(!outsidePayrolls.ok && outsidePayrolls.error.code === "FORBIDDEN", "财务负责人未授权项目工资条查询未被服务端拒绝");

console.log(JSON.stringify({
  passed: true,
  authorizedProjectId: credentials.authorizedProjectId,
  outsideProjectId: credentials.outsideProjectId,
  authorizedPayrollId: credentials.authorizedPayrollId,
  laborMenus,
  accountantMenus,
  financeMenus,
  payrollFlow: ["draft", "reviewing", "approved", "paid"],
  verifiedAt: new Date().toISOString(),
}, null, 2));
