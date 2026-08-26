#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/mobile-purchasing-scope.tar.gz"
EXPECTED_SHA256="a88254ea090eb155d42d9dd57c1fe9bed8890e736705e0fbe5343230970be074"
RELEASE_DIR="$APP_ROOT/releases/release-$(date +%Y%m%d%H%M%S)-mobile-purchasing-scope"
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

# 保留已打开移动端页面可能继续请求的旧动态分包，避免原子切换时出现模块加载失败。
mkdir -p "$RELEASE_DIR/dist/public/assets"
cp -an "$old_release/dist/public/assets/." "$RELEASE_DIR/dist/public/assets/"

# 确认发布包确实包含采购项目范围加载失败提示与重新获取入口。
grep -Rql "项目授权加载失败" "$RELEASE_DIR/dist/public/assets"
grep -Rql "重新获取授权项目" "$RELEASE_DIR/dist/public/assets"

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1

systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
