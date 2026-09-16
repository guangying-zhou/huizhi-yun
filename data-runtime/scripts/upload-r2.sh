#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${HZY_DATA_RUNTIME_PACKAGE_DIR:-$ROOT/build/packages/hzy-data-runtime}"
BUCKET="${HZY_R2_BUCKET:-huizhiyun}"
PREFIX="${HZY_R2_PREFIX:-packages/hzy-data-runtime}"
PUBLIC_BASE_URL="${HZY_R2_PUBLIC_BASE_URL:-https://downloads.huizhi.yun}"
PUBLIC_VERIFY_FALLBACK="${HZY_R2_PUBLIC_VERIFY_FALLBACK:-1}"
REMOTE_FLAG="${WRANGLER_R2_REMOTE_FLAG:---remote}"
CACHE_CONTROL="${HZY_R2_CACHE_CONTROL:-no-cache, max-age=0}"
WRANGLER_VERSION="4.110.0"

ACTION="stage"
ACTION_OPTION=""
EXECUTE=0
CONFIRM=""
VERSION=""

usage() {
  cat <<'USAGE'
Stage or promote an immutable hzy-data-runtime release.

Usage:
  ./scripts/upload-r2.sh <version> --stage
  ./scripts/upload-r2.sh <version> --stage --execute --confirm <preview-sha256>
  ./scripts/upload-r2.sh <version> --promote
  ./scripts/upload-r2.sh <version> --promote --execute --confirm <preview-sha256>

Default mode is preview and performs no Wrangler or network calls. Stage uploads
only the immutable version directory. Promote first verifies that remote version
against the local release inventory, then updates latest aliases; latest/version.txt
is written last. WRANGLER_BIN may explicitly inject a reviewed executable (tests use
this); otherwise pnpm dlx wrangler@4.110.0 is used.
USAGE
}

fail() {
  echo "error: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stage)
      [ -z "$ACTION_OPTION" ] || fail "choose exactly one of --stage or --promote"
      ACTION="stage"
      ACTION_OPTION="stage"
      shift
      ;;
    --promote)
      [ -z "$ACTION_OPTION" ] || fail "choose exactly one of --stage or --promote"
      ACTION="promote"
      ACTION_OPTION="promote"
      shift
      ;;
    --execute)
      EXECUTE=1
      shift
      ;;
    --confirm)
      [ "$#" -ge 2 ] || fail "--confirm requires a value"
      CONFIRM="$2"
      shift 2
      ;;
    --confirm=*)
      CONFIRM="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      fail "unknown option: $1"
      ;;
    *)
      [ -z "$VERSION" ] || fail "only one version argument is allowed"
      VERSION="$1"
      shift
      ;;
  esac
done

[ -n "$VERSION" ] || fail "version argument is required"
case "$VERSION" in
  *[!A-Za-z0-9._-]*|.*|-*) fail "invalid version: $VERSION" ;;
esac
case "$PREFIX" in
  ""|/*|*..*) fail "invalid R2 prefix: $PREFIX" ;;
esac
case "$BUCKET" in
  ""|*/*) fail "invalid R2 bucket: $BUCKET" ;;
esac

VERSION_DIR="$PACKAGE_DIR/$VERSION"
[ -d "$VERSION_DIR" ] || fail "version package dir does not exist: $VERSION_DIR"
[ -f "$VERSION_DIR/release.sha256" ] || fail "version package is missing release.sha256: $VERSION_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

write_inventory() {
  local dir="$1"
  local output="$2"
  (
    cd "$dir"
    find . -type f ! -name release.sha256 -print | LC_ALL=C sort | while IFS= read -r relative; do
      relative="${relative#./}"
      printf "%s  %s\n" "$(sha256_file "$dir/$relative")" "$relative"
    done
  ) > "$output"
}

ACTUAL_INVENTORY="$TMP_DIR/local.release.sha256"
write_inventory "$VERSION_DIR" "$ACTUAL_INVENTORY"
cmp -s "$VERSION_DIR/release.sha256" "$ACTUAL_INVENTORY" || fail "local release inventory does not match immutable files: $VERSION_DIR"

