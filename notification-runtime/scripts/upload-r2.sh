#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${HZY_NOTIFICATION_RUNTIME_PACKAGE_DIR:-$ROOT_DIR/build/packages/hzy-notification-runtime}"
BUCKET="${HZY_DOWNLOADS_R2_BUCKET:-huizhiyun}"
PREFIX="${HZY_NOTIFICATION_RUNTIME_R2_PREFIX:-packages/hzy-notification-runtime}"
WRANGLER_CMD="${WRANGLER_CMD:-wrangler}"
read -r -a WRANGLER_ARGS <<< "$WRANGLER_CMD"

if ! command -v "${WRANGLER_ARGS[0]}" >/dev/null 2>&1; then
  echo "wrangler is required; set WRANGLER_CMD='pnpm dlx wrangler@4' if global wrangler is unavailable" >&2
  exit 1
fi

[[ -d "$PACKAGE_DIR" ]] || {
  echo "package dir does not exist: $PACKAGE_DIR" >&2
  exit 1
}

while IFS= read -r -d '' file; do
  rel="${file#$PACKAGE_DIR/}"
  key="$PREFIX/$rel"
  echo "Uploading $key"
  case "$rel" in
    install.sh)
      "${WRANGLER_ARGS[@]}" r2 object put "$BUCKET/$key" \
        --remote \
        --file "$file" \
        --content-type text/x-shellscript \
        --cache-control no-cache
      ;;
    *.json)
      "${WRANGLER_ARGS[@]}" r2 object put "$BUCKET/$key" \
        --remote \
        --file "$file" \
        --content-type application/json \
        --cache-control no-cache
      ;;
    *.txt|*.sha256)
      "${WRANGLER_ARGS[@]}" r2 object put "$BUCKET/$key" \
        --remote \
        --file "$file" \
        --content-type text/plain \
        --cache-control no-cache
      ;;
    *.tar.gz)
      "${WRANGLER_ARGS[@]}" r2 object put "$BUCKET/$key" \
        --remote \
        --file "$file" \
        --content-type application/gzip \
        --cache-control 'public, max-age=31536000, immutable'
      ;;
    *)
      "${WRANGLER_ARGS[@]}" r2 object put "$BUCKET/$key" --remote --file "$file"
      ;;
  esac
done < <(find "$PACKAGE_DIR" -type f -print0)
