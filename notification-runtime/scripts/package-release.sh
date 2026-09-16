#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")}"
OUT_DIR="${HZY_NOTIFICATION_RUNTIME_PACKAGE_DIR:-$ROOT_DIR/build/packages/hzy-notification-runtime}"
PACKAGE_NAME="hzy-notification-runtime"
TARGETS="${TARGETS:-linux/amd64 linux/arm64}"
MODULE="github.com/huizhi-yun/notification-runtime"
COMMIT="${HZY_NOTIFICATION_RUNTIME_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BUILT_AT="${HZY_NOTIFICATION_RUNTIME_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
VERSION_DIR="$OUT_DIR/$VERSION"
LATEST_DIR="$OUT_DIR/latest"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

rm -rf "$OUT_DIR"
mkdir -p "$VERSION_DIR" "$LATEST_DIR"

declare -A FILES
declare -A SHAS

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    echo "sha256sum, shasum or openssl is required for checksum generation" >&2
    exit 1
  fi
}

write_checksum() {
  local file="$1"
  printf "%s  %s\n" "$(sha256_file "$file")" "$(basename "$file")" > "$file.sha256"
}

SCHEMA_001_PATH="schema/001_notification_delivery_ledger.sql"
SCHEMA_002_PATH="schema/002_notification_delivery_reconciliation.sql"
SCHEMA_001_SHA="$(sha256_file "$ROOT_DIR/$SCHEMA_001_PATH")"
SCHEMA_002_SHA="$(sha256_file "$ROOT_DIR/$SCHEMA_002_PATH")"

copy_payload_file() {
  local name="$1"
  local payload="$2"
  if [[ -f "$ROOT_DIR/$name" ]]; then
    cp "$ROOT_DIR/$name" "$payload/$name"
  fi
}

write_manifest() {
  local dir="$1"
  cat > "$dir/version.txt" <<EOF_VERSION
$VERSION
EOF_VERSION
  cat > "$dir/manifest.json" <<EOF_MANIFEST
{
  "name": "hzy-notification-runtime",
  "version": "$VERSION",
  "commit": "$COMMIT",
  "builtAt": "$BUILT_AT",
  "schema": {
    "version": "002",
    "path": "$SCHEMA_002_PATH",
    "sha256": "$SCHEMA_002_SHA"
  },
  "schemas": [
    {"version": "001", "path": "$SCHEMA_001_PATH", "sha256": "$SCHEMA_001_SHA"},
    {"version": "002", "path": "$SCHEMA_002_PATH", "sha256": "$SCHEMA_002_SHA"}
  ],
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

for target in $TARGETS; do
  os="${target%/*}"
  arch="${target#*/}"
  suffix="${os}-${arch}"
  if [[ "$os" != "linux" ]]; then
    echo "Skipping unsupported target $target; notification-runtime packages are Linux-only" >&2
    continue
  fi
  build_dir="$TMP_DIR/build-$suffix"
  payload="$TMP_DIR/payload-$suffix"
  mkdir -p "$build_dir" "$payload"
  echo "Building $suffix"
  GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags "-s -w -X ${MODULE}/internal/version.Version=$VERSION" \
    -o "$build_dir/$PACKAGE_NAME" \
    "$ROOT_DIR/cmd/hzy-notification-runtime"
  cp "$build_dir/$PACKAGE_NAME" "$payload/$PACKAGE_NAME"
  chmod 755 "$payload/$PACKAGE_NAME"
  copy_payload_file ".env.example" "$payload"
  copy_payload_file "config.example.json" "$payload"
  copy_payload_file "README.md" "$payload"
  mkdir -p "$payload/schema"
  cp "$ROOT_DIR/$SCHEMA_001_PATH" "$payload/schema/"
  cp "$ROOT_DIR/$SCHEMA_002_PATH" "$payload/schema/"
  printf "%s\n" "$VERSION" > "$payload/VERSION"

  version_archive="${PACKAGE_NAME}_${VERSION}_linux_${arch}.tar.gz"
  latest_archive="${PACKAGE_NAME}_linux_${arch}.tar.gz"
  COPYFILE_DISABLE=1 tar --format ustar -C "$payload" -czf "$VERSION_DIR/$version_archive" .
  write_checksum "$VERSION_DIR/$version_archive"
  cp "$VERSION_DIR/$version_archive" "$LATEST_DIR/$latest_archive"
  write_checksum "$LATEST_DIR/$latest_archive"

  sha="$(sha256_file "$VERSION_DIR/$version_archive")"
  FILES["$suffix"]="$VERSION/$version_archive"
  SHAS["$suffix"]="$sha"
done

manifest="$OUT_DIR/latest.json"
{
  printf '{\n'
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "files": {\n'
  first=1
  for key in "${!FILES[@]}"; do
    [[ "$first" -eq 0 ]] && printf ',\n'
    first=0
    printf '    "%s": "%s"' "$key" "${FILES[$key]}"
  done
  printf '\n  },\n'
  printf '  "schema": {"version": "002", "path": "%s", "sha256": "%s"},\n' "$SCHEMA_002_PATH" "$SCHEMA_002_SHA"
  printf '  "schemas": [{"version": "001", "path": "%s", "sha256": "%s"}, {"version": "002", "path": "%s", "sha256": "%s"}],\n' "$SCHEMA_001_PATH" "$SCHEMA_001_SHA" "$SCHEMA_002_PATH" "$SCHEMA_002_SHA"
  printf '  "sha256": {\n'
  first=1
  for key in "${!SHAS[@]}"; do
    [[ "$first" -eq 0 ]] && printf ',\n'
    first=0
    printf '    "%s": "%s"' "$key" "${SHAS[$key]}"
  done
  printf '\n  }\n'
  printf '}\n'
} > "$manifest"

cp "$ROOT_DIR/deploy/install.sh" "$OUT_DIR/install.sh"
cp "$ROOT_DIR/deploy/install.sh" "$LATEST_DIR/install.sh"
chmod 755 "$OUT_DIR/install.sh" "$LATEST_DIR/install.sh"
write_manifest "$VERSION_DIR"
write_manifest "$LATEST_DIR"

echo "Artifacts written to $OUT_DIR"