PLAN_FILE="$TMP_DIR/objects.tsv"
PROMOTE_DIR="$TMP_DIR/promote"
mkdir -p "$PROMOTE_DIR/latest"

append_plan() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || fail "planned file is missing: $file"
  printf "%s\t%s\t%s\n" "$file" "$key" "$(sha256_file "$file")" >> "$PLAN_FILE"
}

build_stage_plan() {
  : > "$PLAN_FILE"
  find "$VERSION_DIR" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    append_plan "$file" "$PREFIX/$VERSION/${file#$VERSION_DIR/}"
  done
}

build_promote_plan() {
  local arch pinned_archive latest_archive latest_checksum
  local artifact_count=0
  local manifest="$VERSION_DIR/manifest.json"

  [ -f "$manifest" ] || fail "release manifest is missing: $manifest"
  : > "$PLAN_FILE"
  for arch in amd64 arm64; do
    pinned_archive="$VERSION_DIR/hzy-data-runtime_${VERSION}_linux_${arch}.tar.gz"
    if grep -Eq "\"arch\"[[:space:]]*:[[:space:]]*\"$arch\"" "$manifest"; then
      [ -f "$pinned_archive" ] || fail "manifest artifact is missing: $pinned_archive"
    else
      [ ! -f "$pinned_archive" ] || fail "release artifact is not declared by manifest: $pinned_archive"
      continue
    fi
    [ -f "$pinned_archive.sig" ] || fail "release artifact signature is missing: $pinned_archive.sig"

    latest_archive="$PROMOTE_DIR/latest/hzy-data-runtime_linux_${arch}.tar.gz"
    latest_checksum="$latest_archive.sha256"
    cp "$pinned_archive" "$latest_archive"
    cp "$pinned_archive.sig" "$latest_archive.sig"
    printf "%s  %s\n" "$(sha256_file "$latest_archive")" "$(basename "$latest_archive")" > "$latest_checksum"

    append_plan "$latest_archive" "$PREFIX/latest/$(basename "$latest_archive")"
    append_plan "$latest_archive.sig" "$PREFIX/latest/$(basename "$latest_archive.sig")"
    append_plan "$latest_checksum" "$PREFIX/latest/$(basename "$latest_checksum")"
    artifact_count=$((artifact_count + 1))
  done
  [ "$artifact_count" -gt 0 ] || fail "release does not contain a supported linux artifact"

  cp "$VERSION_DIR/manifest.json" "$PROMOTE_DIR/latest/manifest.json"
  cp "$VERSION_DIR/manifest.json.sig" "$PROMOTE_DIR/latest/manifest.json.sig"
  cp "$VERSION_DIR/install.sh" "$PROMOTE_DIR/latest/install.sh"
  cp "$VERSION_DIR/install.sh.sig" "$PROMOTE_DIR/latest/install.sh.sig"
  cp "$VERSION_DIR/install.sh" "$PROMOTE_DIR/install.sh"
  cp "$VERSION_DIR/install.sh.sig" "$PROMOTE_DIR/install.sh.sig"
  printf "%s\n" "$VERSION" > "$PROMOTE_DIR/latest/version.txt"

  append_plan "$PROMOTE_DIR/latest/manifest.json" "$PREFIX/latest/manifest.json"
  append_plan "$PROMOTE_DIR/latest/manifest.json.sig" "$PREFIX/latest/manifest.json.sig"
  append_plan "$PROMOTE_DIR/latest/install.sh" "$PREFIX/latest/install.sh"
  append_plan "$PROMOTE_DIR/latest/install.sh.sig" "$PREFIX/latest/install.sh.sig"
  append_plan "$PROMOTE_DIR/install.sh" "$PREFIX/install.sh"
  append_plan "$PROMOTE_DIR/install.sh.sig" "$PREFIX/install.sh.sig"
  # Activation pointer must always be the final write.
  append_plan "$PROMOTE_DIR/latest/version.txt" "$PREFIX/latest/version.txt"
}

if [ "$ACTION" = "stage" ]; then
  build_stage_plan
else
  build_promote_plan
fi

