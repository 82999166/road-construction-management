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
  return {
    code: error?.data?.code ?? error?.code ?? null,
    message: error?.message ?? "未知 tRPC 错误",
  };
}

async function requestQuery(path, input, cookie) {
  const encodedInput = encodeURIComponent(JSON.stringify({ json: input ?? null }));
  const response = await fetch(`${apiBaseUrl}/${path}?input=${encodedInput}`, {
    headers: cookie ? { cookie } : undefined,
  });
  const payload = await response.json();
  if (payload?.error) return { ok: false, error: getPayloadError(payload), status: response.status };
  return { ok: true, data: getPayloadData(payload), status: response.status };
}

async function requestMutation(path, input, cookie) {
  const response = await fetch(`${apiBaseUrl}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ json: input }),
  });
  const payload = await response.json();
  const setCookieHeaders = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  if (payload?.error) return { ok: false, error: getPayloadError(payload), status: response.status, setCookieHeaders };
  return { ok: true, data: getPayloadData(payload), status: response.status, setCookieHeaders };
}

const credentials = JSON.parse(await readFile(credentialPath, "utf8"));
const login = await requestMutation("auth.localManagerLogin", { username: credentials.username, password: credentials.password });
assert(login.ok, `测试普通管理人员登录失败：${login.error?.code ?? "未知错误"}`);
const cookie = login.setCookieHeaders[0]?.split(";")[0];
assert(cookie, "测试普通管理人员登录未返回会话 Cookie");

const workbench = await requestQuery("mobile.workbench", null, cookie);
assert(workbench.ok, `移动工作台查询失败：${workbench.error?.code ?? "未知错误"}`);
const menuCodes = workbench.data.menus.map(menu => menu.code);
assert(menuCodes.includes("LABOR"), "已授权的劳务菜单未显示");
for (const forbiddenMenu of ["CONSTRUCTION", "MACHINERY", "TRANSPORT", "FINANCE", "PURCHASING", "MEASUREMENT"]) {
  assert(!menuCodes.includes(forbiddenMenu), `未授权菜单意外显示：${forbiddenMenu}`);
}
assert(workbench.data.dataScope.projectIds.includes(credentials.authorizedProjectId), "已授权项目未出现在服务端数据范围中");
assert(!workbench.data.dataScope.projectIds.includes(credentials.outsideProjectId), "未授权项目意外出现在服务端数据范围中");

const projectOptions = await requestQuery("labor.projectOptions", null, cookie);
assert(projectOptions.ok, `劳务项目选项查询失败：${projectOptions.error?.code ?? "未知错误"}`);
assert(projectOptions.data.some(project => project.id === credentials.authorizedProjectId), "劳务项目选项未返回已授权测试项目");
assert(!projectOptions.data.some(project => project.id === credentials.outsideProjectId), "劳务项目选项返回了未授权项目");

const workers = await requestQuery("labor.listWorkers", { projectId: credentials.authorizedProjectId, includeLeft: true }, cookie);
assert(workers.ok, `已授权项目劳务人员查询失败：${workers.error?.code ?? "未知错误"}`);
assert(workers.data.some(worker => worker.id === credentials.authorizedWorkerId), "已授权项目未返回测试劳务人员");
assert(workers.data.every(worker => !("identityNoEncrypted" in worker || "phoneEncrypted" in worker || "bankAccountEncrypted" in worker)), "劳务人员响应包含了敏感密文字段");

const attendance = await requestQuery("labor.attendance.list", { projectId: credentials.authorizedProjectId }, cookie);
assert(attendance.ok, `已授权项目考勤查询失败：${attendance.error?.code ?? "未知错误"}`);
assert(attendance.data.length >= 3, "已授权项目未返回预期的测试考勤样本");

const payroll = await requestQuery("labor.payroll.list", { projectId: credentials.authorizedProjectId, period: credentials.payrollPeriod }, cookie);
assert(payroll.ok, `已授权项目工资条查询失败：${payroll.error?.code ?? "未知错误"}`);
assert(payroll.data.some(statement => statement.id === credentials.authorizedPayrollId), "已授权项目未返回测试工资条");
assert(payroll.data.every(statement => statement.paymentReference === null), "劳资管理员意外获得付款凭证字段");

const summary = await requestQuery("labor.summary", { projectId: credentials.authorizedProjectId, period: credentials.payrollPeriod }, cookie);
assert(summary.ok, `劳务工资统计查询失败：${summary.error?.code ?? "未知错误"}`);
assert(summary.data.totalWorkers >= 1 && summary.data.attendanceDays >= 3 && summary.data.actualAmount > 0, "劳务统计未汇总测试人员、考勤和工资样本");

const outsideWorkers = await requestQuery("labor.listWorkers", { projectId: credentials.outsideProjectId, includeLeft: true }, cookie);
assert(!outsideWorkers.ok && outsideWorkers.error.code === "FORBIDDEN", "未授权项目的劳务人员查询未被服务端拒绝");

const approval = await requestMutation("labor.payroll.approve", { id: credentials.authorizedPayrollId, decision: "approved" }, cookie);
assert(!approval.ok && approval.error.code === "FORBIDDEN", "普通劳资管理员意外获准执行工资审核操作");

console.log(JSON.stringify({
  passed: true,
  username: credentials.username,
  authorizedProjectId: credentials.authorizedProjectId,
  outsideProjectId: credentials.outsideProjectId,
  menuCodes,
  workerCount: workers.data.length,
  attendanceCount: attendance.data.length,
  payrollCount: payroll.data.length,
  summary: { totalWorkers: summary.data.totalWorkers, attendanceDays: summary.data.attendanceDays, actualAmount: summary.data.actualAmount },
  verifiedAt: new Date().toISOString(),
}, null, 2));
