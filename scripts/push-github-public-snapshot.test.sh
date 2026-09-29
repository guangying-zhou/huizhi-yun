#!/usr/bin/env bash
# Regression tests for the public-snapshot sanitizer shared by
# scripts/push-github-public-main.sh and scripts/push-github-public-branch.sh.
# Run: bash scripts/push-github-public-snapshot.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/github-public-snapshot.sh
source "$script_dir/lib/github-public-snapshot.sh"

failures=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

# Assembled at runtime so this test file never carries a literal armor block.
armor_begin="-----BEGIN"
armor_end="-----END"
write_key_block() {
  local file="$1" label="$2"
  {
    echo "$armor_begin $label-----"
    echo "MIIEowIBAAKCAQEAfakefakefakefakefakefakefakefakefakefakefakefake"
    echo "$armor_end $label-----"
  } > "$file"
}

expect_sanitize() {
  local name="$1" expected="$2" dir="$3"
  local rc
  ( set -e; public_snapshot_sanitize "$dir" ) >/dev/null 2>&1
  rc=$?
  if [[ "$expected" == "reject" && $rc -ne 0 ]]; then
    pass "$name (rejected)"
  elif [[ "$expected" == "accept" && $rc -eq 0 ]]; then
    pass "$name (accepted)"
  else
    fail "$name (rc=$rc, expected $expected)"
  fi
}

base="$(mktemp -d "${TMPDIR:-/tmp}/hzy-public-snapshot-test.XXXXXX")"
trap 'rm -rf "$base"' EXIT

for label in "RSA PRIVATE KEY" "DSA PRIVATE KEY" "EC PRIVATE KEY" "OPENSSH PRIVATE KEY" \
  "ENCRYPTED PRIVATE KEY" "PRIVATE KEY" "PGP PRIVATE KEY BLOCK"; do
  dir="$base/${label// /_}"
  mkdir -p "$dir"
  write_key_block "$dir/leaked.txt" "$label"
  expect_sanitize "armored $label" reject "$dir"
done

dir="$base/json-escaped"
mkdir -p "$dir"
printf '{"private_key":"%s PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFfake\\n%s PRIVATE KEY-----\\n"}\n' \
  "$armor_begin" "$armor_end" > "$dir/service-account.txt"
expect_sanitize "private key embedded in a JSON string" reject "$dir"

dir="$base/tokens"
mkdir -p "$dir"
# Split so this file does not itself carry a token-shaped literal.
token_prefix="gh""p_"
echo "token: ${token_prefix}0123456789abcdefghijklmnopqrstuvwx" > "$dir/notes.md"
expect_sanitize "provider access token literal" reject "$dir"

# The sanitizer scans its own sources when the workspace is published; the
# pattern text must not match itself.
dir="$base/self"
mkdir -p "$dir/scripts/lib"
cp "$script_dir/lib/github-public-snapshot.sh" "$dir/scripts/lib/"
cp "$script_dir/push-github-public-main.sh" "$script_dir/push-github-public-branch.sh" \
  "$script_dir/push-github-public-snapshot.test.sh" "$dir/scripts/"
expect_sanitize "publisher sources themselves" accept "$dir"

dir="$base/carriers"
mkdir -p "$dir"
echo "SECRET=1" > "$dir/.env"
echo "SECRET=1" > "$dir/.env.production"
echo "SECRET=" > "$dir/.env.example"
echo "key" > "$dir/server.key"
echo "fine" > "$dir/README.md"
expect_sanitize "environment and key carriers" accept "$dir"
[[ ! -e "$dir/.env" ]] && pass ".env removed" || fail ".env survived"
[[ ! -e "$dir/.env.production" ]] && pass ".env.production removed" || fail ".env.production survived"
[[ ! -e "$dir/server.key" ]] && pass "server.key removed" || fail "server.key survived"
[[ -e "$dir/.env.example" ]] && pass ".env.example kept" || fail ".env.example removed"
[[ -e "$dir/README.md" ]] && pass "regular file kept" || fail "regular file removed"

if [[ $failures -gt 0 ]]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all public snapshot sanitizer checks passed"
