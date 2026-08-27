import { spawnSync } from "node:child_process";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpmCommand, ["audit", "--prod", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (!result.stdout?.trim()) {
  console.error("生产依赖审计未返回可解析结果。", result.stderr?.trim() || "");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("生产依赖审计结果格式异常，已拒绝继续发布。");
  process.exit(1);
}

const vulnerabilities = report.metadata?.vulnerabilities ?? {};
const high = Number(vulnerabilities.high ?? 0);
const critical = Number(vulnerabilities.critical ?? 0);
console.log(`生产依赖审计：critical=${critical}，high=${high}，moderate=${Number(vulnerabilities.moderate ?? 0)}，low=${Number(vulnerabilities.low ?? 0)}。`);

if (critical > 0 || high > 0) {
  console.error("发现高危或严重生产依赖公告，已拒绝通过发布门禁。");
  process.exit(1);
}
