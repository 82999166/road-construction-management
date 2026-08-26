#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/diesel-refuel-dedup.tar.gz"
EXPECTED_SHA256="16d01c255cfa593a96ef84fa092386e21ed7d47c187e30ba3855d2e0516ca8b3"
RELEASE_DIR="$APP_ROOT/releases/release-$(date +%Y%m%d%H%M%S)-diesel-refuel-dedup"
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
[[ -f "$ARCHIVE" ]]
[[ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" == "$EXPECTED_SHA256" ]]

mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
[[ -s "$RELEASE_DIR/dist/index.cjs" ]]
[[ -f "$RELEASE_DIR/package.json" ]]

# 保留已打开页面仍可能请求的旧动态分包，避免发布瞬间出现模块加载失败。
mkdir -p "$RELEASE_DIR/dist/public/assets"
cp -an "$old_release/dist/public/assets/." "$RELEASE_DIR/dist/public/assets/"

# 发布包必须同时包含柴油重复录入提示和超级管理员移动端安全设置入口。
grep -Rql "为防止重复入账，本次保存已禁用" "$RELEASE_DIR/dist/public/assets"
grep -Rql "普通运输管理员不会显示此入口" "$RELEASE_DIR/dist/public/assets"

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1

systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
