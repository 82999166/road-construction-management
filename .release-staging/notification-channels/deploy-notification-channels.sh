#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/notification-channels.tar.gz"
EXPECTED_SHA256="2fa8e6dc125c45253ff75f00fbe492db6e3fd07c3b2f39972a0dcb14aa2d44f3"
RELEASE_DIR="$APP_ROOT/releases/release-$(date +%Y%m%d%H%M%S)-notification-channels"
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

# 保留旧版动态分包，避免已打开的 PC/手机页面在切换时请求旧文件失败。
mkdir -p "$RELEASE_DIR/dist/public/assets"
cp -an "$old_release/dist/public/assets/." "$RELEASE_DIR/dist/public/assets/"

# 发布包必须包含通知通道设置和服务号持续推送合规拦截标记。
grep -Rql "短信与服务号通知通道" "$RELEASE_DIR/dist/public/assets"
grep -Rql "official_event_not_immediate" "$RELEASE_DIR/dist/index.cjs"

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
