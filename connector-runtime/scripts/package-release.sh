#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_ROOT="$(cd "$ROOT_DIR/../notification-runtime" && pwd)"
VERSION="${VERSION:-$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")}"
OUT_DIR="${HZY_CONNECTOR_RUNTIME_PACKAGE_DIR:-$ROOT_DIR/build/packages/hzy-connector-runtime}"
SIGNING_KEY_FILE="${HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE:-}"
OPENSSL="${OPENSSL_BIN:-openssl}"
GO_BIN="${GO_BIN:-go}"
PACKAGE_NAME="hzy-connector-runtime"
TARGETS="${TARGETS:-linux/amd64 linux/arm64}"
MODULE="github.com/huizhi-yun/notification-runtime"
COMMIT="${HZY_CONNECTOR_RUNTIME_COMMIT:-$(git -C "$ROOT_DIR/.." rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BUILT_AT="${HZY_CONNECTOR_RUNTIME_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
VERSION_DIR="$OUT_DIR/$VERSION"
LATEST_DIR="$OUT_DIR/latest"

printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$' \
  || { echo "error: version must be an exact semantic version" >&2; exit 1; }
[ -n "$SIGNING_KEY_FILE" ] || { echo "error: HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE is required" >&2; exit 1; }
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
if [ "$GO_BIN" = "go" ]; then
  command -v go >/dev/null 2>&1 || { echo "error: go is required to build Connector Runtime" >&2; exit 1; }
elif [ ! -x "$GO_BIN" ]; then
  echo "error: GO_BIN is not executable: $GO_BIN" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
[ ! -e "$VERSION_DIR" ] || { echo "error: refusing to overwrite immutable version $VERSION: $VERSION_DIR" >&2; exit 1; }
TMP_DIR="$(mktemp -d "$OUT_DIR/.package-${VERSION}.XXXXXX")"
CANDIDATE_DIR="$TMP_DIR/$VERSION"
PUBLIC_KEY_DER="$TMP_DIR/release-public-key.der"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$CANDIDATE_DIR"
"$OPENSSL" pkey -in "$SIGNING_KEY_FILE" -pubout -outform DER -out "$PUBLIC_KEY_DER"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sign_file() {
  local file="$1"
  "$OPENSSL" pkeyutl -sign -rawin -inkey "$SIGNING_KEY_FILE" -in "$file" -out "$file.sig"
  "$OPENSSL" pkeyutl -verify -rawin -pubin -inkey "$PUBLIC_KEY_DER" -keyform DER -in "$file" -sigfile "$file.sig" >/dev/null
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

SIGNING_KEY_ID="$(sha256_file "$PUBLIC_KEY_DER")"
declare -A FILES
declare -A SHAS
declare -A SIGNATURES
for target in $TARGETS; do
  os="${target%/*}"
  arch="${target#*/}"
  [[ "$os" == "linux" ]] || { echo "unsupported target: $target" >&2; exit 1; }
  suffix="$os-$arch"
  payload="$TMP_DIR/payload-$suffix"
  mkdir -p "$payload/schema"
  echo "Building $suffix"
  GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 "$GO_BIN" build \
    -C "$MODULE_ROOT" -trimpath \
    -ldflags "-s -w -X ${MODULE}/internal/version.Version=$VERSION" \
    -o "$payload/$PACKAGE_NAME" ./cmd/hzy-connector-runtime
  chmod 755 "$payload/$PACKAGE_NAME"
  cp "$MODULE_ROOT/schema/001_notification_delivery_ledger.sql" "$payload/schema/"
  cp "$MODULE_ROOT/schema/002_notification_delivery_reconciliation.sql" "$payload/schema/"
  cp "$ROOT_DIR/README.md" "$payload/README.md"
  cp "$ROOT_DIR/deploy/migrate-notification-runtime.sh" "$payload/migrate-notification-runtime.sh"
  cp "$ROOT_DIR/deploy/verify-installation.sh" "$payload/verify-installation.sh"
  cp "$ROOT_DIR/deploy/verify-slo-window.sh" "$payload/verify-slo-window.sh"
  chmod 755 "$payload/migrate-notification-runtime.sh"
  chmod 755 "$payload/verify-installation.sh"
  chmod 755 "$payload/verify-slo-window.sh"
  printf '%s\n' "$VERSION" > "$payload/VERSION"
  archive="${PACKAGE_NAME}_${VERSION}_linux_${arch}.tar.gz"
  COPYFILE_DISABLE=1 tar --format ustar -C "$payload" -czf "$CANDIDATE_DIR/$archive" .
  sign_file "$CANDIDATE_DIR/$archive"
  sha="$(sha256_file "$CANDIDATE_DIR/$archive")"
  printf '%s  %s\n' "$sha" "$archive" > "$CANDIDATE_DIR/$archive.sha256"
  FILES["$suffix"]="$VERSION/$archive"
  SHAS["$suffix"]="$sha"
  SIGNATURES["$suffix"]="$VERSION/$archive.sig"
done

schema1="schema/001_notification_delivery_ledger.sql"
schema2="schema/002_notification_delivery_reconciliation.sql"
schema1_sha="$(sha256_file "$MODULE_ROOT/$schema1")"
schema2_sha="$(sha256_file "$MODULE_ROOT/$schema2")"
MANIFEST="$TMP_DIR/latest.json"
{
  printf '{\n'
  printf '  "name": "%s",\n' "$PACKAGE_NAME"
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "commit": "%s",\n' "$COMMIT"
  printf '  "builtAt": "%s",\n' "$BUILT_AT"
  printf '  "signature": {"algorithm":"Ed25519","keyId":"%s","path":"latest.json.sig"},\n' "$SIGNING_KEY_ID"
  printf '  "files": {\n'
  first=1
  for key in $(printf '%s\n' "${!FILES[@]}" | sort); do
    [[ "$first" -eq 0 ]] && printf ',\n'; first=0
    printf '    "%s": "%s"' "$key" "${FILES[$key]}"
  done
  printf '\n  },\n'
  printf '  "sha256": {\n'
  first=1
  for key in $(printf '%s\n' "${!SHAS[@]}" | sort); do
    [[ "$first" -eq 0 ]] && printf ',\n'; first=0
    printf '    "%s": "%s"' "$key" "${SHAS[$key]}"
  done
  printf '\n  },\n'
  printf '  "signatures": {\n'
  first=1
  for key in $(printf '%s\n' "${!SIGNATURES[@]}" | sort); do
    [[ "$first" -eq 0 ]] && printf ',\n'; first=0
    printf '    "%s": "%s"' "$key" "${SIGNATURES[$key]}"
  done
  printf '\n  },\n'
  printf '  "schema": {"version":"002","path":"%s","sha256":"%s"},\n' "$schema2" "$schema2_sha"
  printf '  "schemas": [{"version":"001","path":"%s","sha256":"%s"},{"version":"002","path":"%s","sha256":"%s"}]\n' "$schema1" "$schema1_sha" "$schema2" "$schema2_sha"
  printf '}\n'
} > "$MANIFEST"
sign_file "$MANIFEST"

INSTALLER="$TMP_DIR/install.sh"
cp "$ROOT_DIR/deploy/install.sh" "$INSTALLER"
chmod 755 "$INSTALLER"
sign_file "$INSTALLER"
cp "$INSTALLER" "$CANDIDATE_DIR/install.sh"
cp "$INSTALLER.sig" "$CANDIDATE_DIR/install.sh.sig"
cp "$MANIFEST" "$CANDIDATE_DIR/manifest.json"
cp "$MANIFEST.sig" "$CANDIDATE_DIR/manifest.json.sig"
printf '%s\n' "$VERSION" > "$CANDIDATE_DIR/version.txt"
write_inventory "$CANDIDATE_DIR" "$CANDIDATE_DIR/release.sha256"
mv "$CANDIDATE_DIR" "$VERSION_DIR"
rm -rf "$LATEST_DIR"
mkdir -p "$LATEST_DIR"
for target in $TARGETS; do
  arch="${target#*/}"
  archive="${PACKAGE_NAME}_${VERSION}_linux_${arch}.tar.gz"
  cp "$VERSION_DIR/$archive" "$LATEST_DIR/${PACKAGE_NAME}_linux_${arch}.tar.gz"
  cp "$VERSION_DIR/$archive.sig" "$LATEST_DIR/${PACKAGE_NAME}_linux_${arch}.tar.gz.sig"
  cp "$VERSION_DIR/$archive.sha256" "$LATEST_DIR/${PACKAGE_NAME}_linux_${arch}.tar.gz.sha256"
done
cp "$INSTALLER" "$OUT_DIR/install.sh"
cp "$INSTALLER.sig" "$OUT_DIR/install.sh.sig"
cp "$INSTALLER" "$LATEST_DIR/install.sh"
cp "$INSTALLER.sig" "$LATEST_DIR/install.sh.sig"
cp "$MANIFEST" "$OUT_DIR/latest.json"
cp "$MANIFEST.sig" "$OUT_DIR/latest.json.sig"
cp "$MANIFEST" "$LATEST_DIR/manifest.json"
cp "$MANIFEST.sig" "$LATEST_DIR/manifest.json.sig"
printf '%s\n' "$VERSION" > "$LATEST_DIR/version.txt"
echo "Packaged immutable $PACKAGE_NAME $VERSION"
echo "Artifacts written to $OUT_DIR"
echo "releaseSigningKeyId=$SIGNING_KEY_ID"
echo "Next:"
echo "  ./scripts/upload-r2.sh $VERSION --stage"
echo "  ./scripts/upload-r2.sh $VERSION --promote"
