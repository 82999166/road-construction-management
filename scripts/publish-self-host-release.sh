#!/usr/bin/env bash
set -euo pipefail

# 用法：REMOTE_HOST=... SSH_KEY_PATH=... scripts/publish-self-host-release.sh <发布包> <摘要文件> <发布标签>
# 兼容旧路径：未提供 SSH_KEY_PATH 时，可通过 SSHPASS 以密码认证。
# 凭据仅经进程环境传递；本脚本不打印、写入或提交任何凭据。

package_path="${1:?缺少发布包路径}"
checksum_path="${2:?缺少摘要文件路径}"
release_tag="${3:?缺少发布标签}"
remote_host="${REMOTE_HOST:?缺少正式服务器地址}"
ssh_key_path="${SSH_KEY_PATH:-}"
app_root="${APP_ROOT:-/opt/yx-cloud-management/app}"
service_name="${SERVICE_NAME:-yx-cloud-management.service}"
health_url="${HEALTH_URL:-http://127.0.0.1:18080/}"

[[ -f "$package_path" && -f "$checksum_path" ]]
expected_checksum="$(awk '{print $1}' "$checksum_path")"
package_name="$(basename "$package_path")"

ssh_options=(
  -o ConnectTimeout=12
  -o StrictHostKeyChecking=accept-new
)

if [[ -n "$ssh_key_path" ]]; then
  [[ -f "$ssh_key_path" && -r "$ssh_key_path" ]] || { printf '部署 SSH 私钥不可读\n' >&2; exit 2; }
else
  : "${SSHPASS:?缺少受控 SSH 凭据或 SSH_KEY_PATH}"
fi

run_remote_ssh() {
  if [[ -n "$ssh_key_path" ]]; then
    ssh -T "${ssh_options[@]}" \
      -i "$ssh_key_path" \
      -o BatchMode=yes \
      -o PreferredAuthentications=publickey \
      -o PasswordAuthentication=no \
      -o KbdInteractiveAuthentication=no \
      "$remote_host" "$@"
  else
    SSHPASS="$SSHPASS" sshpass -e ssh -tt "${ssh_options[@]}" \
      -o PreferredAuthentications=password,keyboard-interactive \
      -o PubkeyAuthentication=no \
      "$remote_host" "$@"
  fi
}

run_remote_ssh "mkdir -p '$app_root/incoming' '$app_root/releases'"

# 正式服务器仅接受分配交互终端的 SSH 命令，且关闭 SFTP/legacy SCP。
# 伪终端不直接传输二进制文件：本地无换行 Base64 编码，远端解码至 incoming，
# 再由远端脚本对收到的归档执行 SHA-256 校验，绝不直接覆盖 current。
upload_via_ssh() {
  local source_path="$1"
  local remote_path="$2"
  local upload_sentinel="__YX_RELEASE_UPLOAD_END__"
  local upload_command="temp_upload=\$(mktemp); cleanup_upload() { rm -f \"\$temp_upload\"; }; trap cleanup_upload EXIT; while IFS= read -r upload_line; do [ \"\$upload_line\" = \"$upload_sentinel\" ] && break; printf '%s\\n' \"\$upload_line\" >> \"\$temp_upload\"; done; base64 -d \"\$temp_upload\" > '$remote_path'"
  if [[ -n "$ssh_key_path" ]]; then
    base64 -w 0 "$source_path" | {
      cat
      printf '\n%s\n' "$upload_sentinel"
    } | run_remote_ssh "$upload_command"
  else
    base64 -w 0 "$source_path" | {
      cat
      printf '\n%s\n' "$upload_sentinel"
    } | run_remote_ssh "stty -echo; $upload_command; stty echo"
  fi
}

upload_via_ssh "$package_path" "$app_root/incoming/$package_name"
upload_via_ssh "$checksum_path" "$app_root/incoming/${package_name}.sha256"

run_remote_ssh \
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
