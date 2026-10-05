#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${HZY_CONNECTOR_RUNTIME_SERVICE_NAME:-hzy-connector-runtime}"
INSTALL_DIR="${HZY_CONNECTOR_RUNTIME_INSTALL_DIR:-/opt/hzy/connector-runtime}"
ENV_FILE="${HZY_CONNECTOR_RUNTIME_ENV_FILE:-$INSTALL_DIR/.env}"
BINARY="${HZY_CONNECTOR_RUNTIME_BINARY:-/usr/local/bin/hzy-connector-runtime}"
PRIVATE_KEY_FILE="${HZY_CONNECTOR_RUNTIME_PRIVATE_KEY_FILE:-/etc/hzy-connector-runtime/connector-private.pem}"
RELEASE_PUBLIC_KEY_FILE="${HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE:-/etc/hzy-connector-runtime/release-signing-public.pem}"
EXPECTED_VERSION="${HZY_CONNECTOR_RUNTIME_EXPECTED_VERSION:-}"
EXPECTED_TENANT="${HZY_CONNECTOR_RUNTIME_EXPECTED_TENANT:-}"
EXPECTED_DEPLOYMENT="${HZY_CONNECTOR_RUNTIME_EXPECTED_DEPLOYMENT:-}"
EXPECTED_DATA_RUNTIME_URL="${HZY_CONNECTOR_RUNTIME_EXPECTED_DATA_RUNTIME_URL:-}"
EXPECTED_RELEASE_KEY_ID="${HZY_CONNECTOR_RUNTIME_EXPECTED_RELEASE_KEY_ID:-}"

fail() { echo "[connector-runtime-verify] FAIL: $*" >&2; exit 1; }
pass() { echo "[connector-runtime-verify] PASS: $*"; }

for command in curl openssl python3 stat systemctl; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
[[ -x "$BINARY" ]] || fail "binary is not executable: $BINARY"
[[ -r "$ENV_FILE" ]] || fail "environment file is not readable: $ENV_FILE"
[[ -e "$PRIVATE_KEY_FILE" ]] || fail "connector private key is missing: $PRIVATE_KEY_FILE"
[[ -r "$RELEASE_PUBLIC_KEY_FILE" ]] || fail "release public key is not readable: $RELEASE_PUBLIC_KEY_FILE"

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

