#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SOURCE_HOST="${PLATFORM_PROD_DB_HOST:-${DB_HOST:-127.0.0.1}}"
SOURCE_PORT="${PLATFORM_PROD_DB_PORT:-${DB_PORT:-3306}}"
SOURCE_USER="${PLATFORM_PROD_DB_USER:-${DB_USER:-root}}"
SOURCE_DB="${PLATFORM_PROD_DB_NAME:-hzy_platform}"
SOURCE_PASSWORD_ENV="${PLATFORM_PROD_DB_PASSWORD_ENV:-PLATFORM_PROD_DB_PASSWORD}"

TARGET_HOST="${PLATFORM_DEV_DB_HOST:-${SOURCE_HOST}}"
TARGET_PORT="${PLATFORM_DEV_DB_PORT:-${SOURCE_PORT}}"
TARGET_USER="${PLATFORM_DEV_DB_USER:-${SOURCE_USER}}"
TARGET_DB="${PLATFORM_DEV_DB_NAME:-hzy_platform_dev}"
TARGET_PASSWORD_ENV="${PLATFORM_DEV_DB_PASSWORD_ENV:-PLATFORM_DEV_DB_PASSWORD}"

SEED_CONSOLE_TEST=1
SOURCE_DEPLOYMENT_CODE="${PLATFORM_DEV_SOURCE_DEPLOYMENT_CODE:-C000001-console}"
TARGET_DEPLOYMENT_CODE="${PLATFORM_DEV_TARGET_DEPLOYMENT_CODE:-wiztek-test-console}"
TARGET_SITE_CODE="${PLATFORM_DEV_TARGET_SITE_CODE:-wiztek-test}"
TARGET_PUBLIC_URL="${PLATFORM_DEV_TARGET_PUBLIC_URL:-https://hzy-test.wiztek.cn}"

EXECUTE=0
DROP_TARGET=0
SKIP_VERIFY=0

usage() {
  cat <<'EOF'
Usage:
  platform/deploy/mysql/init-hzy-platform-dev.sh [options]

Dry-run by default. Add --execute to create/import/sanitize hzy_platform_dev.
Add --drop-target to replace an existing hzy_platform_dev database.

Password handling:
  Export PLATFORM_PROD_DB_PASSWORD and PLATFORM_DEV_DB_PASSWORD, or override the
  env var names with --source-password-env / --target-password-env.

Options:
  --execute
  --drop-target
  --skip-verify
  --no-seed-console-test
  --source-host HOST
  --source-port PORT
  --source-user USER
  --source-db DB
  --source-password-env ENV_NAME
  --target-host HOST
  --target-port PORT
  --target-user USER
  --target-db DB
  --target-password-env ENV_NAME
  --source-deployment-code CODE
  --target-deployment-code CODE
  --target-site-code CODE
  --target-public-url URL

Examples:
  export PLATFORM_PROD_DB_PASSWORD='...'
  export PLATFORM_DEV_DB_PASSWORD='...'

  platform/deploy/mysql/init-hzy-platform-dev.sh

  platform/deploy/mysql/init-hzy-platform-dev.sh --execute --drop-target
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --execute)
      EXECUTE=1
      shift
      ;;
    --drop-target)
      DROP_TARGET=1
      shift
      ;;
    --skip-verify)
      SKIP_VERIFY=1
      shift
      ;;
    --no-seed-console-test)
      SEED_CONSOLE_TEST=0
      shift
      ;;
    --source-host)
      SOURCE_HOST="${2:?missing value for --source-host}"
      shift 2
      ;;
    --source-port)
      SOURCE_PORT="${2:?missing value for --source-port}"
      shift 2
      ;;
    --source-user)
      SOURCE_USER="${2:?missing value for --source-user}"
      shift 2
      ;;
    --source-db)
      SOURCE_DB="${2:?missing value for --source-db}"
      shift 2
      ;;
    --source-password-env)
      SOURCE_PASSWORD_ENV="${2:?missing value for --source-password-env}"
      shift 2
      ;;
    --target-host)
      TARGET_HOST="${2:?missing value for --target-host}"
      shift 2
      ;;
    --target-port)
      TARGET_PORT="${2:?missing value for --target-port}"
      shift 2
      ;;
    --target-user)
      TARGET_USER="${2:?missing value for --target-user}"
      shift 2
      ;;
    --target-db)
      TARGET_DB="${2:?missing value for --target-db}"
      shift 2
      ;;
    --target-password-env)
      TARGET_PASSWORD_ENV="${2:?missing value for --target-password-env}"
      shift 2
      ;;
    --source-deployment-code)
      SOURCE_DEPLOYMENT_CODE="${2:?missing value for --source-deployment-code}"
      shift 2
      ;;
    --target-deployment-code)
      TARGET_DEPLOYMENT_CODE="${2:?missing value for --target-deployment-code}"
      shift 2
      ;;
    --target-site-code)
      TARGET_SITE_CODE="${2:?missing value for --target-site-code}"
      shift 2
      ;;
    --target-public-url)
      TARGET_PUBLIC_URL="${2:?missing value for --target-public-url}"
      shift 2
      ;;
    *)
      echo "[platform-dev-db] unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${TARGET_DB}" != *_dev ]]; then
  echo "[platform-dev-db] target database must end with _dev: ${TARGET_DB}" >&2
  exit 1
