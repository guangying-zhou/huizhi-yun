#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${HZY_CONNECTOR_RUNTIME_SERVICE_NAME:-hzy-connector-runtime}"
INSTALL_DIR="${HZY_CONNECTOR_RUNTIME_INSTALL_DIR:-/opt/hzy/connector-runtime}"
BIN_DIR="${HZY_CONNECTOR_RUNTIME_BIN_DIR:-/usr/local/bin}"
PACKAGE_BASE_URL="${HZY_CONNECTOR_RUNTIME_PACKAGE_BASE_URL:-https://downloads.huizhi.yun/packages/hzy-connector-runtime}"
USER_NAME="${HZY_CONNECTOR_RUNTIME_USER:-hzy-connector}"
PORT="${HZY_CONNECTOR_RUNTIME_PORT:-18082}"
SQLITE_PATH="${HZY_CONNECTOR_RUNTIME_SQLITE_PATH:-$INSTALL_DIR/data/operations.db}"
PRIVATE_KEY_FILE="${HZY_CONNECTOR_RUNTIME_PRIVATE_KEY_FILE:-/etc/hzy-connector-runtime/connector-private.pem}"
RELEASE_PUBLIC_KEY_SOURCE="${HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE:-}"
RELEASE_PUBLIC_KEY_FILE="/etc/hzy-connector-runtime/release-signing-public.pem"
ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

[[ "$(id -u)" -eq 0 ]] || { echo "Please run through sudo." >&2; exit 1; }
[[ "$OS" == "linux" ]] || { echo "hzy-connector-runtime supports Linux only." >&2; exit 1; }
: "${HZY_CONNECTOR_RUNTIME_CONSOLE_URL:?HZY_CONNECTOR_RUNTIME_CONSOLE_URL is required}"
: "${HZY_CONNECTOR_RUNTIME_ENROLLMENT_CODE:?HZY_CONNECTOR_RUNTIME_ENROLLMENT_CODE is required}"
: "${HZY_CONSOLE_API_URL:?HZY_CONSOLE_API_URL is required}"
: "${HZY_CONSOLE_TOKEN_URL:?HZY_CONSOLE_TOKEN_URL is required}"
: "${HZY_CONNECTOR_RUNTIME_JWT_ISSUER:?HZY_CONNECTOR_RUNTIME_JWT_ISSUER is required}"
: "${HZY_CONNECTOR_RUNTIME_JWKS_URL:?HZY_CONNECTOR_RUNTIME_JWKS_URL is required}"
: "${HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL:?HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL is required}"
[ -n "$RELEASE_PUBLIC_KEY_SOURCE" ] || { echo "HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE is required" >&2; exit 1; }
[ -r "$RELEASE_PUBLIC_KEY_SOURCE" ] || { echo "Connector Runtime release public key is not readable" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required for release verification" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required for release verification" >&2; exit 1; }

python3 - "$HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL" <<'PY'
import ipaddress
import sys
from urllib.parse import urlsplit

value = sys.argv[1].strip()
try:
    parsed = urlsplit(value)
    hostname = parsed.hostname or ""
    loopback = hostname.lower() == "localhost"
    if not loopback:
        try:
            loopback = ipaddress.ip_address(hostname).is_loopback
        except ValueError:
            pass
    secure = parsed.scheme == "https" or (parsed.scheme == "http" and loopback)
    clean = bool(parsed.netloc) and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ("", "/")
    _ = parsed.port
    if not secure or not clean:
        raise ValueError("unsafe origin")
except Exception:
    raise SystemExit("HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL must be an HTTPS origin or a loopback HTTP origin")
PY

case "$ARCH" in
  x86_64|amd64) GOARCH="amd64" ;;
  arm64|aarch64) GOARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

download() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  else wget -q "$1" -O "$2"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else openssl dgst -sha256 "$1" | awk '{print $NF}'
  fi
}

