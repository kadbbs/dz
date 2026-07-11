#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/deploy/dz.env}"

cd "${ROOT_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
else
  echo "Env file not found: ${ENV_FILE}. Using process environment and defaults." >&2
fi

: "${DZ_LISTEN_HOST:=::1}"
: "${DZ_WEB_PORT:=8080}"
: "${DZ_ACCESS_CODE:?Set DZ_ACCESS_CODE to a private 6-digit value}"
: "${MEDIASOUP_SIGNAL_HOST:=::1}"
: "${MEDIASOUP_SIGNAL_PORT:=3001}"
: "${MEDIASOUP_MIN_PORT:=40000}"
: "${MEDIASOUP_MAX_PORT:=49999}"
export DZ_LISTEN_HOST DZ_WEB_PORT DZ_ACCESS_CODE
export MEDIASOUP_SIGNAL_HOST MEDIASOUP_SIGNAL_PORT
export MEDIASOUP_LISTEN_IP MEDIASOUP_ANNOUNCED_IP MEDIASOUP_PREFER_IPV6
export MEDIASOUP_MIN_PORT MEDIASOUP_MAX_PORT

GAME_BIN="${GAME_BIN:-}"
if [[ -z "${GAME_BIN}" ]]; then
  if [[ -x "${ROOT_DIR}/bin/web_texas_webrtc" ]]; then
    GAME_BIN="${ROOT_DIR}/bin/web_texas_webrtc"
  elif [[ -x "${ROOT_DIR}/build-linux/web_texas_webrtc" ]]; then
    GAME_BIN="${ROOT_DIR}/build-linux/web_texas_webrtc"
  elif [[ -x "${ROOT_DIR}/build/web_texas_webrtc" ]]; then
    GAME_BIN="${ROOT_DIR}/build/web_texas_webrtc"
  else
    echo "Missing web_texas_webrtc. Run scripts/linux/build_native.sh first, or use a packaged release." >&2
    exit 1
  fi
fi

if [[ ! -d "${ROOT_DIR}/mediasoup-server/node_modules" ]]; then
  echo "Missing mediasoup-server/node_modules. Run npm ci --omit=dev in mediasoup-server first." >&2
  exit 1
fi

pids=()
cleanup() {
  for pid in "${pids[@]}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

"${GAME_BIN}" "${DZ_LISTEN_HOST}" "${DZ_WEB_PORT}" &
pids+=("$!")

(cd "${ROOT_DIR}/mediasoup-server" && node server.js) &
pids+=("$!")

echo "Started C++ game service on [${DZ_LISTEN_HOST}]:${DZ_WEB_PORT}"
echo "Started mediasoup service on [${MEDIASOUP_SIGNAL_HOST}]:${MEDIASOUP_SIGNAL_PORT}"
wait -n "${pids[@]}"
