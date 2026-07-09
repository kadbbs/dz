#!/usr/bin/env bash
set -euo pipefail

CONFIGURATION="Release"
BUILD_DIR="build-linux"
SKIP_MEDIASOUP_INSTALL=0

usage() {
  cat <<'EOF'
Usage: scripts/linux/build_native.sh [options]

Options:
  --configuration NAME   CMake build type, default: Release
  --build-dir DIR        Build directory, default: build-linux
  --skip-mediasoup       Skip npm ci in mediasoup-server
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --configuration)
      CONFIGURATION="$2"
      shift 2
      ;;
    --build-dir)
      BUILD_DIR="$2"
      shift 2
      ;;
    --skip-mediasoup)
      SKIP_MEDIASOUP_INSTALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command '$1'. Install it and retry." >&2
    exit 1
  fi
}

require_cmd cmake

if [[ "${SKIP_MEDIASOUP_INSTALL}" -eq 0 ]]; then
  require_cmd node
  require_cmd npm

  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "${NODE_MAJOR}" -lt 22 ]]; then
    echo "Node.js 22+ is required for mediasoup. Current major version: ${NODE_MAJOR}" >&2
    exit 1
  fi
fi

WEB_ROOT="$(cd web && pwd)"
cmake -S . -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE="${CONFIGURATION}" \
  -DWEB_ROOT_PATH="${WEB_ROOT}"
cmake --build "${BUILD_DIR}" -j"$(nproc)"

if [[ "${SKIP_MEDIASOUP_INSTALL}" -eq 0 ]]; then
  (cd mediasoup-server && npm ci --omit=dev)
fi

echo "Linux native build finished: ${BUILD_DIR}/web_texas_webrtc"