verify_signature() {
  local payload="$1" signature="$2"
  openssl pkeyutl -verify -rawin -pubin -inkey "$RELEASE_PUBLIC_KEY_SOURCE" \
    -in "$payload" -sigfile "$signature" >/dev/null \
    || { echo "Connector Runtime Ed25519 release signature verification failed: $(basename "$payload")" >&2; exit 1; }
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
manifest="$tmp_dir/latest.json"
download "$PACKAGE_BASE_URL/latest.json" "$manifest"
manifest_signature="$tmp_dir/latest.json.sig"
download "$PACKAGE_BASE_URL/latest.json.sig" "$manifest_signature"
verify_signature "$manifest" "$manifest_signature"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$manifest")"
target="$OS-$GOARCH"
file="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["files"][sys.argv[2]])' "$manifest" "$target")"
expected_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"][sys.argv[2]])' "$manifest" "$target")"
signature_file="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["signatures"][sys.argv[2]])' "$manifest" "$target")"
expected_key_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["signature"]["keyId"])' "$manifest")"
public_key_der="$tmp_dir/release-signing-public.der"
openssl pkey -pubin -in "$RELEASE_PUBLIC_KEY_SOURCE" -outform DER -out "$public_key_der"
actual_key_id="$(sha256_file "$public_key_der")"
[[ "$actual_key_id" == "$expected_key_id" ]] || { echo "Connector Runtime release signing key ID mismatch" >&2; exit 1; }
archive="$tmp_dir/$(basename "$file")"
download "$PACKAGE_BASE_URL/$file" "$archive"
archive_signature="$tmp_dir/$(basename "$signature_file")"
download "$PACKAGE_BASE_URL/$signature_file" "$archive_signature"
verify_signature "$archive" "$archive_signature"
actual_sha="$(sha256_file "$archive")"
[[ "$actual_sha" == "$expected_sha" ]] || { echo "Connector Runtime archive checksum mismatch" >&2; exit 1; }
tar -C "$tmp_dir" -xzf "$archive"
[[ -x "$tmp_dir/hzy-connector-runtime" ]] || { echo "package is missing hzy-connector-runtime" >&2; exit 1; }
[[ -x "$tmp_dir/verify-slo-window.sh" ]] || { echo "package is missing verify-slo-window.sh" >&2; exit 1; }

install -d -m 0755 "$INSTALL_DIR" "$INSTALL_DIR/schema" "$BIN_DIR"
install -d -m 0700 "$INSTALL_DIR/data" "$(dirname "$PRIVATE_KEY_FILE")" "$(dirname "$RELEASE_PUBLIC_KEY_FILE")"
if [ "$RELEASE_PUBLIC_KEY_SOURCE" != "$RELEASE_PUBLIC_KEY_FILE" ]; then
  install -m 0644 "$RELEASE_PUBLIC_KEY_SOURCE" "$RELEASE_PUBLIC_KEY_FILE"
else
  chmod 0644 "$RELEASE_PUBLIC_KEY_FILE"
fi
install -m 0644 "$tmp_dir/schema/001_notification_delivery_ledger.sql" "$INSTALL_DIR/schema/001_notification_delivery_ledger.sql"
install -m 0644 "$tmp_dir/schema/002_notification_delivery_reconciliation.sql" "$INSTALL_DIR/schema/002_notification_delivery_reconciliation.sql"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$USER_NAME"
fi

credential_env="$tmp_dir/enrollment.env"
"$tmp_dir/hzy-connector-runtime" enroll \
  --console-url "$HZY_CONNECTOR_RUNTIME_CONSOLE_URL" \
  --code "$HZY_CONNECTOR_RUNTIME_ENROLLMENT_CODE" \
  --private-key-file "$PRIVATE_KEY_FILE" \
  --output-env "$credential_env"

