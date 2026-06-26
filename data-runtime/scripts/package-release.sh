#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="github.com/huizhi-yun/data-runtime"
OUT_DIR="${HZY_DATA_RUNTIME_PACKAGE_DIR:-$ROOT/build/packages/hzy-data-runtime}"

if [ "$#" -gt 0 ]; then
  VERSION="$1"
elif [ -n "${HZY_DATA_RUNTIME_VERSION:-}" ]; then
  VERSION="$HZY_DATA_RUNTIME_VERSION"
elif [ -f "$ROOT/VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
else
  VERSION="$(date -u +%Y.%m.%d.%H%M)"
fi

[ -n "$VERSION" ] || { echo "error: version is required" >&2; exit 1; }

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
LDFLAGS="-s -w -X ${MODULE}/internal/version.Version=${VERSION} -X ${MODULE}/internal/version.Commit=${COMMIT} -X ${MODULE}/internal/version.BuiltAt=${BUILT_AT}"

VERSION_DIR="$OUT_DIR/$VERSION"
LATEST_DIR="$OUT_DIR/latest"
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

write_checksum() {
  local file="$1"
  local checksum_file="$file.sha256"
  printf "%s  %s\n" "$(sha256_file "$file")" "$(basename "$file")" > "$checksum_file"
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
  local version_archive="hzy-data-runtime_${VERSION}_linux_${arch}.tar.gz"
  local latest_archive="hzy-data-runtime_linux_${arch}.tar.gz"

  mkdir -p "$build_dir" "$payload" "$VERSION_DIR" "$LATEST_DIR"

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

  create_archive "$payload" "$VERSION_DIR/$version_archive"
  write_checksum "$VERSION_DIR/$version_archive"

  cp "$VERSION_DIR/$version_archive" "$LATEST_DIR/$latest_archive"
  write_checksum "$LATEST_DIR/$latest_archive"
}

write_manifest() {
  local dir="$1"
  local manifest_version="$2"
  cat > "$dir/version.txt" <<EOF_VERSION
$manifest_version
EOF_VERSION
  cat > "$dir/manifest.json" <<EOF_MANIFEST
{
  "name": "hzy-data-runtime",
  "version": "$manifest_version",
  "commit": "$COMMIT",
  "builtAt": "$BUILT_AT",
  "platforms": [
    {
      "os": "linux",
      "arch": "amd64"
    },
    {
      "os": "linux",
      "arch": "arm64"
    }
  ]
}
EOF_MANIFEST
}

mkdir -p "$VERSION_DIR" "$LATEST_DIR" "$OUT_DIR"

build_arch amd64
build_arch arm64

cp "$ROOT/deploy/install.sh" "$OUT_DIR/install.sh"
cp "$ROOT/deploy/install.sh" "$LATEST_DIR/install.sh"
chmod 755 "$OUT_DIR/install.sh" "$LATEST_DIR/install.sh"

write_manifest "$VERSION_DIR" "$VERSION"
write_manifest "$LATEST_DIR" "$VERSION"

echo
echo "Packaged hzy-data-runtime $VERSION"
echo "Output: $OUT_DIR"
echo
echo "Upload:"
echo "  ./scripts/upload-r2.sh $VERSION"
echo
echo "Install:"
echo "  curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash"
echo "  curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --version $VERSION"
