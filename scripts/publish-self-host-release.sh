#!/usr/bin/env bash
set -euo pipefail

# 用法：REMOTE_HOST=... SSHPASS=... scripts/publish-self-host-release.sh <发布包> <摘要文件> <发布标签>
# 凭据仅经进程环境传递；本脚本不打印、写入或提交任何凭据。

package_path="${1:?缺少发布包路径}"
checksum_path="${2:?缺少摘要文件路径}"
release_tag="${3:?缺少发布标签}"
remote_host="${REMOTE_HOST:?缺少正式服务器地址}"
app_root="${APP_ROOT:-/opt/yx-cloud-management/app}"
service_name="${SERVICE_NAME:-yx-cloud-management.service}"
health_url="${HEALTH_URL:-http://127.0.0.1:18080/}"

[[ -f "$package_path" && -f "$checksum_path" ]]
expected_checksum="$(awk '{print $1}' "$checksum_path")"
package_name="$(basename "$package_path")"

ssh_options=(
  -T
  -o PreferredAuthentications=password,keyboard-interactive
  -o PubkeyAuthentication=no
  -o ConnectTimeout=12
  -o StrictHostKeyChecking=accept-new
)

SSHPASS="${SSHPASS:?缺少受控 SSH 凭据}" sshpass -e ssh "${ssh_options[@]}" "$remote_host" "mkdir -p '$app_root/incoming' '$app_root/releases'"
SSHPASS="$SSHPASS" sshpass -e scp -O -q "${ssh_options[@]}" "$package_path" "$checksum_path" "$remote_host:$app_root/incoming/"

SSHPASS="$SSHPASS" sshpass -e ssh "${ssh_options[@]}" "$remote_host" \
  "APP_ROOT='$app_root' SERVICE_NAME='$service_name' HEALTH_URL='$health_url' RELEASE_TAG='$release_tag' EXPECTED_CHECKSUM='$expected_checksum' PACKAGE_NAME='$package_name' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

package_path="$APP_ROOT/incoming/$PACKAGE_NAME"
new_release="$APP_ROOT/releases/$RELEASE_TAG"
staging_release="$APP_ROOT/releases/.${RELEASE_TAG}.staging"
old_release="$(readlink -f "$APP_ROOT/current")"
activated=0

rollback() {
  if [[ "$activated" == "1" ]]; then
    ln -sfn "$old_release" "$APP_ROOT/current.next"
    mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
    systemctl restart "$SERVICE_NAME" || true
  fi
}
trap rollback ERR

[[ "$(sha256sum "$package_path" | awk '{print $1}')" == "$EXPECTED_CHECKSUM" ]]
rm -rf "$staging_release" "$new_release"
mkdir -p "$staging_release"
tar -xzf "$package_path" -C "$staging_release"
[[ -f "$staging_release/dist/index.cjs" ]]
[[ -f "$staging_release/package.json" ]]
[[ -f "$staging_release/pnpm-lock.yaml" ]]
mv "$staging_release" "$new_release"
ln -sfn "$new_release" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
activated=1
systemctl restart "$SERVICE_NAME"

healthy=0
for _ in $(seq 1 18); do
  if systemctl is-active --quiet "$SERVICE_NAME" && curl -fsS --max-time 4 "$HEALTH_URL" >/dev/null; then
    healthy=$((healthy + 1))
  else
    healthy=0
  fi
  if [[ "$healthy" -ge 3 ]]; then
    trap - ERR
    printf 'PUBLISHED:%s\n' "$RELEASE_TAG"
    exit 0
  fi
  sleep 5
done

printf 'HEALTHCHECK_FAILED\n' >&2
exit 1
REMOTE_SCRIPT
