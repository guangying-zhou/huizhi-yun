#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${HZY_DATA_RUNTIME_PACKAGE_DIR:-$ROOT/build/packages/hzy-data-runtime}"
BUCKET="${HZY_R2_BUCKET:-huizhiyun}"
PREFIX="${HZY_R2_PREFIX:-packages/hzy-data-runtime}"
PUBLIC_BASE_URL="${HZY_R2_PUBLIC_BASE_URL:-https://downloads.huizhi.yun}"
REMOTE_FLAG="${WRANGLER_R2_REMOTE_FLAG:---remote}"
CACHE_CONTROL="${HZY_R2_CACHE_CONTROL:-no-cache, max-age=0}"

if [ "$#" -gt 0 ]; then
  VERSION="$1"
elif [ -f "$PACKAGE_DIR/latest/version.txt" ]; then
  VERSION="$(tr -d '[:space:]' < "$PACKAGE_DIR/latest/version.txt")"
else
  echo "error: version argument is required because $PACKAGE_DIR/latest/version.txt does not exist" >&2
  exit 1
fi

[ -d "$PACKAGE_DIR" ] || { echo "error: package dir does not exist: $PACKAGE_DIR" >&2; exit 1; }
[ -d "$PACKAGE_DIR/$VERSION" ] || { echo "error: version package dir does not exist: $PACKAGE_DIR/$VERSION" >&2; exit 1; }
[ -d "$PACKAGE_DIR/latest" ] || { echo "error: latest package dir does not exist: $PACKAGE_DIR/latest" >&2; exit 1; }

WRANGLER_CMD=()

resolve_wrangler() {
  if [ -n "${WRANGLER_BIN:-}" ]; then
    if "$WRANGLER_BIN" --version >/dev/null 2>&1; then
      WRANGLER_CMD=("$WRANGLER_BIN")
      return
    fi
    echo "error: WRANGLER_BIN is set but not executable: $WRANGLER_BIN" >&2
    exit 1
  fi

  if command -v wrangler >/dev/null 2>&1; then
    local wrangler_path
    wrangler_path="$(command -v wrangler)"
    if wrangler --version >/dev/null 2>&1; then
      WRANGLER_CMD=("wrangler")
      return
    fi
    echo "warning: ignoring broken wrangler at $wrangler_path; falling back to pnpm dlx or npx wrangler@4" >&2
  fi

  if command -v pnpm >/dev/null 2>&1; then
    WRANGLER_CMD=("pnpm" "dlx" "wrangler@4")
  elif command -v npx >/dev/null 2>&1; then
    WRANGLER_CMD=("npx" "wrangler@4")
  else
    echo "error: wrangler, pnpm, or npx is required" >&2
    exit 1
  fi
}

run_wrangler() {
  "${WRANGLER_CMD[@]}" "$@"
}

upload_file() {
  local file="$1"
  local key="$2"
  local remote_args=()
  if [ -n "$REMOTE_FLAG" ]; then
    remote_args+=("$REMOTE_FLAG")
  fi
  echo "Uploading $file -> r2://$BUCKET/$key"
  run_wrangler r2 object put "$BUCKET/$key" --file "$file" --cache-control "$CACHE_CONTROL" "${remote_args[@]}"
}

upload_dir() {
  local dir="$1"
  local rel key
  while IFS= read -r -d '' file; do
    rel="${file#$PACKAGE_DIR/}"
    key="$PREFIX/$rel"
    upload_file "$file" "$key"
  done < <(find "$dir" -type f -print0)
}

resolve_wrangler

if [ -f "$PACKAGE_DIR/install.sh" ]; then
  upload_file "$PACKAGE_DIR/install.sh" "$PREFIX/install.sh"
fi

upload_dir "$PACKAGE_DIR/$VERSION"
upload_dir "$PACKAGE_DIR/latest"

echo
echo "Uploaded hzy-data-runtime $VERSION to R2 bucket $BUCKET"
echo "Installer:"
echo "  $PUBLIC_BASE_URL/$PREFIX/install.sh"
echo "Latest package:"
echo "  $PUBLIC_BASE_URL/$PREFIX/latest/"
echo "Pinned package:"
echo "  $PUBLIC_BASE_URL/$PREFIX/$VERSION/"
