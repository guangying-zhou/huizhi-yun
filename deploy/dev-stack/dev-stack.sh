#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STACK_ENV="local"
COMMAND="status"
APP_NAME=""
DEFAULT_DEV_STACK_APPS="console,workflow"
ALL_DEV_STACK_APPS="console codocs aims altoc assets workflow finance"

usage() {
  cat <<'EOF'
Usage:
  deploy/dev-stack/dev-stack.sh [--env local|staging] <command> [app]

Commands:
  up          Start or reload all enabled dev processes with PM2.
  down        Delete all hzy-* dev processes from PM2.
  restart     Restart all enabled dev processes.
  status      Show PM2 status for hzy-* processes.
  logs [app]  Tail logs for all hzy-* processes or a single app, e.g. logs aims.
  update      git pull, pnpm install, optional typecheck, then reload PM2.
  proxy       Reload Caddy with the matching Caddyfile.
  doctor      Check required local tools and print effective config paths.

Examples:
  deploy/dev-stack/dev-stack.sh --env local up
  deploy/dev-stack/dev-stack.sh --env staging update
  deploy/dev-stack/dev-stack.sh --env staging logs aims
  sudo caddy run --config deploy/dev-stack/Caddyfile.staging
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      STACK_ENV="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    up|down|restart|status|logs|update|proxy|doctor)
      COMMAND="$1"
      shift
      if [[ "${COMMAND}" == "logs" && $# -gt 0 ]]; then
        APP_NAME="$1"
        shift
      fi
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${STACK_ENV}" ]]; then
  echo "--env value is required" >&2
  exit 2
fi

ENV_FILE="${SCRIPT_DIR}/env.${STACK_ENV}"
ENV_EXAMPLE_FILE="${SCRIPT_DIR}/env.${STACK_ENV}.example"
CADDY_FILE="${SCRIPT_DIR}/Caddyfile.${STACK_ENV}"
ECOSYSTEM_FILE="${SCRIPT_DIR}/ecosystem.config.cjs"

if [[ ! -f "${ENV_FILE}" && ! -f "${ENV_EXAMPLE_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE} or ${ENV_EXAMPLE_FILE}" >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

load_shell_env() {
  local file="${ENV_FILE}"
  if [[ ! -f "${file}" ]]; then
    file="${ENV_EXAMPLE_FILE}"
  fi

  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a

  while IFS= read -r line || [[ -n "${line}" ]]; do
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    if [[ -z "${trimmed}" || "${trimmed}" == \#* || "${trimmed}" != *=* ]]; then
      continue
    fi

    local key="${trimmed%%=*}"
    local value="${trimmed#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ -z "${value}" || "${value}" == '""' || "${value}" == "''" ]]; then
      unset "${key}"
    fi
  done <"${file}"
}

all_pm2_names() {
  echo hzy-console hzy-codocs hzy-aims hzy-altoc hzy-assets hzy-workflow hzy-finance
}

enabled_apps() {
  local raw="${HZY_DEV_STACK_APPS:-${DEFAULT_DEV_STACK_APPS}}"
  raw="${raw//,/ }"
  for app in ${raw}; do
    if [[ -n "${app}" ]]; then
      echo "${app}"
    fi
  done
}

enabled_pm2_names() {
  for app in $(enabled_apps); do
    echo "hzy-${app}"
  done
}

is_enabled_app() {
  local target="$1"
  for app in $(enabled_apps); do
    if [[ "${app}" == "${target}" ]]; then
      return 0
    fi
  done
  return 1
}

pm2_delete_disabled() {
  for app in ${ALL_DEV_STACK_APPS}; do
    if ! is_enabled_app "${app}"; then
      pm2 delete "hzy-${app}" >/dev/null 2>&1 || true
    fi
  done
}

pm2_start_or_reload() {
  pm2_delete_disabled
  HZY_DEV_STACK_ENV="${STACK_ENV}" HZY_DEV_STACK_ROOT="${ROOT_DIR}" HZY_DEV_STACK_PNPM="$(command -v pnpm)" \
    pm2 startOrReload "${ECOSYSTEM_FILE}" --update-env
}

pm2_restart() {
  pm2_delete_disabled
  for name in $(enabled_pm2_names); do
    pm2 restart "${name}" --update-env >/dev/null 2>&1 || true
  done
  pm2 status
}

pm2_delete() {
  for name in $(all_pm2_names); do
    pm2 delete "${name}" >/dev/null 2>&1 || true
  done
  pm2 status
}

run_install() {
  require_cmd pnpm
  cd "${ROOT_DIR}"
  pnpm install
}

run_typecheck_if_enabled() {
  if [[ "${HZY_DEV_STACK_RUN_TYPECHECK:-false}" == "true" ]]; then
    cd "${ROOT_DIR}"
    pnpm -r typecheck
  fi
}

case "${COMMAND}" in
  doctor)
    echo "Root: ${ROOT_DIR}"
    echo "Environment: ${STACK_ENV}"
    echo "Env file: $([[ -f "${ENV_FILE}" ]] && echo "${ENV_FILE}" || echo "${ENV_EXAMPLE_FILE} (example fallback)")"
    echo "PM2 ecosystem: ${ECOSYSTEM_FILE}"
    echo "Caddyfile: ${CADDY_FILE}"
    require_cmd node
    require_cmd pnpm
    require_cmd pm2
    echo "Required commands found: node, pnpm, pm2"
    echo "pnpm path: $(command -v pnpm)"
    if command -v caddy >/dev/null 2>&1; then
      echo "Caddy found: $(command -v caddy)"
    else
      echo "Caddy not found; install it before using the proxy command."
    fi
    ;;
  up)
    require_cmd pnpm
    require_cmd pm2
    cd "${ROOT_DIR}"
    load_shell_env
    run_install
    pm2_start_or_reload
    pm2 status
    ;;
  down)
    require_cmd pm2
    pm2_delete
    ;;
  restart)
    require_cmd pm2
    load_shell_env
    pm2_restart
    ;;
  status)
    require_cmd pm2
    pm2 status
    ;;
  logs)
    require_cmd pm2
    if [[ -n "${APP_NAME}" ]]; then
      pm2 logs "hzy-${APP_NAME}"
    else
      pm2 logs
    fi
    ;;
  update)
    require_cmd git
    require_cmd pnpm
    require_cmd pm2
    cd "${ROOT_DIR}"
    load_shell_env
    if [[ "${HZY_DEV_STACK_GIT_PULL:-false}" == "true" ]]; then
      git pull --ff-only
    fi
    run_install
    run_typecheck_if_enabled
    pm2_start_or_reload
    pm2 status
    ;;
  proxy)
    require_cmd caddy
    if [[ ! -f "${CADDY_FILE}" ]]; then
      echo "Missing Caddyfile: ${CADDY_FILE}" >&2
      exit 1
    fi
    caddy reload --config "${CADDY_FILE}" || caddy run --config "${CADDY_FILE}"
    ;;
esac
