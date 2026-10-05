#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="github.com/huizhi-yun/data-runtime"
OUT_DIR="${HZY_DATA_RUNTIME_PACKAGE_DIR:-$ROOT/build/packages/hzy-data-runtime}"
SIGNING_KEY_FILE="${HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE:-}"
OPENSSL="${OPENSSL_BIN:-openssl}"
BUILD_LINUX_ARM64="${HZY_DATA_RUNTIME_BUILD_LINUX_ARM64:-true}"

case "$BUILD_LINUX_ARM64" in
  true|1|yes) BUILD_LINUX_ARM64=true ;;
  false|0|no) BUILD_LINUX_ARM64=false ;;
  *) echo "error: HZY_DATA_RUNTIME_BUILD_LINUX_ARM64 must be true or false" >&2; exit 1 ;;
esac

if [ "$#" -gt 1 ]; then
  echo "error: usage: ./scripts/package-release.sh [version]" >&2
  exit 1
fi

if [ "$#" -eq 1 ]; then
  VERSION="$1"
elif [ -n "${HZY_DATA_RUNTIME_VERSION:-}" ]; then
  VERSION="$HZY_DATA_RUNTIME_VERSION"
elif [ -f "$ROOT/VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
else
  VERSION="$(date -u +%Y.%m.%d.%H%M)"
fi

case "$VERSION" in
  ""|*[!A-Za-z0-9._-]*|.*|-*)
    echo "error: version must use only letters, digits, dot, underscore, and hyphen, and must not start with dot or hyphen" >&2
    exit 1
    ;;
esac
printf "%s" "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$' \
  || { echo "error: version must be an exact semantic version" >&2; exit 1; }

if [ -n "${GO_BIN:-}" ]; then
  GO="$GO_BIN"
elif command -v go >/dev/null 2>&1; then
  GO="go"
elif [ -x /usr/local/go/bin/go ]; then
  GO="/usr/local/go/bin/go"
else
  echo "error: go is not installed or not in PATH" >&2
  exit 1
fi

COMMIT="${HZY_DATA_RUNTIME_COMMIT:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BUILT_AT="${HZY_DATA_RUNTIME_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
case "$COMMIT" in
  ""|*[!A-Za-z0-9._-]*) echo "error: invalid release commit" >&2; exit 1 ;;
esac
case "$BUILT_AT" in
  ""|*[!0-9TZ:._+-]*) echo "error: invalid release build timestamp" >&2; exit 1 ;;
esac

LDFLAGS="-s -w -X ${MODULE}/internal/version.Version=${VERSION} -X ${MODULE}/internal/version.Commit=${COMMIT} -X ${MODULE}/internal/version.BuiltAt=${BUILT_AT}"
VERSION_DIR="$OUT_DIR/$VERSION"

mkdir -p "$OUT_DIR"
TMP_DIR="$(mktemp -d "$OUT_DIR/.package-${VERSION}.XXXXXX")"
CANDIDATE_DIR="$TMP_DIR/$VERSION"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$CANDIDATE_DIR"

