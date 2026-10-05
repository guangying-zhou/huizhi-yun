#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-}"
[ -n "$OUTPUT_DIR" ] || {
  echo "usage: $0 <secure-output-directory>" >&2
  exit 2
}

command -v openssl >/dev/null 2>&1 || {
  echo "error: openssl is required" >&2
  exit 1
}

PRIVATE_KEY="$OUTPUT_DIR/release-signing-private.pem"
PUBLIC_KEY="$OUTPUT_DIR/release-signing-public.pem"
[ ! -e "$PRIVATE_KEY" ] || { echo "error: refusing to overwrite $PRIVATE_KEY" >&2; exit 1; }
[ ! -e "$PUBLIC_KEY" ] || { echo "error: refusing to overwrite $PUBLIC_KEY" >&2; exit 1; }

umask 077
install -d -m 700 "$OUTPUT_DIR"
openssl genpkey -algorithm ED25519 -out "$PRIVATE_KEY"
openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
chmod 600 "$PRIVATE_KEY"
chmod 644 "$PUBLIC_KEY"

if command -v sha256sum >/dev/null 2>&1; then
  KEY_ID="$(openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER | sha256sum | awk '{print $1}')"
else
  KEY_ID="$(openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER | shasum -a 256 | awk '{print $1}')"
fi

echo "Created Ed25519 data-runtime release signing key pair."
echo "privateKey=$PRIVATE_KEY mode=600"
echo "publicKey=$PUBLIC_KEY mode=644"
echo "keyId=$KEY_ID"
