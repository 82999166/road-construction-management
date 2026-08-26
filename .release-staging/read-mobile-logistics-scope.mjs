#!/usr/bin/env bash
set -euo pipefail

username="${1:-}"
if [[ ! "$username" =~ ^[0-9]{6,32}$ ]]; then
  echo '{"matched":false,"reason":"账号标识格式不符合只读诊断要求"}'
  exit 0
fi

pid="$(systemctl show yx-cloud-management -p MainPID --value)"
if [[ ! "$pid" =~ ^[0-9]+$ ]] || [[ "$pid" == "0" ]]; then
  echo '{"matched":false,"reason":"正式应用服务未运行"}'
  exit 0
fi

config="$(mktemp /root/yx-scope-client.XXXXXX.cnf)"
trap 'rm -f "$config"' EXIT
chmod 600 "$config"

node - "$pid" "$config" <<'NODE'
const fs = require('node:fs');
const [pid, configPath] = process.argv.slice(2);
const entries = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
const raw = entries.find(value => value.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length);
if (!raw) throw new Error('正式应用未提供数据库连接');
const url = new URL(raw);
fs.writeFileSync(configPath, `[client]\nhost=${url.hostname}\nport=${url.port || 3306}\nuser=${decodeURIComponent(url.username)}\npassword=${decodeURIComponent(url.password)}\ndatabase=${decodeURIComponent(url.pathname.slice(1))}\n`, { mode: 0o600 });
NODE

mysql_cmd=(mysql "--defaults-extra-file=$config" --batch --skip-column-names)
user_id="$(${mysql_cmd[@]} -e "SELECT id FROM users WHERE localUsername = '${username}' LIMIT 1")"
if [[ -z "$user_id" ]]; then
  echo '{"matched":false,"reason":"未找到对应本地管理账号"}'
  exit 0
fi

account_active="$(${mysql_cmd[@]} -e "SELECT IF(localAccountStatus='active','true','false') FROM users WHERE id=${user_id}")"
assignments="$(${mysql_cmd[@]} -e "SELECT CONCAT(r.code,':',ura.status,':project=',IF(ura.projectId IS NULL,'0','1'),':organization=',IF(ura.organizationId IS NULL,'0','1'),':valid=',IF((ura.validFrom IS NULL OR ura.validFrom<=NOW()) AND (ura.validTo IS NULL OR ura.validTo>NOW()),'1','0')) FROM user_role_assignments ura JOIN system_roles r ON r.id=ura.roleId WHERE ura.userId=${user_id} ORDER BY r.code" | paste -sd ',' -)"
project_scope_status="$(${mysql_cmd[@]} -e "SELECT CONCAT('active=',SUM(p.status='active'),',archived=',SUM(p.status='archived'),',other=',SUM(p.status NOT IN ('active','archived'))) FROM user_role_assignments ura JOIN projects p ON p.id=ura.projectId WHERE ura.userId=${user_id} AND ura.status='active'" | tr -d '\n')"
department_scope="$(${mysql_cmd[@]} -e "SELECT COUNT(*) FROM user_role_assignments ura JOIN organizations o ON o.id=ura.organizationId JOIN department_business_scopes dbs ON dbs.organizationId=o.id WHERE ura.userId=${user_id} AND ura.status='active' AND o.status='active' AND dbs.status='active' AND dbs.module='PURCHASING'")"
role_actions="$(${mysql_cmd[@]} -e "SELECT DISTINCT sp.action FROM user_role_assignments ura JOIN role_permissions rp ON rp.roleId=ura.roleId JOIN system_permissions sp ON sp.id=rp.permissionId WHERE ura.userId=${user_id} AND ura.status='active' AND sp.module='purchase' ORDER BY sp.action" | paste -sd ',' -)"
user_actions="$(${mysql_cmd[@]} -e "SELECT DISTINCT sp.action FROM user_permissions up JOIN system_permissions sp ON sp.id=up.permissionId WHERE up.userId=${user_id} AND sp.module='purchase' ORDER BY sp.action" | paste -sd ',' -)"

printf '{"matched":true,"accountActive":%s,"assignments":"%s","projectScopeStatus":"%s","purchasingDepartmentScopeCount":%s,"rolePurchaseActions":"%s","userPurchaseActions":"%s"}\n' "${account_active:-false}" "${assignments:-}" "${project_scope_status:-active=0,archived=0,other=0}" "${department_scope:-0}" "${role_actions:-}" "${user_actions:-}"
