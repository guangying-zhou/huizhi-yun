#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_RUNTIME_DIR="$ROOT_DIR/data-runtime"
VERSION_FILE="$DATA_RUNTIME_DIR/VERSION"
LATEST_VERSION_URL="${HZY_DATA_RUNTIME_LATEST_VERSION_URL:-https://downloads.huizhi.yun/packages/hzy-data-runtime/latest/version.txt}"
PUBLIC_BASE_URL="${HZY_R2_PUBLIC_BASE_URL:-https://downloads.huizhi.yun}"
R2_PREFIX="${HZY_R2_PREFIX:-packages/hzy-data-runtime}"
PACKAGE_BASE_URL="${PUBLIC_BASE_URL%/}/${R2_PREFIX#/}"

DRY_RUN=0
SKIP_TESTS=0

usage() {
  cat <<'EOF'
Usage: ./update_dr.sh [--dry-run] [--skip-tests]

Automatically publishes the next hzy-data-runtime patch release.

Steps:
  1. Read local data-runtime/VERSION and remote latest/version.txt.
  2. Pick the release version:
     - if local VERSION is ahead of remote, publish local VERSION;
     - otherwise increment the greater current version by one patch.
  3. Run go test ./... in data-runtime unless --skip-tests is set.
  4. Write data-runtime/VERSION, package, checksum, upload to R2, and verify public URLs.

Environment overrides:
  HZY_DATA_RUNTIME_LATEST_VERSION_URL
  HZY_R2_PUBLIC_BASE_URL
  HZY_R2_PREFIX
  HZY_DATA_RUNTIME_PACKAGE_DIR
  HZY_R2_BUCKET
  WRANGLER_BIN
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
  local version_dir="$DATA_RUNTIME_DIR/build/packages/hzy-data-runtime/$version"
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

  log "Verifying public release"
  latest_version="$(curl -fsS "$PACKAGE_BASE_URL/latest/version.txt" | tr -d '[:space:]')"
  [ "$latest_version" = "$version" ] || die "public latest is $latest_version, expected $version"

  manifest="$(curl -fsS "$PACKAGE_BASE_URL/latest/manifest.json")"
  grep -q "\"version\": \"$version\"" <<<"$manifest" || die "public latest manifest does not contain version $version"

  for arch in amd64 arm64; do
    curl -fsSI "$PACKAGE_BASE_URL/$version/hzy-data-runtime_${version}_linux_${arch}.tar.gz" >/dev/null
  done
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-tests)
      SKIP_TESTS=1
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

release_version="$(resolve_release_version "$local_version" "$remote_version")"
ensure_semver "$release_version" "release version"

echo "data-runtime local version:  $local_version"
echo "data-runtime remote latest:  $remote_version"
echo "data-runtime release target: $release_version"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "Dry run only. No files were changed and no upload was started."
  exit 0
fi

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

log "Packaging hzy-data-runtime $release_version ($commit_marker)"
(
  cd "$DATA_RUNTIME_DIR"
  HZY_DATA_RUNTIME_COMMIT="$commit_marker" ./scripts/package-release.sh "$release_version"
)

verify_checksums "$release_version"

log "Uploading hzy-data-runtime $release_version to R2"
(
  cd "$DATA_RUNTIME_DIR"
  ./scripts/upload-r2.sh "$release_version"
)

verify_public_release "$release_version"

echo
echo "Published hzy-data-runtime $release_version"
echo "Commit marker: $commit_marker"
echo "Installer: $PACKAGE_BASE_URL/install.sh"
echo "Pinned:    $PACKAGE_BASE_URL/$release_version/"
echo "Latest:    $PACKAGE_BASE_URL/latest/"
