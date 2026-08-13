import { getOfficialAccountAccessToken, loadPublishedOfficialAccountCredentials } from "../server/services/officialAccountNotifier.ts";

const credentialResult = await loadPublishedOfficialAccountCredentials();
if (!credentialResult.config) throw new Error(`服务号凭据不可用：${credentialResult.reason ?? "unknown"}`);

const token = await getOfficialAccountAccessToken(credentialResult.config);
const endpoints = [
  "https://api.weixin.qq.com/cgi-bin/template/get_all_private_template",
  "https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate",
];

const results = [];
for (const endpoint of endpoints) {
  const response = await fetch(`${endpoint}?access_token=${encodeURIComponent(token)}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000) });
  const payload = await response.json().catch(() => null);
  results.push({ endpoint: new URL(endpoint).pathname, httpStatus: response.status, errcode: payload?.errcode ?? null, templateIds: (payload?.template_list ?? payload?.data ?? []).map(item => item?.template_id).filter(Boolean), titles: (payload?.template_list ?? payload?.data ?? []).map(item => item?.title).filter(Boolean) });
}

console.log(JSON.stringify(results, null, 2));
