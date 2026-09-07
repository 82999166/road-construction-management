#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/yx-cloud-management/app"
SERVICE_NAME="yx-cloud-management.service"
HEALTH_URL="http://127.0.0.1:18080/"
RELEASE_TAG="engineering-calculators-202609070450"
PACKAGE_URL="https://files.manuscdn.com/user_upload_by_module/session_file/310519663286442691/drRlyTMKLGimaodp.tgz"
EXPECTED_SHA256="0467a8a5335d598e7534d05a38cfea8f7fc90a1325f5629aa98f2e0a59518ea6"
PACKAGE_PATH="$APP_ROOT/incoming/$RELEASE_TAG.tgz"
STAGING="$APP_ROOT/releases/.$RELEASE_TAG.staging"
NEW_RELEASE="$APP_ROOT/releases/$RELEASE_TAG"
OLD_RELEASE="$(readlink -f "$APP_ROOT/current")"
ACTIVATED=0

rollback() {
  if [[ "$ACTIVATED" == "1" ]]; then
    ln -sfn "$OLD_RELEASE" "$APP_ROOT/current.next"
    mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
    systemctl restart "$SERVICE_NAME" || true
  fi
}
trap rollback ERR

mkdir -p "$APP_ROOT/incoming" "$APP_ROOT/releases"
curl -fsSL --retry 3 --connect-timeout 15 "$PACKAGE_URL" -o "$PACKAGE_PATH"
[[ "$(sha256sum "$PACKAGE_PATH" | awk '{print $1}')" == "$EXPECTED_SHA256" ]]
rm -rf "$STAGING" "$NEW_RELEASE"
mkdir -p "$STAGING"
tar -xzf "$PACKAGE_PATH" --strip-components=1 -C "$STAGING"
[[ -f "$STAGING/dist/index.cjs" && -f "$STAGING/package.json" && -f "$STAGING/pnpm-lock.yaml" ]]
mv "$STAGING" "$NEW_RELEASE"
ln -sfn "$NEW_RELEASE" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
ACTIVATED=1
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
