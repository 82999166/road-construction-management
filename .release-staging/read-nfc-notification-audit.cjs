const fs = require('node:fs');
const mysql = require('mysql2/promise');

function parseRuntimeConfig(path) {
  const values = {};
  for (const rawLine of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function main() {
  const config = parseRuntimeConfig('/opt/yx-cloud-management/shared/runtime.conf');
  if (!config.DATABASE_URL) throw new Error('未发现数据库运行配置');
  const url = new URL(config.DATABASE_URL);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  });
  try {
    const [transportAudit] = await connection.query(`
      SELECT action, COUNT(*) AS total, MAX(createdAt) AS latestAt
      FROM audit_logs
      WHERE module = 'transport' AND createdAt >= DATE_SUB(NOW(), INTERVAL 45 MINUTE)
      GROUP BY action ORDER BY latestAt DESC
    `);
    const [notificationSummary] = await connection.query(`
      SELECT eventCode, channel, status, COALESCE(failureCode, '') AS failureCode,
             COUNT(*) AS total, MAX(createdAt) AS latestAt
      FROM notification_records
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 45 MINUTE)
      GROUP BY eventCode, channel, status, failureCode
      ORDER BY latestAt DESC
    `);
    console.log(JSON.stringify({
      windowMinutes: 45,
      transportAudit,
      notificationSummary,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`审计查询失败：${error instanceof Error ? error.message : '未知错误'}`);
  process.exitCode = 1;
});
