#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${HZY_CONNECTOR_RUNTIME_PACKAGE_DIR:-$ROOT_DIR/build/packages/hzy-connector-runtime}"
BUCKET="${HZY_DOWNLOADS_R2_BUCKET:-huizhiyun}"
PREFIX="${HZY_CONNECTOR_RUNTIME_R2_PREFIX:-packages/hzy-connector-runtime}"
PUBLIC_BASE_URL="${HZY_CONNECTOR_RUNTIME_PUBLIC_BASE_URL:-https://downloads.huizhi.yun}"
REMOTE_FLAG="${WRANGLER_R2_REMOTE_FLAG:---remote}"
CACHE_CONTROL="${HZY_CONNECTOR_RUNTIME_R2_CACHE_CONTROL:-no-cache, max-age=0}"
WRANGLER_VERSION="4.110.0"
ACTION="stage"
ACTION_OPTION=""
EXECUTE=0
CONFIRM=""
VERSION=""

usage() {
  cat <<'USAGE'
Stage or promote an immutable hzy-connector-runtime release.

Usage:
  ./scripts/upload-r2.sh <version> --stage
  ./scripts/upload-r2.sh <version> --stage --execute --confirm <preview-sha256>
  ./scripts/upload-r2.sh <version> --promote
  ./scripts/upload-r2.sh <version> --promote --execute --confirm <preview-sha256>

Preview is the default and performs no network writes. Stage uploads only the
immutable version directory. Promote verifies every staged object, writes aliases,
then writes latest/version.txt last as the activation pointer.
USAGE
}

fail() { echo "error: $*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stage|--promote)
      [ -z "$ACTION_OPTION" ] || fail "choose exactly one of --stage or --promote"
      ACTION="${1#--}"; ACTION_OPTION="$ACTION"; shift
      ;;
    --execute) EXECUTE=1; shift ;;
    --confirm)
      [ "$#" -ge 2 ] || fail "--confirm requires a value"
      CONFIRM="$2"; shift 2
      ;;
    --confirm=*) CONFIRM="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) fail "unknown option: $1" ;;
    *) [ -z "$VERSION" ] || fail "only one version is allowed"; VERSION="$1"; shift ;;
  esac
done

[ -n "$VERSION" ] || fail "version argument is required"
printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$' \
  || fail "version must be an exact semantic version"
case "$PREFIX" in ""|/*|*..*) fail "invalid R2 prefix: $PREFIX" ;; esac
case "$BUCKET" in ""|*/*) fail "invalid R2 bucket: $BUCKET" ;; esac

VERSION_DIR="$PACKAGE_DIR/$VERSION"
[ -d "$VERSION_DIR" ] || fail "version package dir does not exist: $VERSION_DIR"
[ -f "$VERSION_DIR/release.sha256" ] || fail "version package is missing release.sha256"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}

write_inventory() {
  local dir="$1" output="$2"
  (
    cd "$dir"
    find . -type f ! -name release.sha256 -print | LC_ALL=C sort | while IFS= read -r relative; do
      relative="${relative#./}"
      printf '%s  %s\n' "$(sha256_file "$dir/$relative")" "$relative"
    done
  ) > "$output"
}

write_inventory "$VERSION_DIR" "$TMP_DIR/local.release.sha256"
cmp -s "$VERSION_DIR/release.sha256" "$TMP_DIR/local.release.sha256" \
  || fail "local immutable release inventory does not match"

PLAN_FILE="$TMP_DIR/objects.tsv"
PROMOTE_DIR="$TMP_DIR/promote"
mkdir -p "$PROMOTE_DIR/latest"
append_plan() {
  local file="$1" key="$2"
  [ -f "$file" ] || fail "planned file is missing: $file"
  printf '%s\t%s\t%s\n' "$file" "$key" "$(sha256_file "$file")" >> "$PLAN_FILE"
}

if [ "$ACTION" = "stage" ]; then
  : > "$PLAN_FILE"
  find "$VERSION_DIR" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    append_plan "$file" "$PREFIX/$VERSION/${file#$VERSION_DIR/}"
  done
