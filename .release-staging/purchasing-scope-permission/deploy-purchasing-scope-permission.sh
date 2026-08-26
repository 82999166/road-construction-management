#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
CURRENT_LINK="$APP_ROOT/current"
ARCHIVE="/root/purchasing-scope-permission.tar.gz"
EXPECTED_SHA256="363130324e7d3c1a7ddb2deb7a1c5cfc4cff2b75ca520893d63fc5fe00a64131"
RELEASE_DIR="$APP_ROOT/releases/release-$(date +%Y%m%d%H%M%S)-purchasing-scope-permission"
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

# 新版必须包含移动采购页分包，发布后由服务端权限校验接管用户专属读取权限。
find "$RELEASE_DIR/dist/public/assets" -maxdepth 1 -type f -name 'MobilePurchasingPage-*.js' | grep -q .

ln -s "$RELEASE_DIR" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$CURRENT_LINK"
switched=1
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

rm -f "$ARCHIVE"
trap - ERR
printf 'release=%s\nprevious=%s\nservice=active\n' "$(basename "$RELEASE_DIR")" "$(basename "$old_release")"
