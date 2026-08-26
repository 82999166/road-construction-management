#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/admin-notification-settings-lazy.tar.gz"
EXPECTED_SHA256="42527f3ff6767b598eadb6071c1acd903dc88801e06b113bf20020ec44b4c2d0"
RELEASE_DIR="$APP_ROOT/releases/release-$(date +%Y%m%d%H%M%S)-admin-notification-settings-lazy"
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

# 保留已打开页面引用的旧版动态分包，避免切换后请求旧资源失败。
mkdir -p "$RELEASE_DIR/dist/public/assets"
cp -an "$old_release/dist/public/assets/." "$RELEASE_DIR/dist/public/assets/"

# 新版必须包含系统设置的通知通道延迟加载提示及独立分包。
grep -Rql "正在加载短信与通知通道配置" "$RELEASE_DIR/dist/public/assets"
find "$RELEASE_DIR/dist/public/assets" -maxdepth 1 -type f -name 'NotificationChannelSettings-*.js' | grep -q .

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
