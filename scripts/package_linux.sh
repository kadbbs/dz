#!/usr/bin/env bash
set -euo pipefail

CONFIGURATION="Release"
BUILD_DIR="build-linux"
OUTPUT_DIR="dist"
PACKAGE_NAME="dz-linux-x64"

usage() {
  cat <<'EOF'
Usage: scripts/package_linux.sh [options]

Options:
  --configuration NAME   CMake build type, default: Release
  --build-dir DIR        Build directory, default: build-linux
  --output-dir DIR       Output directory, default: dist
  --package-name NAME    Package directory/archive name, default: dz-linux-x64
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
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --package-name)
      PACKAGE_NAME="$2"
      shift 2
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

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

GAME_BIN="${BUILD_DIR}/web_texas_webrtc"
if [[ ! -x "${GAME_BIN}" ]]; then
  echo "Missing ${GAME_BIN}. Run scripts/linux/build_native.sh first." >&2
  exit 1
fi

if [[ ! -d mediasoup-server/node_modules ]]; then
  echo "Missing mediasoup-server/node_modules. Run npm ci --omit=dev in mediasoup-server first." >&2
  exit 1
fi

STAGING="${OUTPUT_DIR}/${PACKAGE_NAME}"
ARCHIVE="${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz"
rm -rf "${STAGING}" "${ARCHIVE}"
mkdir -p "${STAGING}/bin" "${STAGING}/mediasoup-server" "${OUTPUT_DIR}"

cp "${GAME_BIN}" "${STAGING}/bin/web_texas_webrtc"
cp -R web deploy scripts "${STAGING}/"
cp README.md CMakeLists.txt "${STAGING}/"
cp mediasoup-server/package.json mediasoup-server/package-lock.json mediasoup-server/server.js "${STAGING}/mediasoup-server/"
cp -R mediasoup-server/node_modules "${STAGING}/mediasoup-server/"

{
  echo "package=${PACKAGE_NAME}"
  echo "configuration=${CONFIGURATION}"
  echo "commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${STAGING}/VERSION.txt"

tar -C "${OUTPUT_DIR}" -czf "${ARCHIVE}" "${PACKAGE_NAME}"
echo "Created ${ARCHIVE}"
