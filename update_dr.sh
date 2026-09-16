#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_RUNTIME_DIR="$ROOT_DIR/data-runtime"
VERSION_FILE="$DATA_RUNTIME_DIR/VERSION"
LOCAL_PACKAGE_ROOT="${HZY_DATA_RUNTIME_PACKAGE_DIR:-$DATA_RUNTIME_DIR/build/packages/hzy-data-runtime}"
LATEST_VERSION_URL="${HZY_DATA_RUNTIME_LATEST_VERSION_URL:-https://downloads.huizhi.yun/packages/hzy-data-runtime/latest/version.txt}"
PUBLIC_BASE_URL="${HZY_R2_PUBLIC_BASE_URL:-https://downloads.huizhi.yun}"
R2_PREFIX="${HZY_R2_PREFIX:-packages/hzy-data-runtime}"
PACKAGE_BASE_URL="${PUBLIC_BASE_URL%/}/${R2_PREFIX#/}"

DRY_RUN=0
SKIP_TESTS=0
RESUME=0
BUILD_LINUX_ARM64=false

usage() {
  cat <<'EOF'
Usage: ./update_dr.sh [--dry-run] [--skip-tests] [--resume] [--linux-arm64[=true|false]]

Automatically publishes the next hzy-data-runtime patch release.

Steps:
  1. Read local data-runtime/VERSION and remote latest/version.txt.
  2. Pick the release version:
     - with --resume, reuse local VERSION for an interrupted release;
     - otherwise start from local VERSION when it is ahead of remote, or
       increment the greater current version by one patch;
     - if that immutable local package already exists, advance to the next
       unused patch version instead of overwriting it.
  3. Run go test ./... in data-runtime unless --skip-tests is set.
  4. Write data-runtime/VERSION, package, checksum, upload to R2, and verify public URLs.
     linux/amd64 is always built; linux/arm64 is disabled by default.

Environment overrides:
  HZY_DATA_RUNTIME_LATEST_VERSION_URL
  HZY_R2_PUBLIC_BASE_URL
  HZY_R2_PREFIX
  HZY_DATA_RUNTIME_PACKAGE_DIR
  HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE
  HZY_R2_BUCKET
  WRANGLER_BIN

Options:
  --resume  Reuse and verify an already packaged immutable local version after
            an interrupted stage/promote. The package signing key must match.
  --linux-arm64
            Also generate and publish linux/arm64. Equivalent to
            --linux-arm64=true; the default is false.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

log() {
  echo
  echo "==> $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

require_release_signing_key() {
  local key_file="${HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE:-}"
  [ -n "$key_file" ] || die "HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE is required before tests or VERSION changes"
  [ -f "$key_file" ] && [ -r "$key_file" ] || die "release signing private key is not readable: $key_file"

  local mode
  mode="$(stat -c '%a' "$key_file" 2>/dev/null || stat -f '%Lp' "$key_file" 2>/dev/null || true)"
  [ "$mode" = "600" ] || [ "$mode" = "400" ] || die "release signing private key mode must be 600 or 400, got ${mode:-unknown}"
}

release_signing_key_id() {
  local key_file="${HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE:-}"
  if command -v sha256sum >/dev/null 2>&1; then
    openssl pkey -in "$key_file" -pubout \
      | openssl pkey -pubin -outform DER \
      | sha256sum | awk '{print $1}'
  else
    openssl pkey -in "$key_file" -pubout \
      | openssl pkey -pubin -outform DER \
      | shasum -a 256 | awk '{print $1}'
  fi
}

verify_resume_package() {
  local version="$1"
  local version_dir="$LOCAL_PACKAGE_ROOT/$version"
  local manifest="$version_dir/manifest.json"
  local package_key_id current_key_id

  [ -f "$manifest" ] || die "--resume requires an existing immutable package: $manifest"
  package_key_id="$(sed -n 's/.*"keyId": "\([0-9a-f]\{64\}\)".*/\1/p' "$manifest" | head -n 1)"
  [ -n "$package_key_id" ] || die "resume package manifest is missing Ed25519 keyId: $manifest"
  current_key_id="$(release_signing_key_id)"
  [ "$package_key_id" = "$current_key_id" ] \
    || die "resume package keyId $package_key_id does not match current signing key $current_key_id"
  grep -q "\"version\": \"$version\"" "$manifest" \
    || die "resume package manifest version does not match $version"
}

confirmation_sha() {
  sed -n 's/.*confirmationSha256=\([0-9a-f]\{64\}\).*/\1/p' | tail -n 1
}

is_semver() {
  [[ "$1" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]
}

ensure_semver() {
  local version="$1"
  local label="$2"
  is_semver "$version" || die "$label is not a MAJOR.MINOR.PATCH version: $version"
}

version_gt() {
  local left="$1"
  local right="$2"
  local la lb lc ra rb rc
  IFS=. read -r la lb lc <<<"$left"
  IFS=. read -r ra rb rc <<<"$right"

  if (( 10#$la != 10#$ra )); then
    (( 10#$la > 10#$ra ))
    return
  fi
  if (( 10#$lb != 10#$rb )); then
    (( 10#$lb > 10#$rb ))
    return
  fi
  (( 10#$lc > 10#$rc ))
}

increment_patch() {
  local version="$1"
  local major minor patch
  IFS=. read -r major minor patch <<<"$version"
  printf "%d.%d.%d\n" "$((10#$major))" "$((10#$minor))" "$((10#$patch + 1))"
}

run_checksum_verify() {
  local checksum_file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksum_file"
  else
    shasum -a 256 -c "$checksum_file"
  fi
}

resolve_release_version() {
  local local_version="$1"
  local remote_version="$2"

  if version_gt "$local_version" "$remote_version"; then
    echo "$local_version"
    return
  fi

  if version_gt "$remote_version" "$local_version"; then
    increment_patch "$remote_version"
    return
  fi

  increment_patch "$local_version"
}

git_commit_marker() {
  local head
  head="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  if [ -n "$(git -C "$ROOT_DIR" status --porcelain -- data-runtime)" ]; then
    echo "$head-dirty"
  else
    echo "$head"
  fi
}

verify_checksums() {
  local version="$1"
  local version_dir="$LOCAL_PACKAGE_ROOT/$version"
  local found=0

  [ -d "$version_dir" ] || die "package version dir does not exist: $version_dir"

  log "Verifying local checksums"
  (
    cd "$version_dir"
    for checksum_file in ./*.sha256; do
      [ -f "$checksum_file" ] || continue
      found=1
      run_checksum_verify "$checksum_file"
    done
    [ "$found" -eq 1 ] || die "no .sha256 files found in $version_dir"
  )
}

verify_public_release() {
  local version="$1"
  local latest_version
  local manifest
  local arch
  local verified_arches=0

  log "Verifying public release"
  latest_version="$(curl -fsS "$PACKAGE_BASE_URL/latest/version.txt" | tr -d '[:space:]')"
  [ "$latest_version" = "$version" ] || die "public latest is $latest_version, expected $version"

  manifest="$(curl -fsS "$PACKAGE_BASE_URL/latest/manifest.json")"
  grep -q "\"version\": \"$version\"" <<<"$manifest" || die "public latest manifest does not contain version $version"

  for arch in amd64 arm64; do
    grep -Eq "\"arch\"[[:space:]]*:[[:space:]]*\"$arch\"" <<<"$manifest" || continue
    curl -fsSI "$PACKAGE_BASE_URL/$version/hzy-data-runtime_${version}_linux_${arch}.tar.gz" >/dev/null
    verified_arches=$((verified_arches + 1))
  done
  [ "$verified_arches" -gt 0 ] || die "public latest manifest does not contain a supported linux artifact"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-tests)
      SKIP_TESTS=1
      ;;
    --resume)
      RESUME=1
      ;;
    --linux-arm64)
      BUILD_LINUX_ARM64=true
      ;;
    --linux-arm64=*)
      case "${1#*=}" in
        true|1|yes) BUILD_LINUX_ARM64=true ;;
        false|0|no) BUILD_LINUX_ARM64=false ;;
        *) die "--linux-arm64 must be true or false" ;;
      esac
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

require_cmd git
require_cmd curl

[ -d "$DATA_RUNTIME_DIR" ] || die "data-runtime dir does not exist: $DATA_RUNTIME_DIR"
[ -f "$VERSION_FILE" ] || die "version file does not exist: $VERSION_FILE"
[ -x "$DATA_RUNTIME_DIR/scripts/package-release.sh" ] || die "package script is not executable"
[ -x "$DATA_RUNTIME_DIR/scripts/upload-r2.sh" ] || die "upload script is not executable"

local_version="$(tr -d '[:space:]' < "$VERSION_FILE")"
remote_version="$(curl -fsS "$LATEST_VERSION_URL" | tr -d '[:space:]')"

ensure_semver "$local_version" "local VERSION"
ensure_semver "$remote_version" "remote latest"

if [ "$RESUME" -eq 1 ]; then
  version_gt "$local_version" "$remote_version" \
    || die "--resume requires local VERSION $local_version to be ahead of remote latest $remote_version"
  release_version="$local_version"
else
  release_version="$(resolve_release_version "$local_version" "$remote_version")"
  while [ -e "$LOCAL_PACKAGE_ROOT/$release_version" ]; do
    occupied_version="$release_version"
    release_version="$(increment_patch "$release_version")"
    echo "data-runtime immutable local package exists: $occupied_version; advancing target to $release_version"
  done
fi
ensure_semver "$release_version" "release version"

echo "data-runtime local version:  $local_version"
echo "data-runtime remote latest:  $remote_version"
echo "data-runtime release target: $release_version"
echo "data-runtime linux/arm64:     $BUILD_LINUX_ARM64"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "Dry run only. No files were changed and no upload was started."
  exit 0
fi

# Fail before tests and, critically, before mutating VERSION.
require_release_signing_key
require_cmd openssl

if [ "$SKIP_TESTS" -eq 0 ]; then
  require_cmd go
  log "Running data-runtime tests"
  (cd "$DATA_RUNTIME_DIR" && go test ./...)
else
  log "Skipping tests"
fi

if [ "$local_version" != "$release_version" ]; then
  log "Updating data-runtime/VERSION to $release_version"
  printf "%s\n" "$release_version" > "$VERSION_FILE"
else
  log "Using existing data-runtime/VERSION $release_version"
fi

commit_marker="$(git_commit_marker)"

if [ "$RESUME" -eq 1 ]; then
  log "Resuming immutable hzy-data-runtime $release_version"
  verify_resume_package "$release_version"
else
  log "Packaging hzy-data-runtime $release_version ($commit_marker)"
  (
    cd "$DATA_RUNTIME_DIR"
    HZY_DATA_RUNTIME_COMMIT="$commit_marker" \
      HZY_DATA_RUNTIME_BUILD_LINUX_ARM64="$BUILD_LINUX_ARM64" \
      ./scripts/package-release.sh "$release_version"
  )
fi

verify_checksums "$release_version"

log "Previewing immutable R2 stage for hzy-data-runtime $release_version"
stage_preview="$(cd "$DATA_RUNTIME_DIR" && ./scripts/upload-r2.sh "$release_version" --stage)"
printf "%s\n" "$stage_preview"
stage_confirmation="$(printf "%s\n" "$stage_preview" | confirmation_sha)"
[ -n "$stage_confirmation" ] || die "stage preview did not return confirmationSha256"

log "Staging immutable R2 release $release_version with preview confirmation"
(cd "$DATA_RUNTIME_DIR" && ./scripts/upload-r2.sh "$release_version" --stage --execute --confirm "$stage_confirmation")

log "Previewing R2 promotion for hzy-data-runtime $release_version"
promote_preview="$(cd "$DATA_RUNTIME_DIR" && ./scripts/upload-r2.sh "$release_version" --promote)"
printf "%s\n" "$promote_preview"
promote_confirmation="$(printf "%s\n" "$promote_preview" | confirmation_sha)"
[ -n "$promote_confirmation" ] || die "promote preview did not return confirmationSha256"

log "Promoting hzy-data-runtime $release_version with preview confirmation"
(cd "$DATA_RUNTIME_DIR" && ./scripts/upload-r2.sh "$release_version" --promote --execute --confirm "$promote_confirmation")

verify_public_release "$release_version"

echo
echo "Published hzy-data-runtime $release_version"
echo "Commit marker: $commit_marker"
echo "Installer: $PACKAGE_BASE_URL/install.sh"
echo "Pinned:    $PACKAGE_BASE_URL/$release_version/"
echo "Latest:    $PACKAGE_BASE_URL/latest/"
