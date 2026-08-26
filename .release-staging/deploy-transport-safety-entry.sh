#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/transport-safety-entry-fix.tar.gz"
EXPECTED_SHA256="8d03574d6f48da473d83468bc8c816f41a311feecac1835a44c9cd8a2f2a8734"
RELEASE_DIR="$APP_ROOT/releases/release-202608260901-transport-safety-entry"
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

# 保留历史分包，避免浏览器仍请求旧动态资源时出现模块加载失败。
cp -an "$old_release/dist/public/assets/." "$RELEASE_DIR/dist/public/assets/"

# 只校验本次前端入口修复已进入待发布包；不执行数据库迁移或业务写入。
grep -Rql "仅限超级管理员维护" "$RELEASE_DIR/dist/public/assets"

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1

systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
