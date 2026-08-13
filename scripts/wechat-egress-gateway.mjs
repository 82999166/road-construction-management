import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 8787);
const sharedSecret = String(process.env.WECHAT_EGRESS_SHARED_SECRET || "");
const allowedPrefixes = [
  "/cgi-bin/token",
  "/cgi-bin/message/template/send",
  "/cgi-bin/message/subscribe/bizsend",
  "/cgi-bin/template/get_all_private_template",
];
const maxBodyBytes = 512 * 1024;

if (sharedSecret.length < 32) {
  throw new Error("WECHAT_EGRESS_SHARED_SECRET must contain at least 32 characters");
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function secureEquals(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") return json(response, 200, { ok: true });
  if (request.method !== "POST" || request.url !== "/v1/wechat") return json(response, 404, { error: "not_found" });
  try {
    const raw = await readBody(request);
    const timestamp = String(request.headers["x-egress-timestamp"] || "");
    const signature = String(request.headers["x-egress-signature"] || "");
    const timestampValue = Number(timestamp);
    if (!Number.isFinite(timestampValue) || Math.abs(Date.now() - timestampValue) > 5 * 60 * 1000) return json(response, 401, { error: "expired_request" });
    const expected = createHmac("sha256", sharedSecret).update(`${timestamp}.${raw}`).digest("hex");
    if (!secureEquals(signature, expected)) return json(response, 401, { error: "invalid_signature" });
    const payload = JSON.parse(raw);
    if (!payload || !["GET", "POST"].includes(payload.method) || typeof payload.path !== "string" || (payload.body !== null && typeof payload.body !== "string")) return json(response, 400, { error: "invalid_payload" });
    if (!payload.path.startsWith("/") || !allowedPrefixes.some(prefix => payload.path.startsWith(prefix))) return json(response, 403, { error: "upstream_not_allowed" });
    const upstream = await fetch(`https://api.weixin.qq.com${payload.path}`, {
      method: payload.method,
      redirect: "error",
      headers: payload.method === "POST" ? { "content-type": "application/json" } : undefined,
      body: payload.method === "POST" ? payload.body : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const responseBody = await upstream.text();
    // 日志仅保留结果类别，不记录微信路径、令牌、OpenID、正文或签名。
    console.info(JSON.stringify({ event: "wechat_egress", status: upstream.status }));
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(responseBody);
  } catch (error) {
    const code = error instanceof Error && error.message === "payload_too_large" ? "payload_too_large" : "request_failed";
    console.warn(JSON.stringify({ event: "wechat_egress_error", code }));
    json(response, code === "payload_too_large" ? 413 : 502, { error: code });
  }
});

server.listen(port, "127.0.0.1", () => console.info(JSON.stringify({ event: "wechat_egress_started", port })));