fi

init_args=(
  --source-host "${SOURCE_HOST}"
  --source-port "${SOURCE_PORT}"
  --source-user "${SOURCE_USER}"
  --source-password-env "${SOURCE_PASSWORD_ENV}"
  --source-db "${SOURCE_DB}"
  --target-host "${TARGET_HOST}"
  --target-port "${TARGET_PORT}"
  --target-user "${TARGET_USER}"
  --target-password-env "${TARGET_PASSWORD_ENV}"
  --target-db "${TARGET_DB}"
)

if [[ "${DROP_TARGET}" == "1" ]]; then
  init_args+=(--drop-target)
fi

if [[ "${EXECUTE}" == "1" ]]; then
  init_args+=(--execute)
fi

if [[ "${SEED_CONSOLE_TEST}" == "1" ]]; then
  init_args+=(
    --seed-console-test
    --source-deployment-code "${SOURCE_DEPLOYMENT_CODE}"
    --target-deployment-code "${TARGET_DEPLOYMENT_CODE}"
    --target-site-code "${TARGET_SITE_CODE}"
    --target-public-url "${TARGET_PUBLIC_URL}"
  )
fi

echo "[platform-dev-db] init hzy_platform_dev"
pnpm --dir "${PLATFORM_DIR}" run db:init-dev -- "${init_args[@]}"

if [[ "${EXECUTE}" != "1" || "${SKIP_VERIFY}" == "1" ]]; then
  exit 0
fi

verify_args=(
  --host "${TARGET_HOST}"
  --port "${TARGET_PORT}"
  --user "${TARGET_USER}"
  --password-env "${TARGET_PASSWORD_ENV}"
  --db "${TARGET_DB}"
  --mode sanitized
)

if [[ "${SEED_CONSOLE_TEST}" == "1" ]]; then
  verify_args+=(--expected-test-deployment-code "${TARGET_DEPLOYMENT_CODE}")
fi

echo "[platform-dev-db] verify sanitized target"
pnpm --dir "${PLATFORM_DIR}" run db:verify-dev -- "${verify_args[@]}"

cat <<EOF
[platform-dev-db] migration finished.
[platform-dev-db] next steps:
  1. Configure platform/.env.dev to use DB_NAME=${TARGET_DB}.
  2. Start platform-dev with a dev signing key.
  3. Generate a fresh ${TARGET_DEPLOYMENT_CODE} runtime token, license and test policy bundle.
  4. Run:
     pnpm --dir platform run db:verify-dev -- --host ${TARGET_HOST} --port ${TARGET_PORT} --user ${TARGET_USER} --password-env ${TARGET_PASSWORD_ENV} --db ${TARGET_DB} --mode ready --expected-test-deployment-code ${TARGET_DEPLOYMENT_CODE} --expected-test-public-url ${TARGET_PUBLIC_URL}
EOF