env_file="$INSTALL_DIR/.env"
umask 077
cat > "$env_file" <<EOF
HZY_CONNECTOR_RUNTIME_HOST="0.0.0.0"
HZY_CONNECTOR_RUNTIME_PORT="$PORT"
HZY_CONNECTOR_RUNTIME_INSTALL_DIR="$INSTALL_DIR"
HZY_CONNECTOR_RUNTIME_AUTH_MODE="jwt"
HZY_CONNECTOR_RUNTIME_AUDIENCE="connector-runtime"
HZY_CONNECTOR_RUNTIME_JWT_ISSUER="${HZY_CONNECTOR_RUNTIME_JWT_ISSUER%/}"
HZY_CONNECTOR_RUNTIME_JWKS_URL="$HZY_CONNECTOR_RUNTIME_JWKS_URL"
HZY_CONSOLE_API_URL="${HZY_CONSOLE_API_URL%/}"
HZY_CONSOLE_TOKEN_URL="${HZY_CONSOLE_TOKEN_URL%/}"
HZY_CONNECTOR_RUNTIME_STORE="sqlite"
HZY_CONNECTOR_RUNTIME_SQLITE_PATH="$SQLITE_PATH"
HZY_CONNECTOR_RUNTIME_DELIVERY_LEASE_MS="120000"
HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL="$HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL"
HZY_CONNECTOR_RUNTIME_PACKAGE_BASE_URL="$PACKAGE_BASE_URL"
HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE="$RELEASE_PUBLIC_KEY_FILE"
HZY_CONNECTOR_RUNTIME_SERVICE_NAME="$SERVICE_NAME"
EOF
cat "$credential_env" >> "$env_file"

set -a
source "$env_file"
set +a
HZY_CONNECTOR_RUNTIME_STORE=sqlite HZY_CONNECTOR_RUNTIME_SQLITE_PATH="$SQLITE_PATH" "$tmp_dir/hzy-connector-runtime" -check-store

install -m 0755 "$tmp_dir/hzy-connector-runtime" "$BIN_DIR/hzy-connector-runtime"
install -m 0755 "$tmp_dir/migrate-notification-runtime.sh" "$INSTALL_DIR/migrate-notification-runtime.sh"
install -m 0755 "$tmp_dir/verify-installation.sh" "$INSTALL_DIR/verify-installation.sh"
install -m 0755 "$tmp_dir/verify-slo-window.sh" "$INSTALL_DIR/verify-slo-window.sh"
chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR" "$(dirname "$PRIVATE_KEY_FILE")"
chmod 0600 "$env_file" "$PRIVATE_KEY_FILE"

cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Huizhi Yun Enterprise Connector Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$env_file
ExecStart=$BIN_DIR/hzy-connector-runtime
Restart=always
RestartSec=3
RestartPreventExitStatus=78
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR $(dirname "$PRIVATE_KEY_FILE")
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

cat > "/etc/systemd/system/$SERVICE_NAME-update.service" <<EOF
[Unit]
Description=Update Huizhi Yun Enterprise Connector Runtime

[Service]
Type=oneshot
EnvironmentFile=$env_file
ExecStart=$BIN_DIR/hzy-connector-runtime -update
EOF

cat > "/etc/systemd/system/$SERVICE_NAME-update.timer" <<EOF
[Unit]
Description=Periodically update Huizhi Yun Enterprise Connector Runtime

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
systemctl restart "$SERVICE_NAME.service"
systemctl enable --now "$SERVICE_NAME-update.timer"
if ! HZY_CONNECTOR_RUNTIME_EXPECTED_VERSION="$version" \
  HZY_CONNECTOR_RUNTIME_EXPECTED_TENANT="$HZY_CONNECTOR_RUNTIME_TENANT" \
  HZY_CONNECTOR_RUNTIME_EXPECTED_DEPLOYMENT="$HZY_CONNECTOR_RUNTIME_DEPLOYMENT" \
  HZY_CONNECTOR_RUNTIME_EXPECTED_DATA_RUNTIME_URL="$HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL" \
  HZY_CONNECTOR_RUNTIME_EXPECTED_RELEASE_KEY_ID="$expected_key_id" \
  "$INSTALL_DIR/verify-installation.sh"; then
  systemctl disable --now "$SERVICE_NAME-update.timer" >/dev/null 2>&1 || true
  systemctl stop "$SERVICE_NAME.service" >/dev/null 2>&1 || true
  echo "Connector Runtime installation verification failed; service and update timer were stopped." >&2
  exit 1
fi
unset HZY_CONNECTOR_RUNTIME_ENROLLMENT_CODE
echo "Installed hzy-connector-runtime $version"
echo "Health: curl http://127.0.0.1:$PORT/runtime/health"
if [[ -r /opt/hzy/notification-runtime/.env ]]; then
  echo "Existing Notification Runtime detected. Run the explicit ledger cutover only after configuring the Connector URL:"
  echo "  sudo $INSTALL_DIR/migrate-notification-runtime.sh"
fi
