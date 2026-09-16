#!/usr/bin/env bash
set -euo pipefail

DEFAULT_BASE_URL="https://downloads.huizhi.yun/packages/hzy-data-runtime"

VERSION="${HZY_DATA_RUNTIME_VERSION:-latest}"
BASE_URL="${HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL:-$DEFAULT_BASE_URL}"
INSTALL_DIR="${HZY_DATA_RUNTIME_INSTALL_DIR:-/opt/hzy-data-runtime}"
CONFIG_DIR="${HZY_DATA_RUNTIME_CONFIG_DIR:-/etc/hzy-data-runtime}"
SERVICE_NAME="${HZY_DATA_RUNTIME_SERVICE_NAME:-hzy-data-runtime}"
RUN_USER="${HZY_DATA_RUNTIME_RUN_USER:-hzy}"
RUN_GROUP="${HZY_DATA_RUNTIME_RUN_GROUP:-$RUN_USER}"
DIRECTORY_CONNECTOR_ENABLED="${HZY_DIRECTORY_CONNECTOR_ENABLED:-}"
DIRECTORY_RUN_USER="${HZY_DIRECTORY_CONNECTOR_RUN_USER:-hzy-directory}"
DIRECTORY_RUN_GROUP="${HZY_DIRECTORY_CONNECTOR_RUN_GROUP:-$DIRECTORY_RUN_USER}"
AUTO_UPDATE="${HZY_DATA_RUNTIME_AUTO_UPDATE:-true}"
UPDATE_INTERVAL="${HZY_DATA_RUNTIME_UPDATE_INTERVAL:-5min}"
UPDATE_VERSION="${HZY_DATA_RUNTIME_UPDATE_VERSION:-latest}"
NO_START=0
RECONFIGURE=0
ENROLLMENT_REDEEMED=0
LOCK_FILE=""
RELEASE_PUBLIC_KEY_SOURCE="${HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_FILE:-}"

usage() {
  cat <<'USAGE'
Install or upgrade hzy-data-runtime.

Usage:
  sudo bash ./install.sh --release-public-key /secure/release-signing-public.pem
  sudo bash ./install.sh --release-public-key /secure/release-signing-public.pem --version 0.2.8

Options:
  --version <version>      Install a pinned version. Default: latest
  --base-url <url>         Package base URL. Default: https://downloads.huizhi.yun/packages/hzy-data-runtime
  --install-dir <dir>      Binary and example files directory. Default: /opt/hzy-data-runtime
  --config-dir <dir>       Runtime config directory. Default: /etc/hzy-data-runtime
  --service-name <name>    systemd service name. Default: hzy-data-runtime
  --release-public-key <path> Trusted Ed25519 release public key PEM (required)
  --user <user>            systemd run user. Default: hzy
  --group <group>          systemd run group. Default: same as --user
  --update-interval <span> systemd timer interval. Default: 5min
  --update-version <ver>   Auto-update target version/channel. Default: latest
  --no-auto-update         Do not install or enable the update timer
  --reconfigure            Prompt and rewrite /etc/hzy-data-runtime/.env
  --no-start               Install files and unit, but do not start service

First install can be customized with environment variables such as:
  HZY_DATA_RUNTIME_PORT=18080
  HZY_DATA_RUNTIME_TENANT=tenant-code
  HZY_DATA_RUNTIME_DEPLOYMENT=deployment-code
  HZY_DATA_RUNTIME_STATIC_TOKEN=<platform-provided-token>
  HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_FILE=/secure/release-signing-public.pem
  HZY_DATA_RUNTIME_DB_HOST=127.0.0.1
  HZY_DATA_RUNTIME_DB_USER=cf_app
  HZY_DATA_RUNTIME_DB_PASSWORD=<password>
  HZY_FINANCE_DB_NAME=hzy_finance
  HZY_WORKFLOW_AGENT_ENABLED=false
  HZY_WORKFLOW_DB_NAME=hzy_workflow
  HZY_WEBDEV_AGENT_ENABLED=false
  HZY_WEBDEV_DB_NAME=hzy_webdev
  HZY_ASSETS_AGENT_ENABLED=false
  HZY_ASSETS_DB_NAME=hzy_assets
  HZY_PEOPLE_AGENT_ENABLED=false
  HZY_PEOPLE_DB_NAME=hzy_people
  HZY_ALTOC_AGENT_ENABLED=false
  HZY_ALTOC_DB_NAME=hzy_altoc
  HZY_AIMS_AGENT_ENABLED=false
  HZY_AIMS_DB_NAME=hzy_aims
  HZY_CODOCS_AGENT_ENABLED=false
  HZY_CODOCS_DB_NAME=hzy_codocs
  HZY_CONSOLE_RUNTIME_ENABLED=false
  HZY_CONSOLE_DB_NAME=hzy_console
  HZY_CONSOLE_VAULT_MASTER_KEY=<customer-held-vault-key>
  HZY_CONSOLE_VAULT_MASTER_KEY_FILE=/etc/hzy-data-runtime/console-vault-master-key
  HZY_DIRECTORY_CONNECTOR_ENABLED=true
  HZY_DIRECTORY_CONNECTOR_CONSOLE_URL=https://tenant.huizhi.yun
  HZY_DIRECTORY_CONNECTOR_ID=directory-connector.<deployment>

Automatic updates are enabled by default. The installer writes a systemd timer
that runs every 5 minutes and executes:
  hzy-data-runtime update --version latest

When /etc/hzy-data-runtime/.env already exists, normal upgrades preserve
database settings. Platform-provided activation environment variables such as
HZY_DATA_RUNTIME_STATIC_TOKEN and HZY_*_AGENT_ENABLED are still synchronized.
USAGE
}

fail() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || fail "--version requires a value"
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#*=}"
      shift
      ;;
    --base-url)
      [ "$#" -ge 2 ] || fail "--base-url requires a value"
      BASE_URL="$2"
      shift 2
      ;;
    --base-url=*)
      BASE_URL="${1#*=}"
      shift
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || fail "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --install-dir=*)
      INSTALL_DIR="${1#*=}"
      shift
      ;;
    --config-dir)
      [ "$#" -ge 2 ] || fail "--config-dir requires a value"
      CONFIG_DIR="$2"
      shift 2
      ;;
    --config-dir=*)
      CONFIG_DIR="${1#*=}"
      shift
      ;;
    --service-name)
      [ "$#" -ge 2 ] || fail "--service-name requires a value"
      SERVICE_NAME="$2"
      shift 2
      ;;
    --service-name=*)
      SERVICE_NAME="${1#*=}"
      shift
      ;;
    --release-public-key)
      [ "$#" -ge 2 ] || fail "--release-public-key requires a value"
      RELEASE_PUBLIC_KEY_SOURCE="$2"
      shift 2
      ;;
    --release-public-key=*)
      RELEASE_PUBLIC_KEY_SOURCE="${1#*=}"
      shift
      ;;
    --user)
      [ "$#" -ge 2 ] || fail "--user requires a value"
      RUN_USER="$2"
      shift 2
      ;;
    --user=*)
      RUN_USER="${1#*=}"
      shift
      ;;
    --group)
      [ "$#" -ge 2 ] || fail "--group requires a value"
      RUN_GROUP="$2"
      shift 2
      ;;
    --group=*)
      RUN_GROUP="${1#*=}"
      shift
      ;;
    --update-interval)
      [ "$#" -ge 2 ] || fail "--update-interval requires a value"
      UPDATE_INTERVAL="$2"
      shift 2
      ;;
    --update-interval=*)
      UPDATE_INTERVAL="${1#*=}"
      shift
      ;;
    --update-version)
      [ "$#" -ge 2 ] || fail "--update-version requires a value"
      UPDATE_VERSION="$2"
      shift 2
      ;;
    --update-version=*)
      UPDATE_VERSION="${1#*=}"
      shift
      ;;
    --no-auto-update)
      AUTO_UPDATE=false
      shift
      ;;
    --auto-update)
      AUTO_UPDATE=true
      shift
      ;;
    --reconfigure)
      RECONFIGURE=1
      shift
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail "run the locally verified installer as root"

