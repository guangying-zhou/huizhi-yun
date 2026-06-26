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
AUTO_UPDATE="${HZY_DATA_RUNTIME_AUTO_UPDATE:-true}"
UPDATE_INTERVAL="${HZY_DATA_RUNTIME_UPDATE_INTERVAL:-5min}"
UPDATE_VERSION="${HZY_DATA_RUNTIME_UPDATE_VERSION:-latest}"
NO_START=0
RECONFIGURE=0

usage() {
  cat <<'USAGE'
Install or upgrade hzy-data-runtime.

Usage:
  curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash
  curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --version 0.2.8

Options:
  --version <version>      Install a pinned version. Default: latest
  --base-url <url>         Package base URL. Default: https://downloads.huizhi.yun/packages/hzy-data-runtime
  --install-dir <dir>      Binary and example files directory. Default: /opt/hzy-data-runtime
  --config-dir <dir>       Runtime config directory. Default: /etc/hzy-data-runtime
  --service-name <name>    systemd service name. Default: hzy-data-runtime
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

[ "$(id -u)" -eq 0 ] || fail "run as root, for example: curl -fsSL $DEFAULT_BASE_URL/install.sh | sudo bash"

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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="$TMP_DIR/package.tar.gz"
CHECKSUM_FILE="$TMP_DIR/package.tar.gz.sha256"
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

  local package_url_base="$BASE_URL/$resolved_version/hzy-data-runtime_${resolved_version}_linux_${ARCH}.tar.gz"
  local cache_buster="${HZY_DATA_RUNTIME_DOWNLOAD_CACHE_BUSTER:-$resolved_version}"
  PACKAGE_URL="${package_url_base}?v=${cache_buster}"
  CHECKSUM_URL="${package_url_base}.sha256?v=${cache_buster}"
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
    HZY_FINANCE_AGENT_ENABLED
    HZY_WORKFLOW_AGENT_ENABLED
    HZY_WEBDEV_AGENT_ENABLED
    HZY_ASSETS_AGENT_ENABLED
    HZY_PEOPLE_AGENT_ENABLED
    HZY_ALTOC_AGENT_ENABLED
    HZY_AIMS_AGENT_ENABLED
    HZY_CODOCS_AGENT_ENABLED
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
}

ensure_user_group() {
  if ! getent group "$RUN_GROUP" >/dev/null 2>&1; then
    groupadd --system "$RUN_GROUP"
  fi

  if ! id -u "$RUN_USER" >/dev/null 2>&1; then
    useradd --system --home "$INSTALL_DIR" --shell /sbin/nologin --gid "$RUN_GROUP" "$RUN_USER"
  fi
}

create_env_if_missing() {
  local env_file="$CONFIG_DIR/.env"
  local legacy_env="$INSTALL_DIR/.env"

  if [ ! -f "$env_file" ] && [ -f "$legacy_env" ]; then
    install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" "$legacy_env" "$env_file"
    echo "Migrated legacy config: $legacy_env -> $env_file"
  fi

  if [ -f "$env_file" ] && [ "$RECONFIGURE" != "1" ]; then
    sync_existing_activation_env "$env_file"
    return
  fi

  local auth_mode token
  auth_mode="$(env_default HZY_DATA_RUNTIME_AUTH_MODE "static_token")"
  token="${HZY_DATA_RUNTIME_STATIC_TOKEN:-$(read_env_value HZY_DATA_RUNTIME_STATIC_TOKEN 2>/dev/null || true)}"
  if [ "$auth_mode" = "static_token" ] && [ -z "$token" ]; then
    fail "missing HZY_DATA_RUNTIME_STATIC_TOKEN. Use the platform-generated install command, or set HZY_DATA_RUNTIME_AUTH_MODE=disabled for local development."
  fi

  configure_db_env

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

write_update_units() {
  local update_service="${SERVICE_NAME}-update"
  local update_service_path="/etc/systemd/system/${update_service}.service"
  local update_timer_path="/etc/systemd/system/${update_service}.timer"
  local update_request_service="${SERVICE_NAME}-update-request"
  local update_request_service_path="/etc/systemd/system/${update_request_service}.service"
  local update_request_path="/etc/systemd/system/${update_request_service}.path"
  local update_request_env="$CONFIG_DIR/update-request.env"

  cat > "$update_request_service_path" <<UNIT
[Unit]
Description=Run API-triggered HZY Data Runtime Agent update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-$update_request_env
ExecStart=$INSTALL_DIR/hzy-data-runtime update --install-dir $INSTALL_DIR --service-name $SERVICE_NAME
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
ExecStart=$INSTALL_DIR/hzy-data-runtime update --base-url $BASE_URL --version $UPDATE_VERSION --install-dir $INSTALL_DIR --service-name $SERVICE_NAME
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

echo "Downloading hzy-data-runtime package:"
resolve_package_urls
echo "  $PACKAGE_URL"
download "$PACKAGE_URL" "$ARCHIVE"
verify_checksum

mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
[ -x "$EXTRACT_DIR/hzy-data-runtime" ] || fail "package does not contain executable hzy-data-runtime"

ensure_user_group
install -d -m 755 "$INSTALL_DIR"
install -d -m 750 -o "$RUN_USER" -g "$RUN_GROUP" "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/update-request.env" ]; then
  install -m 600 -o "$RUN_USER" -g "$RUN_GROUP" /dev/null "$CONFIG_DIR/update-request.env"
else
  chown "$RUN_USER:$RUN_GROUP" "$CONFIG_DIR/update-request.env"
  chmod 600 "$CONFIG_DIR/update-request.env"
fi

create_env_if_missing
write_service_unit
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

install -m 755 "$EXTRACT_DIR/hzy-data-runtime" "$INSTALL_DIR/hzy-data-runtime.new"
mv -f "$INSTALL_DIR/hzy-data-runtime.new" "$INSTALL_DIR/hzy-data-runtime"
chown root:root "$INSTALL_DIR/hzy-data-runtime"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
if [ "$AUTO_UPDATE" = "true" ]; then
  systemctl enable "${SERVICE_NAME}-update.timer" >/dev/null
fi
systemctl enable "${SERVICE_NAME}-update-request.path" >/dev/null

if [ "$NO_START" = "1" ]; then
  echo "Installed hzy-data-runtime. Service start skipped because --no-start was set."
else
  systemctl restart "$SERVICE_NAME"
  if [ "$AUTO_UPDATE" = "true" ]; then
    systemctl restart "${SERVICE_NAME}-update.timer"
  fi
  systemctl restart "${SERVICE_NAME}-update-request.path"
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
  fi
fi

"$INSTALL_DIR/hzy-data-runtime" --version || true
echo "Config: $CONFIG_DIR/.env"
echo "Service: $SERVICE_NAME"
if [ "$AUTO_UPDATE" = "true" ]; then
  echo "Auto-update: ${SERVICE_NAME}-update.timer ($UPDATE_INTERVAL, target $UPDATE_VERSION)"
else
  echo "Auto-update: disabled"
fi
echo "API-triggered update: ${SERVICE_NAME}-update-request.path"
