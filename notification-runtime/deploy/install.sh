#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${HZY_NOTIFICATION_RUNTIME_SERVICE_NAME:-hzy-notification-runtime}"
INSTALL_DIR="${HZY_NOTIFICATION_RUNTIME_INSTALL_DIR:-/opt/hzy/notification-runtime}"
BIN_DIR="${HZY_NOTIFICATION_RUNTIME_BIN_DIR:-/usr/local/bin}"
PACKAGE_BASE_URL="${HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL:-https://downloads.huizhi.yun/packages/hzy-notification-runtime}"
USER_NAME="${HZY_NOTIFICATION_RUNTIME_USER:-hzy-runtime}"
ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

if [[ "$OS" != "linux" ]]; then
  echo "hzy-notification-runtime installer currently supports Linux only." >&2
  exit 1
fi

case "$ARCH" in
  x86_64|amd64) GOARCH="amd64" ;;
  arm64|aarch64) GOARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Please run as root or through sudo." >&2
    exit 1
  fi
}

json_value() {
  local key="$1"
  python3 - "$key" <<'PY'
import json, sys
key = sys.argv[1]
doc = json.load(sys.stdin)
value = doc
for part in key.split('.'):
    value = value.get(part, {}) if isinstance(value, dict) else {}
print(value if isinstance(value, str) else '')
PY
}

prompt_value() {
  local var="$1"
  local prompt="$2"
  local default="${3:-}"
  local current="${!var:-}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ ! -r /dev/tty ]]; then
    echo "$var is required in non-interactive mode" >&2
    exit 1
  fi
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " current < /dev/tty
    current="${current:-$default}"
  else
    read -r -p "$prompt: " current < /dev/tty
  fi
  export "$var=$current"
}

prompt_secret() {
  local var="$1"
  local prompt="$2"
  local current="${!var:-}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ ! -r /dev/tty ]]; then
    echo "$var is required in non-interactive mode" >&2
    exit 1
  fi
  read -r -s -p "$prompt: " current < /dev/tty
  echo > /dev/tty
  export "$var=$current"
}

download() {
  local url="$1"
  local target="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$target"
  else
    wget -q "$url" -O "$target"
  fi
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    echo "sha256sum, shasum or openssl is required for checksum verification" >&2
    exit 1
  fi
}

need_root

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

manifest="$tmp_dir/latest.json"
download "$PACKAGE_BASE_URL/latest.json" "$manifest"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$manifest")"
file="$(python3 -c 'import json,sys; doc=json.load(open(sys.argv[1])); print(doc["files"][sys.argv[2]])' "$manifest" "$OS-$GOARCH")"
expected_sha="$(python3 -c 'import json,sys; doc=json.load(open(sys.argv[1])); print(doc["sha256"][sys.argv[2]])' "$manifest" "$OS-$GOARCH")"

archive="$tmp_dir/$(basename "$file")"
download "$PACKAGE_BASE_URL/$file" "$archive"
actual_sha="$(sha256_file "$archive")"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "Checksum mismatch for $file" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
tar -C "$tmp_dir" -xzf "$archive"
install -m 0755 "$tmp_dir/hzy-notification-runtime" "$BIN_DIR/hzy-notification-runtime"

if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$USER_NAME"
fi

prompt_value HZY_NOTIFICATION_RUNTIME_PORT "Notification Runtime port" "18081"
prompt_value HZY_NOTIFICATION_RUNTIME_TENANT "Tenant code" "${HZY_TENANT:-default}"
prompt_value HZY_NOTIFICATION_RUNTIME_DEPLOYMENT "Deployment code" "${HZY_DEPLOYMENT:-local}"
prompt_value HZY_CONSOLE_API_URL "Console API URL" "https://console.huizhi.yun"
prompt_value HZY_CONSOLE_TOKEN_URL "Console token URL" "${HZY_CONSOLE_API_URL%/}/oauth/token"
prompt_value HZY_NOTIFICATION_RUNTIME_AUTH_MODE "Notification Runtime auth mode" "jwt"
prompt_value HZY_NOTIFICATION_RUNTIME_AUDIENCE "Notification Runtime audience" "notification-runtime"
prompt_value HZY_NOTIFICATION_RUNTIME_JWT_ISSUER "Console token issuer" "$HZY_CONSOLE_API_URL"
prompt_value HZY_NOTIFICATION_RUNTIME_JWKS_URL "Console JWKS URL" "${HZY_CONSOLE_API_URL%/}/.well-known/jwks.json"
prompt_value HZY_NOTIFICATION_RUNTIME_CLIENT_ID "Notification Runtime Console client_id" "notification-runtime"
prompt_secret HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET "Notification Runtime Console client_secret"

env_file="$INSTALL_DIR/.env"
umask 077
cat > "$env_file" <<EOF
HZY_NOTIFICATION_RUNTIME_HOST=0.0.0.0
HZY_NOTIFICATION_RUNTIME_PORT=$HZY_NOTIFICATION_RUNTIME_PORT
HZY_NOTIFICATION_RUNTIME_TENANT=$HZY_NOTIFICATION_RUNTIME_TENANT
HZY_NOTIFICATION_RUNTIME_DEPLOYMENT=$HZY_NOTIFICATION_RUNTIME_DEPLOYMENT
HZY_NOTIFICATION_RUNTIME_AUTH_MODE=$HZY_NOTIFICATION_RUNTIME_AUTH_MODE
HZY_NOTIFICATION_RUNTIME_AUDIENCE=$HZY_NOTIFICATION_RUNTIME_AUDIENCE
HZY_NOTIFICATION_RUNTIME_JWT_ISSUER=${HZY_NOTIFICATION_RUNTIME_JWT_ISSUER%/}
HZY_NOTIFICATION_RUNTIME_JWKS_URL=$HZY_NOTIFICATION_RUNTIME_JWKS_URL
HZY_CONSOLE_API_URL=${HZY_CONSOLE_API_URL%/}
HZY_CONSOLE_TOKEN_URL=${HZY_CONSOLE_TOKEN_URL%/}
HZY_NOTIFICATION_RUNTIME_CLIENT_ID=$HZY_NOTIFICATION_RUNTIME_CLIENT_ID
HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET=$HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET
HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL=$PACKAGE_BASE_URL
HZY_NOTIFICATION_RUNTIME_SERVICE_NAME=$SERVICE_NAME
EOF
chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR"

cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Huizhi Yun Notification Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$env_file
ExecStart=$BIN_DIR/hzy-notification-runtime
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > "/etc/systemd/system/$SERVICE_NAME-update.service" <<EOF
[Unit]
Description=Update Huizhi Yun Notification Runtime

[Service]
Type=oneshot
EnvironmentFile=$env_file
ExecStart=$BIN_DIR/hzy-notification-runtime -update
EOF

cat > "/etc/systemd/system/$SERVICE_NAME-update.timer" <<EOF
[Unit]
Description=Periodically update Huizhi Yun Notification Runtime

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME.service"
systemctl enable --now "$SERVICE_NAME-update.timer"

echo "Installed hzy-notification-runtime $version"
echo "Health: curl http://127.0.0.1:$HZY_NOTIFICATION_RUNTIME_PORT/runtime/health"