SERVICE_NAME="${SERVICE_NAME%.service}"

case "$SERVICE_NAME" in
  ""|*/*|*\\*)
    fail "invalid service name: $SERVICE_NAME"
    ;;
esac

[ -n "$UPDATE_INTERVAL" ] || fail "update interval must not be empty"
[ -n "$UPDATE_VERSION" ] || fail "update version must not be empty"

case "$(printf "%s" "$AUTO_UPDATE" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    AUTO_UPDATE=true
    ;;
  0|false|no|off)
    AUTO_UPDATE=false
    ;;
  *)
    fail "invalid HZY_DATA_RUNTIME_AUTO_UPDATE value: $AUTO_UPDATE"
    ;;
esac

need_cmd curl
need_cmd tar
need_cmd install
need_cmd systemctl
need_cmd uname
need_cmd flock
need_cmd sync
need_cmd openssl
need_cmd grep

if [ -z "$RELEASE_PUBLIC_KEY_SOURCE" ] && [ -r "$CONFIG_DIR/release-signing-public.pem" ]; then
  RELEASE_PUBLIC_KEY_SOURCE="$CONFIG_DIR/release-signing-public.pem"
fi
[ -n "$RELEASE_PUBLIC_KEY_SOURCE" ] || fail "--release-public-key or HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_FILE is required"
[ -r "$RELEASE_PUBLIC_KEY_SOURCE" ] || fail "release public key is not readable: $RELEASE_PUBLIC_KEY_SOURCE"

machine="$(uname -m)"
case "$machine" in
  x86_64|amd64)
    ARCH="amd64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    fail "unsupported architecture: $machine"
    ;;
esac

LOCK_FILE="/run/lock/${SERVICE_NAME}-update.lock"
install -d -m 755 /run/lock
exec 9>"$LOCK_FILE"
chmod 600 "$LOCK_FILE"
flock -x 9

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="$TMP_DIR/package.tar.gz"
CHECKSUM_FILE="$TMP_DIR/package.tar.gz.sha256"
SIGNATURE_FILE="$TMP_DIR/package.tar.gz.sig"
EXTRACT_DIR="$TMP_DIR/extract"

download() {
  local url="$1"
  local output="$2"
  curl -fL --retry 3 --connect-timeout 10 --output "$output" "$url"
}

resolve_package_urls() {
  BASE_URL="${BASE_URL%/}"

  local resolved_version="$VERSION"
  if [ "$VERSION" = "latest" ]; then
    local version_file="$TMP_DIR/version.txt"
    download "$BASE_URL/latest/version.txt" "$version_file"
    resolved_version="$(tr -d '[:space:]' < "$version_file")"
    [ -n "$resolved_version" ] || fail "empty latest version file: $BASE_URL/latest/version.txt"
    echo "Resolved latest hzy-data-runtime version: $resolved_version"
  fi

  printf "%s" "$resolved_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$' \
    || fail "resolved version is not an exact semantic version: $resolved_version"

  local package_url_base="$BASE_URL/$resolved_version/hzy-data-runtime_${resolved_version}_linux_${ARCH}.tar.gz"
  local cache_buster="${HZY_DATA_RUNTIME_DOWNLOAD_CACHE_BUSTER:-$resolved_version}"
  PACKAGE_URL="${package_url_base}?v=${cache_buster}"
  CHECKSUM_URL="${package_url_base}.sha256?v=${cache_buster}"
  SIGNATURE_URL="${package_url_base}.sig?v=${cache_buster}"
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    fail "missing sha256sum or shasum for checksum verification"
  fi
}

verify_checksum() {
  if [ "${HZY_DATA_RUNTIME_SKIP_CHECKSUM:-}" = "1" ]; then
    echo "Skipping checksum verification because HZY_DATA_RUNTIME_SKIP_CHECKSUM=1"
    return
  fi

  download "$CHECKSUM_URL" "$CHECKSUM_FILE"
  local expected actual
  expected="$(awk '{print $1}' "$CHECKSUM_FILE" | head -n 1)"
  actual="$(sha256_file "$ARCHIVE")"
  [ -n "$expected" ] || fail "empty checksum file: $CHECKSUM_URL"
  [ "$expected" = "$actual" ] || fail "checksum mismatch for $PACKAGE_URL"
}

verify_signature() {
  download "$SIGNATURE_URL" "$SIGNATURE_FILE"
  openssl pkeyutl -verify -rawin -pubin \
    -inkey "$RELEASE_PUBLIC_KEY_SOURCE" \
    -in "$ARCHIVE" \
    -sigfile "$SIGNATURE_FILE" >/dev/null \
    || fail "Ed25519 release signature verification failed for $PACKAGE_URL"
}

env_quote() {
  local value="${1:-}"
  value="${value//$'\n'/}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

write_env_kv() {
  local key="$1"
  local value="${2:-}"
  printf "%s=%s\n" "$key" "$(env_quote "$value")"
}

write_env_if_set() {
  local key="$1"
  if [ -n "${!key+x}" ]; then
    write_env_kv "$key" "${!key}"
  fi
}

read_env_value() {
  local key="$1"
  local env_file="$CONFIG_DIR/.env"
  [ -f "$env_file" ] || return 1
  grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//" -e 's/^"//' -e 's/"$//'
}

env_default() {
  local key="$1"
  local fallback="${2:-}"
  if [ -n "${!key+x}" ]; then
    printf "%s" "${!key}"
  else
    read_env_value "$key" 2>/dev/null || printf "%s" "$fallback"
  fi
}

resolve_directory_connector_enabled() {
  local configured="$DIRECTORY_CONNECTOR_ENABLED"
  if [ -z "$configured" ]; then
    configured="$(read_env_value HZY_DIRECTORY_CONNECTOR_ENABLED 2>/dev/null || true)"
  fi
  # Compatibility for installations created before the enable flag was
  # persisted in the main Runtime environment.  A protected directory.env is
  # only written after successful Connector enrollment, so it is authoritative
  # evidence that the existing installation must keep the worker enabled.
  if [ -z "$configured" ] && [ -f "$CONFIG_DIR/directory.env" ]; then
    configured=true
  fi
  configured="${configured:-false}"

  case "$(printf "%s" "$configured" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      DIRECTORY_CONNECTOR_ENABLED=true
      ;;
    0|false|no|off)
      DIRECTORY_CONNECTOR_ENABLED=false
      ;;
    *)
      fail "invalid HZY_DIRECTORY_CONNECTOR_ENABLED value: $configured"
      ;;
  esac
  HZY_DIRECTORY_CONNECTOR_ENABLED="$DIRECTORY_CONNECTOR_ENABLED"
  export HZY_DIRECTORY_CONNECTOR_ENABLED
}

upsert_env_kv() {
  local env_file="$1"
  local key="$2"
  local value="${3:-}"
  local tmp_file="$TMP_DIR/env.${key}.$$"
  local line
  line="$(write_env_kv "$key" "$value")"

  awk -v key="$key" -v line="$line" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" {
      if (!replaced) {
        print line
        replaced = 1
      }
      next
    }
    { print }
    END {
      if (!replaced) {
        print line
      }
    }
  ' "$env_file" > "$tmp_file"

  install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" "$tmp_file" "$env_file"
}

should_sync_activation_key() {
  local key="$1"
  if [ -z "${!key+x}" ]; then
    return 1
  fi

  case "$key" in
    HZY_DATA_RUNTIME_TENANT|HZY_DATA_RUNTIME_DEPLOYMENT|HZY_DATA_RUNTIME_STATIC_TOKEN)
      [ -n "${!key}" ]
      ;;
    *)
      return 0
      ;;
  esac
}

sync_existing_activation_env() {
  local env_file="$1"
  local updated=0
  local backup_file=""
  local activation_keys=(
    HZY_DATA_RUNTIME_TENANT
    HZY_DATA_RUNTIME_DEPLOYMENT
    HZY_DATA_RUNTIME_STATIC_TOKEN
    HZY_DATA_RUNTIME_CONTROL_TOKEN
    HZY_DATA_RUNTIME_PLATFORM_URL
    HZY_DATA_RUNTIME_INSTANCE
    HZY_DATA_RUNTIME_PUBLIC_ENDPOINT
    HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64
    HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID
    HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID
    HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64
    HZY_DATA_RUNTIME_AUTH_MODE
    HZY_DATA_RUNTIME_JWT_ISSUER
    HZY_DATA_RUNTIME_JWT_AUDIENCE
    HZY_DATA_RUNTIME_JWKS_URL
    HZY_DATA_RUNTIME_JWKS_JSON
    HZY_FINANCE_AGENT_ENABLED
    HZY_WORKFLOW_AGENT_ENABLED
    HZY_WEBDEV_AGENT_ENABLED
    HZY_ASSETS_AGENT_ENABLED
    HZY_PEOPLE_AGENT_ENABLED
    HZY_ALTOC_AGENT_ENABLED
    HZY_AIMS_AGENT_ENABLED
    HZY_CODOCS_AGENT_ENABLED
    HZY_CONSOLE_RUNTIME_ENABLED
    HZY_DIRECTORY_CONNECTOR_ENABLED
    HZY_DIRECTORY_RUNTIME_ENABLED
  )
  local key

  for key in "${activation_keys[@]}"; do
    if ! should_sync_activation_key "$key"; then
      continue
    fi

    if [ "$updated" = "0" ]; then
      backup_file="${env_file}.bak.$(date +%Y%m%d%H%M%S)"
      install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" "$env_file" "$backup_file"
      updated=1
    fi

    upsert_env_kv "$env_file" "$key" "${!key}"
  done

  if [ "$updated" = "1" ]; then
    echo "Updated platform activation config in existing config: $env_file"
    echo "Backed up existing config: $backup_file"
  else
    echo "Preserved existing config: $env_file"
  fi
}

redeem_enrollment_if_present() {
  local enrollment_code="${HZY_DATA_RUNTIME_ENROLLMENT_CODE:-}"
  [ -n "$enrollment_code" ] || return 0

  local platform_url="${HZY_DATA_RUNTIME_PLATFORM_URL:-}"
  local runtime_code="${HZY_DATA_RUNTIME_INSTANCE:-${HZY_DATA_RUNTIME_DEPLOYMENT:-}}"
  [ -n "$platform_url" ] || fail "HZY_DATA_RUNTIME_PLATFORM_URL is required with an enrollment code"
  [ -n "$runtime_code" ] || fail "HZY_DATA_RUNTIME_INSTANCE is required with an enrollment code"

  local enrollment_env="$TMP_DIR/enrollment.env"
  echo "Redeeming the single-use tenant runtime enrollment code..."
  "$EXTRACT_DIR/hzy-data-runtime" enroll \
    --platform-url "$platform_url" \
    --code "$enrollment_code" \
    --runtime-code "$runtime_code" \
    --runtime-endpoint "${HZY_DATA_RUNTIME_PUBLIC_ENDPOINT:-}" \
    --expected-version "$VERSION" \
    --release-signing-key-id "${HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID:-}" \
    --output-env "$enrollment_env"
  set -a
  # The fragment is generated by the locally signature-verified runtime binary.
  # shellcheck disable=SC1090
  . "$enrollment_env"
  set +a
  unset HZY_DATA_RUNTIME_ENROLLMENT_CODE
  ENROLLMENT_REDEEMED=1
  echo "Tenant runtime enrollment redeemed. The code cannot be reused."
}

retire_stale_control_overlays_after_enrollment() {
  [ "$ENROLLMENT_REDEEMED" = "1" ] || return 0

  local timestamp overlay backup
  timestamp="$(date +%Y%m%d%H%M%S)"
  for overlay in platform-signing-key.json deployment-bindings.json; do
    [ -f "$CONFIG_DIR/$overlay" ] || continue
    backup="$CONFIG_DIR/${overlay}.bak.${timestamp}"
    mv "$CONFIG_DIR/$overlay" "$backup"
    echo "Backed up stale control-plane overlay: $backup"
  done
}

has_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
}

prompt_value() {
  local key="$1"
  local label="$2"
  local fallback="${3:-}"
  local secret="${4:-0}"
  local default value
  default="$(env_default "$key" "$fallback")"

  if [ -n "${!key+x}" ]; then
    printf "%s" "${!key}"
    return
  fi

  if ! has_tty; then
    printf "%s" "$default"
    return
  fi

  if [ "$secret" = "1" ]; then
    if [ -n "$default" ]; then
      printf "%s [keep existing, press Enter to keep]: " "$label" > /dev/tty
    else
      printf "%s: " "$label" > /dev/tty
    fi
    stty -echo < /dev/tty
    IFS= read -r value < /dev/tty || value=""
    stty echo < /dev/tty
    printf "\n" > /dev/tty
    if [ -z "$value" ]; then
      value="$default"
    fi
    printf "%s" "$value"
    return
  fi

  printf "%s [%s]: " "$label" "$default" > /dev/tty
  IFS= read -r value < /dev/tty || value=""
  if [ -z "$value" ]; then
    value="$default"
  fi
  printf "%s" "$value"
}

validate_port() {
  local key="$1"
  local value="$2"
  case "$value" in
    ''|*[!0-9]*)
      fail "$key must be a positive integer"
      ;;
  esac
  [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || fail "$key must be between 1 and 65535"
}

is_enabled() {
  local value
  value="$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    ''|0|false|no|off)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

configure_app_db_env() {
  local app_code="$1"
  local label="$2"
  local default_db="$3"
  local default_enabled="$4"
  local enabled_var="HZY_${app_code}_AGENT_ENABLED"
  local db_var="HZY_${app_code}_DB_NAME"
  local enabled db_name

  enabled="$(env_default "$enabled_var" "$default_enabled")"
  printf -v "$enabled_var" "%s" "$enabled"

  if is_enabled "$enabled"; then
    db_name="$(prompt_value "$db_var" "$label database name" "$default_db")"
    [ -n "$db_name" ] || fail "$db_var is required when $label Agent is enabled"
  else
    db_name="$(env_default "$db_var" "$default_db")"
  fi

  printf -v "$db_var" "%s" "$db_name"
}

configure_db_env() {
  echo "Configure database connection for hzy-data-runtime."

  HZY_DATA_RUNTIME_DB_HOST="$(prompt_value HZY_DATA_RUNTIME_DB_HOST "Database host" "127.0.0.1")"
  HZY_DATA_RUNTIME_DB_PORT="$(prompt_value HZY_DATA_RUNTIME_DB_PORT "Database port" "3306")"
  HZY_DATA_RUNTIME_DB_USER="$(prompt_value HZY_DATA_RUNTIME_DB_USER "Database user" "cf_app")"
  HZY_DATA_RUNTIME_DB_PASSWORD="$(prompt_value HZY_DATA_RUNTIME_DB_PASSWORD "Database password" "" 1)"
  HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT="$(prompt_value HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT "Database connection limit" "5")"

  configure_app_db_env FINANCE Finance hzy_finance true
  configure_app_db_env WORKFLOW Workflow hzy_workflow false
  configure_app_db_env WEBDEV WebDev hzy_webdev false
  configure_app_db_env ASSETS Assets hzy_assets false
  configure_app_db_env PEOPLE People hzy_people false
  configure_app_db_env ALTOC Altoc hzy_altoc false
  configure_app_db_env AIMS Aims hzy_aims false
  configure_app_db_env CODOCS Codocs hzy_codocs false
  HZY_CONSOLE_RUNTIME_ENABLED="$(env_default HZY_CONSOLE_RUNTIME_ENABLED false)"
  HZY_CONSOLE_DB_NAME="$(prompt_value HZY_CONSOLE_DB_NAME "Console Runtime database name" "hzy_console")"
  HZY_CONSOLE_VAULT_MASTER_KEY="$(prompt_value HZY_CONSOLE_VAULT_MASTER_KEY "Customer-held Console Vault master key" "" 1)"
  HZY_DIRECTORY_RUNTIME_ENABLED="$(env_default HZY_DIRECTORY_RUNTIME_ENABLED "$DIRECTORY_CONNECTOR_ENABLED")"
  HZY_DIRECTORY_DB_NAME="$(prompt_value HZY_DIRECTORY_DB_NAME "Directory database name" "hzy_console")"

  validate_port HZY_DATA_RUNTIME_DB_PORT "$HZY_DATA_RUNTIME_DB_PORT"
  validate_port HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT "$HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT"
  [ -n "$HZY_DATA_RUNTIME_DB_USER" ] || fail "HZY_DATA_RUNTIME_DB_USER is required"

  echo "Testing database connection before writing config..."
  if ! HZY_DATA_RUNTIME_DB_HOST="$HZY_DATA_RUNTIME_DB_HOST" \
      HZY_DATA_RUNTIME_DB_PORT="$HZY_DATA_RUNTIME_DB_PORT" \
      HZY_DATA_RUNTIME_DB_USER="$HZY_DATA_RUNTIME_DB_USER" \
      HZY_DATA_RUNTIME_DB_PASSWORD="$HZY_DATA_RUNTIME_DB_PASSWORD" \
      HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT="$HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT" \
      HZY_FINANCE_AGENT_ENABLED="$HZY_FINANCE_AGENT_ENABLED" \
      HZY_FINANCE_DB_NAME="$HZY_FINANCE_DB_NAME" \
      HZY_WORKFLOW_AGENT_ENABLED="$HZY_WORKFLOW_AGENT_ENABLED" \
      HZY_WORKFLOW_DB_NAME="$HZY_WORKFLOW_DB_NAME" \
      HZY_WEBDEV_AGENT_ENABLED="$HZY_WEBDEV_AGENT_ENABLED" \
      HZY_WEBDEV_DB_NAME="$HZY_WEBDEV_DB_NAME" \
      HZY_ASSETS_AGENT_ENABLED="$HZY_ASSETS_AGENT_ENABLED" \
      HZY_ASSETS_DB_NAME="$HZY_ASSETS_DB_NAME" \
      HZY_PEOPLE_AGENT_ENABLED="$HZY_PEOPLE_AGENT_ENABLED" \
      HZY_PEOPLE_DB_NAME="$HZY_PEOPLE_DB_NAME" \
      HZY_ALTOC_AGENT_ENABLED="$HZY_ALTOC_AGENT_ENABLED" \
      HZY_ALTOC_DB_NAME="$HZY_ALTOC_DB_NAME" \
      HZY_AIMS_AGENT_ENABLED="$HZY_AIMS_AGENT_ENABLED" \
      HZY_AIMS_DB_NAME="$HZY_AIMS_DB_NAME" \
      HZY_CODOCS_AGENT_ENABLED="$HZY_CODOCS_AGENT_ENABLED" \
      HZY_CODOCS_DB_NAME="$HZY_CODOCS_DB_NAME" \
      HZY_CONSOLE_RUNTIME_ENABLED="$HZY_CONSOLE_RUNTIME_ENABLED" \
      HZY_CONSOLE_DB_NAME="$HZY_CONSOLE_DB_NAME" \
      HZY_DIRECTORY_RUNTIME_ENABLED="$HZY_DIRECTORY_RUNTIME_ENABLED" \
      HZY_DIRECTORY_DB_NAME="$HZY_DIRECTORY_DB_NAME" \
      "$EXTRACT_DIR/hzy-data-runtime" --check-db; then
    fail "database connection check failed; config was not written"
  fi

  export HZY_DATA_RUNTIME_DB_HOST HZY_DATA_RUNTIME_DB_PORT HZY_DATA_RUNTIME_DB_USER
  export HZY_DATA_RUNTIME_DB_PASSWORD HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT
  export HZY_FINANCE_AGENT_ENABLED HZY_FINANCE_DB_NAME
  export HZY_WORKFLOW_AGENT_ENABLED HZY_WORKFLOW_DB_NAME
  export HZY_WEBDEV_AGENT_ENABLED HZY_WEBDEV_DB_NAME
  export HZY_ASSETS_AGENT_ENABLED HZY_ASSETS_DB_NAME
  export HZY_PEOPLE_AGENT_ENABLED HZY_PEOPLE_DB_NAME
  export HZY_ALTOC_AGENT_ENABLED HZY_ALTOC_DB_NAME
  export HZY_AIMS_AGENT_ENABLED HZY_AIMS_DB_NAME
  export HZY_CODOCS_AGENT_ENABLED HZY_CODOCS_DB_NAME
  export HZY_CONSOLE_RUNTIME_ENABLED HZY_CONSOLE_DB_NAME HZY_CONSOLE_VAULT_MASTER_KEY
  export HZY_DIRECTORY_RUNTIME_ENABLED HZY_DIRECTORY_DB_NAME
}

ensure_user_group() {
  if ! getent group "$RUN_GROUP" >/dev/null 2>&1; then
    groupadd --system "$RUN_GROUP"
  fi

  if ! id -u "$RUN_USER" >/dev/null 2>&1; then
    useradd --system --home "$INSTALL_DIR" --shell /sbin/nologin --gid "$RUN_GROUP" "$RUN_USER"
  fi

  if [ "$DIRECTORY_CONNECTOR_ENABLED" = "true" ]; then
    if ! getent group "$DIRECTORY_RUN_GROUP" >/dev/null 2>&1; then
      groupadd --system "$DIRECTORY_RUN_GROUP"
    fi
    if ! id -u "$DIRECTORY_RUN_USER" >/dev/null 2>&1; then
      useradd --system --home "$INSTALL_DIR" --shell /sbin/nologin --gid "$DIRECTORY_RUN_GROUP" "$DIRECTORY_RUN_USER"
    fi
  fi
}

read_directory_env_value() {
  local key="$1"
  local env_file="$CONFIG_DIR/directory.env"
  [ -f "$env_file" ] || return 1
  grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//" -e 's/^"//' -e 's/"$//'
}

directory_env_default() {
  local key="$1"
  local fallback="${2:-}"
  if [ -n "${!key+x}" ]; then
    printf "%s" "${!key}"
  else
    read_directory_env_value "$key" 2>/dev/null || printf "%s" "$fallback"
  fi
}

directory_connector_enrollment_required() {
  [ "$DIRECTORY_CONNECTOR_ENABLED" = "true" ] || return 1
  [ -n "${HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN:-}" ] || return 1

  local connector_id reenroll
  connector_id="$(directory_env_default HZY_DIRECTORY_CONNECTOR_ID "")"
  reenroll="${HZY_DIRECTORY_CONNECTOR_REENROLL:-false}"
  [ -z "$connector_id" ] || is_enabled "$reenroll"
}

write_directory_connector_env() {
  local env_file="$CONFIG_DIR/directory.env"
  if [ "$DIRECTORY_CONNECTOR_ENABLED" != "true" ]; then
    return
  fi
  local console_url runtime_url connector_id private_key state_cache
  console_url="$(directory_env_default HZY_DIRECTORY_CONNECTOR_CONSOLE_URL "")"
  runtime_url="$(directory_env_default HZY_DIRECTORY_CONNECTOR_RUNTIME_URL "http://127.0.0.1:$(env_default HZY_DATA_RUNTIME_PORT "18080")")"
  connector_id="$(directory_env_default HZY_DIRECTORY_CONNECTOR_ID "")"
  private_key="$(directory_env_default HZY_DIRECTORY_CONNECTOR_PRIVATE_KEY_FILE "$CONFIG_DIR/directory/directory-connector-private.pem")"
  state_cache="$(directory_env_default HZY_DIRECTORY_CONNECTOR_STATE_CACHE_FILE "$CONFIG_DIR/directory/state-cache.json")"
  install -d -m 700 -o "$DIRECTORY_RUN_USER" -g "$DIRECTORY_RUN_GROUP" "$CONFIG_DIR/directory"
  local reenroll="${HZY_DIRECTORY_CONNECTOR_REENROLL:-false}"
  if [ -n "${HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN:-}" ] \
      && { [ -z "$connector_id" ] || is_enabled "$reenroll"; }; then
    [ -n "$console_url" ] || fail "HZY_DIRECTORY_CONNECTOR_CONSOLE_URL is required to redeem an enrollment token"
    "$EXTRACT_DIR/hzy-data-runtime" directory-connector-enroll \
      --console-url "$console_url" \
      --token "$HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN" \
      --private-key-file "$private_key" \
      --output-env "$env_file"
    chown -R "$DIRECTORY_RUN_USER:$DIRECTORY_RUN_GROUP" "$CONFIG_DIR/directory" "$env_file"
    chmod 600 "$env_file" "$private_key"
    echo "Redeemed Directory Connector enrollment token."
    return
  fi
  if [ -n "${HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN:-}" ]; then
    echo "Preserved existing Directory Connector identity; enrollment token was not redeemed again."
  fi
  [ -n "$connector_id" ] || fail "HZY_DIRECTORY_CONNECTOR_ID or ENROLLMENT_TOKEN is required when Directory Connector is enabled"
  if [ -f "$private_key" ]; then
    chown "$DIRECTORY_RUN_USER:$DIRECTORY_RUN_GROUP" "$private_key"
    chmod 600 "$private_key"
  fi
  {
    write_env_kv HZY_DIRECTORY_CONNECTOR_RUNTIME_URL "$runtime_url"
    write_env_kv HZY_DIRECTORY_CONNECTOR_ID "$connector_id"
    write_env_kv HZY_DIRECTORY_CONNECTOR_PRIVATE_KEY_FILE "$private_key"
    write_env_kv HZY_DIRECTORY_CONNECTOR_STATE_CACHE_FILE "$state_cache"
    write_env_kv HZY_DIRECTORY_CONNECTOR_POLL_SECONDS "$(directory_env_default HZY_DIRECTORY_CONNECTOR_POLL_SECONDS "3")"
    write_env_kv HZY_DIRECTORY_CONNECTOR_HTTP_TIMEOUT_SECONDS "$(directory_env_default HZY_DIRECTORY_CONNECTOR_HTTP_TIMEOUT_SECONDS "30")"
    write_env_kv HZY_DIRECTORY_CONNECTOR_CONFIG_RETRY_SECONDS "$(directory_env_default HZY_DIRECTORY_CONNECTOR_CONFIG_RETRY_SECONDS "300")"
  } > "$env_file"
  chown "$DIRECTORY_RUN_USER:$DIRECTORY_RUN_GROUP" "$env_file"
  chmod 600 "$env_file"
}

create_env_if_missing() {
  local env_file="$CONFIG_DIR/.env"
  local legacy_env="$INSTALL_DIR/.env"

  if [ ! -f "$env_file" ] && [ -f "$legacy_env" ]; then
    install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" "$legacy_env" "$env_file"
    echo "Migrated legacy config: $legacy_env -> $env_file"
  fi

  if [ -f "$env_file" ] && [ "$RECONFIGURE" != "1" ]; then
    redeem_enrollment_if_present
    sync_existing_activation_env "$env_file"
    return
  fi

  configure_db_env
  redeem_enrollment_if_present

  local auth_mode token
  auth_mode="$(env_default HZY_DATA_RUNTIME_AUTH_MODE "static_token")"
  token="${HZY_DATA_RUNTIME_STATIC_TOKEN:-$(read_env_value HZY_DATA_RUNTIME_STATIC_TOKEN 2>/dev/null || true)}"
  if [ "$auth_mode" = "static_token" ] && [ -z "$token" ]; then
    fail "missing HZY_DATA_RUNTIME_STATIC_TOKEN. Use the platform-generated enrollment command, or set HZY_DATA_RUNTIME_AUTH_MODE=disabled for local development."
  fi

  if [ -f "$env_file" ]; then
    local backup_file="${env_file}.bak.$(date +%Y%m%d%H%M%S)"
    install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" "$env_file" "$backup_file"
    echo "Backed up existing config: $backup_file"
  fi

  {
    write_env_kv HZY_DATA_RUNTIME_HOST "$(env_default HZY_DATA_RUNTIME_HOST "0.0.0.0")"
    write_env_kv HZY_DATA_RUNTIME_PORT "$(env_default HZY_DATA_RUNTIME_PORT "18080")"
    write_env_kv HZY_DATA_RUNTIME_TENANT "$(env_default HZY_DATA_RUNTIME_TENANT "tenant-code")"
    write_env_kv HZY_DATA_RUNTIME_DEPLOYMENT "$(env_default HZY_DATA_RUNTIME_DEPLOYMENT "deployment-code")"
    echo
    write_env_kv HZY_DATA_RUNTIME_DB_HOST "${HZY_DATA_RUNTIME_DB_HOST:-127.0.0.1}"
    write_env_kv HZY_DATA_RUNTIME_DB_PORT "${HZY_DATA_RUNTIME_DB_PORT:-3306}"
    write_env_kv HZY_DATA_RUNTIME_DB_USER "${HZY_DATA_RUNTIME_DB_USER:-cf_app}"
    write_env_kv HZY_DATA_RUNTIME_DB_PASSWORD "${HZY_DATA_RUNTIME_DB_PASSWORD:-}"
    write_env_kv HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT "${HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT:-5}"
    echo
    write_env_kv HZY_DATA_RUNTIME_AUTH_MODE "$auth_mode"
    write_env_kv HZY_DATA_RUNTIME_STATIC_TOKEN "$token"
    write_env_if_set HZY_DATA_RUNTIME_CONTROL_TOKEN
    write_env_if_set HZY_DATA_RUNTIME_PLATFORM_URL
    write_env_if_set HZY_DATA_RUNTIME_INSTANCE
    write_env_if_set HZY_DATA_RUNTIME_PUBLIC_ENDPOINT
    write_env_if_set HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64
    write_env_if_set HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID
    write_env_if_set HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID
    write_env_if_set HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64
    write_env_kv HZY_DATA_RUNTIME_JWT_AUDIENCE "$(env_default HZY_DATA_RUNTIME_JWT_AUDIENCE "data-runtime")"
    local jwks_url jwks_json
    jwks_url="$(env_default HZY_DATA_RUNTIME_JWKS_URL "")"
    jwks_json="$(env_default HZY_DATA_RUNTIME_JWKS_JSON "")"
    if [ -n "$jwks_url" ]; then
      write_env_kv HZY_DATA_RUNTIME_JWKS_URL "$jwks_url"
    fi
    if [ -n "$jwks_json" ]; then
      write_env_kv HZY_DATA_RUNTIME_JWKS_JSON "$jwks_json"
    fi
    echo
    write_env_kv HZY_FINANCE_AGENT_ENABLED "${HZY_FINANCE_AGENT_ENABLED:-true}"
    write_env_kv HZY_FINANCE_DB_NAME "${HZY_FINANCE_DB_NAME:-hzy_finance}"
    write_env_if_set HZY_FINANCE_DB_HOST
    write_env_if_set HZY_FINANCE_DB_PORT
    write_env_if_set HZY_FINANCE_DB_USER
    write_env_if_set HZY_FINANCE_DB_PASSWORD
    write_env_if_set HZY_FINANCE_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_WORKFLOW_AGENT_ENABLED "${HZY_WORKFLOW_AGENT_ENABLED:-false}"
    write_env_kv HZY_WORKFLOW_DB_NAME "${HZY_WORKFLOW_DB_NAME:-hzy_workflow}"
    write_env_if_set HZY_WORKFLOW_DB_HOST
    write_env_if_set HZY_WORKFLOW_DB_PORT
    write_env_if_set HZY_WORKFLOW_DB_USER
    write_env_if_set HZY_WORKFLOW_DB_PASSWORD
    write_env_if_set HZY_WORKFLOW_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_WEBDEV_AGENT_ENABLED "${HZY_WEBDEV_AGENT_ENABLED:-false}"
    write_env_kv HZY_WEBDEV_DB_NAME "${HZY_WEBDEV_DB_NAME:-hzy_webdev}"
    write_env_if_set HZY_WEBDEV_DB_HOST
    write_env_if_set HZY_WEBDEV_DB_PORT
    write_env_if_set HZY_WEBDEV_DB_USER
    write_env_if_set HZY_WEBDEV_DB_PASSWORD
    write_env_if_set HZY_WEBDEV_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_ASSETS_AGENT_ENABLED "${HZY_ASSETS_AGENT_ENABLED:-false}"
    write_env_kv HZY_ASSETS_DB_NAME "${HZY_ASSETS_DB_NAME:-hzy_assets}"
    write_env_if_set HZY_ASSETS_DB_HOST
    write_env_if_set HZY_ASSETS_DB_PORT
    write_env_if_set HZY_ASSETS_DB_USER
    write_env_if_set HZY_ASSETS_DB_PASSWORD
    write_env_if_set HZY_ASSETS_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_PEOPLE_AGENT_ENABLED "${HZY_PEOPLE_AGENT_ENABLED:-false}"
    write_env_kv HZY_PEOPLE_DB_NAME "${HZY_PEOPLE_DB_NAME:-hzy_people}"
    write_env_if_set HZY_PEOPLE_DB_HOST
    write_env_if_set HZY_PEOPLE_DB_PORT
    write_env_if_set HZY_PEOPLE_DB_USER
    write_env_if_set HZY_PEOPLE_DB_PASSWORD
    write_env_if_set HZY_PEOPLE_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_ALTOC_AGENT_ENABLED "${HZY_ALTOC_AGENT_ENABLED:-false}"
    write_env_kv HZY_ALTOC_DB_NAME "${HZY_ALTOC_DB_NAME:-hzy_altoc}"
    write_env_if_set HZY_ALTOC_DB_HOST
    write_env_if_set HZY_ALTOC_DB_PORT
    write_env_if_set HZY_ALTOC_DB_USER
    write_env_if_set HZY_ALTOC_DB_PASSWORD
    write_env_if_set HZY_ALTOC_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_AIMS_AGENT_ENABLED "${HZY_AIMS_AGENT_ENABLED:-false}"
    write_env_kv HZY_AIMS_DB_NAME "${HZY_AIMS_DB_NAME:-hzy_aims}"
    write_env_if_set HZY_AIMS_DB_HOST
    write_env_if_set HZY_AIMS_DB_PORT
    write_env_if_set HZY_AIMS_DB_USER
    write_env_if_set HZY_AIMS_DB_PASSWORD
    write_env_if_set HZY_AIMS_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_CODOCS_AGENT_ENABLED "${HZY_CODOCS_AGENT_ENABLED:-false}"
    write_env_kv HZY_CODOCS_DB_NAME "${HZY_CODOCS_DB_NAME:-hzy_codocs}"
    write_env_if_set HZY_CODOCS_DB_HOST
    write_env_if_set HZY_CODOCS_DB_PORT
    write_env_if_set HZY_CODOCS_DB_USER
    write_env_if_set HZY_CODOCS_DB_PASSWORD
    write_env_if_set HZY_CODOCS_DB_CONNECTION_LIMIT
    echo
    write_env_kv HZY_CONSOLE_RUNTIME_ENABLED "${HZY_CONSOLE_RUNTIME_ENABLED:-false}"
    write_env_kv HZY_CONSOLE_DB_NAME "${HZY_CONSOLE_DB_NAME:-hzy_console}"
    write_env_if_set HZY_CONSOLE_DB_HOST
    write_env_if_set HZY_CONSOLE_DB_PORT
    write_env_if_set HZY_CONSOLE_DB_USER
    write_env_if_set HZY_CONSOLE_DB_PASSWORD
    write_env_if_set HZY_CONSOLE_DB_CONNECTION_LIMIT
    write_env_if_set HZY_CONSOLE_VAULT_MASTER_KEY
    write_env_kv HZY_CONSOLE_VAULT_MASTER_KEY_FILE "${HZY_CONSOLE_VAULT_MASTER_KEY_FILE:-$CONFIG_DIR/console-vault-master-key}"
    echo
    write_env_kv HZY_DIRECTORY_CONNECTOR_ENABLED "$DIRECTORY_CONNECTOR_ENABLED"
    write_env_kv HZY_DIRECTORY_RUNTIME_ENABLED "${HZY_DIRECTORY_RUNTIME_ENABLED:-$DIRECTORY_CONNECTOR_ENABLED}"
    write_env_kv HZY_DIRECTORY_DB_NAME "${HZY_DIRECTORY_DB_NAME:-hzy_console}"
    write_env_if_set HZY_DIRECTORY_DB_HOST
    write_env_if_set HZY_DIRECTORY_DB_PORT
    write_env_if_set HZY_DIRECTORY_DB_USER
    write_env_if_set HZY_DIRECTORY_DB_PASSWORD
    write_env_if_set HZY_DIRECTORY_DB_CONNECTION_LIMIT
  } > "$env_file"

  chown "$RUN_USER:$RUN_GROUP" "$env_file"
  chmod 600 "$env_file"
  echo "Created config: $env_file"
  if [ "$auth_mode" = "static_token" ]; then
    echo "Static token was written from the platform-provided install command."
  fi
}

write_service_unit() {
  local unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
  cat > "$unit_path" <<UNIT
[Unit]
Description=HZY Data Runtime Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$CONFIG_DIR/.env
ExecStart=$INSTALL_DIR/hzy-data-runtime
Restart=always
RestartSec=3
User=$RUN_USER
Group=$RUN_GROUP

[Install]
WantedBy=multi-user.target
UNIT
  chmod 644 "$unit_path"
  echo "Wrote systemd unit: $unit_path"
}

write_directory_connector_unit() {
  local unit_path="/etc/systemd/system/${SERVICE_NAME}-directory.service"
  if [ "$DIRECTORY_CONNECTOR_ENABLED" != "true" ]; then
    systemctl disable --now "${SERVICE_NAME}-directory.service" >/dev/null 2>&1 || true
    rm -f "$unit_path"
    return
  fi
  cat > "$unit_path" <<UNIT
[Unit]
Description=HZY Data Runtime Directory Connector
After=network-online.target ${SERVICE_NAME}.service
Wants=network-online.target
PartOf=${SERVICE_NAME}.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$CONFIG_DIR/directory.env
ExecStart=$INSTALL_DIR/hzy-data-runtime directory-connector
Restart=always
RestartSec=5
User=$DIRECTORY_RUN_USER
Group=$DIRECTORY_RUN_GROUP
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$CONFIG_DIR

[Install]
WantedBy=multi-user.target
UNIT
  chmod 644 "$unit_path"
  echo "Wrote Directory Connector unit: $unit_path"
}

write_update_units() {
  local update_service="${SERVICE_NAME}-update"
  local update_service_path="/etc/systemd/system/${update_service}.service"
  local update_timer_path="/etc/systemd/system/${update_service}.timer"
  local update_request_service="${SERVICE_NAME}-update-request"
  local update_request_service_path="/etc/systemd/system/${update_request_service}.service"
  local update_request_path="/etc/systemd/system/${update_request_service}.path"
  local update_request_env="$CONFIG_DIR/update-request.env"
  local update_journal="$CONFIG_DIR/update-journal.json"
  local auto_update_policy="$CONFIG_DIR/auto-update-policy.json"

  cat > "$update_request_service_path" <<UNIT
[Unit]
Description=Run API-triggered HZY Data Runtime Agent update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
UMask=0077
EnvironmentFile=-$update_request_env
ExecStart=$INSTALL_DIR/hzy-data-runtime update --trigger api --base-url $BASE_URL --install-dir $INSTALL_DIR --service-name $SERVICE_NAME --release-public-key-file $CONFIG_DIR/release-signing-public.pem --journal-file $update_journal --policy-file $auto_update_policy --lock-file $LOCK_FILE
UNIT

  cat > "$update_request_path" <<UNIT
[Unit]
Description=Watch API-triggered HZY Data Runtime Agent update requests

[Path]
PathChanged=$update_request_env
Unit=${update_request_service}.service

[Install]
WantedBy=multi-user.target
UNIT

  chmod 644 "$update_request_service_path" "$update_request_path"

  if [ "$AUTO_UPDATE" != "true" ]; then
    systemctl disable --now "${update_service}.timer" >/dev/null 2>&1 || true
    rm -f "$update_service_path" "$update_timer_path"
    echo "Auto-update timer disabled. API-triggered update path remains available."
    return
  fi

  cat > "$update_service_path" <<UNIT
[Unit]
Description=Update HZY Data Runtime Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
UMask=0077
ExecStart=$INSTALL_DIR/hzy-data-runtime update --trigger timer --base-url $BASE_URL --version $UPDATE_VERSION --install-dir $INSTALL_DIR --service-name $SERVICE_NAME --release-public-key-file $CONFIG_DIR/release-signing-public.pem --journal-file $update_journal --policy-file $auto_update_policy --lock-file $LOCK_FILE
UNIT

  cat > "$update_timer_path" <<UNIT
[Unit]
Description=Run HZY Data Runtime Agent update every $UPDATE_INTERVAL

[Timer]
OnBootSec=2min
OnUnitActiveSec=$UPDATE_INTERVAL
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  chmod 644 "$update_service_path" "$update_timer_path"
  echo "Wrote systemd update units: $update_service_path, $update_timer_path, $update_request_service_path, $update_request_path"
}

ensure_update_journal_access() {
  local update_journal="$CONFIG_DIR/update-journal.json"
  if [ -e "$update_journal" ]; then
    chown "$RUN_USER:$RUN_GROUP" "$update_journal"
    chmod 600 "$update_journal"
    return
  fi

  local triggered_at
  triggered_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local temporary_journal="$CONFIG_DIR/.update-journal-install.$$"
  printf '%s\n' \
    "{\"schemaVersion\":1,\"operationId\":\"install-bootstrap\",\"trigger\":\"manual\",\"status\":\"skipped\",\"phase\":\"skipped\",\"targetVersion\":\"$UPDATE_VERSION\",\"triggeredAt\":\"$triggered_at\",\"automaticRetry\":false}" \
    > "$temporary_journal"
  chown "$RUN_USER:$RUN_GROUP" "$temporary_journal"
  chmod 600 "$temporary_journal"
  mv -f "$temporary_journal" "$update_journal"
}

echo "Downloading hzy-data-runtime package:"
resolve_package_urls
echo "  $PACKAGE_URL"
download "$PACKAGE_URL" "$ARCHIVE"
verify_checksum
verify_signature

mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
[ -x "$EXTRACT_DIR/hzy-data-runtime" ] || fail "package does not contain executable hzy-data-runtime"

resolve_directory_connector_enabled
if [ "$NO_START" = "1" ] && directory_connector_enrollment_required; then
  fail "--no-start cannot redeem a Directory Connector enrollment token because the Runtime must first load the new activation config"
fi
ensure_user_group
install -d -m 755 "$INSTALL_DIR"
config_dir_group="$RUN_GROUP"
if [ "$DIRECTORY_CONNECTOR_ENABLED" = "true" ]; then
  config_dir_group="$DIRECTORY_RUN_GROUP"
fi
install -d -m 750 -o "$RUN_USER" -g "$config_dir_group" "$CONFIG_DIR"
if [ "$RELEASE_PUBLIC_KEY_SOURCE" != "$CONFIG_DIR/release-signing-public.pem" ]; then
  install -m 600 -o root -g root "$RELEASE_PUBLIC_KEY_SOURCE" "$CONFIG_DIR/release-signing-public.pem"
else
  chmod 600 "$CONFIG_DIR/release-signing-public.pem"
fi
if [ ! -f "$CONFIG_DIR/update-request.env" ]; then
  install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" /dev/null "$CONFIG_DIR/update-request.env"
else
  chown "$RUN_USER:$RUN_GROUP" "$CONFIG_DIR/update-request.env"
  chmod 600 "$CONFIG_DIR/update-request.env"
fi

create_env_if_missing
retire_stale_control_overlays_after_enrollment
write_service_unit
write_directory_connector_unit
ensure_update_journal_access
write_update_units
systemctl daemon-reload

for name in .env.example config.example.json README.md VERSION; do
  if [ -f "$EXTRACT_DIR/$name" ]; then
    install -m 644 "$EXTRACT_DIR/$name" "$INSTALL_DIR/$name"
  fi
done

if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
fi
if systemctl list-unit-files "${SERVICE_NAME}-directory.service" >/dev/null 2>&1; then
  systemctl stop "${SERVICE_NAME}-directory" >/dev/null 2>&1 || true
fi

if [ -x "$INSTALL_DIR/hzy-data-runtime" ]; then
  install -m 755 "$INSTALL_DIR/hzy-data-runtime" "$INSTALL_DIR/.hzy-data-runtime.previous.new"
  sync "$INSTALL_DIR/.hzy-data-runtime.previous.new"
  mv -f "$INSTALL_DIR/.hzy-data-runtime.previous.new" "$INSTALL_DIR/hzy-data-runtime.previous"
fi
install -m 755 "$EXTRACT_DIR/hzy-data-runtime" "$INSTALL_DIR/.hzy-data-runtime.new"
sync "$INSTALL_DIR/.hzy-data-runtime.new"
mv -f "$INSTALL_DIR/.hzy-data-runtime.new" "$INSTALL_DIR/hzy-data-runtime"
chown root:root "$INSTALL_DIR/hzy-data-runtime"

policy_state="tracking"
if [ "$AUTO_UPDATE" != "true" ]; then
  policy_state="disabled"
fi
"$INSTALL_DIR/hzy-data-runtime" auto-update init \
  --policy-file "$CONFIG_DIR/auto-update-policy.json" \
  --lock-file "$LOCK_FILE" \
  --state "$policy_state" \
  --target-version "$UPDATE_VERSION"
chmod 600 "$CONFIG_DIR/auto-update-policy.json"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
if [ "$DIRECTORY_CONNECTOR_ENABLED" = "true" ]; then
  systemctl enable "${SERVICE_NAME}-directory" >/dev/null
fi
if [ "$AUTO_UPDATE" = "true" ]; then
  systemctl enable "${SERVICE_NAME}-update.timer" >/dev/null
fi
systemctl enable "${SERVICE_NAME}-update-request.path" >/dev/null

if [ "$NO_START" = "1" ]; then
  write_directory_connector_env
  echo "Installed hzy-data-runtime. Service start skipped because --no-start was set."
else
  systemctl restart "$SERVICE_NAME"
  port="$(read_env_value HZY_DATA_RUNTIME_PORT || true)"
  port="${port:-18080}"
  health_url="http://127.0.0.1:${port}/runtime/health"

  ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done

  if [ "$ok" = "1" ]; then
    echo "hzy-data-runtime is running: $health_url"
  else
    echo "hzy-data-runtime was installed, but health check did not pass yet."
    echo "Run: journalctl -u $SERVICE_NAME -n 100 --no-pager"
    if directory_connector_enrollment_required; then
      fail "Runtime health must pass before redeeming the Directory Connector enrollment token"
    fi
  fi

  write_directory_connector_env
  if [ "$DIRECTORY_CONNECTOR_ENABLED" = "true" ]; then
    systemctl restart "${SERVICE_NAME}-directory"
  fi
  if [ "$AUTO_UPDATE" = "true" ]; then
    systemctl restart "${SERVICE_NAME}-update.timer"
  fi
  systemctl restart "${SERVICE_NAME}-update-request.path"
fi

"$INSTALL_DIR/hzy-data-runtime" --version || true
echo "Config: $CONFIG_DIR/.env"
echo "Service: $SERVICE_NAME"
if [ "$DIRECTORY_CONNECTOR_ENABLED" = "true" ]; then
  echo "Directory Connector: ${SERVICE_NAME}-directory"
fi
if [ "$AUTO_UPDATE" = "true" ]; then
  echo "Auto-update: ${SERVICE_NAME}-update.timer ($UPDATE_INTERVAL, target $UPDATE_VERSION)"
else
  echo "Auto-update: disabled"
fi
echo "API-triggered update: ${SERVICE_NAME}-update-request.path"