SUMMARY_FILE="$TMP_DIR/summary.txt"
{
  printf "schema=1\n"
  printf "action=%s\n" "$ACTION"
  printf "version=%s\n" "$VERSION"
  printf "bucket=%s\n" "$BUCKET"
  printf "prefix=%s\n" "$PREFIX"
  printf "cacheControl=%s\n" "$CACHE_CONTROL"
  printf "remoteFlag=%s\n" "$REMOTE_FLAG"
  printf "wrangler=%s\n" "${WRANGLER_BIN:-pnpm dlx wrangler@$WRANGLER_VERSION}"
  printf "releaseInventorySha256=%s\n" "$(sha256_file "$VERSION_DIR/release.sha256")"
  while IFS=$'\t' read -r file key hash; do
    printf "object=%s sha256=%s\n" "$key" "$hash"
  done < "$PLAN_FILE"
} > "$SUMMARY_FILE"
CONFIRMATION_SHA256="$(sha256_file "$SUMMARY_FILE")"

echo "[data-runtime-r2] mode=$([ "$EXECUTE" = "1" ] && echo execute || echo preview) action=$ACTION version=$VERSION"
while IFS=$'\t' read -r file key hash; do
  echo "[data-runtime-r2] object=r2://$BUCKET/$key sha256=$hash"
done < "$PLAN_FILE"
echo "[data-runtime-r2] confirmationSha256=$CONFIRMATION_SHA256"

if [ "$EXECUTE" != "1" ]; then
  echo "[data-runtime-r2] PREVIEW ONLY; no Wrangler or network call was made"
  exit 0
fi

[ -n "$CONFIRM" ] || fail "--execute requires --confirm $CONFIRMATION_SHA256"
[ "$CONFIRM" = "$CONFIRMATION_SHA256" ] || fail "confirmation digest mismatch; rerun preview and review the exact plan"

WRANGLER_CMD=()
if [ -n "${WRANGLER_BIN:-}" ]; then
  [ -x "$WRANGLER_BIN" ] || fail "WRANGLER_BIN is not executable: $WRANGLER_BIN"
  WRANGLER_CMD=("$WRANGLER_BIN")
else
  command -v pnpm >/dev/null 2>&1 || fail "pnpm is required for pinned wrangler@$WRANGLER_VERSION (or explicitly set WRANGLER_BIN)"
  WRANGLER_CMD=("pnpm" "dlx" "wrangler@$WRANGLER_VERSION")
fi

run_wrangler() {
  "${WRANGLER_CMD[@]}" "$@"
}

fetch_remote() {
  local key="$1"
  local output="$2"
  local log="$3"
  local verify_url
  local args=(r2 object get "$BUCKET/$key" --file "$output")
  if [ -n "$REMOTE_FLAG" ]; then args+=("$REMOTE_FLAG"); fi
  rm -f "$output" "$log"
  if run_wrangler "${args[@]}" >"$log" 2>&1; then
    return 0
  fi
  if grep -Eiq 'not found|does not exist|NoSuchKey' "$log"; then
    # Wrangler remote get can report multipart objects (>5 MiB) as missing even
    # when the R2 public domain serves the exact object. For the real pinned
    # Wrangler path only, fall back to downloading the same immutable key and
    # let the caller perform the normal SHA-256 comparison. Tests and injected
    # executables remain fully offline and never use this fallback.
    if [ "$PUBLIC_VERIFY_FALLBACK" = "1" ] && [ -z "${WRANGLER_BIN:-}" ]; then
      command -v curl >/dev/null 2>&1 || fail "curl is required for R2 public verification fallback"
      verify_url="${PUBLIC_BASE_URL%/}/$key?hzy-r2-verify=$(date +%s)-$$"
      if curl -fL --retry 3 --connect-timeout 10 --output "$output" "$verify_url" >>"$log" 2>&1; then
        echo "[data-runtime-r2] Wrangler get missed object; verified through public R2 URL: ${PUBLIC_BASE_URL%/}/$key" >&2
        return 0
      fi
    fi
    return 2
  fi
  cat "$log" >&2
  return 1
}

put_remote() {
  local file="$1"
  local key="$2"
  local args=(r2 object put "$BUCKET/$key" --file "$file" --cache-control "$CACHE_CONTROL")
  if [ -n "$REMOTE_FLAG" ]; then args+=("$REMOTE_FLAG"); fi
  echo "[data-runtime-r2] PUT r2://$BUCKET/$key"
  run_wrangler "${args[@]}"
}