[ -n "$SIGNING_KEY_FILE" ] || { echo "error: HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE is required" >&2; exit 1; }
[ -r "$SIGNING_KEY_FILE" ] || { echo "error: release signing key is not readable: $SIGNING_KEY_FILE" >&2; exit 1; }
SIGNING_KEY_MODE="$(stat -c '%a' "$SIGNING_KEY_FILE" 2>/dev/null || stat -f '%Lp' "$SIGNING_KEY_FILE")"
if [ $((8#$SIGNING_KEY_MODE & 077)) -ne 0 ]; then
  echo "error: release signing key must not be readable or writable by group/other" >&2
  exit 1
fi
if [ "$OPENSSL" = "openssl" ]; then
  command -v openssl >/dev/null 2>&1 || { echo "error: openssl is required for Ed25519 release signing" >&2; exit 1; }
elif [ ! -x "$OPENSSL" ]; then
  echo "error: OPENSSL_BIN is not executable: $OPENSSL" >&2
  exit 1
fi

PUBLIC_KEY_DER="$TMP_DIR/release-public-key.der"
"$OPENSSL" pkey -in "$SIGNING_KEY_FILE" -pubout -outform DER -out "$PUBLIC_KEY_DER"

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

SIGNING_KEY_ID="$(sha256_file "$PUBLIC_KEY_DER")"

sign_file() {
  local file="$1"
  local signature="$file.sig"
  "$OPENSSL" pkeyutl -sign -rawin -inkey "$SIGNING_KEY_FILE" -in "$file" -out "$signature"
  "$OPENSSL" pkeyutl -verify -rawin -pubin -inkey "$PUBLIC_KEY_DER" -keyform DER -in "$file" -sigfile "$signature" >/dev/null
}

write_checksum() {
  local file="$1"
  printf "%s  %s\n" "$(sha256_file "$file")" "$(basename "$file")" > "$file.sha256"
}

copy_payload_file() {
  local name="$1"
  local payload="$2"
  if [ -f "$ROOT/$name" ]; then
    cp "$ROOT/$name" "$payload/$name"
  fi
}

create_archive() {
  local payload="$1"
  local output="$2"
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$payload" -czf "$output" .
}

build_arch() {
  local arch="$1"
  local build_dir="$TMP_DIR/build-$arch"
  local payload="$TMP_DIR/payload-$arch"
  local archive="$CANDIDATE_DIR/hzy-data-runtime_${VERSION}_linux_${arch}.tar.gz"

  mkdir -p "$build_dir" "$payload"
  echo "Building linux/$arch"
  (
    cd "$ROOT"
    CGO_ENABLED=0 GOOS=linux GOARCH="$arch" "$GO" build -trimpath -ldflags "$LDFLAGS" -o "$build_dir/hzy-data-runtime" ./cmd/hzy-data-runtime
  )

  cp "$build_dir/hzy-data-runtime" "$payload/hzy-data-runtime"
  chmod 755 "$payload/hzy-data-runtime"
  copy_payload_file ".env.example" "$payload"
  copy_payload_file "config.example.json" "$payload"
  copy_payload_file "README.md" "$payload"
  printf "%s\n" "$VERSION" > "$payload/VERSION"

  create_archive "$payload" "$archive"
  write_checksum "$archive"
  sign_file "$archive"
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

verify_release_dir() {
  local dir="$1"
  local label="$2"
  local expected="$dir/release.sha256"
  local actual="$TMP_DIR/${label}.release.sha256"
  [ -f "$expected" ] || { echo "error: $label is missing release.sha256: $dir" >&2; return 1; }
  write_inventory "$dir" "$actual"
  if ! cmp -s "$expected" "$actual"; then
    echo "error: $label release inventory does not match its files: $dir" >&2
    return 1
  fi
}

ARCHES=(amd64)
if [ "$BUILD_LINUX_ARM64" = "true" ]; then
  ARCHES+=(arm64)
fi

for arch in "${ARCHES[@]}"; do
  build_arch "$arch"
done

cp "$ROOT/deploy/install.sh" "$CANDIDATE_DIR/install.sh"
chmod 755 "$CANDIDATE_DIR/install.sh"
sign_file "$CANDIDATE_DIR/install.sh"
printf "%s\n" "$VERSION" > "$CANDIDATE_DIR/version.txt"

INSTALLER_SHA="$(sha256_file "$CANDIDATE_DIR/install.sh")"

{
  cat <<EOF_MANIFEST_HEADER
{
  "name": "hzy-data-runtime",
  "version": "$VERSION",
  "commit": "$COMMIT",
  "builtAt": "$BUILT_AT",
  "installer": {
    "path": "install.sh",
    "sha256": "$INSTALLER_SHA",
    "signaturePath": "install.sh.sig"
  },
  "signature": {
    "algorithm": "Ed25519",
    "keyId": "$SIGNING_KEY_ID",
    "path": "manifest.json.sig"
  },
  "platforms": [
EOF_MANIFEST_HEADER
  for index in "${!ARCHES[@]}"; do
    arch="${ARCHES[$index]}"
    [ "$index" -eq 0 ] || printf ',\n'
    printf '    {\n      "os": "linux",\n      "arch": "%s"\n    }' "$arch"
  done
  cat <<'EOF_MANIFEST_MIDDLE'

  ],
  "artifacts": [
EOF_MANIFEST_MIDDLE
  for index in "${!ARCHES[@]}"; do
    arch="${ARCHES[$index]}"
    archive="hzy-data-runtime_${VERSION}_linux_${arch}.tar.gz"
    archive_sha="$(sha256_file "$CANDIDATE_DIR/$archive")"
    [ "$index" -eq 0 ] || printf ',\n'
    printf '    {\n      "os": "linux",\n      "arch": "%s",\n      "path": "%s",\n      "sha256": "%s",\n      "signaturePath": "%s.sig"\n    }' \
      "$arch" "$archive" "$archive_sha" "$archive"
  done
  cat <<'EOF_MANIFEST_FOOTER'

  ]
}
EOF_MANIFEST_FOOTER
} > "$CANDIDATE_DIR/manifest.json"

sign_file "$CANDIDATE_DIR/manifest.json"

write_inventory "$CANDIDATE_DIR" "$CANDIDATE_DIR/release.sha256"
verify_release_dir "$CANDIDATE_DIR" candidate

if [ -e "$VERSION_DIR" ]; then
  [ -d "$VERSION_DIR" ] || { echo "error: immutable version path is not a directory: $VERSION_DIR" >&2; exit 1; }
  verify_release_dir "$VERSION_DIR" existing
  if cmp -s "$VERSION_DIR/release.sha256" "$CANDIDATE_DIR/release.sha256"; then
    echo "Immutable package already exists with identical hashes: $VERSION_DIR"
    exit 0
  fi
  echo "error: refusing to overwrite immutable version $VERSION with different hashes: $VERSION_DIR" >&2
  exit 1
fi

mv "$CANDIDATE_DIR" "$VERSION_DIR"

echo
echo "Packaged immutable hzy-data-runtime $VERSION"
echo "Output: $VERSION_DIR"
echo "Release inventory SHA-256: $(sha256_file "$VERSION_DIR/release.sha256")"
echo
echo "Stage preview (no network writes):"
echo "  ./scripts/upload-r2.sh $VERSION --stage"
echo "Promote preview (no network writes):"
echo "  ./scripts/upload-r2.sh $VERSION --promote"
echo "Pinned installer after stage:"
echo "  $VERSION_DIR/install.sh"