[[ "$(file_mode "$ENV_FILE")" == "600" ]] || fail "environment file mode must be 600"
[[ "$(file_mode "$PRIVATE_KEY_FILE")" == "600" ]] || fail "connector private key mode must be 600"
release_key_mode="$(file_mode "$RELEASE_PUBLIC_KEY_FILE")"
[[ $((8#$release_key_mode & 022)) -eq 0 ]] || fail "release public key must not be group/other writable"
pass "file permissions"

read_env_value() {
  python3 - "$ENV_FILE" "$1" <<'PY'
import json
import re
import sys

path, wanted = sys.argv[1:]
for raw in open(path, encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() != wanted:
        continue
    value = value.strip()
    try:
        print(json.loads(value))
    except Exception:
        if re.fullmatch(r"[A-Za-z0-9_./:@+-]*", value):
            print(value)
        else:
            raise SystemExit(f"unsafe value encoding for {wanted}")
    raise SystemExit(0)
raise SystemExit(f"missing {wanted}")
PY
}

port="$(read_env_value HZY_CONNECTOR_RUNTIME_PORT)"
sqlite_path="$(read_env_value HZY_CONNECTOR_RUNTIME_SQLITE_PATH)"
data_runtime_url="$(read_env_value HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL)"

python3 - "$data_runtime_url" "$EXPECTED_DATA_RUNTIME_URL" <<'PY'
import ipaddress
import sys
from urllib.parse import urlsplit

actual, expected = sys.argv[1:]
parsed = urlsplit(actual)
hostname = parsed.hostname or ""
loopback = hostname.lower() == "localhost"
if not loopback:
    try:
        loopback = ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        pass
secure = parsed.scheme == "https" or (parsed.scheme == "http" and loopback)
clean = bool(parsed.netloc) and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ("", "/")
try:
    _ = parsed.port
except ValueError:
    clean = False
if not secure or not clean:
    raise SystemExit("configured data-runtime URL is not a secure origin")
normalized = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
if expected and normalized != expected.rstrip("/"):
    raise SystemExit("configured data-runtime URL does not match the expected origin")
print(normalized)
PY
pass "fixed data-runtime origin"

systemctl is-active --quiet "$SERVICE_NAME.service" || fail "$SERVICE_NAME.service is not active"
systemctl is-enabled --quiet "$SERVICE_NAME.service" || fail "$SERVICE_NAME.service is not enabled"
systemctl is-active --quiet "$SERVICE_NAME-update.timer" || fail "$SERVICE_NAME-update.timer is not active"
systemctl is-enabled --quiet "$SERVICE_NAME-update.timer" || fail "$SERVICE_NAME-update.timer is not enabled"
[[ "$(systemctl show "$SERVICE_NAME.service" --property ActiveState --value)" == "active" ]] || fail "service ActiveState is not active"
[[ "$(systemctl show "$SERVICE_NAME.service" --property SubState --value)" == "running" ]] || fail "service SubState is not running"
[[ "$(systemctl show "$SERVICE_NAME.service" --property ExecMainStatus --value)" == "0" ]] || fail "service main process did not exit cleanly"
pass "systemd service and update timer"

actual_version="$("$BINARY" -version | tr -d '[:space:]')"
[[ "$actual_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || fail "binary version is not exact semver"
[[ -z "$EXPECTED_VERSION" || "$actual_version" == "$EXPECTED_VERSION" ]] || fail "binary version does not match expected version"
[[ -s "$sqlite_path" ]] || fail "SQLite operation store is missing or empty"
[[ "$(file_mode "$sqlite_path")" == "600" ]] || fail "SQLite operation store mode must be 600"
pass "binary $actual_version and SQLite store"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
health_file="$tmp_dir/health.json"
capabilities_file="$tmp_dir/capabilities.json"

ready=0
for ((attempt = 1; attempt <= 20; attempt++)); do
  if curl --noproxy '*' --connect-timeout 2 --max-time 5 -fsS \
      "http://127.0.0.1:$port/runtime/health" -o "$health_file" \
    && curl --noproxy '*' --connect-timeout 2 --max-time 5 -fsS \
      "http://127.0.0.1:$port/runtime/capabilities" -o "$capabilities_file"; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" -eq 1 ]] || fail "runtime health/capabilities did not become ready"

python3 - "$health_file" "$capabilities_file" "$EXPECTED_VERSION" "$EXPECTED_TENANT" "$EXPECTED_DEPLOYMENT" <<'PY'
import json
import sys

health_path, capabilities_path, expected_version, expected_tenant, expected_deployment = sys.argv[1:]
health = json.load(open(health_path, encoding="utf-8")).get("data", {})
capabilities = json.load(open(capabilities_path, encoding="utf-8")).get("data", {})

def require(condition, message):
    if not condition:
        raise SystemExit(message)

require(health.get("status") == "ok", "health status is not ok")
require(health.get("runtimeProduct") == "hzy-connector-runtime", "wrong runtime product")
require(health.get("authMode") == "jwt", "runtime auth mode is not jwt")
require(health.get("deliveryStore") == "ready", "operation store is not ready")
require(health.get("deliveryStoreType") == "sqlite", "operation store is not sqlite")
require(set(health.get("providers", [])) == {"wecom", "dingtalk"}, "provider set mismatch")
if expected_version:
    require(health.get("version") == expected_version, "health version mismatch")
if expected_tenant:
    require(health.get("tenant") == expected_tenant, "tenant binding mismatch")
if expected_deployment:
    require(health.get("deployment") == expected_deployment, "deployment binding mismatch")

require(capabilities.get("schemaVersion") == "hzy.connector-capabilities.v1", "capability schema mismatch")
require(capabilities.get("runtimeProduct") == "hzy-connector-runtime", "capability product mismatch")
require(capabilities.get("arbitraryHttpProxy") is False, "arbitrary HTTP proxy must be disabled")
require(set(capabilities.get("channels", [])) == {"wecom", "dingtalk"}, "channel set mismatch")
expected_scopes = {
    "connector-runtime:notifications:send",
    "connector-runtime:deliveries:read",
    "connector-runtime:deliveries:reconcile",
    "connector-runtime:identity:exchange",
    "connector-runtime:identity:dingtalk:exchange",
    "connector-runtime:people:sync",
    "connector-runtime:jobs:view",
    "connector-runtime:jobs:cancel",
    "connector-runtime:diagnostics:view",
    "connector-runtime:directory:sync",
}
require(set(capabilities.get("scopes", [])) == expected_scopes, "scope set mismatch")
providers = {item.get("code"): item for item in capabilities.get("providers", [])}
require(set(providers) == {"wecom", "dingtalk"}, "provider registry mismatch")
require(providers["wecom"].get("allowedOrigins") == ["https://qyapi.weixin.qq.com"], "WeCom origin policy mismatch")
require(providers["dingtalk"].get("allowedOrigins") == ["https://api.dingtalk.com", "https://oapi.dingtalk.com"], "DingTalk origin policy mismatch")
for provider in providers.values():
    require(provider.get("dynamicTargetAllowed") is False, "dynamic provider target must be disabled")
    require(provider.get("credentialSource") == "console-vault", "provider credential source mismatch")
capability_map = {item.get("code"): item for item in capabilities.get("capabilities", [])}
wecom_login = capability_map.get("identity.wecom.browser-login", {})
require(wecom_login.get("version") == "v1", "WeCom browser login capability missing")
require(wecom_login.get("method") == "POST", "WeCom browser login method mismatch")
require(wecom_login.get("path") == "/v1/identity/wecom/authorizations", "WeCom browser login path mismatch")
require(wecom_login.get("requiredScope") == "connector-runtime:identity:exchange", "WeCom browser login scope mismatch")
PY
pass "health, binding and typed capabilities"

probe_status="$(curl --noproxy '*' --connect-timeout 5 --max-time 15 -sS \
  -o "$tmp_dir/data-runtime-probe.json" -w '%{http_code}' \
  -X POST "${data_runtime_url%/}/runtime/internal/connector-runtime/people-sync-batches" \
  -H 'content-type: application/json' --data '{}')"
[[ "$probe_status" == "401" ]] || fail "data-runtime signature boundary probe returned HTTP $probe_status"
python3 - "$tmp_dir/data-runtime-probe.json" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
error = payload.get("error", {})
if error.get("code") != "connector_runtime_signature_missing":
    raise SystemExit("unexpected data-runtime rejection code")
PY
pass "data-runtime HTTPS reachability and signature fail-closed boundary"

public_der="$tmp_dir/release-public.der"
openssl pkey -pubin -in "$RELEASE_PUBLIC_KEY_FILE" -outform DER -out "$public_der" 2>/dev/null \
  || fail "release public key is invalid"
if command -v sha256sum >/dev/null 2>&1; then
  release_key_id="$(sha256sum "$public_der" | awk '{print $1}')"
else
  release_key_id="$(openssl dgst -sha256 "$public_der" | awk '{print $NF}')"
fi
[[ -z "$EXPECTED_RELEASE_KEY_ID" || "$release_key_id" == "$EXPECTED_RELEASE_KEY_ID" ]] \
  || fail "release signing key ID does not match the expected trust anchor"
pass "release trust anchor $release_key_id"

echo "[connector-runtime-verify] OK version=$actual_version service=$SERVICE_NAME"
