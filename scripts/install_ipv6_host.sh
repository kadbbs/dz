#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-dz}"
APP_DIR="${APP_DIR:-/opt/dz}"
ENV_DIR="${ENV_DIR:-/etc/dz}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root, for example: sudo bash scripts/install_ipv6_host.sh" >&2
  exit 1
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_base_packages() {
  apt-get update
  apt-get install -y build-essential ca-certificates cmake curl gnupg libboost-system-dev rsync
}

install_node22() {
  if need_cmd node && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    return
  fi
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
}

install_caddy() {
  if need_cmd caddy; then
    return
  fi
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

ensure_user() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi
}

copy_app() {
  mkdir -p "${APP_DIR}"
  rsync -a \
    --exclude .git \
    --exclude build \
    --exclude node_modules \
    "${REPO_DIR}/" "${APP_DIR}/"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

build_app() {
  cmake -S "${APP_DIR}" -B "${APP_DIR}/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "${APP_DIR}/build" -j"$(nproc)"
  (cd "${APP_DIR}/mediasoup-server" && npm ci --omit=dev)
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

install_config() {
  mkdir -p "${ENV_DIR}"
  if [[ ! -f "${ENV_DIR}/dz.env" ]]; then
    install -m 0640 -o root -g "${APP_USER}" "${APP_DIR}/deploy/dz.env.example" "${ENV_DIR}/dz.env"
    echo "Created ${ENV_DIR}/dz.env. Edit DZ_DOMAIN and MEDIASOUP_ANNOUNCED_IP before public use." >&2
  fi

  install -m 0644 "${APP_DIR}/deploy/systemd/dz-game.service" /etc/systemd/system/dz-game.service
  install -m 0644 "${APP_DIR}/deploy/systemd/dz-mediasoup.service" /etc/systemd/system/dz-mediasoup.service
  mkdir -p /etc/systemd/system/caddy.service.d
  install -m 0644 "${APP_DIR}/deploy/systemd/caddy-dz.conf" /etc/systemd/system/caddy.service.d/dz.conf
  install -m 0644 "${APP_DIR}/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile
}

enable_services() {
  systemctl daemon-reload
  systemctl enable dz-game dz-mediasoup caddy
  systemctl restart dz-game dz-mediasoup caddy
}

install_base_packages
install_node22
install_caddy
ensure_user
copy_app
build_app
install_config
enable_services

cat <<'EOF'
Deploy finished.

Next checks:
  systemctl status dz-game dz-mediasoup caddy
  curl -g http://[::1]:8080/healthz
  curl -g http://[::1]:3001/healthz

Make sure /etc/dz/dz.env has a real DZ_DOMAIN and public MEDIASOUP_ANNOUNCED_IP.
Open 80/tcp, 443/tcp, and MEDIASOUP_MIN_PORT-MEDIASOUP_MAX_PORT udp/tcp.
EOF
