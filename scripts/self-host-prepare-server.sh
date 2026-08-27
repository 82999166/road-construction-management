#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/yx-cloud-management"
DB_NAME="yx_cloud_management"
DB_USER="yx_app"

echo "[yx] preparing base directories"
mkdir -p "$APP_ROOT"/{app,releases,shared,backups,scripts,logs,storage}
chmod 700 "$APP_ROOT/shared" "$APP_ROOT/backups" "$APP_ROOT/storage"

echo "[yx] ensuring swap for stable builds/runtime"
if ! swapon --show | awk 'NR>1 {found=1} END {exit found?0:1}'; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[yx] generating durable database password if absent"
if [ ! -f "$APP_ROOT/shared/db-password" ]; then
  openssl rand -base64 36 | tr -d '\n' > "$APP_ROOT/shared/db-password"
  chmod 600 "$APP_ROOT/shared/db-password"
fi

DB_PASS="$(cat "$APP_ROOT/shared/db-password")"
DB_PASS_SQL="${DB_PASS//\\/\\\\}"
DB_PASS_SQL="${DB_PASS_SQL//\'/\'\'}"

echo "[yx] creating isolated MySQL database and least-privilege user"
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS_SQL}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS_SQL}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

echo "[yx] writing local deployment facts"
cat > "$APP_ROOT/shared/deployment-facts.env" <<EOF
APP_ROOT=$APP_ROOT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
APP_PORT=18080
STORAGE_DIR=$APP_ROOT/storage
EOF
chmod 600 "$APP_ROOT/shared/deployment-facts.env"

echo "[yx] enabling base services"
systemctl enable --now mysql >/dev/null 2>&1 || systemctl enable --now mysqld >/dev/null 2>&1 || true
systemctl enable --now nginx >/dev/null 2>&1 || true

echo "[yx] preparation complete"
printf 'swap=%s\n' "$(swapon --show --noheadings | wc -l)"
printf 'mysql=%s\n' "$(systemctl is-active mysql 2>/dev/null || systemctl is-active mysqld 2>/dev/null || true)"
printf 'nginx=%s\n' "$(systemctl is-active nginx 2>/dev/null || true)"