else
  for arch in amd64 arm64; do
    pinned="$VERSION_DIR/hzy-connector-runtime_${VERSION}_linux_${arch}.tar.gz"
    latest="$PROMOTE_DIR/latest/hzy-connector-runtime_linux_${arch}.tar.gz"
    cp "$pinned" "$latest"
    cp "$pinned.sig" "$latest.sig"
    printf '%s  %s\n' "$(sha256_file "$latest")" "$(basename "$latest")" > "$latest.sha256"
  done
  cp "$VERSION_DIR/manifest.json" "$PROMOTE_DIR/latest/manifest.json"
  cp "$VERSION_DIR/manifest.json.sig" "$PROMOTE_DIR/latest/manifest.json.sig"
  cp "$VERSION_DIR/manifest.json" "$PROMOTE_DIR/latest.json"
  cp "$VERSION_DIR/manifest.json.sig" "$PROMOTE_DIR/latest.json.sig"
  cp "$VERSION_DIR/install.sh" "$PROMOTE_DIR/latest/install.sh"
  cp "$VERSION_DIR/install.sh.sig" "$PROMOTE_DIR/latest/install.sh.sig"
  cp "$VERSION_DIR/install.sh" "$PROMOTE_DIR/install.sh"
  cp "$VERSION_DIR/install.sh.sig" "$PROMOTE_DIR/install.sh.sig"
  printf '%s\n' "$VERSION" > "$PROMOTE_DIR/latest/version.txt"
  : > "$PLAN_FILE"
  for file in "$PROMOTE_DIR/latest"/*; do append_plan "$file" "$PREFIX/latest/${file#$PROMOTE_DIR/latest/}"; done
  append_plan "$PROMOTE_DIR/latest.json" "$PREFIX/latest.json"
  append_plan "$PROMOTE_DIR/latest.json.sig" "$PREFIX/latest.json.sig"
  append_plan "$PROMOTE_DIR/install.sh" "$PREFIX/install.sh"
  append_plan "$PROMOTE_DIR/install.sh.sig" "$PREFIX/install.sh.sig"
  # Re-add the activation pointer as the final planned write.
  grep -v $'\t'"$PREFIX/latest/version.txt"$'\t' "$PLAN_FILE" > "$PLAN_FILE.without-pointer"
  mv "$PLAN_FILE.without-pointer" "$PLAN_FILE"
  append_plan "$PROMOTE_DIR/latest/version.txt" "$PREFIX/latest/version.txt"
fi

SUMMARY_FILE="$TMP_DIR/summary.txt"
{
  printf 'schema=1\naction=%s\nversion=%s\nbucket=%s\nprefix=%s\n' "$ACTION" "$VERSION" "$BUCKET" "$PREFIX"
  printf 'releaseInventorySha256=%s\n' "$(sha256_file "$VERSION_DIR/release.sha256")"
  while IFS=$'\t' read -r file key hash; do printf 'object=%s sha256=%s\n' "$key" "$hash"; done < "$PLAN_FILE"
} > "$SUMMARY_FILE"
CONFIRMATION_SHA256="$(sha256_file "$SUMMARY_FILE")"
echo "[connector-runtime-r2] mode=$([ "$EXECUTE" = 1 ] && echo execute || echo preview) action=$ACTION version=$VERSION"
while IFS=$'\t' read -r file key hash; do echo "[connector-runtime-r2] object=r2://$BUCKET/$key sha256=$hash"; done < "$PLAN_FILE"
echo "[connector-runtime-r2] confirmationSha256=$CONFIRMATION_SHA256"
if [ "$EXECUTE" != 1 ]; then
  echo "[connector-runtime-r2] PREVIEW ONLY; no network write was made"
  exit 0
fi
[ "$CONFIRM" = "$CONFIRMATION_SHA256" ] || fail "confirmation digest mismatch; review a fresh preview"

if [ -n "${WRANGLER_BIN:-}" ]; then
  [ -x "$WRANGLER_BIN" ] || fail "WRANGLER_BIN is not executable"
  WRANGLER_CMD=("$WRANGLER_BIN")
else
  WRANGLER_CMD=(pnpm dlx "wrangler@$WRANGLER_VERSION")
fi
run_wrangler() { "${WRANGLER_CMD[@]}" "$@"; }

fetch_remote() {
  local key="$1" output="$2" log="$3" status=0
  local args=(r2 object get "$BUCKET/$key" --file "$output")
  [ -z "$REMOTE_FLAG" ] || args+=("$REMOTE_FLAG")
  rm -f "$output" "$log"
  run_wrangler "${args[@]}" >"$log" 2>&1 || status=$?
  if [ "$status" = 0 ]; then return 0; fi
  if grep -Eiq 'not found|does not exist|NoSuchKey' "$log"; then
    if [ -z "${WRANGLER_BIN:-}" ] && curl -fL --retry 3 --connect-timeout 10 \
      -o "$output" "${PUBLIC_BASE_URL%/}/$key?hzy-r2-verify=$(date +%s)-$$" >>"$log" 2>&1; then
      return 0
    fi
    return 2
  fi
  cat "$log" >&2
  return 1
}

put_remote() {
  local file="$1" key="$2"
  local args=(r2 object put "$BUCKET/$key" --file "$file" --cache-control "$CACHE_CONTROL")
  [ -z "$REMOTE_FLAG" ] || args+=("$REMOTE_FLAG")
  echo "[connector-runtime-r2] PUT r2://$BUCKET/$key"
  run_wrangler "${args[@]}"
}

verify_remote() {
  local file="$1"
  local key="$2"
  local label="$3"
  local status=0
  local output="$TMP_DIR/remote-$label"
  local log="$TMP_DIR/remote-$label.log"
  fetch_remote "$key" "$output" "$log" || status=$?
  [ "$status" = 0 ] || fail "remote object is missing or unreadable: r2://$BUCKET/$key"
  [ "$(sha256_file "$output")" = "$(sha256_file "$file")" ] || fail "remote object hash mismatch: r2://$BUCKET/$key"
}

if [ "$ACTION" = "stage" ]; then
  : > "$TMP_DIR/missing.tsv"
  index=0
  while IFS=$'\t' read -r file key hash; do
    index=$((index + 1)); status=0
    fetch_remote "$key" "$TMP_DIR/preflight-$index" "$TMP_DIR/preflight-$index.log" || status=$?
    if [ "$status" = 0 ]; then
      [ "$(sha256_file "$TMP_DIR/preflight-$index")" = "$hash" ] || fail "refusing to overwrite immutable remote object: r2://$BUCKET/$key"
    elif [ "$status" = 2 ]; then
      printf '%s\t%s\n' "$file" "$key" >> "$TMP_DIR/missing.tsv"
    else
      fail "failed to inspect immutable remote object: r2://$BUCKET/$key"
    fi
  done < "$PLAN_FILE"
  while IFS=$'\t' read -r file key; do put_remote "$file" "$key"; done < "$TMP_DIR/missing.tsv"
else
  index=0
  find "$VERSION_DIR" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    index=$((index + 1)); verify_remote "$file" "$PREFIX/$VERSION/${file#$VERSION_DIR/}" "pinned-$index"
  done
  : > "$TMP_DIR/non-pointer.tsv"
  while IFS=$'\t' read -r file key hash; do
    if [ "$key" = "$PREFIX/latest/version.txt" ]; then
      POINTER_FILE="$file"; POINTER_KEY="$key"
    else
      printf '%s\t%s\n' "$file" "$key" >> "$TMP_DIR/non-pointer.tsv"
      put_remote "$file" "$key"
    fi
  done < "$PLAN_FILE"
  index=0
  while IFS=$'\t' read -r file key; do index=$((index + 1)); verify_remote "$file" "$key" "alias-$index"; done < "$TMP_DIR/non-pointer.tsv"
  [ -n "${POINTER_FILE:-}" ] || fail "promotion plan is missing activation pointer"
  put_remote "$POINTER_FILE" "$POINTER_KEY"
fi

index=0
while IFS=$'\t' read -r file key hash; do index=$((index + 1)); verify_remote "$file" "$key" "final-$index"; done < "$PLAN_FILE"
echo "[connector-runtime-r2] completed action=$ACTION version=$VERSION"
