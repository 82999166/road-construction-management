#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/transport-route-config-top-entry.tar.gz"
EXPECTED_SHA256="dac1358a4a8efa20d6f96ddbf85b1777083ee89bb5d440ee9add1d8a5c1467fb"
RELEASE_DIR="$APP_ROOT/releases/release-202608260917-transport-route-config-top-entry"
NEXT_LINK="$APP_ROOT/current.next"
SERVICE="yx-cloud-management"

old_release="$(readlink -f "$CURRENT_LINK")"
switched=0

rollback() {
  local exit_code=$?
  if [[ "$switched" -eq 1 && -n "$old_release" && -d "$old_release" ]]; then
    ln -s "$old_release" "$NEXT_LINK"
    mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
    systemctl restart "$SERVICE" || true
  fi
  rm -f "$NEXT_LINK"
  exit "$exit_code"
}
trap rollback ERR

[[ -d "$old_release" ]]
[[ ! -e "$RELEASE_DIR" ]]
[[ -f "$ARCHIVE" ]]
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$EXPECTED_SHA256" ]]

mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"

[[ -s "$RELEASE_DIR/dist/index.cjs" ]]
[[ -f "$RELEASE_DIR/package.json" ]]
mkdir -p "$RELEASE_DIR/dist/public/assets"

# 保留已打开页面可能继续请求的旧分包，避免动态导入失败。
cp -an "$old_release/dist/public/assets/." "$RELEASE_DIR/dist/public/assets/"

# 本次修复必须包含固定线路配置区域的提示文本。
grep -Rql "正在加载装卸土点与运输路线配置" "$RELEASE_DIR/dist/public/assets"
grep -Rql "仅限超级管理员维护" "$RELEASE_DIR/dist/public/assets"

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1

systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