verify_remote_exact() {
  local file="$1"
  local key="$2"
  local index="$3"
  local downloaded="$TMP_DIR/remote-$index"
  local log="$TMP_DIR/remote-$index.log"
  local status=0
  fetch_remote "$key" "$downloaded" "$log" || status=$?
  [ "$status" = "0" ] || fail "remote object is missing or unreadable: r2://$BUCKET/$key"
  [ "$(sha256_file "$downloaded")" = "$(sha256_file "$file")" ] || fail "remote object hash mismatch: r2://$BUCKET/$key"
}

if [ "$ACTION" = "stage" ]; then
  MISSING_FILE="$TMP_DIR/missing.tsv"
  : > "$MISSING_FILE"
  index=0
  # Complete the immutable preflight before the first write.
  while IFS=$'\t' read -r file key hash; do
    index=$((index + 1))
    downloaded="$TMP_DIR/preflight-$index"
    log="$TMP_DIR/preflight-$index.log"
    status=0
    fetch_remote "$key" "$downloaded" "$log" || status=$?
    if [ "$status" = "0" ]; then
      [ "$(sha256_file "$downloaded")" = "$hash" ] || fail "refusing to overwrite immutable remote version with different hash: r2://$BUCKET/$key"
      echo "[data-runtime-r2] immutable object already matches: r2://$BUCKET/$key"
    elif [ "$status" = "2" ]; then
      printf "%s\t%s\n" "$file" "$key" >> "$MISSING_FILE"
    else
      fail "failed to inspect immutable remote object: r2://$BUCKET/$key"
    fi
  done < "$PLAN_FILE"

  while IFS=$'\t' read -r file key; do
    put_remote "$file" "$key"
  done < "$MISSING_FILE"
else
  index=0
  # Promotion is allowed only after every pinned object is staged unchanged.
  find "$VERSION_DIR" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    index=$((index + 1))
    verify_remote_exact "$file" "$PREFIX/$VERSION/${file#$VERSION_DIR/}" "pinned-$index"
  done

  POINTER_FILE=""
  POINTER_KEY=""
  POINTER_HASH=""
  NON_POINTER_PLAN="$TMP_DIR/non-pointer.tsv"
  : > "$NON_POINTER_PLAN"
  while IFS=$'\t' read -r file key hash; do
    if [ "$key" = "$PREFIX/latest/version.txt" ]; then
      POINTER_FILE="$file"
      POINTER_KEY="$key"
      POINTER_HASH="$hash"
    else
      printf "%s\t%s\t%s\n" "$file" "$key" "$hash" >> "$NON_POINTER_PLAN"
      put_remote "$file" "$key"
    fi
  done < "$PLAN_FILE"
  [ -n "$POINTER_FILE" ] || fail "promotion plan is missing latest/version.txt activation pointer"

  index=0
  while IFS=$'\t' read -r file key hash; do
    index=$((index + 1))
    verify_remote_exact "$file" "$key" "promote-before-pointer-$index"
  done < "$NON_POINTER_PLAN"

  put_remote "$POINTER_FILE" "$POINTER_KEY"
  verify_remote_exact "$POINTER_FILE" "$POINTER_KEY" "promote-pointer"
fi

if [ "$ACTION" = "stage" ]; then
  index=0
  while IFS=$'\t' read -r file key hash; do
    index=$((index + 1))
    verify_remote_exact "$file" "$key" "verify-$index"
  done < "$PLAN_FILE"
fi

echo
echo "[data-runtime-r2] completed action=$ACTION version=$VERSION bucket=$BUCKET"
if [ "$ACTION" = "stage" ]; then
  echo "[data-runtime-r2] pinned=$PUBLIC_BASE_URL/$PREFIX/$VERSION/"
else
  echo "[data-runtime-r2] latest=$PUBLIC_BASE_URL/$PREFIX/latest/"
  echo "[data-runtime-r2] installer=$PUBLIC_BASE_URL/$PREFIX/install.sh"
fi
